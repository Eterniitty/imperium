import { MARKET, STOCK_IDS, type StockId } from "@imperium/content";
import type { CommandError, MarketMineResponse, MarketOrderView, MarketResource, MarketResponse, OrderSide, ShipmentView } from "@imperium/shared";
import { bookDepth, marketFee, matchOrder, roundCredits, tradeValue, validPrice, validQuantity, zeroStock, type BookOrder } from "@imperium/sim";
import { and, asc, desc, eq, gte, ne, or, sql } from "drizzle-orm";
import type { ColonyService } from "../colony/service";
import type { Database } from "../db/client";
import { colonies, marketOrders, marketTrades, resourceLedger, shipments } from "../db/schema";
import type { Tx } from "../events/queue";
import type { HumanityService } from "../humanity/service";

type OrderRow = typeof marketOrders.$inferSelect;

export type OrderArgs = { resource: StockId; side: OrderSide; price: number; quantity: number; colonyId: string };
/** Lo que cambió con una orden, para avisar a cada afectado (carteras y colonias). */
export interface MarketEffects {
  wallets: string[];
  colonies: Array<[colonyId: string, emperorId: string]>;
}
export type MarketResult = ({ ok: true } & MarketEffects) | { ok: false; error: CommandError };

/** Un solo candado para todo el mercado: las casaciones van de una en una (sin bloqueos cruzados entre carteras). */
const MARKET_LOCK = 0x4d41524b; // "MARK"
const VIEW_CACHE_MS = 5_000;
const HOUR_MS = 3_600_000;
/** Órdenes del libro que se miran como mucho al casar una orden entrante. */
const BOOK_SCAN = 200;

/**
 * Mercado global (economía de la humanidad): libro de órdenes de compra y
 * venta por recurso, con créditos. Al crear una orden se retiene lo ofrecido
 * (los recursos de una venta salen de su colonia; los créditos de una compra,
 * de la cartera); al casarse, el vendedor cobra (menos la comisión, que va al
 * tesoro del Núcleo) y lo vendido viaja por la red del Núcleo de la colonia del
 * vendedor a la del comprador (evento `shipment.arrive`). Todo en una
 * transacción y asentado en el libro de recursos.
 *
 * Preparado para la IA: las órdenes son de un Emperador cualquiera y pasan por
 * la misma tubería de órdenes (`market.order`), sin atajos.
 */
export class MarketService {
  private viewCache: { at: number; data: MarketResponse } | null = null;

  constructor(
    private readonly db: Database,
    private readonly colonies: ColonyService,
    private readonly humanity: HumanityService,
    private readonly now: () => number = Date.now,
  ) {}

  private lock(tx: Tx) {
    return tx.execute(sql`SELECT pg_advisory_xact_lock(${MARKET_LOCK})`);
  }

  /** Crea una orden y la casa con el libro tanto como se pueda. */
  async place(emperorId: string, args: OrderArgs): Promise<MarketResult> {
    if (!STOCK_IDS.includes(args.resource) || !validPrice(args.price) || !validQuantity(args.quantity)) return { ok: false, error: "invalid_order" };
    const res = await this.db.transaction(async (tx): Promise<MarketResult> => {
      await this.lock(tx);
      const now = this.now();
      const [colony] = await tx
        .select({ id: colonies.id, systemId: colonies.systemId })
        .from(colonies)
        .where(and(eq(colonies.id, args.colonyId), eq(colonies.emperorId, emperorId)))
        .limit(1);
      if (!colony) return { ok: false, error: "no_colony" };
      const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(marketOrders).where(eq(marketOrders.emperorId, emperorId));
      if ((open?.n ?? 0) >= MARKET.maxOpenOrders) return { ok: false, error: "too_many_orders" };

      const fx: MarketEffects = { wallets: [emperorId], colonies: [] };
      let escrow = 0;
      if (args.side === "sell") {
        const out = await this.colonies.adjustStock(tx, emperorId, colony.id, { [args.resource]: -args.quantity }, "market_escrow", `sell:${args.resource}`, now);
        if (!out.ok) return out;
        fx.colonies.push([colony.id, emperorId]);
      } else {
        escrow = tradeValue(args.price, args.quantity);
        if (!(await this.humanity.spend(tx, emperorId, escrow, "market_escrow", `buy:${args.resource}`, now))) return { ok: false, error: "insufficient_credits" };
      }
      const [order] = await tx
        .insert(marketOrders)
        .values({ emperorId, colonyId: colony.id, resource: args.resource, side: args.side, price: args.price, quantity: args.quantity, remaining: args.quantity, escrowCredits: escrow, createdAt: new Date(now) })
        .returning();
      await this.match(tx, order!, colony.systemId, now, fx);
      return { ok: true, ...fx };
    });
    this.viewCache = null;
    return res;
  }

