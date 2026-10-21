/**
 * Tests de la Fase 9a (guerra): combate de flotas por rondas, huida, convoyes
 * que esperan al combate e interceptar flotas en tránsito. Usan
 * TEST_DATABASE_URL, que se vacía.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ECONOMY, FLEET_BATTLE, getShipClass } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { LOGIN_TOKEN_PARAM, PROTOCOL_VERSION, type Battle, type ContactsResponse, type Emperor, type ServerMessage, type StarSystemSummary } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { battleRounds, battles, battleSides, colonies, discoveries, emperorAllies, fleetCargo, fleets, resourceLedger, scheduledEvents, ships } from "../src/db/schema";
import { DiscoveryService } from "../src/discovery/service";
import { spawnCandidates } from "../src/emperor/world";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";
type Ack = Extract<ServerMessage, { t: "ack" }>;

describe.skipIf(!TEST_DATABASE_URL)("guerra: combate de flotas", () => {
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
  const [sysA, sysB] = spawnCandidates(seed).filter((s) => details.detail(s).planets.length >= 2) as [StarSystemSummary, StarSystemSummary];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsUrl = "";
  const sockets: WebSocket[] = [];
  let n = 0;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    sent.length = 0;
    await db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events, battles CASCADE`);
    app = await buildApp(config, { db, mailer, startWorker: false });
    wsUrl = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws") + "/ws";
  });
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await app.close();
  });
  afterAll(() => database.close());

  /** Jugador con su primera flota en `systemId` y estas naves (sustituyen a las iniciales). */
  async function player(name: string, systemId: string, classes: string[]) {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: `${name.toLowerCase()}@ejemplo.com`, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const emperor = (await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies })).json().emperor as Emperor;
    for (const s of [sysA, sysB]) await db.insert(discoveries).values({ emperorId: emperor.id, systemId: s.id }).onConflictDoNothing();
    const [fleet] = await db.select().from(fleets).where(eq(fleets.emperorId, emperor.id));
    await db.update(fleets).set({ systemId }).where(eq(fleets.id, fleet!.id));
    await db.delete(ships).where(eq(ships.fleetId, fleet!.id));
    for (const c of classes) await db.insert(ships).values({ fleetId: fleet!.id, classId: c, hull: getShipClass(c as "frigate")!.hull });

    const ticket = (await app.inject({ method: "POST", url: "/api/ws/ticket", cookies })).json().ticket as string;
    const ws = new WebSocket(`${wsUrl}?v=${PROTOCOL_VERSION}&ticket=${ticket}`, { headers: { origin: ORIGIN } });
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ t: "sub", topic: "me" }));
    for (let i = 0; i < 250 && !messages.some((m) => m.t === "snap"); i++) await new Promise((r) => setTimeout(r, 20));
    const cmd = async (op: string, args: unknown): Promise<Ack> => {
      const cmdId = `war-${++n}-xyz`;
      ws.send(JSON.stringify({ t: "cmd", cmdId, op, args }));
      for (let i = 0; i < 250; i++) {
        const ack = messages.find((m): m is Ack => m.t === "ack" && m.cmdId === cmdId);
        if (ack) return ack;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("sin respuesta");
    };
    return { emperor, cookies, fleetId: fleet!.id, cmd, ws, messages };
  }

  /** Viaje instantáneo: manda la flota a `systemId` y la hace llegar (procesa la cola). */
  async function travel(fleetId: string, systemId: string) {
    await db
      .update(fleets)
      .set({ destSystemId: systemId, departAt: sql`now() - interval '2 seconds'`, arriveAt: sql`now() - interval '1 second'` })
      .where(eq(fleets.id, fleetId));
    await db.execute(sql`INSERT INTO scheduled_events (kind, due_at, payload) VALUES ('fleet.arrive', now() - interval '1 second', ${JSON.stringify({ fleetId })}::jsonb)`);
    await app.eventWorker.drain();
  }
  /** Resuelve las rondas pendientes (hasta `max`) sin esperar. */
  async function rounds(max = FLEET_BATTLE.maxRounds + 1) {
    for (let i = 0; i < max; i++) {
      const due = await db
        .update(scheduledEvents)
        .set({ dueAt: sql`now() - interval '1 second'` })
        .where(eq(scheduledEvents.kind, "battle.round"))
        .returning({ id: scheduledEvents.id });
      if (due.length === 0) return;
      await app.eventWorker.drain();
    }
  }
  const fleetRow = async (id: string) => (await db.select().from(fleets).where(eq(fleets.id, id)))[0];
  const outcomes = async (battleId: string) =>
    Object.fromEntries((await db.select().from(battleSides).where(eq(battleSides.battleId, battleId))).map((s) => [s.emperorId, s.outcome]));

  it("fragatas contra un carguero: batalla por rondas hasta destruirlo; la carga se pierde en el libro", async () => {
    const def = await player("Defensor", sysB.id, ["freighter"]);
    const att = await player("Atacante", sysA.id, ["frigate", "frigate"]);
    await db.insert(fleetCargo).values({ fleetId: def.fleetId, metal: 100, volatiles: 0, crystal: 0, alloys: 0, humans: 0 });
    // La flota defensora sigue viva y fuera de combate mientras nadie llega.
    expect((await fleetRow(def.fleetId))!.battleId).toBeNull();
    await travel(att.fleetId, sysB.id);
    const [battle] = await db.select().from(battles);
    expect(battle).toBeTruthy();
    expect(battle!.systemId).toBe(sysB.id);
    expect((await fleetRow(def.fleetId))!.battleId).toBe(battle!.id);
    expect((await fleetRow(att.fleetId))!.battleId).toBe(battle!.id);
    // En combate no se carga ni se descarga ni se reclama nada.
    expect(await def.cmd("fleet.transfer", { fleetId: def.fleetId, colonyId: crypto.randomUUID(), direction: "load", amounts: { metal: 1 } })).toMatchObject({ ok: false });

    await rounds();
    const [ended] = await db.select().from(battles);
    expect(ended!.endedAt).not.toBeNull();
    expect(ended!.round).toBeGreaterThan(0);
    expect(await outcomes(battle!.id)).toEqual({ [def.emperor.id]: "lost", [att.emperor.id]: "won" });
    // El carguero ha caído: su flota desaparece; las fragatas quedan libres.
    expect(await fleetRow(def.fleetId)).toBeUndefined();
    expect((await fleetRow(att.fleetId))!.battleId).toBeNull();
    const reports = await db.select().from(battleRounds).where(eq(battleRounds.battleId, battle!.id));
    expect(reports).toHaveLength(ended!.round);
    const loss = await db.select().from(resourceLedger).where(eq(resourceLedger.reason, "battle_loss"));
    expect(loss.map((l) => [l.emperorId, l.metal])).toEqual([[def.emperor.id, -100]]);

    // Cada bando recibe la batalla desde su lado.
    const lastView = () =>
      att.messages
        .flatMap((m) => (m.t === "delta" ? m.ops : []))
        .filter((o) => o.path === `battles.${battle!.id}`)
        .at(-1)?.v as Battle | undefined;
    for (let i = 0; i < 250 && lastView()?.outcome !== "won"; i++) await new Promise((r) => setTimeout(r, 20));
    expect(lastView()).toMatchObject({ outcome: "won", enemyName: "Defensor", systemId: sysB.id });
  });

  it("huir: una orden de viaje saca a la flota y el otro bando gana", async () => {
    const a = await player("Huidor", sysB.id, ["frigate"]);
    const b = await player("Cazador", sysA.id, ["frigate"]);
    await travel(b.fleetId, sysB.id);
    const [battle] = await db.select().from(battles);
    expect(battle).toBeTruthy();
    expect(await a.cmd("fleet.move", { fleetId: a.fleetId, systemId: sysA.id })).toMatchObject({ ok: true });
    expect((await fleetRow(a.fleetId))!.battleId).toBeNull();
    await rounds(1);
    expect(await outcomes(battle!.id)).toEqual({ [a.emperor.id]: "fled", [b.emperor.id]: "won" });
  });

  it("los compañeros no combaten, y sin armas en ningún bando tampoco", async () => {
    const a = await player("Amigo", sysB.id, ["frigate"]);
    const b = await player("Amiga", sysA.id, ["frigate"]);
    await db.insert(emperorAllies).values([
      { emperorId: a.emperor.id, allyId: b.emperor.id },
      { emperorId: b.emperor.id, allyId: a.emperor.id },
    ]);
    await travel(b.fleetId, sysB.id);
    const c = await player("Mercader", sysA.id, ["freighter"]);
    const d = await player("Minero", sysA.id, ["freighter"]);
    void d;
    await travel(c.fleetId, sysA.id);
    expect(await db.select().from(battles)).toEqual([]);
  });

  it("un convoy en ruta espera al combate y sigue su ruta si sobrevive", async () => {
    const conv = await player("Convoy", sysA.id, ["freighter", "frigate", "frigate", "frigate"]);
    const now = new Date();
    const [ca] = await db.insert(colonies).values({ emperorId: conv.emperor.id, systemId: sysA.id, planetIndex: 0, population: 300, ...ECONOMY.storage, resolvedAt: now }).returning();
    const [cb] = await db.insert(colonies).values({ emperorId: conv.emperor.id, systemId: sysB.id, planetIndex: 0, population: 100, metal: 0, volatiles: 500, crystal: 0, alloys: 0, resolvedAt: now }).returning();
    const raider = await player("Corsario", sysB.id, ["explorer"]);
    expect(await conv.cmd("fleet.route", { fleetId: conv.fleetId, fromColonyId: ca!.id, toColonyId: cb!.id, carry: ["metal"], humans: false })).toMatchObject({ ok: true });
    // Llega a B, donde espera el corsario: combate y no descarga.
    await db.update(fleets).set({ departAt: sql`now() - interval '2 seconds'`, arriveAt: sql`now() - interval '1 second'` }).where(eq(fleets.id, conv.fleetId));
    await db.execute(sql`UPDATE scheduled_events SET due_at = now() - interval '1 second' WHERE kind = 'fleet.arrive'`);
    await app.eventWorker.drain();
    const [battle] = await db.select().from(battles);
    expect(battle).toBeTruthy();
    const cargoBefore = (await db.select().from(fleetCargo).where(eq(fleetCargo.fleetId, conv.fleetId)))[0]!.metal;
    expect(cargoBefore).toBeGreaterThan(0);
    expect((await fleetRow(conv.fleetId))!.destSystemId).toBeNull();
    await rounds();
    expect(await outcomes(battle!.id)).toEqual({ [conv.emperor.id]: "won", [raider.emperor.id]: "lost" });
    // Tras vencer, descarga en B y vuelve hacia A.
    const f = (await fleetRow(conv.fleetId))!;
    expect([f.systemId, f.destSystemId]).toEqual([sysB.id, sysA.id]);
  });

  it("contactos e interceptar: ves flotas enemigas en tránsito cerca y vas a su destino", async () => {
    const hunter = await player("Rastreador", sysA.id, ["frigate"]);
    const prey = await player("Presa", sysA.id, ["freighter"]);
    // La presa sale de A (donde están los sensores del cazador) hacia B.
    await db
      .update(fleets)
      .set({ destSystemId: sysB.id, departAt: sql`now() - interval '1 second'`, arriveAt: sql`now() + interval '1 hour'` })
      .where(eq(fleets.id, prey.fleetId));
    const res = await app.inject({ method: "GET", url: "/api/contacts", cookies: hunter.cookies });
    const contacts = (res.json() as ContactsResponse).contacts;
    expect(contacts.map((c) => [c.fleetId, c.emperorName, c.to.systemId])).toEqual([[prey.fleetId, "Presa", sysB.id]]);
    // La presa no ve sus propias flotas como contacto.
    expect(((await app.inject({ method: "GET", url: "/api/contacts", cookies: prey.cookies })).json() as ContactsResponse).contacts).toEqual([]);
    expect(await hunter.cmd("fleet.intercept", { fleetId: hunter.fleetId, targetFleetId: crypto.randomUUID() })).toMatchObject({ ok: false, error: "no_target" });
    expect(await hunter.cmd("fleet.intercept", { fleetId: hunter.fleetId, targetFleetId: prey.fleetId })).toMatchObject({ ok: true });
    expect((await fleetRow(hunter.fleetId))!.destSystemId).toBe(sysB.id);
  });
});
