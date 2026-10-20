/**
 * Tests de la niebla de guerra: descubrimientos al crear el Emperador, al
 * llegar una flota y al llegar el Emperador, y entrega del detalle solo de lo
 * descubierto. Usan TEST_DATABASE_URL, que se vacía.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EMPEROR_FLAGSHIP, getShipClass, STARTING_FLEET } from "@imperium/content";
import { generateSector, generateSystemDetail, universeSeedFromString } from "@imperium/procgen";
import { LOGIN_TOKEN_PARAM, PROTOCOL_VERSION, type Emperor, type ServerMessage, type StarSystemDetail } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { discoveries } from "../src/db/schema";
import { DiscoveryService, systemDetailSeed } from "../src/discovery/service";
import { findSystem, systemsInRange } from "../src/emperor/world";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";

type Snap = Extract<ServerMessage, { t: "snap" }>;
type Delta = Extract<ServerMessage, { t: "delta" }>;

describe.skipIf(!TEST_DATABASE_URL)("niebla de guerra", () => {
  const sent: string[] = [];
  const mailer: Mailer = {
    async sendLoginLink(_to, link) {
      sent.push(link);
    },
  };
  const database = createDb(TEST_DATABASE_URL ?? "");
  // Escala de tiempo enorme: cualquier viaje dura el mínimo (1 s).
  const config = loadConfig({
    APP_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_URL: ORIGIN,
    COOKIE_SECURE: "false",
    TIME_SCALE: "1e7",
    DETAIL_SEED: "semilla-secreta-de-pruebas",
  });
  const SESSION_COOKIE = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  /** Sistemas lejanos (a 500 a.l. del Núcleo Humano): nadie los conoce al empezar. */
  const farSystems = generateSector(seed, { x: 5, y: 0, z: 0 }).systems;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsUrl = "";
  const sockets: WebSocket[] = [];

  beforeAll(() => resetTestDatabase(database));

  beforeEach(async () => {
    sent.length = 0;
    await database.db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events CASCADE`);
    app = await buildApp(config, { db: database.db, mailer });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    wsUrl = address.replace("http", "ws") + "/ws";
  });

  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await app.close();
  });

  afterAll(() => database.close());

  async function player(email: string, name: string) {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const res = await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies });
    return { cookies, emperor: res.json().emperor as Emperor };
  }

  const getSystem = (cookies: Record<string, string> | undefined, id: string) =>
    app.inject({ method: "GET", url: `/api/systems/${encodeURIComponent(id)}`, cookies });

  const discoveredBy = async (emperorId: string) =>
    new Set((await database.db.select().from(discoveries).where(sql`${discoveries.emperorId} = ${emperorId}`)).map((r) => r.systemId));

  /** Conexión que guarda los mensajes y permite esperar uno concreto. */
  async function connect(cookies: Record<string, string>) {
    const ticket = (await app.inject({ method: "POST", url: "/api/ws/ticket", cookies })).json().ticket as string;
    const ws = new WebSocket(`${wsUrl}?v=${PROTOCOL_VERSION}&ticket=${ticket}`, { headers: { origin: ORIGIN } });
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ t: "sub", topic: "me" }));
    const next = async <T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs = 5000): Promise<T> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = messages.find(pred);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`Mensaje no recibido. Recibidos: ${JSON.stringify(messages)}`);
        await new Promise((r) => setTimeout(r, 30));
      }
    };
    return { ws, messages, next, send: (msg: unknown) => ws.send(JSON.stringify(msg)) };
  }

  const discoveredDelta =
    (systemId: string) =>
    (m: ServerMessage): m is Delta =>
      m.t === "delta" && m.topic === "me" && m.ops.some((op) => op.path === `discovered.${systemId}`);

  it("al crear el Emperador descubre su sistema y lo que cubren su nave y su flota inicial, nada más", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const spawn = findSystem(seed, a.emperor.location.systemId)!;
    const range = Math.max(EMPEROR_FLAGSHIP.scannerRangeLy, ...STARTING_FLEET.map((id) => getShipClass(id)!.scannerRangeLy));
    const expected = new Set([spawn.id, ...systemsInRange(seed, spawn.position, range).map((s) => s.id)]);
    // Hay estrellas más allá del alcance que no se descubren.
    expect(systemsInRange(seed, spawn.position, range + 30).length).toBeGreaterThan(expected.size);
    expect(await discoveredBy(a.emperor.id)).toEqual(expected);

    // La instantánea privada del jugador trae la lista.
    const s = await connect(a.cookies);
    const snap = await s.next((m): m is Snap & { topic: "me" } => m.t === "snap" && m.topic === "me");
    expect(new Set(snap.data.discovered)).toEqual(expected);

    // El detalle del sistema propio se entrega, generado con la semilla secreta.
    const res = await getSystem(a.cookies, spawn.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    const detail = res.json().detail as StarSystemDetail;
    expect(detail).toEqual(generateSystemDetail(seed, spawn, systemDetailSeed(config.DETAIL_SEED, spawn.id)));
    expect(detail.summary).toEqual(spawn);
  });

  it("no entrega el detalle de lo no descubierto ni acepta peticiones no válidas", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const far = farSystems[0]!;
    expect((await getSystem(undefined, far.id)).statusCode).toBe(401);
    const res = await getSystem(a.cookies, far.id);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "not_discovered" });
    expect((await getSystem(a.cookies, "no-es-un-id")).statusCode).toBe(400);
    expect((await getSystem(a.cookies, "05:0:0:0")).json()).toEqual({ error: "unknown_system" });
    expect((await getSystem(a.cookies, "5:0:0:999")).json()).toEqual({ error: "unknown_system" });
  });

  it("una flota que llega descubre lo que cubre el escáner de su mejor nave; solo para su dueño", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const b = await player("b@ejemplo.com", "Brennus");
    const far = farSystems[0]!;
    const sa = await connect(a.cookies);
    const snap = await sa.next((m): m is Snap & { topic: "me" } => m.t === "snap" && m.topic === "me");
    const fleet = snap.data.fleets[0]!;

    sa.send({ t: "cmd", cmdId: "flota-lejos-01", op: "fleet.move", args: { fleetId: fleet.id, systemId: far.id } });
    const delta = await sa.next(discoveredDelta(far.id));
    const scanner = getShipClass("explorer")!.scannerRangeLy;
    const expected = new Set([far.id, ...systemsInRange(seed, far.position, scanner).map((s) => s.id)]);
    expect(new Set(delta.ops.map((op) => op.path.slice("discovered.".length)))).toEqual(expected);
    expect(delta.ops.every((op) => op.v === true)).toBe(true);

    const res = await getSystem(a.cookies, far.id);
    expect(res.statusCode).toBe(200);
    expect((res.json().detail as StarSystemDetail).summary.id).toBe(far.id);

    // Los descubrimientos no se comparten: B sigue sin poder verlo.
    expect((await getSystem(b.cookies, far.id)).json()).toEqual({ error: "not_discovered" });
    expect((await discoveredBy(b.emperor.id)).has(far.id)).toBe(false);
  });

  it("el Emperador que llega tras un salto descubre lo que cubre su escáner", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const far = farSystems[1]!;
    const sa = await connect(a.cookies);
    await sa.next((m): m is Snap => m.t === "snap");

    sa.send({ t: "cmd", cmdId: "salto-lejos-01", op: "emperor.move", args: { systemId: far.id } });
    // Antes de llegar, aún no se conoce.
    expect((await getSystem(a.cookies, far.id)).statusCode).toBe(403);
    await sa.next(discoveredDelta(far.id));

    const expected = new Set([far.id, ...systemsInRange(seed, far.position, EMPEROR_FLAGSHIP.scannerRangeLy).map((s) => s.id)]);
    const mine = await discoveredBy(a.emperor.id);
    for (const id of expected) expect(mine.has(id)).toBe(true);
    expect((await getSystem(a.cookies, far.id)).statusCode).toBe(200);
  });

  it("la puesta al día da su entorno a los Emperadores sin descubrimientos, una sola vez", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const before = await discoveredBy(a.emperor.id);
    // Como un Emperador creado antes de la niebla de guerra.
    await database.db.delete(discoveries);
    const service = new DiscoveryService(database.db, config);
    expect(await service.backfill()).toBe(1);
    expect(await discoveredBy(a.emperor.id)).toEqual(before);
    expect(await service.backfill()).toBe(0);
  });

  it("al borrar la cuenta se borran sus descubrimientos", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    expect((await discoveredBy(a.emperor.id)).size).toBeGreaterThan(0);
    await database.db.execute(sql`DELETE FROM accounts`);
    expect((await database.db.select().from(discoveries)).length).toBe(0);
  });
});
