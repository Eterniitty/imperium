import { describe, expect, it } from "vitest";
import { GENERATOR_VERSION } from "@imperium/shared";
import { buildApp } from "../src/app";
import { RateLimiter } from "../src/auth/rateLimit";
import { generateToken, hashToken, normalizeEmail } from "../src/auth/tokens";
import { loadConfig } from "../src/config";
import type { Database } from "../src/db/client";

const BASE_ENV = { DATABASE_URL: "postgres://localhost/x", PUBLIC_URL: "http://localhost:5173" };

describe("configuración", () => {
  it("por defecto escucha solo en la máquina local", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.SERVER_HOST).toBe("127.0.0.1");
    expect(config.SERVER_PORT).toBe(3000);
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it("rechaza un puerto no válido o sin base de datos", () => {
    expect(() => loadConfig({ ...BASE_ENV, SERVER_PORT: "99999" })).toThrow();
    expect(() => loadConfig({ PUBLIC_URL: "http://localhost" })).toThrow();
  });

  it("quita la barra final de la dirección pública", () => {
    expect(loadConfig({ ...BASE_ENV, PUBLIC_URL: "http://a.test/" }).PUBLIC_URL).toBe("http://a.test");
  });

  it("en producción exige correo real, cookies Secure y https", () => {
    const prod = { ...BASE_ENV, APP_ENV: "production", PUBLIC_URL: "https://a.test" };
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "console" })).toThrow(/MAIL_TRANSPORT/);
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "smtp", COOKIE_SECURE: "false" })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "smtp", PUBLIC_URL: "http://a.test" })).toThrow(/PUBLIC_URL/);
    expect(loadConfig({ ...prod, MAIL_TRANSPORT: "smtp" }).APP_ENV).toBe("production");
  });

  it("en pruebas permite correo por consola y cookies sin Secure", () => {
    const c = loadConfig({ ...BASE_ENV, APP_ENV: "staging", COOKIE_SECURE: "false" });
    expect(c.MAIL_TRANSPORT).toBe("console");
    expect(c.COOKIE_SECURE).toBe(false);
  });
});

describe("tokens", () => {
  it("son de 43 caracteres base64url y distintos cada vez", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it("el hash es SHA-256 en hexadecimal y no contiene el token", () => {
    const t = generateToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashToken(t));
    expect(h).not.toContain(t);
  });

  it("normaliza el correo", () => {
    expect(normalizeEmail("  Ana@Ejemplo.COM ")).toBe("ana@ejemplo.com");
  });
});

describe("RateLimiter", () => {
  it("permite hasta el máximo y se reinicia al acabar la ventana", () => {
    let now = 0;
    const rl = new RateLimiter(2, 1000, () => now);
    expect(rl.consume("a")).toBe(true);
    expect(rl.consume("a")).toBe(true);
    expect(rl.consume("a")).toBe(false);
    expect(rl.consume("b")).toBe(true);
    now = 1000;
    expect(rl.consume("a")).toBe(true);
  });
});

describe("GET /api/health", () => {
  it("responde que el servidor está vivo sin tocar la base de datos", async () => {
    const app = await buildApp(loadConfig({ ...BASE_ENV, LOG_LEVEL: "silent" }), { db: {} as Database });
    try {
      const res = await app.inject({ method: "GET", url: "/api/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, generatorVersion: GENERATOR_VERSION });
      expect((await app.inject({ method: "GET", url: "/api/no-existe" })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
