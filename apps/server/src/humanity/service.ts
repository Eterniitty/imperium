import {
  CREDITS,
  HUMANITY,
  HUMANITY_PROJECTS,
  STOCK_IDS,
  getHumanityProject,
  type HumanityProjectId,
  type StockAmounts,
} from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { SECTOR_SIZE, distance, type CommandError, type HumanityProject, type HumanityResponse, type Stock, type Wallet, type WorldPosition } from "@imperium/shared";
import {
  creditIncomePerHour,
  gameHours,
  hoursUntilTreasury,
  humanityBonuses,
  projectCost,
  projectEffect,
  projectMissing,
  projectResourcesReady,
  realDurationMs,
  roundCredits,
  shipmentHours,
  taxSplit,
  treasuryAfter,
  walletAfter,
  zeroStock,
  type HumanityBonuses,
  type ProjectLevels,
} from "@imperium/sim";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { ColonyService } from "../colony/service";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, emperorWallets, emperors, humanityContributions, humanityProjects, humanityTreasury, resourceLedger, shipments } from "../db/schema";
import { findSystem } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";

type WalletRow = typeof emperorWallets.$inferSelect;
type ShipmentRow = typeof shipments.$inferSelect;

/** Agregados de un Emperador en su último recálculo (`emperor_wallets.summary`). */
export interface WalletSummary {
  colonies: number;
  population: number;
  stock: Stock;
  /** Producción neta por hora real. */
  ratesPerHour: Stock;
}

/** Centro del Núcleo Humano: el del sector del origen (allí llegan los aportes). */
export const HUMAN_CORE_CENTER: WorldPosition = { x: SECTOR_SIZE / 2, y: SECTOR_SIZE / 2, z: SECTOR_SIZE / 2 };

export type ContributeArgs = { projectId: string; colonyId?: string; amounts?: Partial<Stock>; credits?: number };
export type ContributeResult = { ok: true; emperorId: string; colonyId: string | null } | { ok: false; error: CommandError };

/** Envío nuevo por la red del Núcleo. */
export interface ShipmentSpec {
  kind: "trade" | "contribution";
  emperorId: string;
  fromColonyId: string;
  fromSystemId: string;
  toColonyId?: string;
  toSystemId?: string;
  projectId?: string;
  tradeId?: number;
  amounts: Partial<StockAmounts>;
}

const VIEW_CACHE_MS = 10_000;
/**
 * Espera real mínima entre dos recálculos periódicos de una cartera: con
 * escalas de tiempo altas (pruebas) una hora de juego dura milisegundos y la
 * cola no haría otra cosa.
 */
const MIN_SETTLE_MS = 10_000;
/** Margen tras la hora prevista para comprobar los fondos del tesoro (redondeos). */
const FUND_MARGIN_MS = 1_000;

const sumStock = (a: Stock, b: Partial<Stock> | undefined): Stock => {
  const out = { ...a };
  if (b) for (const r of STOCK_IDS) out[r] += b[r] ?? 0;
  return out;
};
const stockOf = (r: { metal: number; volatiles: number; crystal: number; alloys: number }): Stock => ({ metal: r.metal, volatiles: r.volatiles, crystal: r.crystal, alloys: r.alloys });

/**
 * Economía de la humanidad: carteras de créditos, el tesoro común del Núcleo
 * Humano y los proyectos comunes. Todo perezoso: cada cartera se recalcula
 * (renta según la población de sus colonias) con el evento `economy.settle`,
 * una vez por hora de juego y Emperador, o cuando su dueño la usa; el tesoro
 * acumula los aportes con la suma de las rentas. Ningún bucle recorre todas
 * las colonias.
 */
