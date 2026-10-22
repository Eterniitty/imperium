/**
 * Editor de naves (fase E2): guardar, listar y borrar diseños propios.
 * Usan TEST_DATABASE_URL, que se vacía.
 */
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOGIN_TOKEN_PARAM, type ShipDesignsResponse } from "@imperium/shared";
import { buildApp } from "../src/app";
import { sessionCookieName } from "../src/auth/routes";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import type { Mailer } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("diseños de nave", () => {
  const sent: string[] = [];
  const mailer: Mailer = {
    async sendLoginLink(_to, link) {
      sent.push(link);
    },
  };
  const database = createDb(TEST_DATABASE_URL ?? "");
  const config = loadConfig({ APP_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: TEST_DATABASE_URL, PUBLIC_URL: "http://juego.test", COOKIE_SECURE: "false", TIME_SCALE: "1" });
  const SESSION_COOKIE = sessionCookieName(config);
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(() => resetTestDatabase(database));
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions, emperors, scheduled_events CASCADE`);
    app = await buildApp(config, { db: database.db, mailer, startWorker: false });
  });
  afterEach(() => app.close());
  afterAll(() => database.close());

  async function player(email: string, name: string) {
    await app.inject({ method: "POST", url: "/api/auth/request", payload: { email, acceptTerms: true } });
    const token = new URLSearchParams(new URL(sent.at(-1)!).hash.slice(1)).get(LOGIN_TOKEN_PARAM);
    const login = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    const cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
    await app.inject({ method: "POST", url: "/api/emperor", payload: { name }, cookies });
    return cookies;
  }
  const post = (url: string, payload: Record<string, unknown>, cookies: Record<string, string>) => app.inject({ method: "POST", url, payload, cookies });

  it("guardar, cambiar, listar y borrar; cada uno solo ve y toca los suyos", async () => {
    const a = await player("a@ejemplo.com", "Disenadora");
    const b = await player("b@ejemplo.com", "Curioso");
    const first = (await post("/api/designs/save", { name: "Halcón", hullId: "hull_skiff", parts: { bridge: "bridge_s", core: "reactor_fission_s" } }, a)).json<ShipDesignsResponse>();
    expect(first.saved).toMatchObject({ name: "Halcón", hullId: "hull_skiff", parts: { bridge: "bridge_s" } });
    const id = first.saved!.id;
    const renamed = (await post("/api/designs/save", { id, name: "Halcón II", hullId: "hull_skiff", parts: { bridge: "bridge_s" } }, a)).json<ShipDesignsResponse>();
    expect(renamed.designs.map((d) => d.name)).toEqual(["Halcón II"]);
    // Otro Emperador no lo ve ni lo puede tocar.
    expect((await app.inject({ method: "GET", url: "/api/designs", cookies: b })).json<ShipDesignsResponse>().designs).toEqual([]);
    expect((await post("/api/designs/save", { id, name: "Mío", hullId: "hull_skiff", parts: {} }, b)).statusCode).toBe(404);
    expect((await post("/api/designs/delete", { id }, b)).statusCode).toBe(404);
    // Piezas o anclajes que no existen: rechazado.
    expect((await post("/api/designs/save", { name: "X", hullId: "hull_skiff", parts: { bridge: "nada" } }, a)).statusCode).toBe(400);
    expect((await post("/api/designs/save", { name: "X", hullId: "hull_skiff", parts: { gun9: "cannon_s" } }, a)).statusCode).toBe(400);
    expect((await post("/api/designs/save", { name: "X", hullId: "no-existe", parts: {} }, a)).statusCode).toBe(400);
    expect((await post("/api/designs/delete", { id }, a)).json<ShipDesignsResponse>().designs).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/designs" })).statusCode).toBe(401);
  });
});
