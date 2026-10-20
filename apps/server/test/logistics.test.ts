/**
 * Tests de la Fase 8 (logística): cargar y descargar entre flotas y colonias,
 * y rutas automáticas entre dos colonias. Usan TEST_DATABASE_URL, que se vacía.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ECONOMY, getShipClass, HUMANS, SHIP_PASSENGERS } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { LOGIN_TOKEN_PARAM, PROTOCOL_VERSION, type Emperor, type Fleet, type ServerMessage, type StarSystemSummary } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { colonies, discoveries, emperors, fleetCargo, fleetRoutes, fleets, resourceLedger, ships } from "../src/db/schema";
import { DiscoveryService } from "../src/discovery/service";
import { spawnCandidates } from "../src/emperor/world";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";
type Ack = Extract<ServerMessage, { t: "ack" }>;

describe.skipIf(!TEST_DATABASE_URL)("logística", () => {
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
    // Tiempo real: durante el test casi no se produce nada (los viajes se adelantan a mano).
    TIME_SCALE: "1",
  });
  const SESSION_COOKIE = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  const details = new DiscoveryService(db, config);
  /** Dos sistemas del Núcleo con planetas: A (origen) y B (destino). */
  const [sysA, sysB] = spawnCandidates(seed).filter((s) => details.detail(s).planets.length >= 2) as [StarSystemSummary, StarSystemSummary];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsUrl = "";
  const sockets: WebSocket[] = [];
  let n = 0;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    sent.length = 0;
    await db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events CASCADE`);
    app = await buildApp(config, { db, mailer, startWorker: false });
    wsUrl = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws") + "/ws";
  });
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await app.close();
  });
  afterAll(() => database.close());

  /** Jugador con colonias en A y B (llenas de recursos) y una flota con un carguero en A. */
  async function setup() {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: "l@ejemplo.com" } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const emperor = (await app.inject({ method: "POST", url: "/api/emperor", payload: { name: "Logista" }, cookies })).json().emperor as Emperor;
    for (const s of [sysA, sysB]) await db.insert(discoveries).values({ emperorId: emperor.id, systemId: s.id }).onConflictDoNothing();
    const now = new Date();
    const [a] = await db.insert(colonies).values({ emperorId: emperor.id, systemId: sysA.id, planetIndex: 0, population: 300, ...ECONOMY.storage, resolvedAt: now }).returning();
    const [b] = await db.insert(colonies).values({ emperorId: emperor.id, systemId: sysB.id, planetIndex: 0, population: 100, metal: 0, volatiles: 500, crystal: 0, alloys: 0, resolvedAt: now }).returning();
    const [fleet] = await db.select().from(fleets).where(eq(fleets.emperorId, emperor.id));
    await db.update(fleets).set({ systemId: sysA.id }).where(eq(fleets.id, fleet!.id));
    await db.insert(ships).values({ fleetId: fleet!.id, classId: "freighter", hull: getShipClass("freighter")!.hull });

    const ticket = (await app.inject({ method: "POST", url: "/api/ws/ticket", cookies })).json().ticket as string;
    const ws = new WebSocket(`${wsUrl}?v=${PROTOCOL_VERSION}&ticket=${ticket}`, { headers: { origin: ORIGIN } });
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise((r) => ws.once("open", r));
    const cmd = async (op: string, args: unknown): Promise<Ack> => {
      const cmdId = `logis-${++n}-xyz`;
      ws.send(JSON.stringify({ t: "cmd", cmdId, op, args }));
      for (let i = 0; i < 250; i++) {
        const ack = messages.find((m): m is Ack => m.t === "ack" && m.cmdId === cmdId);
        if (ack) return ack;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("sin respuesta");
    };
    return { emperor, a: a!, b: b!, fleetId: fleet!.id, cmd };
  }

  const cargoOf = async (fleetId: string) => (await db.select().from(fleetCargo).where(eq(fleetCargo.fleetId, fleetId)))[0];
  const colonyRow = async (id: string) => (await db.select().from(colonies).where(eq(colonies.id, id)))[0]!;
  /** La flota llega ya a su destino: adelanta el viaje y procesa la cola de eventos. */
  async function arrive(fleetId: string) {
    await db.update(fleets).set({ departAt: sql`now() - interval '2 seconds'`, arriveAt: sql`now() - interval '1 second'` }).where(eq(fleets.id, fleetId));
    await db.execute(sql`UPDATE scheduled_events SET due_at = now() - interval '1 second' WHERE kind = 'fleet.arrive'`);
    await app.eventWorker.drain();
  }

  it("cargar y descargar a mano, con bodega, plazas y almacenes como límite", async () => {
    const { a, fleetId, cmd } = await setup();
    const capacity = getShipClass("freighter")!.cargo + getShipClass("explorer")!.cargo;
    expect(await cmd("fleet.transfer", { fleetId, colonyId: a.id, direction: "load", amounts: { metal: 600, humans: 50 } })).toMatchObject({ ok: true });
    expect(await cargoOf(fleetId)).toMatchObject({ metal: 600, humans: 50 });
    expect((await colonyRow(a.id)).metal).toBeCloseTo(ECONOMY.storage.metal - 600, 0);
    // No caben más de la bodega (recursos juntos) ni más pasajeros que plazas.
    expect(await cmd("fleet.transfer", { fleetId, colonyId: a.id, direction: "load", amounts: { volatiles: capacity } })).toMatchObject({ ok: false, error: "cargo_full" });
    expect(await cmd("fleet.transfer", { fleetId, colonyId: a.id, direction: "load", amounts: { humans: SHIP_PASSENGERS.freighter! } })).toMatchObject({ ok: false, error: "cargo_full" });
    // Descargar: el almacén de metal está casi lleno, no cabe todo.
    expect(await cmd("fleet.transfer", { fleetId, colonyId: a.id, direction: "unload", amounts: { metal: 700 } })).toMatchObject({ ok: false, error: "nothing_to_transfer" });
    expect(await cmd("fleet.transfer", { fleetId, colonyId: a.id, direction: "unload", amounts: { humans: 50 } })).toMatchObject({ ok: true });
    const ledger = await db.select().from(resourceLedger).where(eq(resourceLedger.colonyId, a.id)).orderBy(resourceLedger.id);
    expect(ledger.map((l) => [l.reason, l.metal, l.humans])).toEqual([
      ["load", -600, -50],
      ["unload", 0, 50],
    ]);
  });

  it("solo con la flota parada en el sistema de la colonia, y la colonia conserva a sus mínimos", async () => {
    const { a, b, fleetId, cmd } = await setup();
    expect(await cmd("fleet.transfer", { fleetId, colonyId: b.id, direction: "load", amounts: { metal: 1 } })).toMatchObject({ ok: false, error: "not_present" });
    await db.update(colonies).set({ population: HUMANS.colonyKeep + 5 }).where(eq(colonies.id, a.id));
    expect(await cmd("fleet.transfer", { fleetId, colonyId: a.id, direction: "load", amounts: { humans: 10 } })).toMatchObject({ ok: false, error: "not_enough_humans" });
  });

  it("ruta automática: carga en el origen, descarga en el destino y vuelve", async () => {
    const { a, b, fleetId, cmd } = await setup();
    expect(await cmd("fleet.route", { fleetId, fromColonyId: a.id, toColonyId: b.id, carry: ["metal"], humans: false })).toMatchObject({ ok: true });
    // Primer paso, en el origen: ha cargado metal hasta llenar la bodega y ha salido hacia B.
    const capacity = getShipClass("freighter")!.cargo + getShipClass("explorer")!.cargo;
    expect((await cargoOf(fleetId))!.metal).toBeCloseTo(capacity, 0);
    let [f] = await db.select().from(fleets).where(eq(fleets.id, fleetId));
    expect(f!.destSystemId).toBe(sysB.id);
    // Llega a B: descarga y vuelve hacia A.
    await arrive(fleetId);
    expect((await cargoOf(fleetId))!.metal).toBeCloseTo(0, 3);
    expect((await colonyRow(b.id)).metal).toBeCloseTo(capacity, 0);
    [f] = await db.select().from(fleets).where(eq(fleets.id, fleetId));
    expect([f!.systemId, f!.destSystemId]).toEqual([sysB.id, sysA.id]);
    // Con la ruta en marcha nunca está parada: se detiene la ruta, llega y se queda.
    expect(await cmd("fleet.move", { fleetId, systemId: sysB.id })).toMatchObject({ ok: false, error: "in_transit" });
    expect(await cmd("fleet.routeStop", { fleetId })).toMatchObject({ ok: true });
    expect(await db.select().from(fleetRoutes)).toEqual([]);
    await arrive(fleetId);
    [f] = await db.select().from(fleets).where(eq(fleets.id, fleetId));
    expect([f!.systemId, f!.destSystemId]).toEqual([sysA.id, null]);
    expect(await cmd("fleet.move", { fleetId, systemId: sysB.id })).toMatchObject({ ok: true });
  });

  it("rutas no válidas: misma colonia, nada que llevar o sin bodega", async () => {
    const { a, b, fleetId, cmd } = await setup();
    expect(await cmd("fleet.route", { fleetId, fromColonyId: a.id, toColonyId: a.id, carry: ["metal"], humans: false })).toMatchObject({ ok: false, error: "invalid_route" });
    expect(await cmd("fleet.route", { fleetId, fromColonyId: a.id, toColonyId: b.id, carry: [], humans: false })).toMatchObject({ ok: false, error: "invalid_route" });
    void emperors;
  });
});
