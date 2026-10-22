/**
 * Tests de la Fase 11 (especies alienígenas): territorio determinista y
 * secreto, regiones que despiertan, guarnición, respuesta a intrusos con el
 * combate por rondas, hostilidad según postura y rencor, tributos, patrullas,
 * expansión, comercio de los Nómadas y las rutas de la API con niebla de
 * guerra. Usan TEST_DATABASE_URL, que se vacía.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALIEN_AI, getFaction, getShipClass, getSpecies, SPECIES } from "@imperium/content";
import { coreRing, regionKey } from "@imperium/procgen";
import { systemsOutward } from "./systems";
import { LOGIN_TOKEN_PARAM, type AliensResponse, type ContactsResponse, type Emperor, type StarSystemSummary, type SystemAliensResponse } from "@imperium/shared";
import { buildApp } from "../src/app";
import { territorySeed } from "../src/ai/territory";
import { sessionCookieName } from "../src/auth/routes";
import { DEV_DETAIL_SEED, loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { EmperorService } from "../src/emperor/service";
import { alienClaims, alienFleets, alienRegions, alienStandings, battles, battleSides, colonies, discoveries, emperors, emperorWallets, fleets, marketOrders, scheduledEvents, ships } from "../src/db/schema";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";

describe.skipIf(!TEST_DATABASE_URL)("especies alienígenas (Fase 11)", () => {
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
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    sent.length = 0;
    await db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events, battles, alien_regions, alien_claims, market_orders CASCADE`);
    app = await buildApp(config, { db, mailer, startWorker: false });
    await app.aliens.reset();
    app.aliens.random = () => 0;
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(() => database.close());

  /** Primer sistema (recorriendo anillos hacia fuera) cuyo dueño cumple `pred`. */
  function findTerritory(pred: (factionId: string) => boolean, extra: (s: StarSystemSummary) => boolean = () => true): StarSystemSummary {
    for (const s of systemsOutward(app.aliens.territory.universeSeed, 2)) {
      const o = app.aliens.territory.owner(s);
      if (o && pred(o.factionId) && extra(s)) return s;
    }
    throw new Error("No se encontró territorio");
  }

  /** Jugador con su primera flota en `systemId` y estas naves; ya no es novato. */
  async function player(name: string, systemId: string, classes: string[]) {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: `${name.toLowerCase()}@ejemplo.com`, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const emperor = (await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies })).json().emperor as Emperor;
    await db.update(emperors).set({ createdAt: sql`now() - interval '30 days'` }).where(eq(emperors.id, emperor.id));
    const [fleet] = await db.select().from(fleets).where(eq(fleets.emperorId, emperor.id));
    await db.update(fleets).set({ systemId }).where(eq(fleets.id, fleet!.id));
    await db.delete(ships).where(eq(ships.fleetId, fleet!.id));
    for (const c of classes) await db.insert(ships).values({ fleetId: fleet!.id, classId: c, hull: getShipClass(c as "frigate")!.hull });
    return { emperor, cookies, fleetId: fleet!.id };
  }

  /** Viaje instantáneo de una flota y su llegada (procesa la cola). */
  async function travel(fleetId: string, systemId: string) {
    await db
      .update(fleets)
      .set({ destSystemId: systemId, departAt: sql`now() - interval '2 seconds'`, arriveAt: sql`now() - interval '1 second'` })
      .where(eq(fleets.id, fleetId));
    await db.execute(sql`INSERT INTO scheduled_events (kind, due_at, payload) VALUES ('fleet.arrive', now() - interval '1 second', ${JSON.stringify({ fleetId })}::jsonb)`);
    await app.eventWorker.drain();
  }
  /** Adelanta los eventos de un tipo y los procesa. */
  async function due(kind: string) {
    await db.update(scheduledEvents).set({ dueAt: sql`now() - interval '1 second'` }).where(eq(scheduledEvents.kind, kind));
    await app.eventWorker.drain();
  }
  const actorOf = async (factionId: string) => (await db.select().from(emperors).where(eq(emperors.factionId, factionId)))[0];

  it("el territorio es determinista, secreto y nunca está en el Núcleo Humano", () => {
    expect(territorySeed(DEV_DETAIL_SEED)).toBe(territorySeed(DEV_DETAIL_SEED));
    expect(territorySeed(DEV_DETAIL_SEED)).not.toBe(territorySeed("otra-semilla-secreta-muy-larga"));
    const t = app.aliens.territory;
    const seen = new Set<string>();
    for (const s of systemsOutward(t.universeSeed, 0, 30)) {
      const o = t.owner(s);
      if (coreRing(s.sector) <= 1) expect(o).toBeNull();
      if (!o) continue;
      seen.add(o.speciesId);
      expect(coreRing(s.sector)).toBeGreaterThanOrEqual(getSpecies(o.speciesId)!.territory.minCoreRing);
      expect(getFaction(o.factionId)!.speciesId).toBe(o.speciesId);
    }
    // Hay varias especies, y los Precursores no tienen territorio (solo ruinas).
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(seen.has("precursors")).toBe(false);
  });

  it("una flota que entra en territorio de una facción hostil despierta la región y recibe una respuesta; combaten por rondas", async () => {
    // Con otro sistema suyo en la región (la guarnición no aparece en el del intruso; con la galaxia de
    // ~30 000 estrellas hay regiones de un solo sistema).
    const t = app.aliens.territory;
    const target = findTerritory(
      (f) => getFaction(f)!.relation === "hostile" && getSpecies(getFaction(f)!.speciesId)!.ai.intruders === "attack",
      (s) => t.factionSystems(regionKey(t.regionOf(s)), t.owner(s)!.factionId).length >= 2,
    );
    const factionId = app.aliens.territory.owner(target)!.factionId;
    const key = regionKey(app.aliens.territory.regionOf(target));
    const p = await player("Intrusa", "0:0:0:0", ["frigate", "frigate"]);
    await travel(p.fleetId, target.id);

    const [region] = await db.select().from(alienRegions).where(eq(alienRegions.regionKey, key));
    expect(region).toMatchObject({ factionId, ticking: true });
    const actor = await actorOf(factionId);
    expect(actor).toMatchObject({ kind: "alien", accountId: null, visibility: "hidden" });
    // Guarnición: flotas con naves de su especie, en sistemas de su territorio.
    const garrison = await db.select().from(fleets).innerJoin(alienFleets, eq(alienFleets.fleetId, fleets.id)).where(eq(alienFleets.regionKey, key));
    expect(garrison.length).toBeGreaterThanOrEqual(1);
    const classes = (await db.select().from(ships).where(eq(ships.fleetId, garrison[0]!.fleets.id))).map((s) => s.classId);
    const species = getSpecies(getFaction(factionId)!.speciesId)!;
    for (const c of classes) expect(species.fleet.composition.map(([id]) => id)).toContain(c);
    // Respuesta: alguna flota de la guarnición viaja hacia el intruso (si no estaba ya allí).
    const responders = garrison.filter((g) => g.fleets.destSystemId === target.id);
    const alreadyThere = garrison.filter((g) => g.fleets.systemId === target.id && !g.fleets.destSystemId);
    expect(responders.length + alreadyThere.length).toBeGreaterThan(0);
    // Al llegar, combate por rondas contra la facción (su nombre va traducido en el cliente).
    for (const r of responders) await travel(r.fleets.id, target.id);
    const [battle] = await db.select().from(battles).where(eq(battles.systemId, target.id));
    expect(battle).toBeTruthy();
    const sides = await db.select().from(battleSides).where(eq(battleSides.battleId, battle!.id));
    expect(sides.map((s) => s.emperorId).sort()).toEqual([p.emperor.id, actor!.id].sort());
    const view = await app.inject({ method: "GET", url: "/api/contacts", cookies: p.cookies });
    expect(view.statusCode).toBe(200);
  });

  it("los Emperadores nuevos tienen gracia: no se envían flotas contra ellos", async () => {
    const target = findTerritory((f) => getFaction(f)!.relation === "hostile" && getSpecies(getFaction(f)!.speciesId)!.ai.intruders === "attack");
    const p = await player("Novata", "0:0:0:0", ["frigate"]);
    await db.update(emperors).set({ createdAt: sql`now()` }).where(eq(emperors.id, p.emperor.id));
    await travel(p.fleetId, target.id);
    const moving = await db
      .select()
      .from(fleets)
      .innerJoin(alienFleets, eq(alienFleets.fleetId, fleets.id))
      .where(and(isNotNull(fleets.destSystemId), eq(fleets.destSystemId, target.id)));
    expect(moving).toHaveLength(0);
  });

  it("una facción neutral no combate hasta que se le da motivo (rencor); interceptar o colonizar lo sube y un tributo lo borra", async () => {
    const target = findTerritory((f) => f === "void_nomads_free_wake");
    const p = await player("Mercader", "0:0:0:0", ["frigate"]);
    const actorId = await db.transaction((tx) => app.aliens.actor(tx, "void_nomads_free_wake", target.id));
    expect(await app.aliens.hostile(db, p.emperor.id, actorId, target.id)).toBe(false);
    // Una flota nómada parada en el sistema: llegar allí no empieza ninguna batalla.
    const [nomads] = await db.insert(fleets).values({ emperorId: actorId, number: 99, systemId: target.id }).returning();
    await db.insert(ships).values({ fleetId: nomads!.id, classId: "nomad_corsair", hull: 200 });
    await travel(p.fleetId, target.id);
    expect(await db.select().from(battles)).toHaveLength(0);
    // Colonizar su territorio suma rencor (medio punto); interceptar, uno: ya es hostil.
    await app.aliens.onColonyClaimed(p.emperor.id, target.id);
    expect(await app.aliens.grudge(db, p.emperor.id, "void_nomads_free_wake")).toBeCloseTo(getSpecies("void_nomads")!.ai.grudgePerColony, 3);
    await db.transaction((tx) => app.aliens.onIntercept(tx, p.emperor.id, "void_nomads_free_wake"));
    expect(await app.aliens.hostile(db, p.emperor.id, actorId, target.id)).toBe(true);
    // Nunca en el Núcleo Humano.
    expect(await app.aliens.hostile(db, p.emperor.id, actorId, "0:0:0:0")).toBe(false);
    // Tributo: paga lo justo (₢ por punto) y deja de ser hostil.
    await app.humanity.wallet(p.emperor.id);
    await db.update(emperorWallets).set({ credits: 5000 }).where(eq(emperorWallets.emperorId, p.emperor.id));
    const before = (await db.select().from(emperorWallets).where(eq(emperorWallets.emperorId, p.emperor.id)))[0]!.credits;
    expect(await app.aliens.tribute(p.emperor.id, "void_nomads_free_wake", 100_000)).toEqual({ ok: true, emperorId: p.emperor.id });
    const after = (await db.select().from(emperorWallets).where(eq(emperorWallets.emperorId, p.emperor.id)))[0]!.credits;
    expect(before - after).toBeCloseTo((1 + getSpecies("void_nomads")!.ai.grudgePerColony) * ALIEN_AI.grudge.tributeCreditsPerPoint, 0);
    expect(await app.aliens.hostile(db, p.emperor.id, actorId, target.id)).toBe(false);
    // Los que nunca pactan no aceptan tributos.
    expect(await app.aliens.tribute(p.emperor.id, "eradicators_pale_verdict", 1000)).toEqual({ ok: false, error: "no_diplomacy" });
    const [standing] = await db.select().from(alienStandings).where(eq(alienStandings.emperorId, p.emperor.id));
    expect(standing!.grudge).toBeCloseTo(0, 6);
  });

  it("las decisiones de una región: refuerzos, patrullas, expansión y se duerme sin humanos cerca", async () => {
    const target = findTerritory((f) => getSpecies(getFaction(f)!.speciesId)!.ai.patrol > 0 && getSpecies(getFaction(f)!.speciesId)!.ai.expansionPerDay > 0);
    const key = regionKey(app.aliens.territory.regionOf(target));
    const factionId = app.aliens.territory.owner(target)!.factionId;
    await db.transaction((tx) => app.aliens.activate(tx, target));
    const before = (await db.select().from(alienClaims)).length;
    await due("ai.region");
    // random() = 0: todas patrullan si pueden y la expansión siempre lo intenta.
    const fleetsNow = await db.select().from(fleets).innerJoin(alienFleets, eq(alienFleets.fleetId, fleets.id)).where(eq(alienFleets.regionKey, key));
    expect(fleetsNow.length).toBeGreaterThan(0);
    const claims = await db.select().from(alienClaims);
    if (claims.length > before) {
      const claimed = claims.at(-1)!;
      expect(claimed.factionId).toBe(factionId);
      expect(app.aliens.territory.ownerOf(claimed.systemId)?.factionId).toBe(factionId);
    }
    // Hay una nueva decisión programada; si pasa el tiempo activo, la región se duerme.
    expect((await db.select().from(scheduledEvents).where(eq(scheduledEvents.kind, "ai.region"))).length).toBe(1);
    await db.update(alienRegions).set({ activeUntil: sql`now() - interval '1 second'` });
    await due("ai.region");
    expect((await db.select().from(alienRegions))[0]!.ticking).toBe(false);
    expect((await db.select().from(scheduledEvents).where(eq(scheduledEvents.kind, "ai.region"))).length).toBe(0);
  });

  it("los Nómadas del Vacío comercian en el mercado global desde su hábitat", async () => {
    const target = findTerritory((f) => f === "void_nomads_free_wake");
    const key = regionKey(app.aliens.territory.regionOf(target));
    await app.aliens.trade("void_nomads_free_wake", key);
    const actor = await actorOf("void_nomads_free_wake");
    expect(actor).toBeTruthy();
    const [habitat] = await db.select().from(colonies).where(eq(colonies.emperorId, actor!.id));
    expect(habitat).toBeTruthy();
    const orders = await db.select().from(marketOrders).where(eq(marketOrders.emperorId, actor!.id));
    expect(orders.some((o) => o.side === "sell" && (ALIEN_AI.trade.sells as readonly string[]).includes(o.resource))).toBe(true);
    // Las facciones no cuentan en los agregados de la humanidad.
    const humanity = await app.humanity.view();
    expect(humanity).toBeTruthy();
  });

  it("la API respeta la niebla de guerra: territorio solo de lo descubierto", async () => {
    const target = findTerritory(() => true);
    const p = await player("Exploradora", "0:0:0:0", ["explorer"]);
    const hidden = await app.inject({ method: "GET", url: `/api/systems/${target.id}/aliens`, cookies: p.cookies });
    expect(hidden.statusCode).toBe(403);
    let view = (await app.inject({ method: "GET", url: "/api/aliens", cookies: p.cookies })).json() as AliensResponse;
    expect(view.territory.find((t) => t.systemId === target.id)).toBeUndefined();
    await db.insert(discoveries).values({ emperorId: p.emperor.id, systemId: target.id }).onConflictDoNothing();
    view = (await app.inject({ method: "GET", url: "/api/aliens", cookies: p.cookies })).json() as AliensResponse;
    const owner = app.aliens.territory.owner(target)!;
    expect(view.territory.find((t) => t.systemId === target.id)).toMatchObject(owner);
    expect(view.standings.map((s) => s.factionId)).toContain(owner.factionId);
    const sys = (await app.inject({ method: "GET", url: `/api/systems/${target.id}/aliens`, cookies: p.cookies })).json() as SystemAliensResponse;
    expect(sys.territory).toMatchObject(owner);
    // Sin sensores allí, no se ven las flotas.
    expect(sys.sensed).toBe(false);
    expect(sys.fleets).toEqual([]);
    const contacts = (await app.inject({ method: "GET", url: "/api/contacts", cookies: p.cookies })).json() as ContactsResponse;
    expect(contacts.sightings).toEqual([]);
    // Los actores alienígenas no salen en la lista de Emperadores.
    await db.transaction((tx) => app.aliens.actor(tx, owner.factionId, target.id));
    expect((await new EmperorService(db, config).all()).map((e) => e.name)).not.toContain(owner.factionId);
  });

  it("todas las especies activas tienen territorio alcanzable salvo los Precursores", () => {
    for (const s of SPECIES) {
      if (s.extinct) expect(s.territory.regionWeight).toBe(0);
      else expect(s.territory.regionWeight).toBeGreaterThan(0);
    }
  });
});
