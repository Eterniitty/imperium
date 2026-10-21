/**
 * Derechos sobre los datos: descargar y borrar la cuenta (RGPD). Usan la base de
 * datos de TEST_DATABASE_URL; sin esa variable se saltan.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LEGAL_VERSION, LOGIN_TOKEN_PARAM } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { accounts, emperors, fleets, magicLinkTokens, scheduledEvents } from "../src/db/schema";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Cuenta: exportar y borrar", () => {
  const sent: string[] = [];
  const mailer: Mailer = {
    async sendLoginLink(_to, link) {
      sent.push(link);
    },
  };
  const database = createDb(TEST_DATABASE_URL ?? "");
  const config = loadConfig({
    APP_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_URL: "http://juego.test",
    COOKIE_SECURE: "false",
  });
  const SESSION_COOKIE = sessionCookieName(config);
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    sent.length = 0;
    await database.db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events CASCADE`);
    app = await buildApp(config, { db: database.db, mailer, startWorker: false });
  });
  afterEach(() => app.close());
  afterAll(() => database.close());

  async function login(email: string): Promise<Record<string, string>> {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const res = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
  }

  it("sin aceptar los términos no se envía el enlace", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: "x@ejemplo.com" } });
    expect(res.statusCode).toBe(400);
    const no = await app.inject({ method: "POST", url: "/api/auth/request", payload: { email: "x@ejemplo.com", acceptTerms: false } });
    expect(no.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("la cuenta guarda qué versión de los términos aceptó", async () => {
    await login("t@ejemplo.com");
    const [acc] = await database.db.select().from(accounts).where(sql`${accounts.email} = 't@ejemplo.com'`);
    expect(acc?.termsVersion).toBe(LEGAL_VERSION);
    expect(acc?.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it("exporta los datos de la cuenta y del Emperador", async () => {
    expect((await app.inject({ method: "GET", url: "/api/account/export" })).statusCode).toBe(401);
    const c = await login("e@ejemplo.com");
    await app.inject({ method: "POST", url: "/api/emperor", payload: { name: "Exporta Dora" }, cookies: c });
    const res = await app.inject({ method: "GET", url: "/api/account/export", cookies: c });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    const data = res.json();
    expect(data.account.email).toBe("e@ejemplo.com");
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].idHash).toBeUndefined();
    expect(data.game.emperor.name).toBe("Exporta Dora");
    expect(data.game.fleets.length).toBeGreaterThan(0);
  });

  it("borra la cuenta, sus datos, sus enlaces y sus eventos pendientes", async () => {
    const c = await login("b@ejemplo.com");
    await app.inject({ method: "POST", url: "/api/emperor", payload: { name: "Borra Dora" }, cookies: c });
    const other = await login("otra@ejemplo.com");
    const [emp] = await database.db.select().from(emperors);
    const [fleet] = await database.db.select().from(fleets).where(sql`${fleets.emperorId} = ${emp!.id}`);
    await database.db.insert(scheduledEvents).values([
      { dueAt: new Date(), kind: "fleet.arrive", payload: { fleetId: fleet!.id } },
      { dueAt: new Date(), kind: "emperor.arrive", payload: { emperorId: emp!.id, systemId: "x" } },
      { dueAt: new Date(), kind: "emperor.arrive", payload: { emperorId: "00000000-0000-0000-0000-000000000000", systemId: "x" } },
    ]);

    // Sin confirmación explícita no se borra nada.
    expect((await app.inject({ method: "POST", url: "/api/account/delete", payload: {}, cookies: c })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/account/delete", payload: { confirm: true } })).statusCode).toBe(401);

    const res = await app.inject({ method: "POST", url: "/api/account/delete", payload: { confirm: true }, cookies: c });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((k) => k.name === SESSION_COOKIE)?.value).toBe("");

    expect(await database.db.select().from(accounts).where(sql`${accounts.email} = 'b@ejemplo.com'`)).toHaveLength(0);
    expect(await database.db.select().from(emperors)).toHaveLength(0);
    expect(await database.db.select().from(fleets)).toHaveLength(0);
    expect(await database.db.select().from(magicLinkTokens).where(sql`${magicLinkTokens.email} = 'b@ejemplo.com'`)).toHaveLength(0);
    // Solo queda el evento ajeno.
    expect(await database.db.select().from(scheduledEvents)).toHaveLength(1);
    // La sesión ya no vale; la otra cuenta sigue intacta.
    expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies: c })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", cookies: other })).statusCode).toBe(200);
    // Se puede volver a registrar el mismo correo desde cero.
    await login("b@ejemplo.com");
    expect((await app.inject({ method: "GET", url: "/api/emperor", cookies: await login("b@ejemplo.com") })).statusCode).toBe(404);
  });
});
