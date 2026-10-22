/**
 * Tests de la Fase 9b (conquista de planetas): asedio con progreso y presencia
 * sostenida, defensas de la colonia, desembarco de tropas (humanos), captura
 * con pérdidas, órdenes del mercado y obras canceladas, colonias
 * independientes, protecciones (gracia, Núcleo Humano), ocupación alienígena
 * y los Emperadores de la IA que conquistan. Usan TEST_DATABASE_URL, que se vacía.
 */
import { populationCap } from "@imperium/sim";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { AI_EMPERORS, ALIEN_SIEGE, getFaction, getShipClass, getSpecies, SIEGE } from "@imperium/content";
import { generateSector, universeSeedFromString } from "@imperium/procgen";
import { LOGIN_TOKEN_PARAM, PROTOCOL_VERSION, type Emperor, type ServerMessage, type Siege, type StarSystemSummary } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import {
  alienStandings,
  colonies,
  colonyBuilds,
  discoveries,
  emperors,
  fleetCargo,
  fleetRoutes,
  fleets,
  installations,
  marketOrders,
  resourceLedger,
  scheduledEvents,
  ships,
  sieges,
} from "../src/db/schema";
import { DiscoveryService } from "../src/discovery/service";
import { inHumanCore, spawnCandidates } from "../src/emperor/world";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";
type Ack = Extract<ServerMessage, { t: "ack" }>;

