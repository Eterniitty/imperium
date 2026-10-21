/**
 * Tests de integración del WebSocket: conexiones reales contra el servidor
 * escuchando en un puerto local. Usan TEST_DATABASE_URL, que se vacía.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { LOGIN_TOKEN_PARAM, PROTOCOL_VERSION, WS_CLOSE, type Emperor, type EmperorView, type Fleet, type ServerMessage, type Topic, type Visibility } from "@imperium/shared";
import { generateSector, universeSeedFromString } from "@imperium/procgen";
import { planetPosition, quantumFuelCost } from "@imperium/sim";
import { buildApp } from "../src/app";
import { colonies, emperors, fleets, resourceLedger } from "../src/db/schema";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import type { Mailer } from "../src/mail";
import { spawnCandidates, systemsInRange } from "../src/emperor/world";
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
  const spawnSystems = new Set(spawnCandidates(seed).map((s) => s.id));
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
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const res = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
  }

  /** Jugador con Emperador. Por defecto público, para los tests de difusión; los de privacidad eligen. */
  async function player(email: string, name: string, visibility: Visibility = "public") {
    const cookies = await login(email);
    const res = await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies });
    await app.inject({ method: "POST", url: "/api/social/visibility", payload: { visibility }, cookies });
    const emperor = res.json().emperor as Emperor;
    // Depósito sin límite: los saltos cruzan el Núcleo (el alcance por combustible tiene su propia prueba).
    await database.db.update(emperors).set({ fuel: 1e6 }).where(eq(emperors.id, emperor.id));
    return { cookies, emperor };
  }

  const social = (cookies: Record<string, string>, url: string, payload?: unknown) =>
    app.inject({ method: payload === undefined ? "GET" : "POST", url, payload: payload as object, cookies });

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

  it("un Emperador nuevo y público aparece en directo para los conectados", async () => {
    const a = await player("a@ejemplo.com", "Aurelia");
    const sa = await connect(a.cookies);
    const from = sa.messages.length;
    // Nace privado (solo compañeros): aparece para los demás cuando se hace público.
    const b = await player("b@ejemplo.com", "Brennus", "public");
    const delta = await sa.next((m): m is Delta => deltaOf("emperors")(m) && m.ops.length > 0, from);
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

  describe("privacidad", () => {
    /** Ids de Emperadores que ve un cliente según lo recibido (instantánea y cambios). */
    const seenBy = (s: TestSocket): Set<string> => {
      const ids = new Set<string>();
      for (const m of s.messages) {
        if (m.t === "snap" && m.topic === "emperors") {
          ids.clear();
          for (const e of m.data.emperors) ids.add(e.id);
        } else if (m.t === "delta" && m.topic === "emperors") {
          for (const op of m.ops) {
            const id = op.path.slice("emperors.".length);
            if (op.v) ids.add(id);
            else ids.delete(id);
          }
        }
      }
      return ids;
    };
    const settle = () => new Promise((r) => setTimeout(r, 200));

    it("por defecto solo te ven tus compañeros: ni posición ni avisos a los demás", async () => {
      const a = await player("a@ejemplo.com", "Aurelia", "allies");
      const b = await player("b@ejemplo.com", "Brennus", "allies");
      const sa = await connect(a.cookies);
      const sb = await connect(b.cookies);
      expect([...seenBy(sb)]).toEqual([b.emperor.id]);

      // Aurelia viaja: a Brennus no le llega nada de ella.
      const from = sb.messages.length;
      const dest = coreSystems.find((s) => s.id !== a.emperor.location.systemId)!;
      sa.send({ t: "cmd", cmdId: "oculta-0001", op: "emperor.move", args: { systemId: dest.id } });
      await sa.next(is("ack"));
      await settle();
      expect(JSON.stringify(sb.messages.slice(from))).not.toContain(a.emperor.id);
    });

    it("añadirse uno solo no basta; cuando los dos se añaden, se ven", async () => {
      const a = await player("a@ejemplo.com", "Aurelia", "allies");
      const b = await player("b@ejemplo.com", "Brennus", "allies");
      const sb = await connect(b.cookies);

      const one = await social(a.cookies, "/api/social/allies", { name: "  BRENNUS " });
      expect(one.json()).toMatchObject({ allies: [], pending: [{ id: b.emperor.id, name: "Brennus" }], requests: [] });
      expect((await social(b.cookies, "/api/social")).json()).toMatchObject({ requests: [{ id: a.emperor.id, name: "Aurelia" }] });
      await settle();
      expect(seenBy(sb).has(a.emperor.id)).toBe(false);

      const both = await social(b.cookies, "/api/social/allies", { name: "aurelia" });
      expect(both.json()).toMatchObject({ allies: [{ id: a.emperor.id }], pending: [], requests: [] });
      await settle();
      expect(seenBy(sb).has(a.emperor.id)).toBe(true);

      // Quitar al compañero: deja de verse en el acto.
      await social(b.cookies, "/api/social/allies/remove", { emperorId: a.emperor.id });
      await settle();
      expect(seenBy(sb).has(a.emperor.id)).toBe(false);
    });

    it("oculto no lo ve nadie, ni sus compañeros; al ocultarse, desaparece para quien lo veía", async () => {
      const a = await player("a@ejemplo.com", "Aurelia", "public");
      const b = await player("b@ejemplo.com", "Brennus", "allies");
      const sb = await connect(b.cookies);
      expect(seenBy(sb).has(a.emperor.id)).toBe(true);
      await social(a.cookies, "/api/social/allies", { name: "Brennus" });
      await social(b.cookies, "/api/social/allies", { name: "Aurelia" });

      await social(a.cookies, "/api/social/visibility", { visibility: "hidden" });
      await settle();
      expect(seenBy(sb).has(a.emperor.id)).toBe(false);
      // Una instantánea nueva tampoco lo trae.
      const fresh = await connect(b.cookies);
      expect(seenBy(fresh).has(a.emperor.id)).toBe(false);
      // Él sí se ve a sí mismo.
      const own = await connect(a.cookies);
      expect(seenBy(own).has(a.emperor.id)).toBe(true);
    });

    it("errores al añadir compañeros y visibilidad no válida", async () => {
      const a = await player("a@ejemplo.com", "Aurelia");
      expect((await social(a.cookies, "/api/social/allies", { name: "Nadie Existe" })).json()).toEqual({ error: "unknown_emperor" });
      expect((await social(a.cookies, "/api/social/allies", { name: "aurelia" })).json()).toEqual({ error: "cannot_ally_self" });
      expect((await social(a.cookies, "/api/social/visibility", { visibility: "algunos" })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/api/social" })).statusCode).toBe(401);
    });
  });

  describe("espacio local (vuelo compartido)", () => {
    const pose = (p: [number, number, number]) => ({ p, q: [0, 0, 0, 1] as [number, number, number, number], v: [0, 0, 0] as [number, number, number] });
    const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
    /** Deja aparcada la nave de un Emperador en `p` ahora (para empezar a pilotar desde ahí). */
    const parkAt = (emperorId: string, p: [number, number, number]) => app.flagships.savePark(emperorId, { p, at: Date.now() });

    /** Dos jugadores en el mismo sistema (B salta al de A), conectados. */
    async function twoInOneSystem(visibility: Visibility = "hidden") {
      const a = await player("a@ejemplo.com", "Aurelia", visibility);
      const b = await player("b@ejemplo.com", "Brennus", visibility);
      const sa = await connect(a.cookies);
      const sb = await connect(b.cookies);
      const systemId = a.emperor.location.systemId;
      if (b.emperor.location.systemId !== systemId) {
        sb.send({ t: "cmd", cmdId: "reunion-01", op: "emperor.move", args: { systemId } });
        await sb.next(is("ack"));
        await settle(1100);
      }
      return { a, b, sa, sb, systemId };
    }

    it("dos naves en el mismo sistema se ven y se mueven, aunque estén ocultas en el mapa", async () => {
      const { a, b, sa, sb, systemId } = await twoInOneSystem("hidden");
      await parkAt(a.emperor.id, [100, 0, 0]);
      await parkAt(b.emperor.id, [110, 0, 0]);
      sa.send({ t: "pose", systemId, ...pose([100, 0, 0]) });
      const first = await sa.next(is("space"));
      // B aún no pilota, pero su nave está aparcada en el sistema y se ve.
      expect(first).toMatchObject({ systemId, ships: [{ id: b.emperor.id, name: "Brennus", kind: "emperor" }] });

      sb.send({ t: "pose", systemId, ...pose([110, 0, 0]) });
      const seenB = await sb.next(is("space"));
      expect(seenB.ships).toMatchObject([{ id: a.emperor.id, name: "Aurelia", ally: false, p: [100, 0, 0], hull: 400, shield: 200 }]);

      // B se mueve: A recibe su posición (y no la suya propia).
      const from = sa.messages.length;
      sb.send({ t: "pose", systemId, ...pose([112, 0, 0]) });
      const poses = await sa.next(is("poses"), from);
      expect(poses.ships).toEqual([{ id: b.emperor.id, ...pose([112, 0, 0]) }]);

      // B deja de pilotar: su nave se queda aparcada donde estaba y A la sigue viendo.
      sb.send({ t: "leave" });
      await settle(1300);
      expect(sa.messages.filter(is("shipGone"))).toEqual([]);
      expect(app.space.shipsIn(systemId)).toContain(b.emperor.id);
      const status = await app.flagships.status(b.emperor.id);
      expect(Math.hypot(status!.park.p[0] - 112, status!.park.p[1], status!.park.p[2])).toBeLessThan(1);
    });

    it("una nave aparcada orbita la estrella; para pilotarla hay que salir de donde está", async () => {
      const { a, b, sa, sb, systemId } = await twoInOneSystem("hidden");
      await parkAt(a.emperor.id, [1_000_000, 0, 0]);
      // B, a 2000 km de la estrella, sin piloto: orbita despacio (unos 17 m/s).
      await parkAt(b.emperor.id, [2_000_000, 0, 0]);
      sa.send({ t: "pose", systemId, ...pose([1_000_000, 0, 0]) });
      const space = await sa.next(is("space"));
      expect(space.ships).toMatchObject([{ id: b.emperor.id }]);
      await settle(1300);
      const moved = sa.messages.filter(is("poses")).flatMap((m) => m.ships).filter((s) => s.id === b.emperor.id).at(-1)!;
      expect(moved.p[0]).toBeLessThan(2_000_000);
      expect(moved.p[2]).toBeLessThan(0);
      expect(Math.hypot(moved.p[0], moved.p[2])).toBeCloseTo(2_000_000, 0);
      // B intenta tomar los mandos lejos de su nave: el servidor le dice dónde está.
      sb.send({ t: "pose", systemId, ...pose([0, 0, 1_500_000]) });
      const rejected = await sb.next(is("poseRejected"));
      expect(Math.hypot(rejected.p[0] - 2_000_000, rejected.p[2])).toBeLessThan(500);
      sb.send({ t: "pose", systemId, ...pose(rejected.p) });
      await sb.next(is("space"));
      // El dueño conoce siempre dónde está aparcada su nave (tema `me`).
      expect((await app.flagships.status(a.emperor.id))!.park.p).toEqual([1_000_000, 0, 0]);
    });

    it("el salto cuántico gasta combustible según la distancia; sin combustible no se salta", async () => {
      const a = await player("a@ejemplo.com", "Aurelia");
      const sa = await connect(a.cookies);
      // Un destino al alcance de un depósito lleno.
      const dest = systemsInRange(seed, a.emperor.location.position, 100).find((s) => s.id !== a.emperor.location.systemId)!;
      const ly = Math.hypot(dest.position.x - a.emperor.location.position.x, dest.position.y - a.emperor.location.position.y, dest.position.z - a.emperor.location.position.z);
      const cost = quantumFuelCost(ly);
      await database.db.update(emperors).set({ fuel: cost - 1, fuelAt: new Date() }).where(eq(emperors.id, a.emperor.id));
      sa.send({ t: "cmd", cmdId: "salto-sin-01", op: "emperor.move", args: { systemId: dest.id } });
      expect(await sa.next(is("ack"))).toMatchObject({ ok: false, error: "insufficient_fuel" });
      await database.db.update(emperors).set({ fuel: 1000, fuelAt: new Date() }).where(eq(emperors.id, a.emperor.id));
      sa.send({ t: "cmd", cmdId: "salto-con-01", op: "emperor.move", args: { systemId: dest.id } });
      expect(await sa.next((m): m is Extract<ServerMessage, { t: "ack" }> => m.t === "ack" && m.cmdId === "salto-con-01")).toMatchObject({ ok: true });
      const status = (await app.flagships.status(a.emperor.id))!;
      expect(status.supplies.fuel).toBeCloseTo(1000 - cost, 0);
    });

    it("al pilotar se reciben energía y combustible; el pulso sin combustible no avanza", async () => {
      const a = await player("a@ejemplo.com", "Aurelia");
      const sa = await connect(a.cookies);
      const systemId = a.emperor.location.systemId;
      const far = app.flagships.layout(systemId)!.boundary * 0.9;
      await parkAt(a.emperor.id, [far, 0, 0]);
      await database.db.update(emperors).set({ fuel: 0, fuelAt: new Date() }).where(eq(emperors.id, a.emperor.id));
      sa.send({ t: "pose", systemId, ...pose([far, 0, 0]) });
      await sa.next(is("space"));
      expect(await sa.next(is("supplies"))).toMatchObject({ energy: 100, energyMax: 100, fuel: 0, fuelMax: 1000 });
      // A 20 km/s (pulso) sin combustible: rechazada. A velocidad de maniobra, aceptada.
      await settle(150);
      sa.send({ t: "pose", systemId, ...pose([far - 5000, 0, 0]) });
      expect(await sa.next(is("poseRejected"))).toMatchObject({ p: [far, 0, 0] });
      await settle(300);
      const from = sa.messages.length;
      sa.send({ t: "pose", systemId, ...pose([far - 100, 0, 0]) });
      await settle(200);
      expect(sa.messages.slice(from).filter(is("poseRejected"))).toEqual([]);
    });

    it("junto a una colonia propia se repone el combustible con sus volátiles", async () => {
      const a = await player("a@ejemplo.com", "Aurelia");
      const sa = await connect(a.cookies);
      const systemId = a.emperor.location.systemId;
      const layout = app.flagships.layout(systemId)!;
      const planet = layout.planets[0]!;
      sa.send({ t: "cmd", cmdId: "reclamar-01", op: "colony.claim", args: { systemId, planetIndex: planet.index, humans: 200 } });
      expect(await sa.next(is("ack"))).toMatchObject({ ok: true });
      const [colony] = await database.db.select().from(colonies).where(eq(colonies.emperorId, a.emperor.id));
      // Con el tiempo de las pruebas tan acelerado, el mantenimiento vaciaría los volátiles en un instante.
      // Sin flotas, la colonia no paga su mantenimiento (y sus volátiles no se gastan solos).
      await database.db.delete(fleets).where(eq(fleets.emperorId, a.emperor.id));
      await database.db.update(colonies).set({ volatiles: 1000, resolvedAt: new Date() }).where(eq(colonies.id, colony!.id));
      const c = planetPosition(planet, Date.now());
      const p: [number, number, number] = [c.x + planet.size + 2000, c.y, c.z];
      await parkAt(a.emperor.id, p);
      await database.db.update(emperors).set({ fuel: 100, fuelAt: new Date() }).where(eq(emperors.id, a.emperor.id));
      sa.send({ t: "pose", systemId, ...pose(p) });
      await sa.next(is("space"));
      const refilled = await sa.next((m): m is Extract<ServerMessage, { t: "supplies" }> => m.t === "supplies" && m.fuel > 110, 0, 9000);
      expect(refilled.resupplying).toBe(true);
      // Lo pagan las existencias de la colonia, con su asiento en el libro.
      const ledger = await database.db.select().from(resourceLedger).where(eq(resourceLedger.reason, "flagship_resupply"));
      expect(ledger.length).toBeGreaterThan(0);
      expect(ledger[0]!.volatiles).toBeLessThan(0);
    }, 15_000);

    it("rechaza posiciones imposibles: demasiado rápido o fuera del sistema", async () => {
      const a = await player("a@ejemplo.com", "Aurelia");
      const sa = await connect(a.cookies);
      const systemId = a.emperor.location.systemId;
      await parkAt(a.emperor.id, [50, 0, 0]);
      sa.send({ t: "pose", systemId, ...pose([50, 0, 0]) });
      await sa.next(is("space"));
      // 1000 km de golpe: imposible incluso con el motor de pulso.
      sa.send({ t: "pose", systemId, ...pose([1_000_050, 0, 0]) });
      expect(await sa.next(is("poseRejected"))).toMatchObject({ p: [50, 0, 0] });
    });

    it("no se puede volar en un sistema donde no está el Emperador", async () => {
      const a = await player("a@ejemplo.com", "Aurelia");
      const sa = await connect(a.cookies);
      const other = coreSystems.find((s) => s.id !== a.emperor.location.systemId)!;
      sa.send({ t: "pose", systemId: other.id, ...pose([50, 0, 0]) });
      await settle();
      expect(sa.messages.filter(is("space"))).toEqual([]);
    });

    it("al saltar o desconectarse, la nave deja el sistema", async () => {
      const { a, b, sa, sb, systemId } = await twoInOneSystem("public");
      await parkAt(a.emperor.id, [100, 0, 0]);
      await parkAt(b.emperor.id, [120, 0, 0]);
      sa.send({ t: "pose", systemId, ...pose([100, 0, 0]) });
      await sa.next(is("space"));
      sb.send({ t: "pose", systemId, ...pose([120, 0, 0]) });
      await sb.next(is("space"));
      const dest = coreSystems.find((s) => s.id !== systemId)!;
      sb.send({ t: "cmd", cmdId: "salto-0001", op: "emperor.move", args: { systemId: dest.id } });
      expect(await sa.next(is("shipGone"))).toEqual({ t: "shipGone", id: b.emperor.id, reason: "left" });
      // Aparecerá en el borde del destino, del lado por el que llega.
      const status = (await app.flagships.status(b.emperor.id))!;
      expect(status.systemId).toBe(dest.id);
      expect(Math.hypot(...status.park.p)).toBeCloseTo(app.flagships.layout(dest.id)!.boundary * 0.97, 0);
      void a;
    });
  });

  describe("combate en tiempo real", () => {
    const pose = (p: [number, number, number]) => ({ p, q: [0, 0, 0, 1] as [number, number, number, number], v: [0, 0, 0] as [number, number, number] });
    const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

    /** A y B en el mismo sistema: A en z=100 mirando a -Z; B delante, en z=80. */
    async function duel(allies = false) {
      const a = await player("a@ejemplo.com", "Aurelia", "hidden");
      const b = await player("b@ejemplo.com", "Brennus", "hidden");
      if (allies) {
        await social(a.cookies, "/api/social/allies", { name: "Brennus" });
        await social(b.cookies, "/api/social/allies", { name: "Aurelia" });
      }
      const sa = await connect(a.cookies);
      const sb = await connect(b.cookies);
      const systemId = a.emperor.location.systemId;
      if (b.emperor.location.systemId !== systemId) {
        sb.send({ t: "cmd", cmdId: "duelo-0001", op: "emperor.move", args: { systemId } });
        await sb.next(is("ack"));
        await settle(1100);
      }
      await app.flagships.savePark(a.emperor.id, { p: [0, 0, 100], at: Date.now() });
      await app.flagships.savePark(b.emperor.id, { p: [0, 0, -200], at: Date.now() });
      sa.send({ t: "pose", systemId, ...pose([0, 0, 100]) });
      await sa.next(is("space"));
      sb.send({ t: "pose", systemId, ...pose([0, 0, -200]) });
      await sb.next(is("space"));
      await settle(100);
      return { a, b, sa, sb, systemId };
    }

    it("un cañonazo que acierta baja el escudo del enemigo y ambos lo ven", async () => {
      const { b, sa, sb } = await duel();
      const from = sb.messages.length;
      sa.send({ t: "fire", weapon: "cannon", dir: [0, 0, -1] });
      const shot = await sb.next(is("shot"), from);
      expect(shot).toMatchObject({ weapon: "cannon", target: null, speed: 1500 });
      expect(shot.hitAt).not.toBeNull();
      const hurt = await sb.next((m): m is Extract<ServerMessage, { t: "ship" }> => m.t === "ship" && m.ship.id === b.emperor.id && m.ship.shield < 200, from);
      expect(hurt.ship).toMatchObject({ shield: 186, hull: 400 });
      expect((await sa.next((m): m is Extract<ServerMessage, { t: "ship" }> => m.t === "ship" && m.ship.id === b.emperor.id && m.ship.shield === 186)).ship.hull).toBe(400);
    });

    it("fallar no hace daño, y entre compañeros no hay fuego amigo", async () => {
      const { a, b, sa } = await duel(true);
      sa.send({ t: "fire", weapon: "cannon", dir: [0, 0, -1] });
      sa.send({ t: "fire", weapon: "missile", dir: [0, 0, -1], target: b.emperor.id });
      await settle(400);
      expect(app.space.combatOf(b.emperor.id).shield).toBe(200);
      void a;
    });

    it("el misil exige objetivo enemigo a tiro y delante; acierta y gasta munición", async () => {
      const { b, sa } = await duel();
      // Sin objetivo: nada.
      sa.send({ t: "fire", weapon: "missile", dir: [0, 0, -1] });
      await settle(200);
      expect(sa.messages.filter(is("shot"))).toEqual([]);
      sa.send({ t: "fire", weapon: "missile", dir: [0, 0, -1], target: b.emperor.id });
      const shot = await sa.next(is("shot"));
      expect(shot).toMatchObject({ weapon: "missile", target: b.emperor.id });
      const weapons = await sa.next((m): m is Extract<ServerMessage, { t: "weapons" }> => m.t === "weapons" && m.weapons.some((w) => w.kind === "missile" && w.ammo === 5));
      expect(weapons.weapons.find((w) => w.kind === "missile")).toMatchObject({ ammo: 5, ammoMax: 6 });
      await settle(900);
      expect(app.space.combatOf(b.emperor.id).shield).toBe(110);
    });

    it("una nave destruida sale del sistema y su Emperador renace en el Núcleo Humano", async () => {
      const { b, sa, sb, systemId } = await duel();
      const victim = app.space.combatOf(b.emperor.id);
      victim.shield = 0;
      victim.hull = 10;
      sa.send({ t: "fire", weapon: "cannon", dir: [0, 0, -1] });
      const gone = await sa.next(is("shipGone"));
      expect(gone).toEqual({ t: "shipGone", id: b.emperor.id, reason: "destroyed" });
      const destroyed = await sb.next(is("destroyed"));
      expect(destroyed.by).toBe("Aurelia");
      expect(spawnSystems.has(destroyed.systemId)).toBe(true);
      expect(app.space.shipsIn(systemId)).not.toContain(b.emperor.id);
      // Renace con la nave reparada.
      expect([victim.hull, victim.shield]).toEqual([400, 200]);
      const res = await app.inject({ method: "GET", url: "/api/emperor", cookies: b.cookies });
      expect(res.json().emperor).toMatchObject({ location: { systemId: destroyed.systemId }, travel: null });
    });
  });
});
