/**
 * Tests de la Fase 10 (muerte y linaje): caer y gestarse (con la racha de
 * muertes), renacer en una Cuna o en el Núcleo Humano, lo que se pierde, los
 * Herederos (gestar, gobernar, construir, cambiar de colonia, encarnarse vivo
 * o muerto, morir con la colonia), la nave del Emperador en las batallas por
 * rondas, los Emperadores de la IA y la exportación y el borrado de los datos.
 * Usan TEST_DATABASE_URL, que se vacía.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EMPEROR_FLAGSHIP, FLAGSHIP_SUPPLIES, getShipClass, HEIRS, LINEAGE } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { findSystem } from "./systems";
import { LOGIN_TOKEN_PARAM, PROTOCOL_VERSION, type Emperor, type LineageStatus, type ServerMessage, type StarSystemSummary } from "@imperium/shared";
import { gestationMs, planetPosition } from "@imperium/sim";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { battles, colonies, colonyBuilds, discoveries, emperorDeaths, emperors, fleets, heirs, installations, scheduledEvents, ships } from "../src/db/schema";
import { DiscoveryService } from "../src/discovery/service";
import { inHumanCore, spawnCandidates } from "../src/emperor/world";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";
type Ack = Extract<ServerMessage, { t: "ack" }>;

describe.skipIf(!TEST_DATABASE_URL)("muerte y linaje (Fase 10)", () => {
  const sent: string[] = [];
  const mailer: Mailer = {
    async sendLoginLink(_to, link) {
      sent.push(link);
    },
  };
  const database = createDb(TEST_DATABASE_URL ?? "");
  const db = database.db;
  const config = loadConfig({ APP_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: TEST_DATABASE_URL, PUBLIC_URL: ORIGIN, COOKIE_SECURE: "false", TIME_SCALE: "1", AUTH_REQUESTS_PER_IP: "1000" });
  const SESSION_COOKIE = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  const details = new DiscoveryService(db, config);
  const spawns = new Set(spawnCandidates(seed).map((s) => s.id));
  const [sysA, sysB] = spawnCandidates(seed).filter((s) => details.detail(s).planets.length >= 2) as [StarSystemSummary, StarSystemSummary];
  /** Un sistema con planetas fuera del Núcleo Humano. */
  const outer = findSystem(seed, (s) => details.detail(s).planets.length >= 1 && !inHumanCore(s.id), 2);
  let app: Awaited<ReturnType<typeof buildApp>>;
  let wsUrl = "";
  const sockets: WebSocket[] = [];
  let n = 0;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    sent.length = 0;
    await db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events, battles, alien_regions, alien_claims, market_orders CASCADE`);
    app = await buildApp(config, { db, mailer, startWorker: false });
    await app.aliens.reset();
    app.aliens.random = () => 0;
    wsUrl = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws") + "/ws";
  });
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.terminate());
    await app.close();
  });
  afterAll(() => database.close());

  /** Jugador (ya no novato) con su Emperador en `systemId` y su primera flota con estas naves, conectado por WebSocket. */
  async function player(name: string, systemId: string, classes: string[] = ["explorer"]) {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: `${name.normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}@ejemplo.com`, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const emperor = (await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies })).json().emperor as Emperor;
    await db.update(emperors).set({ systemId, createdAt: sql`now() - interval '30 days'` }).where(eq(emperors.id, emperor.id));
    for (const s of [sysA, sysB, outer]) await db.insert(discoveries).values({ emperorId: emperor.id, systemId: s.id }).onConflictDoNothing();
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
      const cmdId = `linaje-${++n}-xyz`;
      ws.send(JSON.stringify({ t: "cmd", cmdId, op, args }));
      for (let i = 0; i < 250; i++) {
        const ack = messages.find((m): m is Ack => m.t === "ack" && m.cmdId === cmdId);
        if (ack) return ack;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("sin respuesta");
    };
    /** Último linaje recibido por el tema `me` que cumpla `pred` (espera a que llegue). */
    const lineage = async (pred: (v: LineageStatus) => boolean = () => true): Promise<LineageStatus | undefined> => {
      const find = () =>
        messages
          .flatMap((m) => (m.t === "delta" ? m.ops : []))
          .filter((o) => o.path === `lineage.${emperor.id}`)
          .map((o) => o.v as LineageStatus)
          .filter(pred)
          .at(-1);
      for (let i = 0; i < 150 && !find(); i++) await new Promise((r) => setTimeout(r, 20));
      return find();
    };
    return { emperor, cookies, fleetId: fleet!.id, cmd, lineage };
  }

  async function colony(emperorId: string, systemId: string, planetIndex: number, cradle = false) {
    const [row] = await db
      .insert(colonies)
      .values({ emperorId, systemId, planetIndex, population: 1000, metal: 2000, volatiles: 1000, crystal: 300, alloys: 500, resolvedAt: new Date() })
      .returning();
    if (cradle) await db.insert(installations).values({ colonyId: row!.id, kind: "lineage_cradle" });
    return row!;
  }

  /** Adelanta los eventos de un tipo (como si hubiera pasado su hora) y los procesa. */
  async function fire(kind: string) {
    await db.update(scheduledEvents).set({ dueAt: sql`now() - interval '1 second'` }).where(eq(scheduledEvents.kind, kind));
    await app.eventWorker.drain();
  }
  /** La gestación ha terminado: adelanta la hora de renacer y procesa el evento. */
  async function gestationOver(emperorId: string) {
    await db.update(emperors).set({ rebornAt: sql`now() - interval '1 second'` }).where(eq(emperors.id, emperorId));
    await fire("lineage.rebirth");
  }
  const emperorRow = async (id: string) => (await db.select().from(emperors).where(eq(emperors.id, id)))[0]!;
  const status = async (id: string) => (await app.lineage.status(id))!;

  it("sin Cunas: cae, se gesta en el Núcleo con la racha creciente, no puede actuar y renace con lo mínimo", async () => {
    const a = await player("Aurelia", sysA.id);
    await db.update(emperors).set({ flagshipHull: 120 }).where(eq(emperors.id, a.emperor.id));
    const before = Date.now();
    const death = await app.lineage.die(a.emperor.id, { systemId: sysA.id, cause: "combat", by: "Brennus" });
    expect(death).not.toBeNull();
    // Primera muerte, sin Cunas: gestación base × factor del Núcleo.
    expect(death!.rebornAt - before).toBeGreaterThanOrEqual(gestationMs(1, true, 1) - 50);
    expect(death!.rebornAt - before).toBeLessThan(gestationMs(1, true, 1) + 2000);
    expect(spawns.has(death!.systemId)).toBe(true);
    // Muerto ya no vuelve a morir.
    expect(await app.lineage.die(a.emperor.id, { systemId: sysA.id, cause: "combat", by: null })).toBeNull();
    const s = await status(a.emperor.id);
    expect(s.dead).toMatchObject({ place: { kind: "core", systemId: death!.systemId } });
    expect(s.deaths[0]).toMatchObject({ cause: "combat", by: "Brennus", streak: 1, rebirthKind: null });
    const dead = await emperorRow(a.emperor.id);
    expect(dead).toMatchObject({ humans: 0, flagshipHull: 0, deathStreak: 1 });
    // Mientras se gesta: ni salta, ni reclama con su nave, ni desembarca, y los demás lo ven caído.
    expect(await a.cmd("emperor.move", { systemId: sysB.id })).toMatchObject({ ok: false, error: "dead" });
    expect(await a.cmd("colony.claim", { systemId: sysA.id, planetIndex: 0, humans: 60 })).toMatchObject({ ok: false, error: "dead" });
    expect((await app.inject({ method: "GET", url: "/api/emperor", cookies: a.cookies })).json().emperor.gestating).toBe(true);
    // Aún no toca: el evento se reprograma.
    await fire("lineage.rebirth");
    expect((await emperorRow(a.emperor.id)).deadAt).not.toBeNull();

    await gestationOver(a.emperor.id);
    const reborn = await emperorRow(a.emperor.id);
    expect(reborn).toMatchObject({ deadAt: null, rebornAt: null, systemId: death!.systemId, generation: 2, humans: LINEAGE.rebirthHumans, flagshipHull: EMPEROR_FLAGSHIP.hull, fuel: FLAGSHIP_SUPPLIES.emergencyFuelMax, missiles: 2 });
    expect((await status(a.emperor.id)).deaths[0]).toMatchObject({ rebirthKind: "core", systemId: sysA.id });
    expect(await a.lineage((v) => v.dead === null && v.generation === 2)).toBeDefined();

    // Otra muerte seguida: la racha sube y la gestación se alarga.
    const second = await app.lineage.die(a.emperor.id, { systemId: death!.systemId, cause: "battle", by: null });
    expect((await emperorRow(a.emperor.id)).deathStreak).toBe(2);
    expect(second!.rebornAt - Date.now()).toBeGreaterThan(gestationMs(1, true, 1) + 1000);
    // Con horas sin morir, la racha se olvida.
    await db.update(emperors).set({ lastDeathAt: sql`now() - make_interval(hours => ${LINEAGE.streakDecayHours + 1})` }).where(eq(emperors.id, a.emperor.id));
    expect((await status(a.emperor.id)).streak).toBe(1);
  });

  it("Cunas: renace junto al planeta de la más cercana o de la preferida; si la pierde mientras se gesta, en otra", async () => {
    const a = await player("Aurelia", sysB.id);
    const c1 = await colony(a.emperor.id, sysA.id, 0, true);
    const c2 = await colony(a.emperor.id, sysB.id, 1, true);
    // Cae en el sistema B: la Cuna más cercana es la de B.
    const death = await app.lineage.die(a.emperor.id, { systemId: sysB.id, cause: "combat", by: "" });
    expect(death!.systemId).toBe(sysB.id);
    expect((await status(a.emperor.id)).dead!.place).toMatchObject({ kind: "cradle", colonyId: c2.id });
    // Con Cuna, la gestación es la base (sin el factor del Núcleo).
    expect(death!.rebornAt - Date.now()).toBeLessThan(gestationMs(1, true, 1) - 1000);
    await gestationOver(a.emperor.id);
    expect(await emperorRow(a.emperor.id)).toMatchObject({ systemId: sysB.id, deadAt: null });
    // La nave aparece junto al planeta de la Cuna.
    const ship = (await app.flagships.status(a.emperor.id))!;
    const planet = app.flagships.layout(sysB.id)!.planets.find((p) => p.index === 1)!;
    const at = planetPosition(planet, ship.park.at);
    expect(Math.hypot(ship.park.p[0] - at.x, ship.park.p[1] - at.y, ship.park.p[2] - at.z)).toBeLessThan(planet.size + LINEAGE.rebirthAltitudeM + 1000);

    // Cuna preferida: la de A (solo una Cuna propia).
    expect(await a.cmd("lineage.prefer", { colonyId: "00000000-0000-4000-8000-000000000000" })).toMatchObject({ ok: false, error: "no_cradle" });
    expect(await a.cmd("lineage.prefer", { colonyId: c1.id })).toMatchObject({ ok: true });
    await app.lineage.die(a.emperor.id, { systemId: sysB.id, cause: "combat", by: "" });
    expect((await status(a.emperor.id)).dead!.place).toMatchObject({ kind: "cradle", colonyId: c1.id });
    // Pierde la Cuna preferida mientras se gesta: renace en la otra.
    await db.delete(installations).where(eq(installations.colonyId, c1.id));
    await gestationOver(a.emperor.id);
    expect((await emperorRow(a.emperor.id)).systemId).toBe(sysB.id);
    expect((await status(a.emperor.id)).deaths[0]).toMatchObject({ rebirthKind: "cradle" });
  });

  it("Herederos: gestar, nacer y gobernar, construir según la doctrina, cambiar de colonia, encarnarse y morir con la colonia", async () => {
    const a = await player("Aurelia", sysA.id);
    const b = await player("Brennus", sysA.id);
    const c1 = await colony(a.emperor.id, sysA.id, 0, true);
    const c2 = await colony(a.emperor.id, sysB.id, 0);
    const before = (await db.select().from(colonies).where(eq(colonies.id, c1.id)))[0]!;

    // Gestar: hace falta una Cuna propia; uno por colonia.
    expect(await a.cmd("heir.gestate", { colonyId: c2.id, doctrine: "bastion" })).toMatchObject({ ok: false, error: "no_cradle" });
    expect(await b.cmd("heir.gestate", { colonyId: c1.id, doctrine: "bastion" })).toMatchObject({ ok: false, error: "no_cradle" });
    expect(await a.cmd("heir.gestate", { colonyId: c1.id, doctrine: "bastion" })).toMatchObject({ ok: true });
    expect(await a.cmd("heir.gestate", { colonyId: c1.id, doctrine: "prosperity" })).toMatchObject({ ok: false, error: "colony_has_heir" });
    const after = (await db.select().from(colonies).where(eq(colonies.id, c1.id)))[0]!;
    expect(after.alloys).toBeCloseTo(before.alloys - HEIRS.cost.alloys, 0);
    expect(after.population).toBeLessThan(before.population - HEIRS.population + 5);
    const [heir] = await db.select().from(heirs).where(eq(heirs.emperorId, a.emperor.id));
    expect(heir).toMatchObject({ state: "gestating", doctrine: "bastion", colonyId: c1.id });
    expect(await a.cmd("heir.assign", { heirId: heir!.id, colonyId: c2.id })).toMatchObject({ ok: false, error: "heir_not_ready" });
    expect(await a.cmd("heir.incarnate", { heirId: heir!.id })).toMatchObject({ ok: false, error: "heir_not_ready" });

    // Nace y gobierna su colonia (con su doctrina).
    await db.update(heirs).set({ readyAt: sql`now() - interval '1 second'` }).where(eq(heirs.id, heir!.id));
    await fire("heir.born");
    expect((await db.select().from(heirs).where(eq(heirs.id, heir!.id)))[0]).toMatchObject({ state: "active" });
    expect((await db.select().from(colonies).where(eq(colonies.id, c1.id)))[0]!.governor).toBe("bastion");
    expect(await a.lineage((v) => v.heirs.some((h) => h.state === "active"))).toBeDefined();

    // El gobernador, con la cola vacía, encarga lo primero de su doctrina (una plataforma defensiva).
    await fire("heir.govern");
    await new Promise((r) => setTimeout(r, 300));
    expect((await db.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, c1.id))).map((x) => x.itemId)).toEqual(["defense_platform"]);
    // Sin permiso para construir, no encarga nada.
    expect(await a.cmd("heir.doctrine", { heirId: heir!.id, doctrine: "prosperity", builds: false })).toMatchObject({ ok: true });
    expect((await db.select().from(colonies).where(eq(colonies.id, c1.id)))[0]!.governor).toBe("prosperity");

    // A gobernar otra colonia: la Cuna queda libre para otro.
    expect(await a.cmd("heir.assign", { heirId: heir!.id, colonyId: c2.id })).toMatchObject({ ok: true });
    expect((await db.select().from(colonies).where(eq(colonies.id, c1.id)))[0]!.governor).toBeNull();
    expect((await db.select().from(colonies).where(eq(colonies.id, c2.id)))[0]!.governor).toBe("prosperity");

    // Encarnarse estando vivo: el Emperador y su nave pasan a la colonia del Heredero, que se consume.
    expect(await a.cmd("heir.incarnate", { heirId: heir!.id })).toMatchObject({ ok: true });
    const moved = await emperorRow(a.emperor.id);
    expect(moved).toMatchObject({ systemId: sysB.id, generation: 2, deadAt: null });
    expect(moved.incarnatedAt).not.toBeNull();
    expect(await db.select().from(heirs).where(eq(heirs.emperorId, a.emperor.id))).toEqual([]);
    expect((await db.select().from(colonies).where(eq(colonies.id, c2.id)))[0]!.governor).toBeNull();

    // Enfriamiento: no otra vez enseguida.
    const [h2] = await db.insert(heirs).values({ emperorId: a.emperor.id, colonyId: c1.id, name: "Bastian", doctrine: "balanced", state: "active" }).returning();
    expect(await a.cmd("heir.incarnate", { heirId: h2!.id })).toMatchObject({ ok: false, error: "cooldown" });

    // Muerto: en vez de esperar la gestación, despierta en el Heredero.
    await db.update(emperors).set({ incarnatedAt: null }).where(eq(emperors.id, a.emperor.id));
    await app.lineage.die(a.emperor.id, { systemId: sysB.id, cause: "combat", by: "" });
    expect(await a.cmd("heir.incarnate", { heirId: h2!.id })).toMatchObject({ ok: true });
    expect(await emperorRow(a.emperor.id)).toMatchObject({ deadAt: null, systemId: sysA.id, humans: LINEAGE.rebirthHumans, flagshipHull: EMPEROR_FLAGSHIP.hull });
    expect((await status(a.emperor.id)).deaths[0]).toMatchObject({ rebirthKind: "heir" });
    // El evento del renacimiento que quedaba ya no hace nada.
    await fire("lineage.rebirth");
    expect((await emperorRow(a.emperor.id)).systemId).toBe(sysA.id);

    // Si la colonia cambia de manos, su Heredero muere con ella.
    const [h3] = await db.insert(heirs).values({ emperorId: a.emperor.id, colonyId: c1.id, name: "Calia", doctrine: "bastion", state: "active" }).returning();
    await db.update(colonies).set({ governor: "bastion" }).where(eq(colonies.id, c1.id));
    await db.transaction((tx) => app.colonies.capture(tx, c1.id, b.emperor.id, Date.now(), { seed: 1, survivors: 0, ref: "test" }));
    expect(await db.select().from(heirs).where(eq(heirs.id, h3!.id))).toEqual([]);
    expect((await db.select().from(colonies).where(eq(colonies.id, c1.id)))[0]).toMatchObject({ emperorId: b.emperor.id, governor: null });
  });

  it("batallas por rondas: la nave del Emperador combate sola fuera del Núcleo (no dentro) y, si cae, su Emperador muere", async () => {
    const a = await player("Aurelia", outer.id);
    const b = await player("Brennus", outer.id, ["frigate", "frigate", "frigate"]);
    // La flota de Aurelia está lejos: en el sistema solo queda su nave, tocada.
    await db.update(fleets).set({ systemId: sysB.id }).where(eq(fleets.id, a.fleetId));
    await db.update(emperors).set({ flagshipHull: 60 }).where(eq(emperors.id, a.emperor.id));
    const fx = await db.transaction((tx) => app.wars.onArrive(tx, b.fleetId));
    expect(fx.inBattle).toBe(true);
    const [battle] = await db.select().from(battles);
    expect(battle).toBeDefined();
    const view = (await app.wars.view(b.emperor.id, battle!.id))!;
    expect(view.foe).toEqual({ flagship: 1 });
    for (let i = 0; i < 10 && !(await db.select().from(battles))[0]!.endedAt; i++) await fire("battle.round");
    const ended = (await db.select().from(battles))[0]!;
    expect(ended.endedAt).not.toBeNull();
    const a1 = await emperorRow(a.emperor.id);
    expect(a1.deadAt).not.toBeNull();
    expect((await status(a.emperor.id)).deaths[0]).toMatchObject({ cause: "battle", by: "Brennus", systemId: outer.id });

    // En el Núcleo Humano, una nave sola (sin flotas) no entra en las batallas.
    const c = await player("Calia", sysA.id);
    const d = await player("Darius", sysA.id, ["frigate"]);
    await db.update(fleets).set({ systemId: sysB.id }).where(eq(fleets.id, c.fleetId));
    const res = await db.transaction((tx) => app.wars.onArrive(tx, d.fleetId));
    expect(res.inBattle).toBe(false);
  });

  it("los Emperadores de la IA construyen su Cuna, gestan Herederos y se encarnan si caen", async () => {
    await app.aiEmperors.ensure(1);
    const [ai] = await app.aiEmperors.list();
    const capital = await colony(ai!.id, sysA.id, 1);
    // Tras su lista de instalaciones, la Cuna en la capital.
    await db.insert(installations).values(["mine", "power_plant", "mine", "shipyard", "refinery", "mine"].map((kind) => ({ colonyId: capital.id, kind })));
    await db.insert(installations).values([{ colonyId: capital.id, kind: "mine" }]);
    await app.aiEmperors.decide(ai!.id);
    const builds = await db.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, capital.id));
    expect(builds.map((x) => x.itemId)).toContain("lineage_cradle");
    // Con la Cuna, gesta un Heredero.
    await db.delete(colonyBuilds).where(eq(colonyBuilds.colonyId, capital.id));
    await db.insert(installations).values({ colonyId: capital.id, kind: "lineage_cradle" });
    await app.lineage.aiTurn(ai!.id, "expansionist");
    const [heir] = await db.select().from(heirs).where(eq(heirs.emperorId, ai!.id));
    expect(heir).toMatchObject({ state: "gestating", doctrine: "prosperity" });
    // Caído con una gestación larga y un Heredero nacido: se encarna.
    await db.update(heirs).set({ state: "active", readyAt: null }).where(eq(heirs.id, heir!.id));
    await app.lineage.die(ai!.id, { systemId: sysB.id, cause: "battle", by: null });
    await db.update(emperors).set({ rebornAt: sql`now() + interval '3 hours'` }).where(eq(emperors.id, ai!.id));
    await app.lineage.aiTurn(ai!.id, "expansionist");
    expect(await emperorRow(ai!.id)).toMatchObject({ deadAt: null, systemId: sysA.id });
  });

  it("exportación y borrado: Herederos y muertes van en los datos y se borran con la cuenta", async () => {
    const a = await player("Aurelia", sysA.id);
    const c1 = await colony(a.emperor.id, sysA.id, 0, true);
    expect(await a.cmd("heir.gestate", { colonyId: c1.id, doctrine: "balanced" })).toMatchObject({ ok: true });
    await app.lineage.die(a.emperor.id, { systemId: sysA.id, cause: "combat", by: "Brennus" });
    const exp = (await app.inject({ method: "GET", url: "/api/account/export", cookies: a.cookies })).json();
    expect(exp.game.lineage.heirs).toHaveLength(1);
    expect(exp.game.lineage.deaths).toHaveLength(1);
    expect(exp.game.emperor.deadAt).not.toBeNull();
    expect((await app.inject({ method: "POST", url: "/api/account/delete", payload: { confirm: true }, cookies: a.cookies })).statusCode).toBe(204);
    expect(await db.select().from(heirs)).toEqual([]);
    expect(await db.select().from(emperorDeaths)).toEqual([]);
    const left = await db.select().from(scheduledEvents).where(and(sql`${scheduledEvents.kind} IN ('heir.born', 'lineage.rebirth')`));
    expect(left).toEqual([]);
    // La colonia queda independiente y sin gobernador.
    expect((await db.select().from(colonies).where(eq(colonies.id, c1.id)))[0]).toMatchObject({ emperorId: null, governor: null });
  });
});