export class HumanityService {
  private readonly seed: number;
  private readonly timeScale: number;
  private levels: ProjectLevels = {};
  private bonusCache: HumanityBonuses = humanityBonuses({});
  private viewCache: { at: number; data: HumanityResponse } | null = null;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    private readonly colonies: ColonyService,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
    this.timeScale = config.TIME_SCALE;
  }

  private loading: Promise<void> | null = null;

  /** Carga una vez (perezosamente: construir la aplicación no toca la base de datos). */
  ensure(): Promise<void> {
    return (this.loading ??= this.load().catch((err: unknown) => {
      this.loading = null;
      throw err;
    }));
  }

  /** Crea las filas que falten (tesoro y proyectos nuevos de content) y lee los niveles. */
  async load(): Promise<void> {
    await this.db.insert(humanityTreasury).values({ id: 1 }).onConflictDoNothing();
    await this.db
      .insert(humanityProjects)
      .values(HUMANITY_PROJECTS.map((p) => ({ projectId: p.id })))
      .onConflictDoNothing();
    await this.reload();
  }

  /** Vuelve a leer los niveles de los proyectos (tras completar uno). */
  async reload(): Promise<void> {
    const rows = await this.db.select({ id: humanityProjects.projectId, level: humanityProjects.level }).from(humanityProjects);
    const levels: ProjectLevels = {};
    for (const r of rows) levels[r.id as HumanityProjectId] = r.level;
    this.levels = levels;
    this.bonusCache = humanityBonuses(levels);
    this.viewCache = null;
  }

  /** Bonificaciones globales de los proyectos completados. */
  bonuses(): HumanityBonuses {
    return this.bonusCache;
  }

  // --- Carteras ---

  private async lockWallet(tx: Tx, emperorId: string): Promise<WalletRow | null> {
    const [row] = await tx.select().from(emperorWallets).where(eq(emperorWallets.emperorId, emperorId)).for("update").limit(1);
    return row ?? null;
  }

  private walletView(row: WalletRow, now: number): Wallet {
    const { net, tax } = taxSplit(row.incomePerHour);
    return {
      credits: walletAfter(row.credits, row.incomePerHour, gameHours(row.settledAt.getTime(), now, this.timeScale)),
      incomePerHour: net * this.timeScale,
      taxPerHour: tax * this.timeScale,
      at: now,
    };
  }

  /** Cartera del Emperador (la crea, con el saldo inicial, si aún no tiene). */
  async wallet(emperorId: string): Promise<Wallet | null> {
    let [row] = await this.db.select().from(emperorWallets).where(eq(emperorWallets.emperorId, emperorId)).limit(1);
    if (!row) {
      const ok = await this.db.transaction((tx) => this.recompute(tx, emperorId, this.now()));
      if (!ok) return null;
      [row] = await this.db.select().from(emperorWallets).where(eq(emperorWallets.emperorId, emperorId)).limit(1);
      if (!row) return null;
    }
    return this.walletView(row, this.now());
  }

  /**
   * Recalcula la cartera a la hora `at`: cobra la renta hasta ahora, mira la
   * población actual de sus colonias (nueva renta y agregados) y ajusta los
   * aportes por hora del tesoro. Si no tenía cartera, la crea con el saldo
   * inicial y programa sus recálculos periódicos. False si el Emperador no existe.
   */
  async recompute(tx: Tx, emperorId: string, at: number): Promise<boolean> {
    let w = await this.lockWallet(tx, emperorId);
    if (!w) {
      const [exists] = await tx.select({ id: emperors.id }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
      if (!exists) return false;
      const [created] = await tx
        .insert(emperorWallets)
        .values({ emperorId, credits: CREDITS.starting, settledAt: new Date(at) })
        .onConflictDoNothing()
        .returning({ emperorId: emperorWallets.emperorId });
      if (created) {
        await tx.insert(resourceLedger).values({ emperorId, reason: "starting_credits", credits: CREDITS.starting });
        await schedule(tx, "economy.settle", new Date(at + this.settleEveryMs()), { emperorId });
      }
      w = await this.lockWallet(tx, emperorId);
      if (!w) return false;
    }
    const credits = walletAfter(w.credits, w.incomePerHour, gameHours(w.settledAt.getTime(), at, this.timeScale));
    const list = await this.colonies.list(emperorId);
    const summary: WalletSummary = { colonies: list.length, population: 0, stock: zeroStock(), ratesPerHour: zeroStock() };
    for (const c of list) {
      summary.population += c.population;
      summary.stock = sumStock(summary.stock, c.stock);
      summary.ratesPerHour = sumStock(summary.ratesPerHour, c.ratesPerHour);
    }
    const income = creditIncomePerHour(summary.population);
    if (Math.abs(income - w.incomePerHour) > 1e-9) await this.changeTreasuryIncome(tx, taxSplit(income).tax - taxSplit(w.incomePerHour).tax, at);
    await tx
      .update(emperorWallets)
      .set({ credits, incomePerHour: income, settledAt: new Date(Math.max(at, w.settledAt.getTime())), summary })
      .where(eq(emperorWallets.emperorId, emperorId));
    this.viewCache = null;
    return true;
  }

  private settleEveryMs(): number {
    return Math.max(MIN_SETTLE_MS, realDurationMs(HUMANITY.settleEveryHours, this.timeScale));
  }

  /**
   * Manejador del evento `economy.settle`: recalcula y programa el siguiente
   * (si el Emperador sigue existiendo). Devuelve si cambió su renta (para
   * avisarle: si no, su cliente ya proyecta bien el saldo) o null si ya no existe.
   */
  async onSettle(tx: Tx, emperorId: string): Promise<{ changed: boolean; leveled: boolean } | null> {
    await this.ensure();
    const at = this.now();
    const before = (await this.lockWallet(tx, emperorId))?.incomePerHour ?? null;
    if (!(await this.recompute(tx, emperorId, at))) return null;
    const after = (await this.lockWallet(tx, emperorId))?.incomePerHour ?? null;
    await schedule(tx, "economy.settle", new Date(at + this.settleEveryMs()), { emperorId });
    // De paso, los proyectos que esperan fondos del tesoro (sus aportes por hora pueden haber cambiado).
    const leveled = await this.fundReady(tx, at);
    return { changed: before === null || after === null || Math.abs(before - after) > 1e-6, leveled };
  }

  /** Cobra la renta pendiente y devuelve el saldo actual (la cartera queda bloqueada en la transacción). */
  private async accrue(tx: Tx, emperorId: string, at: number): Promise<number | null> {
    let w = await this.lockWallet(tx, emperorId);
    if (!w) {
      if (!(await this.recompute(tx, emperorId, at))) return null;
      w = await this.lockWallet(tx, emperorId);
      if (!w) return null;
    }
    const credits = walletAfter(w.credits, w.incomePerHour, gameHours(w.settledAt.getTime(), at, this.timeScale));
    if (at > w.settledAt.getTime()) await tx.update(emperorWallets).set({ credits, settledAt: new Date(at) }).where(eq(emperorWallets.emperorId, emperorId));
    return credits;
  }

  /** Gasta créditos de la cartera (todo o nada) y lo asienta. False si no alcanza. */
  async spend(tx: Tx, emperorId: string, amount: number, reason: string, ref: string | null, at: number): Promise<boolean> {
    const credits = await this.accrue(tx, emperorId, at);
    if (credits === null || credits + 1e-6 < amount) return false;
    await tx
      .update(emperorWallets)
      .set({ credits: sql`greatest(0, ${emperorWallets.credits} - ${amount})` })
      .where(eq(emperorWallets.emperorId, emperorId));
    await tx.insert(resourceLedger).values({ emperorId, reason, ref, credits: -amount });
    this.viewCache = null;
    return true;
  }

  /**
   * Ingresa créditos en una cartera y lo asienta. No hace falta cobrar antes
   * la renta: el saldo perezoso es lineal, sumar ahora da lo mismo.
   */
  async credit(tx: Tx, emperorId: string, amount: number, reason: string, ref: string | null): Promise<void> {
    if (amount <= 0) return;
    const [row] = await tx
      .update(emperorWallets)
      .set({ credits: sql`${emperorWallets.credits} + ${amount}` })
      .where(eq(emperorWallets.emperorId, emperorId))
      .returning({ emperorId: emperorWallets.emperorId });
    await tx.insert(resourceLedger).values({ emperorId, reason, ref: row ? ref : `${ref ?? ""} (sin cartera)`, credits: row ? amount : 0 });
    this.viewCache = null;
  }

  // --- Tesoro del Núcleo ---

  /** Tesoro bloqueado y resuelto a la hora `at`. */
  private async settleTreasury(tx: Tx, at: number): Promise<{ credits: number; incomePerHour: number }> {
    let [t] = await tx.select().from(humanityTreasury).where(eq(humanityTreasury.id, 1)).for("update").limit(1);
    if (!t) {
      await tx.insert(humanityTreasury).values({ id: 1, settledAt: new Date(at) }).onConflictDoNothing();
      [t] = await tx.select().from(humanityTreasury).where(eq(humanityTreasury.id, 1)).for("update").limit(1);
    }
    const credits = treasuryAfter(t!.credits, t!.incomePerHour, gameHours(t!.settledAt.getTime(), at, this.timeScale));
    if (at > t!.settledAt.getTime()) await tx.update(humanityTreasury).set({ credits, settledAt: new Date(at) }).where(eq(humanityTreasury.id, 1));
    return { credits, incomePerHour: t!.incomePerHour };
  }

  private async changeTreasuryIncome(tx: Tx, delta: number, at: number): Promise<void> {
    await this.settleTreasury(tx, at);
    await tx
      .update(humanityTreasury)
      .set({ incomePerHour: sql`greatest(0, ${humanityTreasury.incomePerHour} + ${delta})` })
      .where(eq(humanityTreasury.id, 1));
  }

  /** Ingresa créditos en el tesoro (comisiones del mercado, donaciones) y lo asienta sin Emperador ni colonia. */
  async creditTreasury(tx: Tx, amount: number, reason: string, ref: string | null): Promise<void> {
    if (amount <= 0) return;
    await tx
      .update(humanityTreasury)
      .set({ credits: sql`${humanityTreasury.credits} + ${amount}` })
      .where(eq(humanityTreasury.id, 1));
    await tx.insert(resourceLedger).values({ emperorId: null, colonyId: null, reason, ref, credits: amount });
    this.viewCache = null;
  }

  /** Al borrar una cuenta: su renta deja de aportar al tesoro (la cartera se borra en cascada). */
  async onEmperorDeleted(tx: Tx, emperorId: string, at: number): Promise<void> {
    const w = await this.lockWallet(tx, emperorId);
    if (w && w.incomePerHour > 0) await this.changeTreasuryIncome(tx, -taxSplit(w.incomePerHour).tax, at);
    this.viewCache = null;
  }

  // --- Envíos por la red del Núcleo ---

  /** Crea un envío y programa su llegada (tiempo según la distancia y la Red de transporte). */
  async sendShipment(tx: Tx, spec: ShipmentSpec, at: number): Promise<{ id: string; arriveAt: number }> {
    const from = findSystem(this.seed, spec.fromSystemId);
    const toPos = spec.toSystemId ? findSystem(this.seed, spec.toSystemId)?.position : HUMAN_CORE_CENTER;
    const ly = from && toPos ? distance(from.position, toPos) : 0;
    const arriveAt = at + realDurationMs(shipmentHours(ly, this.bonusCache.shipmentSpeed), this.timeScale);
    const amounts = { ...zeroStock(), ...spec.amounts };
    const [row] = await tx
      .insert(shipments)
      .values({
        kind: spec.kind,
        emperorId: spec.emperorId,
        fromColonyId: spec.fromColonyId,
        fromSystemId: spec.fromSystemId,
        toColonyId: spec.toColonyId ?? null,
        toSystemId: spec.toSystemId ?? null,
        projectId: spec.projectId ?? null,
        tradeId: spec.tradeId ?? null,
        ...amounts,
        departAt: new Date(at),
        arriveAt: new Date(arriveAt),
      })
      .returning({ id: shipments.id });
    await schedule(tx, "shipment.arrive", new Date(arriveAt), { shipmentId: row!.id });
    return { id: row!.id, arriveAt };
  }

  // --- Proyectos comunes ---

  /**
   * Aporta a un proyecto: recursos de una colonia propia (salen ya y llegan al
   * Núcleo con un envío; no se puede mandar más de lo que le falta al nivel
   * actual, contando lo que ya va de camino) y/o créditos de la cartera, que
   * van al tesoro (que es quien paga la parte en créditos de los proyectos).
   */
  async contribute(emperorId: string, args: ContributeArgs): Promise<ContributeResult> {
    const def = getHumanityProject(args.projectId);
    if (!def) return { ok: false, error: "unknown_project" };
    const amounts = zeroStock();
    for (const r of STOCK_IDS) amounts[r] = Math.floor(Math.max(0, args.amounts?.[r] ?? 0));
    const credits = roundCredits(Math.max(0, args.credits ?? 0));
    const units = STOCK_IDS.reduce((n, r) => n + amounts[r], 0);
    if (units + credits < HUMANITY.minContribution) return { ok: false, error: "nothing_to_transfer" };
    if (units > 0 && !args.colonyId) return { ok: false, error: "no_colony" };
    await this.ensure();

    const result = await this.db.transaction(async (tx): Promise<ContributeResult> => {
      const now = this.now();
      const [p] = await tx.select().from(humanityProjects).where(eq(humanityProjects.projectId, def.id)).for("update").limit(1);
      if (!p) return { ok: false, error: "unknown_project" };
      if (p.level >= def.maxLevel) return { ok: false, error: "project_complete" };

      if (units > 0) {
        const cost = projectCost(def, p.level);
        const [transit] = await this.inTransit(tx, def.id);
        const missing = projectMissing(cost, sumStock(stockOf(p), transit));
        if (STOCK_IDS.some((r) => amounts[r] > Math.ceil(missing[r]))) return { ok: false, error: "exceeds_need" };
        const negative = zeroStock();
        for (const r of STOCK_IDS) negative[r] = -amounts[r];
        const res = await this.colonies.adjustStock(tx, emperorId, args.colonyId!, negative, "humanity_contribution", `project:${def.id}`, now);
        if (!res.ok) return res;
        await this.sendShipment(tx, { kind: "contribution", emperorId, fromColonyId: args.colonyId!, fromSystemId: res.systemId, projectId: def.id, amounts }, now);
      }
      if (credits > 0) {
        if (!(await this.spend(tx, emperorId, credits, "humanity_contribution", `project:${def.id}`, now))) throw new NotEnoughCredits();
        await this.settleTreasury(tx, now);
        await this.creditTreasury(tx, credits, "humanity_donation", `project:${def.id}`);
        await tx.insert(humanityContributions).values({ emperorId, projectId: def.id, credits });
        await this.fundReady(tx, now);
      }
      return { ok: true, emperorId, colonyId: units > 0 ? args.colonyId! : null };
    }).catch((err: unknown) => {
      if (err instanceof NotEnoughCredits) return { ok: false, error: "insufficient_credits" } as const;
      throw err;
    });
    if (result.ok) await this.reload();
    return result;
  }

  /** Recursos de camino al Núcleo para un proyecto (o para todos, sin id). */
  private async inTransit(db: Database | Tx, projectId?: string): Promise<Array<Stock & { projectId: string }>> {
    const rows = await db
      .select({
        projectId: sql<string>`${shipments.projectId}`,
        metal: sql<number>`coalesce(sum(${shipments.metal}), 0)::float8`,
        volatiles: sql<number>`coalesce(sum(${shipments.volatiles}), 0)::float8`,
        crystal: sql<number>`coalesce(sum(${shipments.crystal}), 0)::float8`,
        alloys: sql<number>`coalesce(sum(${shipments.alloys}), 0)::float8`,
      })
      .from(shipments)
      .where(and(eq(shipments.kind, "contribution"), projectId ? eq(shipments.projectId, projectId) : undefined))
      .groupBy(shipments.projectId);
    return rows;
  }

  /** Llega al Núcleo un aporte: suma al proyecto, se reconoce a quien lo hizo y, si se completa, se financia. */
  async receive(tx: Tx, s: ShipmentRow): Promise<void> {
    if (!s.projectId) return;
    await this.ensure();
    const amounts = stockOf(s);
    await tx
      .update(humanityProjects)
      .set({
        metal: sql`${humanityProjects.metal} + ${amounts.metal}`,
        volatiles: sql`${humanityProjects.volatiles} + ${amounts.volatiles}`,
        crystal: sql`${humanityProjects.crystal} + ${amounts.crystal}`,
        alloys: sql`${humanityProjects.alloys} + ${amounts.alloys}`,
      })
      .where(eq(humanityProjects.projectId, s.projectId));
    await tx.insert(humanityContributions).values({ emperorId: s.emperorId, projectId: s.projectId, ...amounts });
    this.viewCache = null;
    await this.tryFund(tx, s.projectId, this.now());
  }

  /** Intenta financiar los proyectos que ya tienen todos sus recursos. Devuelve si alguno subió de nivel. */
  async fundReady(tx: Tx, at: number): Promise<boolean> {
    let any = false;
    for (const def of HUMANITY_PROJECTS) if (await this.tryFund(tx, def.id, at)) any = true;
    return any;
  }

  /**
   * Si el proyecto tiene todos los recursos del nivel, el tesoro paga sus
   * créditos y sube de nivel (lo aportado de más pasa al siguiente). Si al
   * tesoro aún no le llega, se programa una comprobación para cuando le llegue.
   * Devuelve si subió de nivel (quien llama recarga los niveles tras confirmar).
   */
  async tryFund(tx: Tx, projectId: string, at: number): Promise<boolean> {
    const def = getHumanityProject(projectId);
    if (!def) return false;
    let leveled = false;
    for (let i = 0; i < def.maxLevel; i++) {
      const [p] = await tx.select().from(humanityProjects).where(eq(humanityProjects.projectId, def.id)).for("update").limit(1);
      if (!p || p.level >= def.maxLevel) break;
      const cost = projectCost(def, p.level);
      if (!projectResourcesReady(cost, stockOf(p))) break;
      const treasury = await this.settleTreasury(tx, at);
      if (treasury.credits + 1e-6 < cost.credits) {
        const hours = hoursUntilTreasury(treasury.credits, treasury.incomePerHour, cost.credits);
        if (Number.isFinite(hours)) {
          const due = at + realDurationMs(hours, this.timeScale) + FUND_MARGIN_MS;
          if (!p.fundCheckAt || p.fundCheckAt.getTime() > due || p.fundCheckAt.getTime() < at) {
            await schedule(tx, "humanity.fund", new Date(due), { projectId: def.id });
            await tx.update(humanityProjects).set({ fundCheckAt: new Date(due) }).where(eq(humanityProjects.projectId, def.id));
          }
        }
        break;
      }
      await tx
        .update(humanityTreasury)
        .set({ credits: sql`greatest(0, ${humanityTreasury.credits} - ${cost.credits})` })
        .where(eq(humanityTreasury.id, 1));
      const left = projectMissing(stockOf(p), cost); // lo aportado de más
      await tx
        .update(humanityProjects)
        .set({ level: p.level + 1, ...left, completedAt: new Date(at), fundCheckAt: null })
        .where(eq(humanityProjects.projectId, def.id));
      await tx.insert(resourceLedger).values({ emperorId: null, colonyId: null, reason: "humanity_project", ref: `${def.id}:${p.level + 1}`, credits: -cost.credits });
      leveled = true;
    }
    if (leveled) this.viewCache = null;
    return leveled;
  }

  /** Manejador del evento `humanity.fund`. */
  async onFund(tx: Tx, projectId: string): Promise<boolean> {
    await this.ensure();
    await tx.update(humanityProjects).set({ fundCheckAt: null }).where(eq(humanityProjects.projectId, projectId));
    return this.tryFund(tx, projectId, this.now());
  }

  // --- Vista pública ---

  /** Economía de toda la humanidad (con caché breve: es pública y se pide a menudo). */
  async view(): Promise<HumanityResponse> {
    await this.ensure();
    const now = this.now();
    if (this.viewCache && now - this.viewCache.at < VIEW_CACHE_MS) return this.viewCache.data;

    // Las carteras de las facciones alienígenas (los Nómadas comercian) no son de la humanidad.
    const wallets = (
      await this.db.select({ w: emperorWallets }).from(emperorWallets).innerJoin(emperors, eq(emperors.id, emperorWallets.emperorId)).where(ne(emperors.kind, "alien"))
    ).map((r) => r.w);
    let emperorsWithColonies = 0;
    let population = 0;
    let credits = 0;
    let stock = zeroStock();
    let rates = zeroStock();
    for (const w of wallets) {
      credits += walletAfter(w.credits, w.incomePerHour, gameHours(w.settledAt.getTime(), now, this.timeScale));
      const s = w.summary as Partial<WalletSummary>;
      if (!s.colonies) continue;
      emperorsWithColonies++;
      population += s.population ?? 0;
      stock = sumStock(stock, s.stock);
      rates = sumStock(rates, s.ratesPerHour);
    }
    // Colonias independientes (congeladas): sus cifras guardadas.
    const [ind] = await this.db
      .select({
        population: sql<number>`coalesce(sum(${colonies.population}), 0)::float8`,
        metal: sql<number>`coalesce(sum(${colonies.metal}), 0)::float8`,
        volatiles: sql<number>`coalesce(sum(${colonies.volatiles}), 0)::float8`,
        crystal: sql<number>`coalesce(sum(${colonies.crystal}), 0)::float8`,
        alloys: sql<number>`coalesce(sum(${colonies.alloys}), 0)::float8`,
      })
      .from(colonies)
      .where(isNull(colonies.emperorId));
    population += ind?.population ?? 0;
    stock = sumStock(stock, ind ? stockOf(ind) : undefined);
    const [count] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(colonies)
      .leftJoin(emperors, eq(emperors.id, colonies.emperorId))
      .where(sql`${emperors.kind} IS DISTINCT FROM 'alien'`);

    const [t] = await this.db.select().from(humanityTreasury).where(eq(humanityTreasury.id, 1)).limit(1);
    const treasuryCredits = t ? treasuryAfter(t.credits, t.incomePerHour, gameHours(t.settledAt.getTime(), now, this.timeScale)) : 0;

    const rows = await this.db.select().from(humanityProjects);
    const transit = new Map((await this.inTransit(this.db)).map((r) => [r.projectId, r]));
    const projects: HumanityProject[] = [];
    for (const def of HUMANITY_PROJECTS) {
      const p = rows.find((r) => r.projectId === def.id);
      const level = p?.level ?? 0;
      const complete = level >= def.maxLevel;
      const cost = complete ? null : projectCost(def, level);
      const progress = p ? stockOf(p) : zeroStock();
      const top = await this.db
        .select({
          name: emperors.name,
          total: sql<number>`sum(${humanityContributions.metal} + ${humanityContributions.volatiles} + ${humanityContributions.crystal} + ${humanityContributions.alloys} + ${humanityContributions.credits})::float8`,
        })
        .from(humanityContributions)
        .leftJoin(emperors, eq(emperors.id, humanityContributions.emperorId))
        .where(eq(humanityContributions.projectId, def.id))
        .groupBy(humanityContributions.emperorId, emperors.name)
        .orderBy(desc(sql`2`))
        .limit(HUMANITY.topContributors);
      const tr = transit.get(def.id);
      projects.push({
        id: def.id,
        level,
        maxLevel: def.maxLevel,
        status: complete ? "complete" : cost && projectResourcesReady(cost, progress) ? "awaiting_funds" : "collecting",
        cost,
        progress,
        inTransit: tr ? stockOf(tr) : zeroStock(),
        effect: projectEffect(def.id, { [def.id]: level }),
        effectPerLevel: def.effectPerLevel,
        top: top.map((r) => ({ name: r.name, total: r.total })),
      });
    }

    const data: HumanityResponse = {
      emperors: emperorsWithColonies,
      colonies: count?.n ?? 0,
      population,
      stock,
      ratesPerHour: rates,
      credits,
      treasury: { credits: treasuryCredits, incomePerHour: (t?.incomePerHour ?? 0) * this.timeScale, taxRate: HUMANITY.taxRate, at: now },
      projects,
      at: now,
    };
    this.viewCache = { at: now, data };
    return data;
  }

  /** Niveles actuales (para los tests y la vista). */
  projectLevels(): ProjectLevels {
    return { ...this.levels };
  }
}

/** Sin créditos para el aporte: deshace la transacción entera (recursos incluidos). */
class NotEnoughCredits extends Error {}
