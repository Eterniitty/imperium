/**
 * Tests de los Emperadores humanos de la IA (Fase 11): se crean como un
 * jugador nuevo (sin cuenta), reclaman su primer planeta, construyen en orden,
 * colonizan con colonizadores y no empiezan peleas en el Núcleo Humano. Usan
 * TEST_DATABASE_URL, que se vacía.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AI_EMPEROR, AI_EMPERORS, AI_PERSONALITIES, getShipClass } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { colonies, colonyBuilds, discoveries, emperors, fleets, ships } from "../src/db/schema";
import { DiscoveryService } from "../src/discovery/service";
import { spawnCandidates } from "../src/emperor/world";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Emperadores humanos de la IA (Fase 11)", () => {
  const database = createDb(TEST_DATABASE_URL ?? "");
  const db = database.db;
  const config = loadConfig({ APP_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: TEST_DATABASE_URL, PUBLIC_URL: "http://juego.test", COOKIE_SECURE: "false", TIME_SCALE: "1" });
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE accounts, emperors, scheduled_events, battles, alien_regions, alien_claims, market_orders CASCADE`);
    app = await buildApp(config, { db, startWorker: false });
    await app.aliens.reset();
    app.aiEmperors.random = () => 0.3;
  });
  afterEach(() => app.close());
  afterAll(() => database.close());

  it("por defecto no hay ninguno en las pruebas; se crean como un jugador nuevo, sin cuenta y visibles", async () => {
    expect(config.AI_EMPERORS).toBe(0);
    expect(loadConfig({ APP_ENV: "development", DATABASE_URL: TEST_DATABASE_URL, PUBLIC_URL: "http://juego.test" }).AI_EMPERORS).toBe(3);
    expect(await app.aiEmperors.ensure(2)).toBe(2);
    expect(await app.aiEmperors.ensure(2)).toBe(0);
    const rows = await db.select().from(emperors).where(eq(emperors.kind, "ai"));
    expect(rows.map((r) => r.name).sort()).toEqual(AI_EMPERORS.slice(0, 2).map((e) => e.name).sort());
    for (const r of rows) {
      expect(r).toMatchObject({ accountId: null, visibility: "public", factionId: null });
      expect((await db.select().from(fleets).where(eq(fleets.emperorId, r.id))).length).toBe(1);
      expect((await db.select().from(discoveries).where(eq(discoveries.emperorId, r.id))).length).toBeGreaterThan(0);
    }
  });

  it("reclama su primer planeta con su nave y encarga instalaciones en orden; sin peleas en el Núcleo", async () => {
    await app.aiEmperors.ensure(1);
    const [ai] = await db.select().from(emperors).where(eq(emperors.kind, "ai"));
    const fx = await app.aiEmperors.decide(ai!.id);
    expect(fx!.colonies.length).toBeGreaterThan(0);
    const [colony] = await db.select().from(colonies).where(eq(colonies.emperorId, ai!.id));
    expect(colony!.systemId).toBe(ai!.systemId);
    const builds = await db.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, colony!.id));
    const persona = AI_PERSONALITIES[AI_EMPERORS[0]!.personality];
    expect(builds[0]?.itemId).toBe(persona.buildOrder[0]![0]);
    // Una segunda decisión no reclama otra vez con la nave ni duplica el encargo en marcha.
    await app.aiEmperors.decide(ai!.id);
    expect((await db.select().from(colonies).where(eq(colonies.emperorId, ai!.id))).length).toBe(1);
    expect((await db.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, colony!.id))).length).toBe(1);
    // Con un jugador cualquiera, no combate en el Núcleo Humano.
    expect(await app.aliens.hostile(db, ai!.id, crypto.randomUUID(), ai!.systemId)).toBe(false);
  });

  it("un colonizador parado en un sistema descubierto con un planeta libre lo reclama", async () => {
    await app.aiEmperors.ensure(1);
    const [ai] = await db.select().from(emperors).where(eq(emperors.kind, "ai"));
    await app.aiEmperors.decide(ai!.id);
    const details = new DiscoveryService(db, config);
    const seed = universeSeedFromString(config.UNIVERSE_SEED);
    const target = spawnCandidates(seed).find((s) => s.id !== ai!.systemId && details.detail(s).planets.some((p) => p.habitability >= AI_EMPEROR.minHabitability))!;
    await db.insert(discoveries).values({ emperorId: ai!.id, systemId: target.id }).onConflictDoNothing();
    const [fleet] = await db.insert(fleets).values({ emperorId: ai!.id, number: 2, systemId: target.id }).returning();
    await db.insert(ships).values({ fleetId: fleet!.id, classId: "colonizer", hull: getShipClass("colonizer")!.hull, humans: 1000 });
    await app.aiEmperors.decide(ai!.id);
    const there = await db.select().from(colonies).where(eq(colonies.systemId, target.id));
    expect(there.map((c) => c.emperorId)).toContain(ai!.id);
    // El colonizador se ha consumido (y con él la flota, que no tenía más naves).
    expect(await db.select().from(fleets).where(eq(fleets.id, fleet!.id))).toHaveLength(0);
  });
});
