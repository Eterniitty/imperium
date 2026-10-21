/**
 * Mercenarios (fase 3 del plan): contratar con créditos donde está la nave del
 * Emperador, tope de contratos, sin mantenimiento y se marchan al acabar el
 * contrato (o al terminar su batalla). Usan TEST_DATABASE_URL, que se vacía.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MERCENARIES } from "@imperium/content";
import { LOGIN_TOKEN_PARAM, type Emperor } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { emperorWallets, fleets, mercenaryContracts, scheduledEvents, ships } from "../src/db/schema";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("mercenarios", () => {
  const sent: string[] = [];
  const mailer: Mailer = {
    async sendLoginLink(_to, link) {
      sent.push(link);
    },
  };
  const database = createDb(TEST_DATABASE_URL ?? "");
  const db = database.db;
  const config = loadConfig({ APP_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: TEST_DATABASE_URL, PUBLIC_URL: "http://juego.test", COOKIE_SECURE: "false", TIME_SCALE: "1" });
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

  async function emperorWith(credits: number): Promise<Emperor> {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: "m@ejemplo.com", acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    const emperor = (await app.inject({ method: "POST", url: "/api/emperor", payload: { name: "Condotiero" }, cookies })).json().emperor as Emperor;
    await db
      .insert(emperorWallets)
      .values({ emperorId: emperor.id, credits, incomePerHour: 0, settledAt: new Date() })
      .onConflictDoUpdate({ target: emperorWallets.emperorId, set: { credits, incomePerHour: 0, settledAt: new Date() } });
    return emperor;
  }

  it("contratar: cobra, aparece donde está la nave y respeta el tope", async () => {
    const offer = MERCENARIES.offers[0]!;
    const emperor = await emperorWith(offer.credits * 5);
    const res = await app.mercenaries.hire(emperor.id, offer.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [fleet] = await db.select().from(fleets).where(eq(fleets.id, res.fleetId));
    expect(fleet!.systemId).toBe(emperor.location.systemId);
    const crew = await db.select().from(ships).where(eq(ships.fleetId, res.fleetId));
    expect(crew.length).toBe(offer.ships.reduce((a, [, n]) => a + n, 0));
    const [wallet] = await db.select().from(emperorWallets).where(eq(emperorWallets.emperorId, emperor.id));
    expect(wallet!.credits).toBeCloseTo(offer.credits * 4, 0);
    for (let i = 1; i < MERCENARIES.maxActive; i++) expect((await app.mercenaries.hire(emperor.id, offer.id)).ok).toBe(true);
    expect(await app.mercenaries.hire(emperor.id, offer.id)).toEqual({ ok: false, error: "limit_reached" });
    expect(await app.mercenaries.hire(emperor.id, "nadie")).toEqual({ ok: false, error: "invalid_command" });
  });

  it("sin créditos no hay contrato", async () => {
    const emperor = await emperorWith(10);
    expect(await app.mercenaries.hire(emperor.id, MERCENARIES.offers[0]!.id)).toEqual({ ok: false, error: "insufficient_credits" });
    expect(await db.select().from(mercenaryContracts)).toEqual([]);
  });

  it("al acabar el contrato se marchan", async () => {
    const offer = MERCENARIES.offers[0]!;
    const emperor = await emperorWith(offer.credits);
    const res = await app.mercenaries.hire(emperor.id, offer.id);
    if (!res.ok) throw new Error(res.error);
    const due = () => db.update(scheduledEvents).set({ dueAt: sql`now() - interval '1 second'` }).where(eq(scheduledEvents.kind, "mercenary.leave"));
    await due();
    await app.eventWorker.drain();
    expect(await db.select().from(fleets).where(eq(fleets.id, res.fleetId))).toEqual([]);
    expect(await db.select().from(mercenaryContracts)).toEqual([]);
    expect((await db.select().from(scheduledEvents).where(eq(scheduledEvents.kind, "mercenary.leave"))).length).toBe(0);
  });
});