  /** Casa una orden recién creada con las del lado contrario (precio y luego antigüedad). */
  private async match(tx: Tx, taker: OrderRow, takerSystemId: string, now: number, fx: MarketEffects): Promise<void> {
    const opposite: OrderSide = taker.side === "buy" ? "sell" : "buy";
    const book = await tx
      .select({ order: marketOrders, systemId: colonies.systemId })
      .from(marketOrders)
      .innerJoin(colonies, eq(colonies.id, marketOrders.colonyId))
      .where(
        and(
          eq(marketOrders.resource, taker.resource),
          eq(marketOrders.side, opposite),
          ne(marketOrders.emperorId, taker.emperorId),
          taker.side === "buy" ? sql`${marketOrders.price} <= ${taker.price}` : sql`${marketOrders.price} >= ${taker.price}`,
        ),
      )
      .orderBy(taker.side === "buy" ? asc(marketOrders.price) : desc(marketOrders.price), asc(marketOrders.seq))
      .limit(BOOK_SCAN)
      .for("update", { of: marketOrders });
    const byId = new Map(book.map((b) => [b.order.id, b]));
    const { fills } = matchOrder(
      { ownerId: taker.emperorId, side: taker.side as OrderSide, price: taker.price, quantity: taker.remaining },
      book.map((b): BookOrder => ({ id: b.order.id, ownerId: b.order.emperorId, side: opposite, price: b.order.price, remaining: b.order.remaining, createdAt: b.order.seq })),
    );

    let takerLeft = taker.remaining;
    let takerEscrow = taker.escrowCredits;
    for (const fill of fills) {
      const maker = byId.get(fill.makerId)!;
      const buy = taker.side === "buy" ? { order: taker, systemId: takerSystemId } : maker;
      const sell = taker.side === "buy" ? maker : { order: taker, systemId: takerSystemId };
      const value = tradeValue(fill.price, fill.quantity);
      const fee = marketFee(value);
      const resource = taker.resource as StockId;

      const [trade] = await tx
        .insert(marketTrades)
        .values({
          resource,
          price: fill.price,
          quantity: fill.quantity,
          buyerId: buy.order.emperorId,
          sellerId: sell.order.emperorId,
          buyerColonyId: buy.order.colonyId,
          sellerColonyId: sell.order.colonyId,
          createdAt: new Date(now),
        })
        .returning({ id: marketTrades.id });
      const ref = `trade:${trade!.id}`;
      // El vendedor cobra; la comisión va al tesoro de la humanidad.
      await this.humanity.credit(tx, sell.order.emperorId, roundCredits(value - fee), "market_sale", ref);
      await this.humanity.creditTreasury(tx, fee, "market_fee", ref);
      // El comprador ya pagó al precio de su orden: se le devuelve la diferencia si casó más barato.
      const reserved = tradeValue(buy.order.price, fill.quantity);
      const refund = roundCredits(reserved - value);
      if (refund > 0) await this.humanity.credit(tx, buy.order.emperorId, refund, "market_refund", ref);
      // Lo vendido viaja de la colonia del vendedor a la del comprador.
      await this.humanity.sendShipment(
        tx,
        {
          kind: "trade",
          emperorId: buy.order.emperorId,
          fromColonyId: sell.order.colonyId,
          fromSystemId: sell.systemId,
          toColonyId: buy.order.colonyId,
          toSystemId: buy.systemId,
          tradeId: trade!.id,
          amounts: { [resource]: fill.quantity },
        },
        now,
      );

      // La orden del libro: baja lo que queda (o se borra, devolviendo el polvo de créditos retenidos).
      const makerLeft = maker.order.remaining - fill.quantity;
      const makerEscrow = maker.order.side === "buy" ? roundCredits(maker.order.escrowCredits - reserved) : 0;
      await this.updateOrder(tx, maker.order, makerLeft, makerEscrow);
      if (!fx.wallets.includes(maker.order.emperorId)) fx.wallets.push(maker.order.emperorId);
      takerLeft -= fill.quantity;
      if (taker.side === "buy") takerEscrow = roundCredits(takerEscrow - reserved);
    }
    if (fills.length > 0) await this.updateOrder(tx, taker, takerLeft, taker.side === "buy" ? takerEscrow : 0);
  }

  private async updateOrder(tx: Tx, order: OrderRow, remaining: number, escrow: number): Promise<void> {
    if (remaining > 0) {
      await tx.update(marketOrders).set({ remaining, escrowCredits: Math.max(0, escrow) }).where(eq(marketOrders.id, order.id));
      return;
    }
    await tx.delete(marketOrders).where(eq(marketOrders.id, order.id));
    if (escrow > 0) await this.humanity.credit(tx, order.emperorId, escrow, "market_refund", `order:${order.id}`);
  }

