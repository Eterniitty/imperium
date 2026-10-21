/**
 * Wiki editable: administradores (ADMIN_EMAILS), revisiones solo inserción,
 * historial y restauración, artículos nuevos y ocultos, CSRF y borrado de la
 * cuenta del autor. Usan TEST_DATABASE_URL; sin esa variable se saltan.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOGIN_TOKEN_PARAM, type WikiHistoryResponse, type WikiPageResponse, type WikiRevisionResponse, type WikiSaveResponse, type WikiStateResponse } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { wikiLog, wikiRevisions } from "../src/db/schema";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "http://juego.test";

describe("config: ADMIN_EMAILS", () => {
  it("lista separada por comas, sin espacios ni mayúsculas; vacía por defecto", () => {
    const base = { DATABASE_URL: "postgres://x", PUBLIC_URL: ORIGIN, APP_ENV: "test" };
    expect([...loadConfig({ ...base, ADMIN_EMAILS: " Ana@Ejemplo.com, ,bo@x.es " }).ADMIN_EMAILS]).toEqual(["ana@ejemplo.com", "bo@x.es"]);
    expect(loadConfig(base).ADMIN_EMAILS.size).toBe(0);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("Wiki editable", () => {
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
    PUBLIC_URL: ORIGIN,
    COOKIE_SECURE: "false",
    ADMIN_EMAILS: "jefa@ejemplo.com, otro@ejemplo.com",
  });
  const SESSION_COOKIE = sessionCookieName(config);
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    sent.length = 0;
    await database.db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, wiki_revisions, wiki_pages, wiki_log CASCADE`);
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

  const post = (url: string, payload: unknown, cookies?: Record<string, string>, origin: string | null = ORIGIN) =>
    app.inject({ method: "POST", url, payload: payload as object, ...(cookies ? { cookies } : {}), headers: origin ? { origin } : {} });

  it("solo el servidor decide quién es administrador", async () => {
    expect((await app.inject({ method: "GET", url: "/api/wiki/me" })).json()).toEqual({ admin: false });
    const player = await login("jugador@ejemplo.com");
    expect((await app.inject({ method: "GET", url: "/api/wiki/me", cookies: player })).json()).toEqual({ admin: false });
    const admin = await login("Jefa@Ejemplo.com");
    expect((await app.inject({ method: "GET", url: "/api/wiki/me", cookies: admin })).json()).toEqual({ admin: true });

    const body = { slug: "leyes", locale: "es", body: "# Leyes\n\nHola", note: "", baseRevisionId: null };
    expect((await post("/api/wiki/save", body)).statusCode).toBe(401);
    expect((await post("/api/wiki/save", body, player)).json()).toEqual({ error: "forbidden" });
    expect((await post("/api/wiki/save", body, player)).statusCode).toBe(403);
    // CSRF: sin Origin, o desde otra web, se rechaza aunque la cookie sea de un administrador.
    expect((await post("/api/wiki/save", body, admin, null)).statusCode).toBe(403);
    expect((await post("/api/wiki/save", body, admin, "https://malvada.example")).statusCode).toBe(403);
    // Un formulario (texto plano o urlencoded) no sirve.
    const form = await app.inject({ method: "POST", url: "/api/wiki/save", cookies: admin, headers: { origin: ORIGIN, "content-type": "text/plain" }, payload: JSON.stringify(body) });
    expect(form.statusCode).toBe(415);
    expect((await post("/api/wiki/save", body, admin)).statusCode).toBe(200);
    // Leer el historial también es solo para administradores.
    expect((await app.inject({ method: "GET", url: "/api/wiki/history?slug=leyes", cookies: player })).statusCode).toBe(403);
  });

  it("publicar, conflicto, historial, restaurar y versión publicada", async () => {
    const admin = await login("jefa@ejemplo.com");
    const empty = (await app.inject({ method: "GET", url: "/api/wiki" })).json<WikiStateResponse>();
    expect(empty).toEqual({ pages: [], published: [], admin: false });

    const first = await post("/api/wiki/save", { slug: "leyes", locale: "es", body: "# Leyes\r\n\r\nUno", note: "  primera   versión ", baseRevisionId: null }, admin);
    const p1 = first.json<WikiSaveResponse>().published;
    expect(p1).toMatchObject({ slug: "leyes", locale: "es", body: "# Leyes\n\nUno" });
    // Otro administrador editaba sobre la versión del repositorio: conflicto, no se pisa.
    const other = await login("otro@ejemplo.com");
    const stale = await post("/api/wiki/save", { slug: "leyes", locale: "es", body: "# Leyes\n\nOtro", baseRevisionId: null }, other);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: "conflict" });
    const p2 = (await post("/api/wiki/save", { slug: "leyes", locale: "es", body: "# Leyes\n\nDos", baseRevisionId: p1.revisionId }, other)).json<WikiSaveResponse>().published;

    const state = (await app.inject({ method: "GET", url: "/api/wiki" })).json<WikiStateResponse>();
    expect(state.published).toEqual([p2]);

    const history = (await app.inject({ method: "GET", url: "/api/wiki/history?slug=leyes&locale=es", cookies: admin })).json<WikiHistoryResponse>().revisions;
    expect(history.map((r) => [r.id, r.note, r.author])).toEqual([
      [p2.revisionId, "", "ot***@ejemplo.com"],
      [p1.revisionId, "primera versión", "je***@ejemplo.com"],
    ]);
    const rev = (await app.inject({ method: "GET", url: `/api/wiki/revisions/${p1.revisionId}`, cookies: admin })).json<WikiRevisionResponse>();
    expect(rev.revision.body).toBe("# Leyes\n\nUno");

    // Restaurar: revisión nueva con el texto antiguo (el historial no se reescribe).
    const p3 = (await post("/api/wiki/restore", { revisionId: p1.revisionId }, admin)).json<WikiSaveResponse>().published;
    expect(p3.body).toBe("# Leyes\n\nUno");
    expect(p3.revisionId).toBeGreaterThan(p2.revisionId);
    const after = (await app.inject({ method: "GET", url: "/api/wiki/history?slug=leyes", cookies: admin })).json<WikiHistoryResponse>().revisions;
    expect(after[0]).toMatchObject({ id: p3.revisionId, restoredFrom: p1.revisionId });
    const log = await database.db.select().from(wikiLog).orderBy(wikiLog.id);
    expect(log.map((l) => l.action)).toEqual(["save", "save", "restore"]);
  });

  it("validación: slug, artículo inexistente, tamaño y caracteres nulos", async () => {
    const admin = await login("jefa@ejemplo.com");
    const save = (body: object) => post("/api/wiki/save", { locale: "es", note: "", baseRevisionId: null, ...body }, admin);
    expect((await save({ slug: "../etc", body: "x" })).statusCode).toBe(400);
    expect((await save({ slug: "Leyes", body: "x" })).statusCode).toBe(400);
    expect((await save({ slug: "no-existe", body: "x" })).json()).toEqual({ error: "unknown_article" });
    expect((await save({ slug: "leyes", body: "x".repeat(60_001) })).statusCode).toBe(400);
    expect((await save({ slug: "leyes", body: "a\u0000b" })).statusCode).toBe(400);
    expect((await save({ slug: "leyes", body: "x".repeat(60_000) })).statusCode).toBe(200);
    expect((await post("/api/wiki/save", { slug: "leyes", locale: "fr", body: "x", baseRevisionId: null }, admin)).statusCode).toBe(400);
  });

  it("artículos nuevos y ocultos: los demás no ven su texto", async () => {
    const admin = await login("jefa@ejemplo.com");
    expect((await post("/api/wiki/create", { slug: "leyes", group: "start", locale: "es", title: "X" }, admin)).json()).toEqual({ error: "slug_taken" });
    const created = (await post("/api/wiki/create", { slug: "rutas-comerciales", group: "empire", locale: "es", title: "Rutas <b>comerciales</b>" }, admin)).json<WikiPageResponse>();
    expect(created.page).toEqual({ slug: "rutas-comerciales", group: "empire", hidden: false, custom: true, position: 1, byline: null });
    // El título es texto: el renderizador de la Wiki lo escapa.
    expect(created.published!.body).toBe("# Rutas <b>comerciales</b>\n\n");
    expect((await post("/api/wiki/create", { slug: "rutas-comerciales", group: "empire", locale: "es", title: "Y" }, admin)).statusCode).toBe(409);

    // Ocultar uno del repositorio y el nuevo.
    await post("/api/wiki/save", { slug: "lore", locale: "en", body: "# Lore\n\nsecret", baseRevisionId: null }, admin);
    expect((await post("/api/wiki/meta", { slug: "lore", hidden: true }, admin)).json<WikiPageResponse>().page).toMatchObject({ slug: "lore", hidden: true, group: "lore", custom: false });
    await post("/api/wiki/meta", { slug: "rutas-comerciales", hidden: true, group: "war" }, admin);
    const anon = (await app.inject({ method: "GET", url: "/api/wiki" })).json<WikiStateResponse>();
    expect(anon.pages.map((p) => p.slug)).toEqual(["lore"]);
    expect(anon.published).toEqual([]);
    const mine = (await app.inject({ method: "GET", url: "/api/wiki", cookies: admin })).json<WikiStateResponse>();
    expect(mine.admin).toBe(true);
    expect(mine.published.map((p) => p.slug).sort()).toEqual(["lore", "rutas-comerciales"]);
    expect(mine.pages.find((p) => p.slug === "rutas-comerciales")).toMatchObject({ hidden: true, group: "war" });
    expect((await post("/api/wiki/meta", { slug: "no-existe", hidden: true }, admin)).statusCode).toBe(404);
    const actions = (await database.db.select().from(wikiLog).orderBy(wikiLog.id)).map((l) => l.action);
    expect(actions).toEqual(["create", "save", "hide", "hide", "group"]);

    // Libros: un artículo nuevo en «books», con su firma; texto vacío la quita.
    await post("/api/wiki/create", { slug: "cronica-del-primer-salto", group: "books", locale: "es", title: "Crónica del primer salto" }, admin);
    const signed = (await post("/api/wiki/meta", { slug: "cronica-del-primer-salto", byline: "  Lyra Venn, Emperador  " }, admin)).json<WikiPageResponse>();
    expect(signed.page).toMatchObject({ group: "books", byline: "Lyra Venn, Emperador" });
    expect((await app.inject({ method: "GET", url: "/api/wiki" })).json<WikiStateResponse>().pages.find((p) => p.slug === "cronica-del-primer-salto")?.byline).toBe("Lyra Venn, Emperador");
    expect((await post("/api/wiki/meta", { slug: "cronica-del-primer-salto", byline: "" }, admin)).json<WikiPageResponse>().page.byline).toBeNull();
    expect((await post("/api/wiki/meta", { slug: "cronica-del-primer-salto", byline: "x".repeat(121) }, admin)).statusCode).toBe(400);
  });

  it("las revisiones no se pueden modificar ni borrar; al borrar la cuenta quedan sin autor", async () => {
    const admin = await login("jefa@ejemplo.com");
    await post("/api/wiki/save", { slug: "leyes", locale: "es", body: "# Leyes", note: "n", baseRevisionId: null }, admin);
    await expect(database.db.update(wikiRevisions).set({ body: "otra cosa" })).rejects.toThrow();
    await expect(database.db.delete(wikiRevisions)).rejects.toThrow();
    await expect(database.db.delete(wikiLog)).rejects.toThrow();

    const exported = (await app.inject({ method: "GET", url: "/api/account/export", cookies: admin })).json<{ wiki: { revisions: Array<{ body: string }>; log: unknown[] } }>();
    expect(exported.wiki.revisions.map((r) => r.body)).toEqual(["# Leyes"]);
    expect(exported.wiki.log).toHaveLength(1);

    const del = await app.inject({ method: "POST", url: "/api/account/delete", cookies: admin, payload: { confirm: true } });
    expect(del.statusCode).toBe(204);
    const rows = await database.db.select().from(wikiRevisions).where(eq(wikiRevisions.slug, "leyes"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: "# Leyes", note: "n", authorId: null, authorLabel: null });
    const [entry] = await database.db.select().from(wikiLog);
    expect(entry).toMatchObject({ authorId: null, authorLabel: null });
    // La versión publicada sigue ahí.
    const state = (await app.inject({ method: "GET", url: "/api/wiki" })).json<WikiStateResponse>();
    expect(state.published.map((p) => p.body)).toEqual(["# Leyes"]);
  });
});
