/**
 * Tests de la economía de la humanidad y del mercado global: carteras de
 * créditos, tesoro del Núcleo, proyectos comunes, órdenes, casación, envíos y
 * borrado de cuenta. Usan TEST_DATABASE_URL, que se vacía.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { CREDITS, ECONOMY, HUMANITY, MARKET, getHumanityProject } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { LOGIN_TOKEN_PARAM, PROTOCOL_VERSION, type Emperor, type HumanityResponse, type MarketMineResponse, type MarketResponse, type ServerMessage, type StarSystemSummary } from "@imperium/shared";
import { creditIncomePerHour, marketFee, projectCost, taxSplit, tradeValue } from "@imperium/sim";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import {
  colonies,
  discoveries,
  emperorWallets,
  humanityProjects,
  humanityTreasury,
  marketOrders,
  marketTrades,
  resourceLedger,
  scheduledEvents,
  shipments,
} from "../src/db/schema";
import { DiscoveryService } from "../src/discovery/service";
import { spawnCandidates } from "../src/emperor/world";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";
type Ack = Extract<ServerMessage, { t: "ack" }>;

describe.skipIf(!TEST_DATABASE_URL)("economía de la humanidad y mercado", () => {
  const sent: string[] = [];
  const mailer: Mailer = {
    async sendLoginLink(_to, link) {
      sent.push(link);
    },
  };
  const database = createDb(TEST_DATABASE_URL ?? "");
  const db = database.db;
  const config = loadConfig({
    APP_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_URL: ORIGIN,
    COOKIE_SECURE: "false",
    // Tiempo real: durante el test casi no se produce nada (los envíos se adelantan a mano).
    TIME_SCALE: "1",
  });
  const SESSION_COOKIE = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  const details = new DiscoveryService(db, config);
  const [sysA, sysB] = spawnCandidates(seed).filter((s) => details.detail(s).planets.length >= 2) as [StarSystemSummary, StarSystemSummary];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsUrl = "";
  const sockets: WebSocket[] = [];
  let n = 0;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    sent.length = 0;
    await db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events, colonies, resource_ledger CASCADE`);
    await db.update(humanityTreasury).set({ credits: 0, incomePerHour: 0, settledAt: new Date() });
    await db.update(humanityProjects).set({ level: 0, metal: 0, volatiles: 0, crystal: 0, alloys: 0, fundCheckAt: null, completedAt: null });
    app = await buildApp(config, { db, mailer, startWorker: false });
    wsUrl = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws") + "/ws";
  });
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await app.close();
  });
  afterAll(() => database.close());

  /** Jugador con una colonia llena en `system` (planeta `planet`), conectado por WebSocket. */
  async function player(email: string, name: string, system: StarSystemSummary, planet: number) {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const emperor = (await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies })).json().emperor as Emperor;
    await db.insert(discoveries).values({ emperorId: emperor.id, systemId: system.id }).onConflictDoNothing();
    const [colony] = await db
      .insert(colonies)
      .values({ emperorId: emperor.id, systemId: system.id, planetIndex: planet, population: 1000, metal: 2000, volatiles: 1000, crystal: 300, alloys: 500, resolvedAt: new Date() })
      .returning();

    const ticket = (await app.inject({ method: "POST", url: "/api/ws/ticket", cookies })).json().ticket as string;
    const ws = new WebSocket(`${wsUrl}?v=${PROTOCOL_VERSION}&ticket=${ticket}`, { headers: { origin: ORIGIN } });
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ t: "sub", topic: "me" }));
    const snap = await waitFor(() => messages.find((m) => m.t === "snap" && m.topic === "me"));
    const cmd = async (op: string, args: unknown): Promise<Ack> => {
      const cmdId = `huma-${++n}-xyz`;
      ws.send(JSON.stringify({ t: "cmd", cmdId, op, args }));
      return waitFor(() => messages.find((m): m is Ack => m.t === "ack" && m.cmdId === cmdId));
    };
    return { emperor, colony: colony!, cookies, cmd, messages, snap };
  }

  async function waitFor<T>(get: () => T | undefined): Promise<T> {
    for (let i = 0; i < 250; i++) {
      const v = get();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("sin respuesta");
  }

  const colonyRow = async (id: string) => (await db.select().from(colonies).where(eq(colonies.id, id)))[0]!;
  const walletRow = async (id: string) => (await db.select().from(emperorWallets).where(eq(emperorWallets.emperorId, id)))[0]!;
  const treasury = async () => (await db.select().from(humanityTreasury))[0]!;
  /** Los envíos llegan ya: adelanta su llegada y procesa la cola. */
  async function deliver() {
    await db.update(shipments).set({ arriveAt: sql`now() - interval '1 second'` });
    await db.execute(sql`UPDATE scheduled_events SET due_at = now() - interval '1 second' WHERE kind IN ('shipment.arrive', 'humanity.fund')`);
    await app.eventWorker.drain();
  }

  it("cartera: saldo inicial, renta por población y aporte al tesoro", async () => {
    const p = await player("h1@ejemplo.com", "Tesorera", sysA, 0);
    const snapWallet = (p.snap as Extract<ServerMessage, { t: "snap"; topic: "me" }>).data.wallet;
    expect(snapWallet.credits).toBeCloseTo(CREDITS.starting, 2);
    const w = await walletRow(p.emperor.id);
    // La renta sale de la población de sus colonias, y el tesoro recibe la tasa.
    expect(w.incomePerHour).toBeCloseTo(creditIncomePerHour(1000), 3);
    expect((await treasury()).incomePerHour).toBeCloseTo(taxSplit(creditIncomePerHour(1000)).tax, 3);
    // Se recalcula sola cada hora de juego.
    const [ev] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.kind, "economy.settle"));
    expect(ev?.payload).toEqual({ emperorId: p.emperor.id });
    // Vista pública de la humanidad.
    const view = (await app.inject({ method: "GET", url: "/api/humanity", cookies: p.cookies })).json() as HumanityResponse;
    expect(view).toMatchObject({ emperors: 1, colonies: 1, treasury: { taxRate: HUMANITY.taxRate } });
    expect(view.population).toBeCloseTo(1000, 0);
    expect(view.projects.map((x) => x.id)).toContain("core_research");
  });

  it("mercado: retiene, casa al precio del libro, cobra comisión y envía lo vendido", async () => {
    const seller = await player("v@ejemplo.com", "Vendedora", sysA, 0);
    const buyer = await player("c@ejemplo.com", "Compradora", sysB, 0);
    // Venta de 100 de metal a 2: el metal sale ya de la colonia.
    expect(await seller.cmd("market.order", { resource: "metal", side: "sell", price: 2, quantity: 100, colonyId: seller.colony.id })).toMatchObject({ ok: true });
    expect((await colonyRow(seller.colony.id)).metal).toBeCloseTo(1900, 0);
    // No se casa consigo misma.
    expect(await seller.cmd("market.order", { resource: "metal", side: "buy", price: 3, quantity: 10, colonyId: seller.colony.id })).toMatchObject({ ok: true });
    expect(await db.select().from(marketTrades)).toEqual([]);
    // La compradora ofrece 2,5 por 60: casa a 2 (el precio del libro) y se le devuelve la diferencia.
    expect(await buyer.cmd("market.order", { resource: "metal", side: "buy", price: 2.5, quantity: 60, colonyId: buyer.colony.id })).toMatchObject({ ok: true });
    const trades = await db.select().from(marketTrades);
    expect(trades.map((t) => [t.price, t.quantity])).toEqual([[2, 60]]);
    const value = tradeValue(2, 60);
    expect((await walletRow(buyer.emperor.id)).credits).toBeCloseTo(CREDITS.starting - value, 1);
    expect((await walletRow(seller.emperor.id)).credits).toBeCloseTo(CREDITS.starting - tradeValue(3, 10) + value - marketFee(value), 1);
    expect((await treasury()).credits).toBeCloseTo(marketFee(value), 2);
    // La orden de venta queda con 40; la de compra, casada del todo, ya no está.
    const book = await db.select().from(marketOrders).where(eq(marketOrders.side, "sell"));
    expect(book.map((o) => o.remaining)).toEqual([40]);
    // Lo comprado viaja de A a B: aún no ha llegado.
    expect((await colonyRow(buyer.colony.id)).metal).toBeCloseTo(2000, 0);
    const [ship] = await db.select().from(shipments);
    expect(ship).toMatchObject({ kind: "trade", toColonyId: buyer.colony.id, metal: 60 });
    expect(ship!.arriveAt.getTime()).toBeGreaterThan(Date.now());
    await deliver();
    expect((await colonyRow(buyer.colony.id)).metal).toBeCloseTo(2060, 0);
    const ledger = await db.select().from(resourceLedger).where(eq(resourceLedger.colonyId, buyer.colony.id));
    expect(ledger.map((l) => l.reason)).toEqual(["market_delivery"]);
    expect(ledger[0]!.metal).toBeCloseTo(60, 6);
    // Precios públicos e historial.
    const view = (await app.inject({ method: "GET", url: "/api/market", cookies: buyer.cookies })).json() as MarketResponse;
    const metal = view.resources.find((r) => r.resource === "metal")!;
    expect(metal).toMatchObject({ last: 2, bestAsk: 2, bestBid: 3, volume24h: 60 });
    expect(metal.history.at(-1)).toMatchObject({ avg: 2, volume: 60 });
    const mine = (await app.inject({ method: "GET", url: "/api/market/mine", cookies: seller.cookies })).json() as MarketMineResponse;
    expect(mine.orders).toHaveLength(2);
    expect(mine.trades).toMatchObject([{ side: "sell", price: 2, quantity: 60 }]);
  });

  it("mercado: cancelar devuelve lo retenido; límites y validación en el servidor", async () => {
    const p = await player("l@ejemplo.com", "Limitada", sysA, 0);
    expect(await p.cmd("market.order", { resource: "crystal", side: "sell", price: 5, quantity: 10_000, colonyId: p.colony.id })).toMatchObject({ ok: false, error: "insufficient_resources" });
    expect(await p.cmd("market.order", { resource: "crystal", side: "buy", price: 5, quantity: 1000, colonyId: p.colony.id })).toMatchObject({ ok: false, error: "insufficient_credits" });
    expect(await p.cmd("market.order", { resource: "crystal", side: "buy", price: 0.001, quantity: 1, colonyId: p.colony.id })).toMatchObject({ ok: false, error: "invalid_order" });
    expect(await p.cmd("market.order", { resource: "crystal", side: "buy", price: 1.234, quantity: 1, colonyId: p.colony.id })).toMatchObject({ ok: false, error: "invalid_order" });
    expect(await p.cmd("market.order", { resource: "crystal", side: "buy", price: 1, quantity: MARKET.maxQuantity + 1, colonyId: p.colony.id })).toMatchObject({ ok: false, error: "invalid_order" });
    expect(await p.cmd("market.order", { resource: "crystal", side: "buy", price: 1, quantity: 1, colonyId: crypto.randomUUID() })).toMatchObject({ ok: false, error: "no_colony" });

    expect(await p.cmd("market.order", { resource: "alloys", side: "sell", price: 4, quantity: 100, colonyId: p.colony.id })).toMatchObject({ ok: true });
    expect(await p.cmd("market.order", { resource: "alloys", side: "buy", price: 1.5, quantity: 100, colonyId: p.colony.id })).toMatchObject({ ok: true });
    expect((await colonyRow(p.colony.id)).alloys).toBeCloseTo(400, 0);
    expect((await walletRow(p.emperor.id)).credits).toBeCloseTo(CREDITS.starting - 150, 1);
    for (const o of await db.select().from(marketOrders)) expect(await p.cmd("market.cancel", { orderId: o.id })).toMatchObject({ ok: true });
    expect((await colonyRow(p.colony.id)).alloys).toBeCloseTo(500, 0);
    expect((await walletRow(p.emperor.id)).credits).toBeCloseTo(CREDITS.starting, 1);
    expect(await p.cmd("market.cancel", { orderId: crypto.randomUUID() })).toMatchObject({ ok: false, error: "no_order" });

    // Tope de órdenes abiertas por Emperador.
    for (let i = 0; i < MARKET.maxOpenOrders; i++) {
      expect(await p.cmd("market.order", { resource: "metal", side: "sell", price: 10 + i, quantity: 1, colonyId: p.colony.id })).toMatchObject({ ok: true });
    }
    expect(await p.cmd("market.order", { resource: "metal", side: "sell", price: 50, quantity: 1, colonyId: p.colony.id })).toMatchObject({ ok: false, error: "too_many_orders" });
  });

  it("proyecto común: aportes que viajan al Núcleo, el tesoro paga los créditos y se aplica la bonificación", async () => {
    const p = await player("a@ejemplo.com", "Aportadora", sysA, 0);
    const def = getHumanityProject("colony_grants")!;
    const cost = projectCost(def, 0);
    // Más de lo que hace falta: no.
    expect(await p.cmd("humanity.contribute", { projectId: def.id, colonyId: p.colony.id, amounts: { crystal: cost.crystal + 1 } })).toMatchObject({ ok: false, error: "exceeds_need" });
    expect(await p.cmd("humanity.contribute", { projectId: "nada", colonyId: p.colony.id, amounts: { metal: 50 } })).toMatchObject({ ok: false, error: "unknown_project" });
    // Recursos del proyecto: se dan a la colonia de sobra para poder aportarlo todo.
    await db
      .update(colonies)
      .set({ metal: ECONOMY.storage.metal, volatiles: ECONOMY.storage.volatiles, crystal: ECONOMY.storage.crystal, alloys: ECONOMY.storage.alloys, rare_metals: 0, exotic: 0, resolvedAt: new Date() })
      .where(eq(colonies.id, p.colony.id));
    // En dos partes, rellenando el almacén antes de cada una: con el reloj acelerado de las pruebas la colonia gasta
    // algo de volátiles entre una orden y otra, y el proyecto pide justo un almacén entero.
    const half = Math.floor(Math.min(cost.volatiles, 1500) / 2);
    const chunks = [
      { metal: Math.min(cost.metal, 3000), volatiles: half, crystal: cost.crystal, alloys: cost.alloys },
      { volatiles: Math.min(cost.volatiles, 1500) - half },
    ];
    for (const amounts of chunks) {
      await db.update(colonies).set({ volatiles: ECONOMY.storage.volatiles, resolvedAt: new Date() }).where(eq(colonies.id, p.colony.id));
      expect(await p.cmd("humanity.contribute", { projectId: def.id, colonyId: p.colony.id, amounts })).toMatchObject({ ok: true });
    }
    const [ship] = await db.select().from(shipments);
    expect(ship).toMatchObject({ kind: "contribution", projectId: def.id });
    // El tesoro tiene créditos de sobra para este nivel.
    await db.update(humanityTreasury).set({ credits: cost.credits + 10, settledAt: new Date() });
    await deliver();
    const [row] = await db.select().from(humanityProjects).where(eq(humanityProjects.projectId, def.id));
    expect(row!.level).toBe(1);
    expect((await treasury()).credits).toBeCloseTo(10, 0);
    await app.humanity.reload();
    expect(app.humanity.bonuses().founding).toBeCloseTo(1 + def.effectPerLevel);
    const ledger = await db.select().from(resourceLedger).where(and(eq(resourceLedger.reason, "humanity_project")));
    expect(ledger.map((l) => [l.ref, l.credits])).toEqual([[`${def.id}:1`, -cost.credits]]);
    // Aporte en créditos: van al tesoro.
    expect(await p.cmd("humanity.contribute", { projectId: "core_research", credits: 100 })).toMatchObject({ ok: true });
    expect((await treasury()).credits).toBeCloseTo(110, 0);
    expect(await p.cmd("humanity.contribute", { projectId: "core_research", credits: 1e6 })).toMatchObject({ ok: false, error: "insufficient_credits" });
    const view = (await app.inject({ method: "GET", url: "/api/humanity", cookies: p.cookies })).json() as HumanityResponse;
    expect(view.projects.find((x) => x.id === def.id)).toMatchObject({ level: 1 });
    expect(view.projects.find((x) => x.id === "core_research")!.top[0]).toMatchObject({ name: "Aportadora", total: 100 });
  });

  it("proyecto con todos los recursos espera a que el tesoro tenga los créditos", async () => {
    const p = await player("e@ejemplo.com", "Paciente", sysA, 0);
    const def = getHumanityProject("trade_network")!;
    const cost = projectCost(def, 0);
    await db.update(humanityProjects).set({ metal: cost.metal, volatiles: cost.volatiles, crystal: cost.crystal, alloys: cost.alloys, rare_metals: 0, exotic: 0 }).where(eq(humanityProjects.projectId, def.id));
    // Un aporte en créditos que no llega: se programa la comprobación para cuando el tesoro lo tenga.
    expect(await p.cmd("humanity.contribute", { projectId: def.id, credits: 100 })).toMatchObject({ ok: true });
    const [ev] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.kind, "humanity.fund"));
    expect(ev?.payload).toEqual({ projectId: def.id });
    await db.update(humanityTreasury).set({ credits: cost.credits, settledAt: new Date() });
    await deliver();
    const [row] = await db.select().from(humanityProjects).where(eq(humanityProjects.projectId, def.id));
    expect(row!.level).toBe(1);
  });

  it("borrar la cuenta cancela sus órdenes (devuelve lo retenido) y la exportación incluye la economía", async () => {
    const p = await player("b@ejemplo.com", "Efímera", sysA, 0);
    expect(await p.cmd("market.order", { resource: "volatiles", side: "sell", price: 3, quantity: 200, colonyId: p.colony.id })).toMatchObject({ ok: true });
    expect(await p.cmd("humanity.contribute", { projectId: "core_defenses", credits: 20 })).toMatchObject({ ok: true });
    const exported = (await app.inject({ method: "GET", url: "/api/account/export", cookies: p.cookies })).json();
    expect(exported.game.wallet).toMatchObject({ emperorId: p.emperor.id });
    expect(exported.game.marketOrders).toHaveLength(1);
    expect(exported.game.humanityContributions).toHaveLength(1);
    const incomeBefore = (await treasury()).incomePerHour;
    expect(incomeBefore).toBeGreaterThan(0);

    const del = await app.inject({ method: "POST", url: "/api/account/delete", payload: { confirm: true }, cookies: p.cookies });
    expect(del.statusCode).toBe(204);
    expect(await db.select().from(marketOrders)).toEqual([]);
    expect(await db.select().from(emperorWallets)).toEqual([]);
    const c = await colonyRow(p.colony.id);
    expect(c.emperorId).toBeNull();
    expect(c.volatiles).toBeCloseTo(1000, 0);
    // Su renta deja de aportar al tesoro.
    expect((await treasury()).incomePerHour).toBeCloseTo(0, 6);
    expect(await db.select().from(scheduledEvents).where(eq(scheduledEvents.kind, "economy.settle"))).toEqual([]);
  });
});
