/**
 * Tests de integración del Emperador. Igual que los de acceso, usan la base de
 * datos de TEST_DATABASE_URL, que se vacía al empezar. Sin esa variable se saltan.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOGIN_TOKEN_PARAM, type Emperor } from "@imperium/shared";
import { universeSeedFromString } from "@imperium/procgen";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { emperors } from "../src/db/schema";
import { spawnCandidates } from "../src/emperor/world";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("Emperador persistente", () => {
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
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    // Base de datos limpia: se borra todo y se aplican las migraciones desde cero.
    await resetTestDatabase(database);
  });

  beforeEach(async () => {
    sent.length = 0;
    await database.db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors CASCADE`);
    app = await buildApp(config, { db: database.db, mailer });
  });

  afterEach(() => app.close());
  afterAll(() => database.close());

  /** Inicia sesión con un correo y devuelve la cookie de sesión. */
  async function login(email: string): Promise<Record<string, string>> {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const res = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    return { [SESSION_COOKIE]: cookie!.value };
  }

  const getEmperor = (cookies: Record<string, string>) => app.inject({ method: "GET", url: "/api/emperor", cookies });
  const create = (cookies: Record<string, string>, name: unknown) =>
    app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies });
  const move = (cookies: Record<string, string>, systemId: string) =>
    app.inject({ method: "POST", url: "/api/emperor/move", payload: { systemId }, cookies });

  it("sin sesión no se puede consultar ni crear", async () => {
    expect((await getEmperor({})).statusCode).toBe(401);
    expect((await create({}, "Aurelia")).statusCode).toBe(401);
    expect((await move({}, "0:0:0:0")).statusCode).toBe(401);
  });

  it("una cuenta nueva no tiene Emperador hasta que lo nombra", async () => {
    const c = await login("a@ejemplo.com");
    const none = await getEmperor(c);
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: "no_emperor" });

    const res = await create(c, "  Aurelia   Varn ");
    expect(res.statusCode).toBe(201);
    const emperor: Emperor = res.json().emperor;
    expect(emperor.name).toBe("Aurelia Varn");
    // Aparece en un sistema tipo Sol del Núcleo Humano.
    const candidates = spawnCandidates(seed);
    const spawn = candidates.find((s) => s.id === emperor.location.systemId);
    expect(spawn).toBeDefined();
    expect(emperor.location).toEqual({ systemId: spawn!.id, systemName: spawn!.name, position: spawn!.position });
  });

  it("sigue en el mismo sitio al cerrar sesión y volver a entrar", async () => {
    const first = await login("b@ejemplo.com");
    const created: Emperor = (await create(first, "Brennus")).json().emperor;
    await app.inject({ method: "POST", url: "/api/auth/logout", cookies: first });

    const again = await login("b@ejemplo.com");
    const res = await getEmperor(again);
    expect(res.statusCode).toBe(200);
    expect(res.json().emperor).toEqual(created);
  });

  it("solo un Emperador por cuenta, aunque se pidan dos a la vez", async () => {
    const c = await login("c@ejemplo.com");
    const results = await Promise.all([create(c, "Casio"), create(c, "Cornelia")]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json()).toEqual({ error: "emperor_exists" });
    expect(await database.db.select().from(emperors)).toHaveLength(1);
  });

  it("el nombre es único sin distinguir mayúsculas ni formas Unicode equivalentes", async () => {
    expect((await create(await login("d@ejemplo.com"), "Ðrusa Ⅸ")).statusCode).toBe(201);
    const other = await login("e@ejemplo.com");
    const res = await create(other, "ðRUSA IX");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "name_taken" });
    // Tras el rechazo puede elegir otro nombre.
    expect((await create(other, "Drusa X")).statusCode).toBe(201);
  });

  it("rechaza nombres no válidos", async () => {
    const c = await login("f@ejemplo.com");
    for (const name of ["ab", "x".repeat(25), "<script>", "-Aurelia", "Aurelia'", "Au\u0000relia", "", 42]) {
      expect((await create(c, name)).statusCode, String(name)).toBe(400);
    }
    // Letras de cualquier alfabeto, guiones y apóstrofos internos sí valen.
    expect((await create(c, "Ñuño O'Brien-Søren")).statusCode).toBe(201);
  });

  it("se traslada a un sistema existente y el cambio persiste", async () => {
    const c = await login("g@ejemplo.com");
    const created: Emperor = (await create(c, "Galba")).json().emperor;
    const target = spawnCandidates(seed).find((s) => s.id !== created.location.systemId)!;

    const res = await move(c, target.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().emperor.location.systemId).toBe(target.id);
    expect((await getEmperor(c)).json().emperor.location.systemName).toBe(target.name);
  });

  it("no se traslada a sistemas inexistentes ni con identificadores mal formados", async () => {
    const c = await login("h@ejemplo.com");
    await create(c, "Helvia");
    expect((await move(c, "0:0:0:999")).json()).toEqual({ error: "unknown_system" });
    expect((await move(c, "00:0:0:0")).json()).toEqual({ error: "unknown_system" });
    expect((await move(c, "-0:0:0:0")).json()).toEqual({ error: "unknown_system" });
    expect((await move(c, "99999999:0:0:0")).statusCode).toBe(400);
    expect((await move(c, "0:0:0")).statusCode).toBe(400);
  });

  it("sin Emperador no se puede trasladar", async () => {
    const c = await login("i@ejemplo.com");
    expect((await move(c, spawnCandidates(seed)[0]!.id)).json()).toEqual({ error: "no_emperor" });
  });

  it("al borrar la cuenta se borra su Emperador", async () => {
    const c = await login("j@ejemplo.com");
    await create(c, "Julia");
    await database.db.execute(sql`DELETE FROM accounts`);
    expect(await database.db.select().from(emperors)).toHaveLength(0);
  });
});
