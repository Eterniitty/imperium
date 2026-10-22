/**
 * Tests de los contratos y del rango del Emperador (`docs/juego-solitario.md`):
 * ofertas deterministas, aceptar con huecos limitados, cumplir y cobrar
 * (créditos, reputación y experiencia), y las mejoras de cada rango.
 * Usan TEST_DATABASE_URL, que se vacía.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONTRACTS, GOALS, goalXp, RANK_XP, RANKS, rankOf, rankPerks } from "@imperium/content";
import { LOGIN_TOKEN_PARAM, type Emperor } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { contracts, emperors, goals, resourceLedger } from "../src/db/schema";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";

describe("rango del Emperador (datos)", () => {
  it("los rangos suben en orden y las mejoras se acumulan", () => {
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i]!.xp).toBeGreaterThan(RANKS[i - 1]!.xp);
    expect(rankOf(0).index).toBe(0);
    expect(rankOf(RANKS[3]!.xp - 1).index).toBe(2);
    expect(rankOf(RANKS[3]!.xp).index).toBe(3);
    expect(rankOf(1e9).next).toBeNull();
    expect(rankPerks(0)).toEqual({ contractSlots: 0, contractOffers: 0, contractRewardPct: 0 });
    const top = rankPerks(RANKS.length - 1);
    expect(top.contractSlots).toBeGreaterThan(rankPerks(2).contractSlots - 1);
    expect(top.contractRewardPct).toBeGreaterThan(0);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("contratos y rango", () => {
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
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    sent.length = 0;
    await db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events CASCADE`);
    app = await buildApp(config, { db, mailer, startWorker: false });
  });
  afterEach(() => app.close());
  afterAll(() => database.close());

  /** Un Emperador nuevo (cuenta de pruebas con un correo inventado). */
  async function emperor(name: string): Promise<Emperor> {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: `${name.toLowerCase()}@ejemplo.com`, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    return (await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies })).json().emperor as Emperor;
  }

  it("ofertas del día, huecos limitados y cumplir un contrato: créditos, reputación y experiencia", async () => {
    const e = await emperor("Contratista");
    const view = await app.contracts.view(e.id);
    expect(view.offers).toHaveLength(CONTRACTS.offersPerDay);
    expect(view.maxActive).toBe(CONTRACTS.maxActive);
    // Deterministas: las mismas ofertas al pedirlas otra vez.
    expect((await app.contracts.view(e.id)).offers).toEqual(view.offers);

    // Se aceptan hasta llenar los huecos (ofertas de un día con más de las necesarias).
    const many = app.contracts.offers(e.id, Date.now(), { contractSlots: 0, contractOffers: CONTRACTS.maxActive + 1, contractRewardPct: 0 });
    const offer = view.offers[0]!;
    expect(await app.contracts.accept(e.id, offer.id)).toEqual({ ok: true });
    expect(await app.contracts.accept(e.id, offer.id)).toEqual({ ok: false, error: "unknown_contract" });
    for (const o of view.offers.slice(1, CONTRACTS.maxActive)) expect(await app.contracts.accept(e.id, o.id)).toEqual({ ok: true });
    if (view.offers.length > CONTRACTS.maxActive) expect(await app.contracts.accept(e.id, view.offers[CONTRACTS.maxActive]!.id)).toEqual({ ok: false, error: "too_many_contracts" });
    expect(many.length).toBeGreaterThan(view.offers.length);

    // Cumplir el primero: paga créditos, reputación y experiencia según su dificultad.
    const before = (await db.select().from(emperors).where(eq(emperors.id, e.id)))[0]!;
    const tier = CONTRACTS.kinds[offer.kind].targets.indexOf(offer.target) + 1;
    const r = await app.contracts.progress(e.id, offer.kind, offer.target);
    expect(r.changed).toBe(true);
    expect(r.completed.map((c) => c.offerId)).toContain(offer.id);
    const [row] = await db.select().from(contracts).where(and(eq(contracts.emperorId, e.id), eq(contracts.offerId, offer.id)));
    expect(row!.status).toBe("done");
    const after = (await db.select().from(emperors).where(eq(emperors.id, e.id)))[0]!;
    const sameKind = view.offers.slice(0, CONTRACTS.maxActive).filter((o) => o.kind === offer.kind && o.target <= offer.target);
    const xp = sameKind.reduce((n, o) => n + RANK_XP.contractPerTier * (CONTRACTS.kinds[o.kind].targets.indexOf(o.target) + 1), 0);
    expect(after.xp - before.xp).toBe(xp);
    expect(r.rank?.xp).toBe(after.xp);
    expect(after.reputation).toBeGreaterThan(before.reputation);
    const paid = await db.select().from(resourceLedger).where(and(eq(resourceLedger.emperorId, e.id), eq(resourceLedger.reason, "contract")));
    expect(paid.some((p) => p.ref === `contract:${row!.id}`)).toBe(true);
    expect(tier).toBeGreaterThanOrEqual(1);

    // Abandonar uno en curso libera el hueco.
    const active = (await app.contracts.view(e.id)).list.filter((c) => c.status === "active");
    if (active[0]) expect(await app.contracts.abandon(e.id, active[0].id)).toBe(true);
  });

  it("rescate: los restos van a un sistema conocido, se avisan al espacio local y se cumple el contrato concreto", async () => {
    const e = await emperor("Rescatador");
    const place = await app.contracts.rescuePlace!(e.id, "semilla");
    expect(place).toBeTruthy();
    expect(place!.point.every(Number.isFinite)).toBe(true);
    expect(place!.point[1]).toBe(0);
    let seen: Array<{ contractId: string }> | null = null;
    app.contracts.onSpots = (_id, spots) => {
      seen = spots;
    };
    const [row] = await db
      .insert(contracts)
      .values({ emperorId: e.id, offerId: "0:9", kind: "rescue", target: 1, credits: 650, reputation: 3, expiresAt: new Date(Date.now() + 3_600_000), systemId: place!.systemId, point: place!.point })
      .returning();
    await app.contracts.syncSpots(e.id);
    expect(seen!.map((x) => x.contractId)).toEqual([row!.id]);
    const view = await app.contracts.view(e.id);
    expect(view.list.find((c) => c.id === row!.id)).toMatchObject({ kind: "rescue", systemId: place!.systemId, point: place!.point });
    expect(view.list.find((c) => c.id === row!.id)!.systemName).toBeTruthy();
    // Otro id no lo cumple; el suyo sí, y deja de haber restos.
    expect((await app.contracts.progress(e.id, "rescue", 1, "00000000-0000-0000-0000-000000000000")).changed).toBe(false);
    const r = await app.contracts.progress(e.id, "rescue", 1, row!.id);
    expect(r.completed.map((c) => c.id)).toEqual([row!.id]);
    expect(seen).toEqual([]);
  });

  it("objetivos del día y de la semana: deterministas, se cumplen solos, pagan y hacen racha", async () => {
    const e = await emperor("Constante");
    const view = await app.goals.view(e.id);
    expect(view.daily).toHaveLength(GOALS.dailyCount);
    expect(new Set(view.daily.map((g) => g.kind)).size).toBe(GOALS.dailyCount);
    expect(view.weekly).toBeTruthy();
    expect(view.streak).toBe(0);
    expect((await app.goals.view(e.id)).daily.map((g) => [g.kind, g.target])).toEqual(view.daily.map((g) => [g.kind, g.target]));

    // Cumplir los tres del día: experiencia, créditos y un día de racha (una sola vez).
    const xp0 = (await db.select().from(emperors).where(eq(emperors.id, e.id)))[0]!.xp;
    for (const g of view.daily) await app.goals.progress(e.id, g.kind, g.target);
    const after = await app.goals.view(e.id);
    expect(after.daily.every((g) => g.done)).toBe(true);
    expect(after.streak).toBe(1);
    const me = (await db.select().from(emperors).where(eq(emperors.id, e.id)))[0]!;
    expect(me.xp - xp0).toBeGreaterThanOrEqual(GOALS.dailyCount * GOALS.daily.xp);
    const paid = await db.select().from(resourceLedger).where(and(eq(resourceLedger.emperorId, e.id), eq(resourceLedger.reason, "goal")));
    expect(paid.reduce((n, p) => n + (p.credits ?? 0), 0)).toBeGreaterThanOrEqual(GOALS.dailyCount * GOALS.daily.credits);
    // Un objetivo ya cumplido no vuelve a pagar.
    expect((await app.goals.progress(e.id, view.daily[0]!.kind, 999)).changed).toBe(view.weekly!.kind === view.daily[0]!.kind);

    // La racha: si ayer se cumplieron, sigue; si no, se rompe. Con racha, más experiencia.
    await db.update(emperors).set({ goalStreak: 3, goalStreakDay: me.goalStreakDay - 1 }).where(eq(emperors.id, e.id));
    expect((await app.goals.view(e.id)).streak).toBe(3);
    expect((await app.goals.view(e.id)).daily[0]!.xp).toBe(goalXp(GOALS.daily.xp, 3));
    await db.update(emperors).set({ goalStreakDay: me.goalStreakDay - 2 }).where(eq(emperors.id, e.id));
    expect((await app.goals.view(e.id)).streak).toBe(0);
    // Solo se guardan los del periodo en curso.
    expect((await db.select().from(goals).where(eq(goals.emperorId, e.id))).length).toBe(GOALS.dailyCount + 1);
  });

  it("las mejoras del rango: más huecos, más ofertas (las primeras no cambian) y más recompensa", async () => {
    const e = await emperor("Almirante");
    const base = await app.contracts.view(e.id);
    const at = async (id: string) => {
      await db.update(emperors).set({ xp: RANKS.find((r) => r.id === id)!.xp }).where(eq(emperors.id, e.id));
      return app.contracts.view(e.id);
    };
    expect((await at("commander")).maxActive).toBe(CONTRACTS.maxActive + 1);
    const rear = await at("rearAdmiral");
    expect(rear.offers).toHaveLength(CONTRACTS.offersPerDay + 1);
    expect(rear.offers.slice(0, base.offers.length)).toEqual(base.offers);
    const grand = await at("grandAdmiral");
    expect(grand.offers[0]!.credits).toBe(Math.round((base.offers[0]!.credits * 120) / 100));
    expect(grand.offers[0]!.target).toBe(base.offers[0]!.target);

    // Subir de rango se nota en `add`.
    await db.update(emperors).set({ xp: RANKS[1]!.xp - 1 }).where(eq(emperors.id, e.id));
    expect(await app.rank.add(e.id, 1)).toEqual({ xp: RANKS[1]!.xp, up: true });
    expect(await app.rank.add(e.id, 1)).toEqual({ xp: RANKS[1]!.xp + 1, up: false });
    expect(await app.rank.add(e.id, 0)).toBeNull();
  });
});