  /** Cancela una orden propia: se devuelve lo retenido que quede (recursos a su colonia, créditos a la cartera). */
  async cancel(emperorId: string, orderId: string): Promise<MarketResult> {
    const res = await this.db.transaction(async (tx): Promise<MarketResult> => {
      await this.lock(tx);
      const [order] = await tx
        .select()
        .from(marketOrders)
        .where(and(eq(marketOrders.id, orderId), eq(marketOrders.emperorId, emperorId)))
        .for("update")
        .limit(1);
      if (!order) return { ok: false, error: "no_order" };
      const fx: MarketEffects = { wallets: [emperorId], colonies: [] };
      await this.refund(tx, order, this.now(), fx);
      return { ok: true, ...fx };
    });
    this.viewCache = null;
    return res;
  }

  private async refund(tx: Tx, order: OrderRow, at: number, fx: MarketEffects): Promise<void> {
    await tx.delete(marketOrders).where(eq(marketOrders.id, order.id));
    if (order.side === "buy") {
      await this.humanity.credit(tx, order.emperorId, order.escrowCredits, "market_refund", `order:${order.id}`);
      return;
    }
    const back = await this.colonies.adjustStock(tx, order.emperorId, order.colonyId, { [order.resource]: order.remaining }, "market_refund", `order:${order.id}`, at);
    if (back.ok) fx.colonies.push([order.colonyId, order.emperorId]);
    else {
      // La colonia ya no es suya: lo retenido se pierde (y se apunta).
      await tx.insert(resourceLedger).values({ emperorId: order.emperorId, colonyId: null, reason: "market_lost", ref: `order:${order.id}`, [order.resource]: order.remaining });
    }
  }

  /** Al borrar una cuenta: cancela todas sus órdenes (antes de que sus colonias se independicen). */
  async cancelAll(tx: Tx, emperorId: string, at: number): Promise<number> {
    await this.lock(tx);
    const rows = await tx.select().from(marketOrders).where(eq(marketOrders.emperorId, emperorId)).for("update");
    const fx: MarketEffects = { wallets: [], colonies: [] };
    for (const o of rows) await this.refund(tx, o, at, fx);
    this.viewCache = null;
    return rows.length;
  }

  /**
   * Fase 9b: al conquistar una colonia, se cancelan las órdenes que la usan
   * (antes de cambiar de dueño). Lo retenido de una venta vuelve a la colonia
   * (sigue en sus almacenes y pasa al conquistador con la captura); los
   * créditos de una compra vuelven a la cartera de quien la puso. Los envíos
   * que ya viajan hacia ella se pierden al llegar (`shipment_lost`), como
   * cualquier envío a una colonia que ya no es del comprador.
   */
  async cancelForColony(tx: Tx, colonyId: string, at: number): Promise<MarketEffects> {
    await this.lock(tx);
    const rows = await tx.select().from(marketOrders).where(eq(marketOrders.colonyId, colonyId)).for("update");
    const fx: MarketEffects = { wallets: [], colonies: [] };
    for (const o of rows) {
      await this.refund(tx, o, at, fx);
      if (o.side === "buy") fx.wallets.push(o.emperorId);
    }
    if (rows.length) this.viewCache = null;
    return fx;
  }

  /**
   * Manejador del evento `shipment.arrive`: entrega una compra en la colonia
   * del comprador (si sigue siendo suya; si no, se pierde) o un aporte en el
   * Núcleo. Devuelve la colonia que cambió y su dueño, si la hay.
   */
  async arrive(tx: Tx, shipmentId: string): Promise<{ emperorId: string; colonyId: string } | null> {
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update").limit(1);
    if (!s) return null;
    await tx.delete(shipments).where(eq(shipments.id, s.id));
    if (s.kind === "contribution") {
      await this.humanity.receive(tx, s);
      return null;
    }
    const amounts = { metal: s.metal, volatiles: s.volatiles, crystal: s.crystal, alloys: s.alloys, rare_metals: s.rare_metals, exotic: s.exotic };
    const ref = s.tradeId !== null ? `trade:${s.tradeId}` : `shipment:${s.id}`;
    if (s.emperorId && s.toColonyId) {
      const done = await this.colonies.adjustStock(tx, s.emperorId, s.toColonyId, amounts, "market_delivery", ref, this.now());
      if (done.ok) return { emperorId: s.emperorId, colonyId: s.toColonyId };
    }
    await tx.insert(resourceLedger).values({ emperorId: s.emperorId, colonyId: null, reason: "shipment_lost", ref, ...amounts });
    return null;
  }

  // --- Lectura ---

