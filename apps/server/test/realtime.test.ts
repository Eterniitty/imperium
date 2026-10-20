/**
 * Tests de integración del WebSocket: conexiones reales contra el servidor
 * escuchando en un puerto local. Usan TEST_DATABASE_URL, que se vacía.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { LOGIN_TOKEN_PARAM, PROTOCOL_VERSION, WS_CLOSE, type Emperor, type EmperorView, type Fleet, type ServerMessage, type Topic } from "@imperium/shared";
import { generateSector, universeSeedFromString } from "@imperium/procgen";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";

/** Conexión de prueba que guarda los mensajes recibidos para esperarlos. */
class TestSocket {
  readonly messages: ServerMessage[] = [];
  private waiters: Array<() => void> = [];
  closeCode: number | null = null;

  constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      this.waiters.forEach((w) => w());
    });
    ws.on("close", (code) => {
      this.closeCode = code;
      this.waiters.forEach((w) => w());
    });
  }

  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Espera (y devuelve) el primer mensaje que cumpla la condición, contando desde `from`. */
  async next<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, from = 0, timeoutMs = 3000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.slice(from).find(pred);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`Mensaje no recibido. Recibidos: ${JSON.stringify(this.messages)}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
      this.waiters = [];
    }
  }

  async closed(timeoutMs = 3000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null) {
      if (Date.now() > deadline) throw new Error("La conexión no se cerró");
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.closeCode;
  }
}

const is =
  <K extends ServerMessage["t"]>(t: K) =>
  (m: ServerMessage): m is Extract<ServerMessage, { t: K }> =>
    m.t === t;

type Snap<T extends Topic> = Extract<ServerMessage, { t: "snap"; topic: T }>;
type Delta = Extract<ServerMessage, { t: "delta" }>;
/** Instantánea de un tema. */
const snapOf =
  <T extends Topic>(topic: T) =>
  (m: ServerMessage): m is Snap<T> =>
    m.t === "snap" && m.topic === topic;
/** Cambio de un tema. */
const deltaOf =
  (topic: Topic) =>
  (m: ServerMessage): m is Delta =>
    m.t === "delta" && m.topic === topic;

describe.skipIf(!TEST_DATABASE_URL)("WebSocket y dos jugadores", () => {
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
  });
  const SESSION_COOKIE = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  const coreSystems = generateSector(seed, { x: 0, y: 0, z: 0 }).systems;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsUrl = "";
  const sockets: TestSocket[] = [];

  beforeAll(async () => {
    await resetTestDatabase(database);
  });

  beforeEach(async () => {
    sent.length = 0;
    await database.db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors CASCADE`);
    app = await buildApp(config, { db: database.db, mailer });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    wsUrl = address.replace("http", "ws") + "/ws";
  });

  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.ws.terminate());
    await app.close();
  });

  afterAll(() => database.close());

  async function login(email: string): Promise<Record<string, string>> {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const res = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
  }

  async function player(email: string, name: string) {
    const cookies = await login(email);
    const res = await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies });
    return { cookies, emperor: res.json().emperor as Emperor };
  }

  const ticket = async (cookies: Record<string, string>) => {
    const res = await app.inject({ method: "POST", url: "/api/ws/ticket", cookies });
    return res.json().ticket as string;
  };

  /** Abre un WebSocket; resuelve con la conexión o con el código HTTP del rechazo. */
  function open(query: string, origin = ORIGIN): Promise<TestSocket | number> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`${wsUrl}?${query}`, { headers: { origin } });
      ws.once("open", () => {
        const s = new TestSocket(ws);
        sockets.push(s);
        resolve(s);
      });
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    });
  }

  async function connect(cookies: Record<string, string>): Promise<TestSocket> {
    const s = await open(`v=${PROTOCOL_VERSION}&ticket=${await ticket(cookies)}`);
    if (typeof s === "number") throw new Error(`Conexión rechazada: ${s}`);
    s.send({ t: "sub", topic: "emperors" });
    s.send({ t: "sub", topic: "me" });
    await s.next(snapOf("emperors"));
    await s.next(snapOf("me"));
    return s;
  }

  it("el ticket exige sesión y Emperador", async () => {
    expect((await app.inject({ method: "POST", url: "/api/ws/ticket" })).statusCode).toBe(401);
    const cookies = await login("sin@ejemplo.com");
    const res = await app.inject({ method: "POST", url: "/api/ws/ticket", cookies });
    expect(res.json()).toEqual({ error: "no_emperor" });
  });

  it("rechaza conexiones sin ticket, con ticket usado, de otra web o de otra versión", async () => {
    const { cookies } = await player("a@ejemplo.com", "Aurelia");
    expect(await open(`v=${PROTOCOL_VERSION}`)).toBe(401);
    expect(await open(`v=${PROTOCOL_VERSION}&ticket=inventado`)).toBe(401);
    expect(await open(`v=${PROTOCOL_VERSION}&ticket=${await ticket(cookies)}`, "https://malvada.test")).toBe(403);
    expect(await open(`v=999&ticket=${await ticket(cookies)}`)).toBe(400);

    const t = await ticket(cookies);
    expect(typeof (await open(`v=${PROTOCOL_VERSION}&ticket=${t}`))).toBe("object");
    expect(await open(`v=${PROTOCOL_VERSION}&ticket=${t}`)).toBe(401);
  });

  it("al conectar: saludo, instantánea con todos los Emperadores y quién está en línea", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const b = await player("b@ejemplo.com", "Brennus");
    const sa = await connect(a.cookies);
    expect(sa.messages[0]).toMatchObject({ t: "hello", protocol: PROTOCOL_VERSION, emperorId: a.emperor.id });
    const snap = await sa.next(snapOf("emperors"));
    expect(snap.data.emperors.map((e) => [e.name, e.online])).toEqual([
      ["Aurelia", true],
      ["Brennus", false],
    ]);

    // B se conecta: A lo ve pasar a en línea; y al desconectarse, a desconectado.
    const from = sa.messages.length;
    const sb = await connect(b.cookies);
    const online = await sa.next(deltaOf("emperors"), from);
    expect(online.ops).toEqual([{ path: `emperors.${b.emperor.id}`, v: { ...b.emperor, online: true } }]);
    sb.ws.close();
    const offline = await sa.next((m): m is Delta => deltaOf("emperors")(m) && m.seq === online.seq + 1, from);
    expect((offline.ops[0]?.v as EmperorView).online).toBe(false);
  });

  it("un jugador viaja y el otro lo ve moverse; al llegar, está en el destino", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const b = await player("b@ejemplo.com", "Brennus");
    const sa = await connect(a.cookies);
    const sb = await connect(b.cookies);
    const dest = coreSystems.find((s) => s.id !== a.emperor.location.systemId)!;

    const from = sb.messages.length;
    sa.send({ t: "cmd", cmdId: "mover-0001", op: "emperor.move", args: { systemId: dest.id } });
    expect(await sa.next(is("ack"))).toEqual({ t: "ack", cmdId: "mover-0001", ok: true });

    const delta = await sb.next(deltaOf("emperors"), from);
    const seen = delta.ops[0]!.v as EmperorView;
    expect(seen.location.systemId).toBe(a.emperor.location.systemId);
    expect(seen.travel?.to.systemId).toBe(dest.id);
    expect(seen.travel!.arriveAt - seen.travel!.departAt).toBe(1000);

    // Durante el viaje no acepta otro destino.
    sa.send({ t: "cmd", cmdId: "mover-0002", op: "emperor.move", args: { systemId: a.emperor.location.systemId } });
    expect(await sa.next((m): m is Extract<ServerMessage, { t: "ack" }> => m.t === "ack" && m.cmdId === "mover-0002")).toMatchObject({
      ok: false,
      error: "in_transit",
    });

    await new Promise((r) => setTimeout(r, 1100));
    const res = await app.inject({ method: "GET", url: "/api/emperor", cookies: a.cookies });
    expect(res.json().emperor).toMatchObject({ location: { systemId: dest.id }, travel: null });
  });

  it("repetir una orden con el mismo cmdId no la ejecuta dos veces", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const sa = await connect(a.cookies);
    const dest = coreSystems.find((s) => s.id !== a.emperor.location.systemId)!;
    const cmd = { t: "cmd", cmdId: "repetida-01", op: "emperor.move", args: { systemId: dest.id } };
    sa.send(cmd);
    sa.send(cmd);
    await new Promise((r) => setTimeout(r, 300));
    const acks = sa.messages.filter(is("ack"));
    expect(acks).toEqual([
      { t: "ack", cmdId: "repetida-01", ok: true },
      { t: "ack", cmdId: "repetida-01", ok: true },
    ]);
    // Un solo cambio difundido (además del de conectarse).
    expect(sa.messages.filter(deltaOf("emperors")).filter((d) => (d.ops[0]?.v as EmperorView).travel)).toHaveLength(1);
  });

  it("rechaza destinos inexistentes o el sistema donde ya está", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const sa = await connect(a.cookies);
    sa.send({ t: "cmd", cmdId: "destino-01", op: "emperor.move", args: { systemId: "0:0:0:999" } });
    sa.send({ t: "cmd", cmdId: "destino-02", op: "emperor.move", args: { systemId: a.emperor.location.systemId } });
    await new Promise((r) => setTimeout(r, 300));
    expect(sa.messages.filter(is("ack"))).toEqual([
      { t: "ack", cmdId: "destino-01", ok: false, error: "unknown_system" },
      { t: "ack", cmdId: "destino-02", ok: false, error: "already_there" },
    ]);
  });

  it("un mensaje mal formado cierra la conexión", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    for (const bad of ["no es json", JSON.stringify({ t: "cmd", op: "emperor.teleport" }), JSON.stringify({ t: "sub", topic: "todo" })]) {
      const s = await connect(a.cookies);
      s.ws.send(bad);
      expect(await s.closed()).toBe(WS_CLOSE.protocol);
    }
  });

  it("demasiados mensajes cierran la conexión", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const s = await connect(a.cookies);
    for (let i = 0; i < 70; i++) s.send({ t: "sub", topic: "emperors" });
    expect(await s.closed()).toBe(WS_CLOSE.rateLimited);
  });

  it("un Emperador nuevo aparece en directo para los conectados", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const sa = await connect(a.cookies);
    const from = sa.messages.length;
    const b = await player("b@ejemplo.com", "Brennus");
    const delta = await sa.next(deltaOf("emperors"), from);
    expect(delta.ops).toEqual([{ path: `emperors.${b.emperor.id}`, v: { ...b.emperor, online: false } }]);
  });

  it("cada Emperador empieza con una flota con un explorador, y solo la ve él", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const b = await player("b@ejemplo.com", "Brennus");
    const sa = await connect(a.cookies);
    const sb = await connect(b.cookies);
    const fleetsA = sa.messages.find(snapOf("me"))!.data.fleets;
    expect(fleetsA).toHaveLength(1);
    expect(fleetsA[0]).toMatchObject({ number: 1, location: a.emperor.location, travel: null, ships: [{ classId: "explorer", hull: 60 }] });
    const fleetsB = sb.messages.find(snapOf("me"))!.data.fleets;
    expect(fleetsB.map((f) => f.id)).not.toContain(fleetsA[0]!.id);
  });

  it("una flota viaja, solo su dueño ve el cambio y al llegar el servidor la deja en el destino", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const b = await player("b@ejemplo.com", "Brennus");
    const sa = await connect(a.cookies);
    const sb = await connect(b.cookies);
    const fleet = sa.messages.find(snapOf("me"))!.data.fleets[0]!;
    const dest = coreSystems.find((s) => s.id !== fleet.location.systemId)!;

    // Otro jugador no puede mover una flota ajena.
    sb.send({ t: "cmd", cmdId: "ajena-0001", op: "fleet.move", args: { fleetId: fleet.id, systemId: dest.id } });
    expect(await sb.next(is("ack"))).toEqual({ t: "ack", cmdId: "ajena-0001", ok: false, error: "no_fleet" });

    const from = sa.messages.length;
    const fromB = sb.messages.length;
    sa.send({ t: "cmd", cmdId: "flota-0001", op: "fleet.move", args: { fleetId: fleet.id, systemId: dest.id } });
    expect(await sa.next(is("ack"), from)).toEqual({ t: "ack", cmdId: "flota-0001", ok: true });
    const leaving = (await sa.next(deltaOf("me"), from)).ops[0]!.v as Fleet;
    expect(leaving.travel?.to.systemId).toBe(dest.id);

    // La llegada la procesa la cola de eventos y se avisa al dueño.
    const arrived = await sa.next((m): m is Delta => deltaOf("me")(m) && (m.ops[0]!.v as Fleet).travel === null, from, 5000);
    expect((arrived.ops[0]!.v as Fleet).location.systemId).toBe(dest.id);
    const [row] = await database.db.execute(sql`SELECT system_id, dest_system_id FROM fleets WHERE id = ${fleet.id}`);
    expect(row).toEqual({ system_id: dest.id, dest_system_id: null });
    expect(sb.messages.slice(fromB).filter(deltaOf("me"))).toEqual([]);
  });
});
