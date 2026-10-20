/**
 * Tests de integración del acceso por enlace. Usan una base de datos real
 * (TEST_DATABASE_URL), que se vacía al empezar. Sin esa variable se saltan.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOGIN_TOKEN_PARAM, type Locale } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { hashToken } from "../src/auth/tokens";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { magicLinkTokens, sessions } from "../src/db/schema";
import type { Mailer } from "../src/mail";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("acceso por enlace", () => {
  const sent: Array<{ to: string; link: string; locale: Locale }> = [];
  const mailer: Mailer = {
    async sendLoginLink(to, link, locale) {
      sent.push({ to, link, locale });
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

  beforeAll(async () => {
    // Base de datos limpia: se borra todo y se aplican las migraciones desde cero.
    await database.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await database.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await database.db.execute(sql`CREATE SCHEMA public`);
    await database.migrate();
  });

  beforeEach(async () => {
    sent.length = 0;
    await database.db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions CASCADE`);
    // Una app nueva por test: los límites de tasa empiezan de cero.
    app = await buildApp(config, { db: database.db, mailer });
  });

  afterEach(() => app.close());

  afterAll(() => database.close());

  const requestLink = (email: string, ip = "10.0.0.1") =>
    app.inject({ method: "POST", url: "/api/auth/request", payload: { email, locale: "en" }, remoteAddress: ip });

  // El token va en el fragmento (#login=...), no en la consulta.
  const tokenFromLink = (link: string) => new URLSearchParams(new URL(link).hash.slice(1)).get(LOGIN_TOKEN_PARAM) ?? "";

  const verify = (token: string) => app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });

  const sessionCookie = (res: Awaited<ReturnType<typeof verify>>) => res.cookies.find((c) => c.name === SESSION_COOKIE);

  it("flujo completo: pedir enlace, canjearlo, ver la cuenta y cerrar sesión", async () => {
    const req = await requestLink("  Ana@Ejemplo.com ");
    expect(req.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ana@ejemplo.com");
    expect(sent[0]?.locale).toBe("en");
    expect(sent[0]?.link.startsWith("http://juego.test/#login=")).toBe(true);

    const res = await verify(tokenFromLink(sent[0]!.link));
    expect(res.statusCode).toBe(200);
    expect(res.json().account).toMatchObject({ email: "ana@ejemplo.com", locale: "en" });
    const cookie = sessionCookie(res);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");

    const me = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: cookie!.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json().account.email).toBe("ana@ejemplo.com");

    const out = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { [SESSION_COOKIE]: cookie!.value } });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: cookie!.value } });
    expect(after.statusCode).toBe(401);
  });

  it("en la base de datos solo se guardan hashes, nunca los tokens", async () => {
    await requestLink("b@ejemplo.com");
    const token = tokenFromLink(sent[0]!.link);
    const res = await verify(token);
    const sessionId = sessionCookie(res)!.value;

    const links = await database.db.select().from(magicLinkTokens);
    expect(links.map((l) => l.tokenHash)).toEqual([hashToken(token)]);
    const rows = await database.db.select().from(sessions);
    expect(rows.map((s) => s.idHash)).toEqual([hashToken(sessionId)]);
  });

  it("un enlace solo sirve una vez", async () => {
    await requestLink("c@ejemplo.com");
    const token = tokenFromLink(sent[0]!.link);
    expect((await verify(token)).statusCode).toBe(200);
    const again = await verify(token);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: "invalid_or_expired" });
  });

  it("dos canjes simultáneos del mismo enlace: solo uno tiene éxito", async () => {
    await requestLink("d@ejemplo.com");
    const token = tokenFromLink(sent[0]!.link);
    const results = await Promise.all([verify(token), verify(token), verify(token)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400, 400]);
  });

  it("un enlace caducado no sirve", async () => {
    await requestLink("e@ejemplo.com");
    await database.db.update(magicLinkTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await verify(tokenFromLink(sent[0]!.link));
    expect(res.json()).toEqual({ error: "invalid_or_expired" });
  });

  it("un token inventado no sirve", async () => {
    const res = await verify("A".repeat(43));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_or_expired" });
  });

  it("volver a entrar con el mismo correo usa la misma cuenta", async () => {
    await requestLink("f@ejemplo.com");
    const a = await verify(tokenFromLink(sent[0]!.link));
    await requestLink("F@ejemplo.com");
    const b = await verify(tokenFromLink(sent[1]!.link));
    expect(a.json().account.id).toBe(b.json().account.id);
  });

  it("rechaza correos no válidos y cuerpos que no son JSON", async () => {
    expect((await requestLink("no-es-un-correo")).statusCode).toBe(400);
    const form = await app.inject({
      method: "POST",
      url: "/api/auth/request",
      headers: { "content-type": "text/plain" },
      payload: '{"email":"g@ejemplo.com"}',
    });
    expect(form.statusCode).toBe(415);
    expect(sent).toHaveLength(0);
  });

  it("limita las peticiones por correo (en silencio, contando alias) y por IP", async () => {
    for (let i = 0; i < 3; i++) expect((await requestLink(`h+${i}@ejemplo.com`, `10.0.1.${i}`)).statusCode).toBe(202);
    // Superado el límite del correo: misma respuesta, pero no se envía nada.
    expect((await requestLink("h@ejemplo.com", "10.0.1.9")).statusCode).toBe(202);
    expect(sent).toHaveLength(3);

    for (let i = 0; i < 10; i++) expect((await requestLink(`ip${i}@ejemplo.com`, "10.0.2.1")).statusCode).toBe(202);
    const blocked = await requestLink("otro@ejemplo.com", "10.0.2.1");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: "rate_limited" });
  });

  it("las IPv6 del mismo /64 comparten límite", async () => {
    for (let i = 0; i < 10; i++) expect((await requestLink(`v6${i}@ejemplo.com`, `2a01:4f8:1:2::${i + 1}`)).statusCode).toBe(202);
    expect((await requestLink("v6x@ejemplo.com", "2a01:4f8:1:2:ffff::1")).statusCode).toBe(429);
    expect((await requestLink("v6y@ejemplo.com", "2a01:4f8:1:3::1")).statusCode).toBe(202);
  });

  it("consultar un enlace muestra el correo enmascarado y no lo gasta", async () => {
    await requestLink("andrea@ejemplo.com");
    const token = tokenFromLink(sent[0]!.link);
    const peek = await app.inject({ method: "POST", url: "/api/auth/peek", payload: { token } });
    expect(peek.statusCode).toBe(200);
    expect(peek.json()).toEqual({ email: "an***@ejemplo.com" });
    expect((await verify(token)).statusCode).toBe(200);
    const after = await app.inject({ method: "POST", url: "/api/auth/peek", payload: { token } });
    expect(after.json()).toEqual({ error: "invalid_or_expired" });
  });

  it("al entrar, los demás enlaces pendientes de ese correo dejan de valer", async () => {
    await requestLink("i@ejemplo.com");
    await requestLink("i@ejemplo.com");
    expect((await verify(tokenFromLink(sent[1]!.link))).statusCode).toBe(200);
    expect((await verify(tokenFromLink(sent[0]!.link))).json()).toEqual({ error: "invalid_or_expired" });
  });

  it("entrar con un enlace cierra la sesión anterior del navegador", async () => {
    await requestLink("j@ejemplo.com");
    await requestLink("k@ejemplo.com");
    const first = sessionCookie(await verify(tokenFromLink(sent[0]!.link)))!.value;
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { token: tokenFromLink(sent[1]!.link) },
      cookies: { [SESSION_COOKIE]: first },
    });
    expect(second.json().account.email).toBe("k@ejemplo.com");
    const old = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: first } });
    expect(old.statusCode).toBe(401);
  });

  it("sin sesión, /me responde 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me", cookies: { [SESSION_COOKIE]: "inventada" } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthenticated" });
  });
});