  /** Libro, precios e historial de cada recurso (público; con caché breve). */
  async view(): Promise<MarketResponse> {
    const now = this.now();
    if (this.viewCache && now - this.viewCache.at < VIEW_CACHE_MS) return this.viewCache.data;
    const levels = await this.db
      .select({ resource: marketOrders.resource, side: marketOrders.side, price: marketOrders.price, remaining: sql<number>`sum(${marketOrders.remaining})::int` })
      .from(marketOrders)
      .groupBy(marketOrders.resource, marketOrders.side, marketOrders.price);
    const since = new Date(now - MARKET.historyHours * HOUR_MS);
    const buckets = await this.db
      .select({
        resource: marketTrades.resource,
        t: sql<number>`(extract(epoch from date_trunc('hour', ${marketTrades.createdAt})) * 1000)::float8`,
        avg: sql<number>`(sum(${marketTrades.price} * ${marketTrades.quantity}) / sum(${marketTrades.quantity}))::float8`,
        volume: sql<number>`sum(${marketTrades.quantity})::int`,
      })
      .from(marketTrades)
      .where(gte(marketTrades.createdAt, since))
      .groupBy(marketTrades.resource, sql`2`)
      .orderBy(sql`2`);
    const resources: MarketResource[] = [];
    for (const resource of STOCK_IDS) {
      const bids = bookDepth("buy", levels.filter((l) => l.resource === resource && l.side === "buy"));
      const asks = bookDepth("sell", levels.filter((l) => l.resource === resource && l.side === "sell"));
      const [last] = await this.db.select({ price: marketTrades.price }).from(marketTrades).where(eq(marketTrades.resource, resource)).orderBy(desc(marketTrades.id)).limit(1);
      const history = buckets.filter((b) => b.resource === resource).map((b) => ({ t: b.t, avg: roundCredits(b.avg), volume: b.volume }));
      resources.push({
        resource,
        bestBid: bids[0]?.price ?? null,
        bestAsk: asks[0]?.price ?? null,
        last: last?.price ?? null,
        volume24h: history.filter((h) => h.t >= now - 24 * HOUR_MS).reduce((n, h) => n + h.volume, 0),
        bids,
        asks,
        history,
      });
    }
    const data: MarketResponse = { resources, feeRate: MARKET.feeRate, at: now };
    this.viewCache = { at: now, data };
    return data;
  }

  /** Órdenes abiertas, envíos en camino y operaciones recientes del Emperador. */
  async mine(emperorId: string): Promise<MarketMineResponse> {
    const own = await this.colonies.list(emperorId);
    const colonyName = (id: string | null) => {
      const c = own.find((x) => x.id === id);
      return c ? (c.name ?? c.planetName) : "—";
    };
    const orders = await this.db.select().from(marketOrders).where(eq(marketOrders.emperorId, emperorId)).orderBy(asc(marketOrders.seq));
    const ships = await this.db.select().from(shipments).where(eq(shipments.emperorId, emperorId)).orderBy(asc(shipments.arriveAt));
    const trades = await this.db
      .select()
      .from(marketTrades)
      .where(or(eq(marketTrades.buyerId, emperorId), eq(marketTrades.sellerId, emperorId)))
      .orderBy(desc(marketTrades.id))
      .limit(20);
    return {
      orders: orders.map(
        (o): MarketOrderView => ({
          id: o.id,
          resource: o.resource as StockId,
          side: o.side as OrderSide,
          price: o.price,
          quantity: o.quantity,
          remaining: o.remaining,
          colonyId: o.colonyId,
          colonyName: colonyName(o.colonyId),
          createdAt: o.createdAt.getTime(),
        }),
      ),
      shipments: ships.map(
        (s): ShipmentView => ({
          id: s.id,
          kind: s.kind as ShipmentView["kind"],
          to: s.kind === "trade" ? colonyName(s.toColonyId) : (s.projectId ?? ""),
          amounts: { ...zeroStock(), metal: s.metal, volatiles: s.volatiles, crystal: s.crystal, alloys: s.alloys, rare_metals: s.rare_metals, exotic: s.exotic },
          departAt: s.departAt.getTime(),
          arriveAt: s.arriveAt.getTime(),
        }),
      ),
      trades: trades.map((tr) => ({
        resource: tr.resource as StockId,
        side: tr.buyerId === emperorId ? "buy" : "sell",
        price: tr.price,
        quantity: tr.quantity,
        at: tr.createdAt.getTime(),
      })),
      maxOpenOrders: MARKET.maxOpenOrders,
    };
  }

  /** Para la exportación de datos de la cuenta. */
  async exportFor(emperorId: string) {
    return {
      marketOrders: await this.db.select().from(marketOrders).where(eq(marketOrders.emperorId, emperorId)),
      marketTrades: await this.db
        .select()
        .from(marketTrades)
        .where(or(eq(marketTrades.buyerId, emperorId), eq(marketTrades.sellerId, emperorId))),
      shipments: await this.db.select().from(shipments).where(eq(shipments.emperorId, emperorId)),
    };
  }
}