describe.skipIf(!TEST_DATABASE_URL)("conquista de planetas (Fase 9b)", () => {
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
  const [sysA, sysB] = spawnCandidates(seed).filter((s) => details.detail(s).planets.length >= 2) as [StarSystemSummary, StarSystemSummary];
  /** Un sistema con planetas fuera del Núcleo Humano. */
  const outer = generateSector(seed, { x: 2, y: 0, z: 0 }).systems.find((s) => details.detail(s).planets.length >= 1 && !inHumanCore(s.id))!;
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

  /** Jugador (ya no novato) con su primera flota en `systemId` y estas naves, conectado por WebSocket. */
  async function player(name: string, systemId: string, classes: string[]) {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: `${name.normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}@ejemplo.com`, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const emperor = (await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies })).json().emperor as Emperor;
    await db.update(emperors).set({ createdAt: sql`now() - interval '30 days'` }).where(eq(emperors.id, emperor.id));
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
      const cmdId = `siege-${++n}-xyz`;
      ws.send(JSON.stringify({ t: "cmd", cmdId, op, args }));
      for (let i = 0; i < 250; i++) {
        const ack = messages.find((m): m is Ack => m.t === "ack" && m.cmdId === cmdId);
        if (ack) return ack;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("sin respuesta");
    };
    /** Último valor recibido de un camino del tema `me` (espera a que llegue). */
    const last = async <T>(path: string, pred: (v: T | null) => boolean = () => true): Promise<T | null | undefined> => {
      const find = () =>
        messages
          .flatMap((m) => (m.t === "delta" ? m.ops : []))
          .filter((o) => o.path === path)
          .at(-1);
      for (let i = 0; i < 250; i++) {
        const op = find();
        if (op && pred(op.v as T | null)) return op.v as T | null;
        await new Promise((r) => setTimeout(r, 20));
      }
      return find()?.v as T | null | undefined;
    };
    return { emperor, cookies, fleetId: fleet!.id, cmd, last };
  }

  async function colony(emperorId: string | null, systemId: string, planetIndex: number, population = 1000, resolvedAt: Date = new Date()) {
    const [row] = await db
      .insert(colonies)
      .values({ emperorId, systemId, planetIndex, population, metal: 1000, volatiles: 500, crystal: 100, alloys: 0, resolvedAt })
      .returning();
    return row!;
  }

  /** Hace como si hubieran pasado `hours` horas de juego desde la última resolución y resuelve el asedio. */
  async function elapse(siegeId: string, hours: number) {
    await db
      .update(sieges)
      .set({ resolvedAt: sql`now() - make_interval(secs => ${hours * 3600})` })
      .where(eq(sieges.id, siegeId));
    await db.update(scheduledEvents).set({ dueAt: sql`now() - interval '1 second'` }).where(eq(scheduledEvents.kind, "siege.tick"));
    await app.eventWorker.drain();
  }
  const siegeRow = async (id: string) => (await db.select().from(sieges).where(eq(sieges.id, id)))[0]!;
  const colonyRow = async (id: string) => (await db.select().from(colonies).where(eq(colonies.id, id)))[0]!;
  const siegeOf = async (colonyId: string) => (await db.select().from(sieges).where(eq(sieges.colonyId, colonyId)))[0];

  it("asedio entre jugadores: protecciones, progreso, desembarco fallido y captura con sus pérdidas", async () => {
    const def = await player("Defensa", sysA.id, ["freighter"]);
    const att = await player("Asalto", sysA.id, ["frigate", "frigate", "freighter"]);
    const target = await colony(def.emperor.id, sysA.id, 0);
    const other = await colony(def.emperor.id, sysB.id, 0);
    // Ruta automática, encargo y venta en el mercado que dependen de la colonia.
    await db.insert(fleetRoutes).values({ fleetId: def.fleetId, fromColonyId: target.id, toColonyId: other.id, carry: ["metal"], humans: false });
    expect(await def.cmd("colony.build", { colonyId: target.id, kind: "installation", itemId: "mine" })).toMatchObject({ ok: true });
    expect(await def.cmd("market.order", { resource: "metal", side: "sell", price: 50, quantity: 100, colonyId: target.id })).toMatchObject({ ok: true });

    // Protecciones y errores.
    expect(await def.cmd("siege.start", { colonyId: target.id })).toMatchObject({ ok: false, error: "own_colony" });
    await db.update(emperors).set({ createdAt: sql`now()` }).where(eq(emperors.id, def.emperor.id));
    expect(await att.cmd("siege.start", { colonyId: target.id })).toMatchObject({ ok: false, error: "protected" });
    await db.update(emperors).set({ createdAt: sql`now() - interval '30 days'` }).where(eq(emperors.id, def.emperor.id));
    const trader = await player("Comercio", sysA.id, ["freighter"]);
    expect(await trader.cmd("siege.start", { colonyId: target.id })).toMatchObject({ ok: false, error: "no_armed_fleet" });

    // Empieza: el defensor recibe el aviso.
    expect(await att.cmd("siege.start", { colonyId: target.id })).toMatchObject({ ok: true });
    const siege = (await siegeOf(target.id))!;
    expect(siege).toMatchObject({ attackerId: att.emperor.id, defenderId: def.emperor.id, state: "advancing", progress: 0 });
    expect(await def.last<Siege>(`sieges.${siege.id}`)).toMatchObject({ role: "defender", attackerName: "Asalto", outcome: "ongoing" });
    expect(await att.last<Siege>(`sieges.${siege.id}`)).toMatchObject({ role: "attacker", defenderName: "Defensa" });
    const third = await player("Tercero", sysA.id, ["frigate"]);
    expect(await third.cmd("siege.start", { colonyId: target.id })).toMatchObject({ ok: false, error: "already_besieged" });
    expect(await att.cmd("siege.assault", { siegeId: siege.id, fleetId: att.fleetId })).toMatchObject({ ok: false, error: "siege_not_ready" });
    // Los planetas asediados se marcan para quien conoce el sistema.
    const claims = (await app.inject({ method: "GET", url: `/api/systems/${sysA.id}/claims`, cookies: third.cookies })).json().claims as Array<{ colonyId: string; besieged?: boolean }>;
    expect(claims.find((c) => c.colonyId === target.id)?.besieged).toBe(true);
    await db.delete(fleets).where(eq(fleets.id, third.fleetId));

    // Diez horas de juego con 80 de ataque contra unos 40 de defensa: completo.
    await elapse(siege.id, 10);
    expect(await siegeRow(siege.id)).toMatchObject({ state: "ready", progress: 1, attack: 80 });
    expect(await att.cmd("siege.assault", { siegeId: siege.id, fleetId: att.fleetId })).toMatchObject({ ok: false, error: "no_troops" });

    // Pocas tropas: el desembarco fracasa y caen todas.
    await db.insert(fleetCargo).values({ fleetId: att.fleetId, humans: 20 });
    expect(await att.cmd("siege.assault", { siegeId: siege.id, fleetId: att.fleetId })).toMatchObject({ ok: true });
    const failed = await siegeRow(siege.id);
    expect(failed.endedAt).toBeNull();
    expect(failed.lastAssault).toMatchObject({ troops: 20, captured: false, attackerLosses: 20 });
    expect((await colonyRow(target.id)).emperorId).toBe(def.emperor.id);

    // Con más tropas que defensores, el planeta es suyo.
    await db.update(fleetCargo).set({ humans: 200 }).where(eq(fleetCargo.fleetId, att.fleetId));
    const before = await colonyRow(target.id);
    expect(await att.cmd("siege.assault", { siegeId: siege.id, fleetId: att.fleetId })).toMatchObject({ ok: true });
    const done = await siegeRow(siege.id);
    expect(done).toMatchObject({ outcome: "captured" });
    const report = done.lastAssault as { defenders: number; survivors?: number; attackerLosses: number; captured: boolean };
    expect(report.captured).toBe(true);
    const after = await colonyRow(target.id);
    expect(after.emperorId).toBe(att.emperor.id);
    expect(after.acquiredAt).not.toBeNull();
    expect(after.resolvedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
    // Población: la de antes menos la milicia, menos la parte de la captura, más los supervivientes.
    const militia = Math.round(before.population * SIEGE.militiaShare);
    // (sin pasar del tope de población del planeta)
    // (el tope del planeta depende de su habitabilidad: la galaxia, y con ella este planeta, cambió el 22-10-2026)
    const cap = populationCap(details.detail(sysA).planets.find((p) => p.index === 0)!.habitability);
    expect(after.population).toBeGreaterThanOrEqual(Math.min(cap, (before.population - militia) * (1 - SIEGE.capture.populationLoss)));
    expect(after.population).toBeLessThanOrEqual((before.population - militia) * (1 - SIEGE.capture.populationLoss) + 200 - report.attackerLosses + 1);
    // Lo que dependía de ella: obras perdidas, orden del mercado cancelada (lo retenido vuelve a la colonia), ruta acabada.
    expect(await db.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, target.id))).toEqual([]);
    expect(await db.select().from(marketOrders)).toEqual([]);
    expect(await db.select().from(fleetRoutes)).toEqual([]);
    const reasons = (await app.colonies.ledger(target.id)).map((l) => l.reason);
    expect(reasons).toEqual(expect.arrayContaining(["market_refund", "conquest_cancel", "conquest_lost", "conquest"]));
    // El antiguo dueño pierde la colonia; el nuevo la recibe.
    expect(await def.last(`colonies.${target.id}`, (v) => v === null)).toBeNull();
    expect(await att.last<{ id: string }>(`colonies.${target.id}`, (v) => v !== null)).toMatchObject({ id: target.id });
    expect(await def.last<Siege>(`sieges.${siege.id}`, (v) => v?.outcome === "captured")).toMatchObject({ outcome: "captured" });
    // Exportación de datos: el asedio va con los de los dos.
    const exported = (await app.inject({ method: "GET", url: "/api/account/export", cookies: def.cookies })).json();
    expect(exported.game.sieges.map((s: { id: string }) => s.id)).toEqual([siege.id]);
  });

  it("colonia independiente: se conquista y vuelve a producir desde la conquista (sin cobrar el tiempo congelado)", async () => {
    const att = await player("Libertador", sysA.id, ["frigate", "freighter"]);
    const frozen = await colony(null, sysA.id, 1, 500, new Date(Date.now() - 30 * 86_400_000));
    expect(await att.cmd("siege.start", { colonyId: frozen.id })).toMatchObject({ ok: true });
    const siege = (await siegeOf(frozen.id))!;
    expect(siege.defenderId).toBeNull();
    await elapse(siege.id, 20);
    await db.insert(fleetCargo).values({ fleetId: att.fleetId, humans: 100 });
    expect(await att.cmd("siege.assault", { siegeId: siege.id, fleetId: att.fleetId })).toMatchObject({ ok: true });
    const after = await colonyRow(frozen.id);
    expect(after.emperorId).toBe(att.emperor.id);
    expect(after.resolvedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
    // Sin el crecimiento de 30 días: (500 − 50 de milicia) × 0,9 + supervivientes.
    expect(after.population).toBeCloseTo(450 * (1 - SIEGE.capture.populationLoss) + 100 - Math.round(50 * SIEGE.attackerLossPerDefender), 0);
    expect(after.metal).toBeCloseTo(1000 * (1 - SIEGE.capture.stockLoss));
  });

  it("las plataformas defensivas destruyen a quien asedia sin fuerza suficiente: el asedio se rompe; levantar un asedio", async () => {
    const def = await player("Fortaleza", sysB.id, ["freighter"]);
    const att = await player("Temerario", sysA.id, ["frigate"]);
    const fort = await colony(def.emperor.id, sysA.id, 0);
    await db.insert(installations).values(Array.from({ length: 4 }, () => ({ colonyId: fort.id, kind: "defense_platform" })));
    expect(await att.cmd("siege.start", { colonyId: fort.id })).toMatchObject({ ok: true });
    const siege = (await siegeOf(fort.id))!;
    await elapse(siege.id, 10);
    expect(await siegeRow(siege.id)).toMatchObject({ outcome: "broken" });
    expect(await db.select().from(fleets).where(eq(fleets.id, att.fleetId))).toEqual([]);
    expect(await def.last<Siege>(`sieges.${siege.id}`, (v) => v?.outcome === "broken")).toMatchObject({ outcome: "broken" });

    // Levantar: el atacante lo deja cuando quiere.
    const att2 = await player("Prudente", sysA.id, ["frigate", "frigate"]);
    expect(await att2.cmd("siege.start", { colonyId: fort.id })).toMatchObject({ ok: true });
    const second = (await db.select().from(sieges).where(and(eq(sieges.colonyId, fort.id), eq(sieges.attackerId, att2.emperor.id))))[0]!;
    expect(await att.cmd("siege.lift", { siegeId: second.id })).toMatchObject({ ok: false, error: "no_siege" });
    expect(await att2.cmd("siege.lift", { siegeId: second.id })).toMatchObject({ ok: true });
    expect(await siegeRow(second.id)).toMatchObject({ outcome: "lifted" });
  });

  it("naves armadas del defensor: no se puede empezar y, si llegan, el asedio queda disputado", async () => {
    const def = await player("Guardián", sysA.id, ["frigate"]);
    const att = await player("Sitiador", sysA.id, ["frigate", "frigate"]);
    const home = await colony(def.emperor.id, sysA.id, 0);
    expect(await att.cmd("siege.start", { colonyId: home.id })).toMatchObject({ ok: false, error: "defended" });
    await db.update(fleets).set({ systemId: sysB.id }).where(eq(fleets.id, def.fleetId));
    expect(await att.cmd("siege.start", { colonyId: home.id })).toMatchObject({ ok: true });
    const siege = (await siegeOf(home.id))!;
    await db.update(fleets).set({ systemId: sysA.id }).where(eq(fleets.id, def.fleetId));
    await elapse(siege.id, 10);
    expect(await siegeRow(siege.id)).toMatchObject({ state: "contested", progress: 0 });
  });

  it("facciones alienígenas: no asedian en el Núcleo; fuera, con su rencor, ocupan la colonia al completar el asedio", async () => {
    const faction = getFaction("eradicators_pale_verdict")!;
    const actor = (await db.select().from(emperors).where(eq(emperors.factionId, faction.id)))[0]!;
    const species = getSpecies(faction.speciesId)!;
    const classId = species.fleet.composition[0]![0];
    const victim = await player("Víctima", sysB.id, ["freighter"]);
    const alienFleet = async (systemId: string) => {
      const [f] = await db.insert(fleets).values({ emperorId: actor.id, number: Math.floor(Math.random() * 1e6), systemId }).returning();
      await db.insert(ships).values(Array.from({ length: 4 }, () => ({ fleetId: f!.id, classId, hull: 500 })));
      return f!;
    };
    // En el Núcleo Humano, nunca.
    const core = await colony(victim.emperor.id, sysA.id, 0);
    await alienFleet(sysA.id);
    expect(await db.transaction((tx) => app.sieges.startTx(tx, actor.id, core.id))).toMatchObject({ ok: false, error: "protected" });
    // Fuera, sí: al completarse, la ocupan (sin desembarcar humanos) y muere parte de la población.
    const far = await colony(victim.emperor.id, outer.id, details.detail(outer).planets[0]!.index);
    await alienFleet(outer.id);
    const res = await db.transaction((tx) => app.sieges.startTx(tx, actor.id, far.id));
    expect(res).toMatchObject({ ok: true });
    const siege = (await siegeOf(far.id))!;
    await elapse(siege.id, 20);
    const after = await colonyRow(far.id);
    expect(after.emperorId).toBe(actor.id);
    expect(after.population).toBeLessThan(1000 * (1 - SIEGE.capture.populationLoss - ALIEN_SIEGE.occupationPopulationLoss) + 1);
    expect(await siegeRow(siege.id)).toMatchObject({ outcome: "captured" });
    // El jugador puede recuperarla: asediar una colonia ocupada suma rencor.
    await db.update(fleets).set({ systemId: outer.id }).where(eq(fleets.id, victim.fleetId));
    await db.delete(ships).where(eq(ships.fleetId, victim.fleetId));
    await db.insert(ships).values({ fleetId: victim.fleetId, classId: "frigate", hull: 300 });
    await db.delete(fleets).where(eq(fleets.emperorId, actor.id));
    expect(await victim.cmd("siege.start", { colonyId: far.id })).toMatchObject({ ok: true });
    const [standing] = await db.select().from(alienStandings).where(and(eq(alienStandings.emperorId, victim.emperor.id), eq(alienStandings.factionId, faction.id)));
    expect(standing!.grudge).toBeGreaterThan(0);
  });

  it("la IA alienígena asedia por su cuenta las colonias humanas de su territorio", async () => {
    // Una facción hostil que ataca, con un sistema con planetas en su territorio.
    let target: StarSystemSummary | null = null;
    let factionId = "";
    for (let x = 2; x <= 16 && !target; x++)
      for (let y = -1; y <= 1 && !target; y++)
        for (const s of generateSector(app.aliens.territory.universeSeed, { x, y, z: 0 }).systems) {
          const o = app.aliens.territory.owner(s);
          if (!o || getFaction(o.factionId)?.relation !== "hostile" || getSpecies(o.speciesId)?.ai.intruders !== "attack") continue;
          if (details.detail(s).planets.length === 0) continue;
          target = s;
          factionId = o.factionId;
          break;
        }
    expect(target).toBeTruthy();
    const victim = await player("Colono", sysA.id, ["freighter"]);
    const c = await colony(victim.emperor.id, target!.id, details.detail(target!).planets[0]!.index);
    // La región despierta con su guarnición; una de sus flotas está en el sistema de la colonia.
    const region = await db.transaction((tx) => app.aliens.activate(tx, target!));
    expect(region?.factionId).toBe(factionId);
    const actor = (await db.select().from(emperors).where(eq(emperors.factionId, factionId)))[0]!;
    const [garrison] = await db.select().from(fleets).where(eq(fleets.emperorId, actor.id));
    await db.update(fleets).set({ systemId: target!.id }).where(eq(fleets.id, garrison!.id));
    await db.update(scheduledEvents).set({ dueAt: sql`now() - interval '1 second'` }).where(eq(scheduledEvents.kind, "ai.region"));
    await app.eventWorker.drain();
    expect(await siegeOf(c.id)).toMatchObject({ attackerId: actor.id, defenderId: victim.emperor.id });
    // La flota que asedia no se va de patrulla.
    expect((await db.select().from(fleets).where(eq(fleets.id, garrison!.id)))[0]!.destSystemId).toBeNull();
  });

  it("un Emperador de la IA militarista asedia una colonia débil fuera del Núcleo y desembarca colonos", async () => {
    const persona = AI_EMPERORS.find((e) => e.personality === "militarist")!;
    await app.aiEmperors.ensure(AI_EMPERORS.indexOf(persona) + 1);
    const [ai] = await db.select().from(emperors).where(eq(emperors.name, persona.name));
    await db.update(emperors).set({ createdAt: sql`now() - interval '30 days'` }).where(eq(emperors.id, ai!.id));
    await db.insert(discoveries).values({ emperorId: ai!.id, systemId: outer.id }).onConflictDoNothing();
    const prey = await colony(null, outer.id, details.detail(outer).planets[0]!.index, 300);
    const [war] = await db.insert(fleets).values({ emperorId: ai!.id, number: 50, systemId: outer.id }).returning();
    await db.insert(ships).values(Array.from({ length: 3 }, () => ({ fleetId: war!.id, classId: "frigate", hull: 300 })));
    await app.aiEmperors.decide(ai!.id);
    const siege = (await siegeOf(prey.id))!;
    expect(siege).toMatchObject({ attackerId: ai!.id, defenderId: null });
    await elapse(siege.id, 20);
    // Con el asedio completo, trae un colonizador con colonos y desembarca.
    const [troops] = await db.insert(fleets).values({ emperorId: ai!.id, number: 51, systemId: outer.id }).returning();
    await db.insert(ships).values({ fleetId: troops!.id, classId: "colonizer", hull: 120, humans: 400 });
    await app.aiEmperors.decide(ai!.id);
    expect((await colonyRow(prey.id)).emperorId).toBe(ai!.id);
    expect(await siegeRow(siege.id)).toMatchObject({ outcome: "captured" });
  });
});
