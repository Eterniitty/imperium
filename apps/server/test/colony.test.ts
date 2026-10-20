/**
 * Tests de la Fase 7: reclamar y renombrar planetas, quién ve qué, construcción
 * con evento programado, naves nuevas y libro de recursos. Usan
 * TEST_DATABASE_URL, que se vacía. Tiempo real (TIME_SCALE=1): durante el test
 * no se produce casi nada, y las construcciones se adelantan a mano.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ECONOMY, getInstallation, getShipClass, HUMANS, SHIP_HUMAN_CAPACITY } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import {
  LOGIN_TOKEN_PARAM,
  PLANET_NAME_MAX,
  PROTOCOL_VERSION,
  type Colony,
  type DeltaOp,
  type Emperor,
  type EmperorHumans,
  type Fleet,
  type ServerMessage,
  type StarSystemDetail,
  type StarSystemSummary,
} from "@imperium/shared";
import { minColonists } from "@imperium/sim";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { colonies, colonyBuilds, discoveries, emperors, fleets, installations, resourceLedger, ships } from "../src/db/schema";
import { DiscoveryService } from "../src/discovery/service";
import { spawnCandidates } from "../src/emperor/world";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";

type Snap = Extract<ServerMessage, { t: "snap"; topic: "me" }>;
type Ack = Extract<ServerMessage, { t: "ack" }>;

describe.skipIf(!TEST_DATABASE_URL)("colonias y economía", () => {
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
    TIME_SCALE: "1",
  });
  const SESSION_COOKIE = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  const details = new DiscoveryService(db, config);
  /** Sistema del Núcleo con al menos tres planetas: ahí se pone a los Emperadores de las pruebas. */
  const home: { summary: StarSystemSummary; detail: StarSystemDetail } = (() => {
    for (const summary of spawnCandidates(seed)) {
      const detail = details.detail(summary);
      if (detail.planets.length >= 3) return { summary, detail };
    }
    throw new Error("No hay ningún sistema con tres planetas en el Núcleo");
  })();
  const planet = (i: number) => home.detail.planets[i]!;
  /** Colonos mínimos del primer planeta. */
  const need0 = minColonists(home.detail.planets[0]!.habitability);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsUrl = "";
  const sockets: WebSocket[] = [];
  let cmdN = 0;

  beforeAll(() => resetTestDatabase(database));

  beforeEach(async () => {
    sent.length = 0;
    await db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events CASCADE`);
    app = await buildApp(config, { db, mailer, startWorker: false });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    wsUrl = address.replace("http", "ws") + "/ws";
  });

  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await app.close();
  });

  afterAll(() => database.close());

  /** Jugador cuyo Emperador y flota están en `home` (o donde diga `at`), que conoce. */
  async function player(email: string, name: string, at: StarSystemSummary | null = home.summary) {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const res = await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies });
    const emperor = res.json().emperor as Emperor;
    if (at) {
      await db.update(emperors).set({ systemId: at.id }).where(eq(emperors.id, emperor.id));
      await db.update(fleets).set({ systemId: at.id }).where(eq(fleets.emperorId, emperor.id));
      await db.insert(discoveries).values({ emperorId: emperor.id, systemId: at.id }).onConflictDoNothing();
    }
    return { cookies, emperor };
  }

  async function connect(cookies: Record<string, string>) {
    const ticket = (await app.inject({ method: "POST", url: "/api/ws/ticket", cookies })).json().ticket as string;
    const ws = new WebSocket(`${wsUrl}?v=${PROTOCOL_VERSION}&ticket=${ticket}`, { headers: { origin: ORIGIN } });
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ t: "sub", topic: "me" }));
    const next = async <T extends ServerMessage>(pred: (m: ServerMessage) => m is T, from = 0, timeoutMs = 5000): Promise<T> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = messages.slice(from).find(pred);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`Mensaje no recibido. Recibidos: ${JSON.stringify(messages)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const snap = await next((m): m is Snap => m.t === "snap" && m.topic === "me");
    /** Envía una orden y espera su respuesta. */
    const cmd = async (op: string, args: unknown): Promise<Ack> => {
      const cmdId = `orden-${++cmdN}-xyz`;
      ws.send(JSON.stringify({ t: "cmd", cmdId, op, args }));
      return next((m): m is Ack => m.t === "ack" && m.cmdId === cmdId);
    };
    /** Último valor recibido de una ruta del tema "me" (desde el mensaje `from`). */
    const op = async <T>(path: string, from = 0): Promise<T> => {
      const d = await next((m): m is Extract<ServerMessage, { t: "delta" }> => m.t === "delta" && m.ops.some((o) => o.path === path), from);
      return d.ops.find((o: DeltaOp) => o.path === path)!.v as T;
    };
    return { ws, messages, next, snap, cmd, op };
  }

  const claims = (cookies: Record<string, string> | undefined, systemId: string) =>
    app.inject({ method: "GET", url: `/api/systems/${encodeURIComponent(systemId)}/claims`, cookies });

  /** Adelanta el reloj de las construcciones en marcha y procesa la cola de eventos. */
  async function finishBuilds() {
    await db.execute(sql`UPDATE colony_builds SET finish_at = now() - interval '1 second' WHERE started_at IS NOT NULL`);
    await db.execute(sql`UPDATE scheduled_events SET due_at = now() - interval '1 second' WHERE kind = 'colony.build'`);
    await app.eventWorker.drain();
  }

  const ledgerOf = (colonyId: string) => db.select().from(resourceLedger).where(eq(resourceLedger.colonyId, colonyId)).orderBy(resourceLedger.id);

  it("la nave del Emperador lleva humanos y el tema privado los trae, con las colonias", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const s = await connect(a.cookies);
    expect(s.snap.data.colonies).toEqual([]);
    const humans: EmperorHumans = s.snap.data.humans;
    expect(Math.floor(humans.count)).toBe(HUMANS.flagshipStart);
    expect(humans.capacity).toBe(HUMANS.flagshipCapacity);
    expect(humans.perHour).toBe(HUMANS.flagshipPerHour);
  });

  it("reclamar: hace falta haberlo descubierto, estar allí, que esté libre y humanos suficientes", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const s = await connect(a.cookies);
    const p0 = planet(0);
    const need = minColonists(p0.habitability);

    // Un sistema que no conoce.
    const far = spawnCandidates(seed).find((x) => x.id !== home.summary.id)!;
    await db.delete(discoveries).where(and(eq(discoveries.emperorId, a.emperor.id), eq(discoveries.systemId, far.id)));
    expect(await s.cmd("colony.claim", { systemId: far.id, planetIndex: 0 })).toMatchObject({ ok: false, error: "not_discovered" });
    // Uno que conoce, pero donde no está.
    await db.insert(discoveries).values({ emperorId: a.emperor.id, systemId: far.id });
    expect(await s.cmd("colony.claim", { systemId: far.id, planetIndex: 0 })).toMatchObject({ ok: false, error: "not_present" });
    // Planeta inexistente, pocos humanos y más de los que lleva.
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 60 })).toMatchObject({ ok: false, error: "unknown_planet" });
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: need - 1 })).toMatchObject({ ok: false, error: "not_enough_humans" });
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: HUMANS.flagshipStart + 50 })).toMatchObject({ ok: false, error: "not_enough_humans" });
    // De viaje no se puede desembarcar.
    await db.update(emperors).set({ destSystemId: far.id, departAt: new Date(), arriveAt: new Date(Date.now() + 3_600_000) }).where(eq(emperors.id, a.emperor.id));
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: need })).toMatchObject({ ok: false, error: "in_transit" });
    await db.update(emperors).set({ destSystemId: null, departAt: null, arriveAt: null }).where(eq(emperors.id, a.emperor.id));

    // Ahora sí: desembarca `need` humanos y funda la colonia.
    const from = s.messages.length;
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: need })).toMatchObject({ ok: true });
    const [row] = await db.select().from(colonies).where(eq(colonies.emperorId, a.emperor.id));
    const colony = await s.op<Colony>(`colonies.${row!.id}`, from);
    expect(colony).toMatchObject({ systemId: home.summary.id, planetIndex: 0, name: null, installations: {}, builds: [] });
    expect(colony.population).toBeCloseTo(need, 3);
    expect(colony.stock.metal).toBeCloseTo(ECONOMY.foundingStock.metal, 0);
    const humans = await s.op<EmperorHumans>(`humans.${a.emperor.id}`, from);
    expect(Math.round(humans.count)).toBe(HUMANS.flagshipStart - need);

    // Asiento de la fundación en el libro.
    const ledger = await ledgerOf(row!.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ reason: "foundation", ref: "emperor", humans: need, metal: ECONOMY.foundingStock.metal, emperorId: a.emperor.id });

    // Otro Emperador que conoce el sistema no puede quitárselo.
    const b = await player("b@ejemplo.com", "Brennus");
    const sb = await connect(b.cookies);
    expect(await sb.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: 150 })).toMatchObject({ ok: false, error: "planet_owned" });
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: 150 })).toMatchObject({ ok: false, error: "planet_owned" });
  });

  it("reclamar con un colonizador: desembarcan sus colonos y la nave se consume", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const s = await connect(a.cookies);
    const fleet = s.snap.data.fleets[0]!;
    // La flota inicial solo lleva un explorador.
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 1, fleetId: fleet.id })).toMatchObject({ ok: false, error: "no_colonizer" });
    await db.insert(ships).values({ fleetId: fleet.id, classId: "colonizer", hull: 120, humans: 400 });
    const from = s.messages.length;
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 1, fleetId: fleet.id })).toMatchObject({ ok: true });
    const updated = await s.op<Fleet>(`fleets.${fleet.id}`, from);
    expect(updated.ships.map((x) => x.classId)).toEqual(["explorer"]);
    const [row] = await db.select().from(colonies).where(eq(colonies.emperorId, a.emperor.id));
    expect(row).toMatchObject({ planetIndex: 1, population: 400 });
    expect((await ledgerOf(row!.id))[0]).toMatchObject({ reason: "foundation", ref: `fleet:${fleet.id}`, humans: 400 });
    // El Emperador no ha perdido humanos.
    expect(Math.floor((await app.colonies.humans(a.emperor.id))!.count)).toBe(HUMANS.flagshipStart);

    // Una flota que solo lleva el colonizador desaparece con él.
    const [solo] = await db.insert(fleets).values({ emperorId: a.emperor.id, number: 2, systemId: home.summary.id }).returning();
    await db.insert(ships).values({ fleetId: solo!.id, classId: "colonizer", hull: 120, humans: 300 });
    const from2 = s.messages.length;
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 2, fleetId: solo!.id })).toMatchObject({ ok: true });
    expect(await s.op<Fleet | null>(`fleets.${solo!.id}`, from2)).toBeNull();
    expect(await db.select().from(fleets).where(eq(fleets.id, solo!.id))).toEqual([]);
  });

  it("renombrar: solo el dueño; el nombre y el dueño los ve quien conoce el sistema, las existencias solo el dueño", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const b = await player("b@ejemplo.com", "Brennus");
    const c = await player("c@ejemplo.com", "Cassia", null);
    await db.delete(discoveries).where(and(eq(discoveries.emperorId, c.emperor.id), eq(discoveries.systemId, home.summary.id)));
    const sa = await connect(a.cookies);
    const sb = await connect(b.cookies);
    expect(await sa.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: need0 })).toMatchObject({ ok: true });
    const [row] = await db.select().from(colonies);
    const id = row!.id;

    expect(await sa.cmd("colony.rename", { colonyId: id, name: "x" })).toMatchObject({ ok: false, error: "invalid_name" });
    expect(await sa.cmd("colony.rename", { colonyId: id, name: "a".repeat(PLANET_NAME_MAX + 1) })).toMatchObject({ ok: false, error: "invalid_name" });
    expect(await sa.cmd("colony.rename", { colonyId: id, name: "-Nueva" })).toMatchObject({ ok: false, error: "invalid_name" });
    expect(await sb.cmd("colony.rename", { colonyId: id, name: "Robada" })).toMatchObject({ ok: false, error: "no_colony" });
    const from = sa.messages.length;
    expect(await sa.cmd("colony.rename", { colonyId: id, name: "  Nueva   Aurelia  " })).toMatchObject({ ok: true });
    expect((await sa.op<Colony>(`colonies.${id}`, from)).name).toBe("Nueva Aurelia");

    // B conoce el sistema: ve el dueño y el nombre, nada más.
    const seen = await claims(b.cookies, home.summary.id);
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toEqual({ claims: [{ planetIndex: 0, name: "Nueva Aurelia", ownerId: a.emperor.id, ownerName: "Aurelia" }] });
    // C no lo ha descubierto; sin sesión, nada.
    expect((await claims(c.cookies, home.summary.id)).json()).toEqual({ error: "not_discovered" });
    expect((await claims(undefined, home.summary.id)).statusCode).toBe(401);
    // B no recibe la colonia de A por su tema privado.
    expect(sb.snap.data.colonies).toEqual([]);
    expect(sb.messages.some((m) => m.t === "delta" && m.ops.some((o) => o.path.startsWith("colonies.")))).toBe(false);
  });

  it("construir: se paga al encargar, termina con un evento y la siguiente de la cola empieza", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const s = await connect(a.cookies);
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: need0 })).toMatchObject({ ok: true });
    const [row] = await db.select().from(colonies);
    const id = row!.id;
    const mine = getInstallation("mine")!;

    expect(await s.cmd("colony.build", { colonyId: id, kind: "installation", itemId: "nada" })).toMatchObject({ ok: false, error: "unknown_item" });
    expect(await s.cmd("colony.build", { colonyId: id, kind: "ship", itemId: "frigate" })).toMatchObject({ ok: false, error: "needs_shipyard" });

    let from = s.messages.length;
    expect(await s.cmd("colony.build", { colonyId: id, kind: "installation", itemId: "mine" })).toMatchObject({ ok: true });
    let colony = await s.op<Colony>(`colonies.${id}`, from);
    expect(colony.stock.metal).toBeCloseTo(ECONOMY.foundingStock.metal - mine.cost.metal, 0);
    expect(colony.builds).toHaveLength(1);
    expect(colony.builds[0]!.finishAt! - colony.builds[0]!.startedAt!).toBe(mine.buildTimeHours * 3_600_000);
    // Una segunda, en espera.
    expect(await s.cmd("colony.build", { colonyId: id, kind: "installation", itemId: "mine" })).toMatchObject({ ok: true });
    // Ya no queda metal para una tercera.
    expect(await s.cmd("colony.build", { colonyId: id, kind: "installation", itemId: "mine" })).toMatchObject({ ok: false, error: "insufficient_resources" });
    const events = await db.execute(sql`SELECT count(*)::int AS n FROM scheduled_events WHERE kind = 'colony.build'`);
    expect(events[0]!.n).toBe(1);

    // Termina la primera: hay una mina y la segunda empieza.
    from = s.messages.length;
    await finishBuilds();
    colony = await s.op<Colony>(`colonies.${id}`, from);
    expect(colony.installations).toEqual({ mine: 1 });
    expect(colony.builds).toHaveLength(1);
    expect(colony.builds[0]!.startedAt).not.toBeNull();
    from = s.messages.length;
    await finishBuilds();
    colony = await s.op<Colony>(`colonies.${id}`, from);
    expect(colony.installations).toEqual({ mine: 2 });
    expect(colony.builds).toEqual([]);
    expect(await db.select().from(installations).where(eq(installations.colonyId, id))).toHaveLength(2);

    // Libro: fundación y dos encargos, con el coste en negativo.
    const ledger = await ledgerOf(id);
    expect(ledger.map((l) => [l.reason, l.ref, l.metal])).toEqual([
      ["foundation", "emperor", ECONOMY.foundingStock.metal],
      ["build", "installation:mine", -mine.cost.metal],
      ["build", "installation:mine", -mine.cost.metal],
    ]);
    // El libro es solo inserción.
    await expect(db.update(resourceLedger).set({ metal: 1e9 }).where(eq(resourceLedger.colonyId, id))).rejects.toThrow();
    await expect(db.delete(resourceLedger).where(eq(resourceLedger.colonyId, id))).rejects.toThrow();
  });

  it("el astillero construye naves: aparece una flota nueva, y el colonizador se lleva colonos", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const s = await connect(a.cookies);
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 0, humans: need0 })).toMatchObject({ ok: true });
    const [row] = await db.select().from(colonies);
    const id = row!.id;
    // Un astillero ya construido y recursos de sobra (como si hubieran pasado días).
    await db.insert(installations).values({ colonyId: id, kind: "shipyard" });
    await db.update(colonies).set({ ...ECONOMY.storage, population: 900, resolvedAt: new Date() }).where(eq(colonies.id, id));
    expect(await s.cmd("colony.build", { colonyId: id, kind: "installation", itemId: "shipyard" })).toMatchObject({ ok: false, error: "limit_reached" });

    expect(await s.cmd("colony.build", { colonyId: id, kind: "ship", itemId: "colonizer" })).toMatchObject({ ok: true });
    const from = s.messages.length;
    await finishBuilds();
    const created = await s.next((m): m is Extract<ServerMessage, { t: "delta" }> => m.t === "delta" && m.ops.some((o) => o.path.startsWith("fleets.")), from);
    const fleet = created.ops.find((o) => o.path.startsWith("fleets."))!.v as Fleet;
    expect(fleet.number).toBe(2);
    expect(fleet.location.systemId).toBe(home.summary.id);
    // Embarcan todos menos los que se quedan (la población puede haber bajado un poco hacia su tope).
    const boarded = fleet.ships[0]!.humans;
    expect(boarded).toBeLessThanOrEqual(Math.min(SHIP_HUMAN_CAPACITY.colonizer!, 900 - HUMANS.colonyKeep));
    expect(boarded).toBeGreaterThan(800);
    expect(fleet.ships).toEqual([{ id: expect.any(String), classId: "colonizer", hull: getShipClass("colonizer")!.hull, humans: boarded }]);
    const colony = await s.op<Colony>(`colonies.${id}`, from);
    expect(colony.population).toBeGreaterThanOrEqual(HUMANS.colonyKeep);
    expect(colony.population).toBeLessThan(HUMANS.colonyKeep + 1);
    expect((await ledgerOf(id)).map((l) => [l.reason, l.humans])).toEqual([
      ["foundation", need0],
      ["build", 0],
      ["colonizer_boarding", -boarded],
    ]);

    // Con ese colonizador se reclama otro planeta del sistema.
    expect(await s.cmd("colony.claim", { systemId: home.summary.id, planetIndex: 1, fleetId: fleet.id })).toMatchObject({ ok: true });
    expect(await db.select().from(colonies)).toHaveLength(2);
    expect(await db.select().from(colonyBuilds)).toEqual([]);
  });
});
