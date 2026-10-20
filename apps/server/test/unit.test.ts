import { describe, expect, it } from "vitest";
import { GENERATOR_VERSION } from "@imperium/shared";
import { buildApp } from "../src/app";
import { emailRateKey, ipRateKey, RateLimiter } from "../src/auth/rateLimit";
import { maskEmail, sessionCookieName } from "../src/auth/routes";
import { generateToken, hashToken, normalizeEmail } from "../src/auth/tokens";
import { DEV_DETAIL_SEED, loadConfig } from "../src/config";
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

  it("en producción exige correo real, cookies Secure, https y semilla de detalle propia", () => {
    const prod = { ...BASE_ENV, APP_ENV: "production", PUBLIC_URL: "https://a.test", DETAIL_SEED: "x".repeat(32) };
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "console" })).toThrow(/MAIL_TRANSPORT/);
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "smtp", COOKIE_SECURE: "false" })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "smtp", PUBLIC_URL: "http://a.test" })).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "smtp", DETAIL_SEED: undefined })).toThrow(/DETAIL_SEED/);
    expect(loadConfig({ ...prod, MAIL_TRANSPORT: "smtp" }).APP_ENV).toBe("production");
    expect(loadConfig({ ...prod, MAIL_TRANSPORT: "smtp" }).DETAIL_SEED).toBe("x".repeat(32));
  });

  it("en pruebas permite correo por consola y cookies sin Secure", () => {
    const c = loadConfig({ ...BASE_ENV, APP_ENV: "staging", COOKIE_SECURE: "false" });
    expect(c.MAIL_TRANSPORT).toBe("console");
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.DETAIL_SEED).toBe(DEV_DETAIL_SEED);
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

  it("con el tope de claves lleno rechaza claves nuevas y libera las caducadas", () => {
    let now = 0;
    const rl = new RateLimiter(5, 1000, () => now, 2);
    expect(rl.consume("a")).toBe(true);
    expect(rl.consume("b")).toBe(true);
    expect(rl.consume("c")).toBe(false);
    expect(rl.consume("a")).toBe(true);
    now = 1000;
    expect(rl.consume("c")).toBe(true);
  });
});

describe("claves de límite", () => {
  it("agrupa IPv6 por /64 y deja IPv4 como están", () => {
    expect(ipRateKey("1.2.3.4")).toBe("1.2.3.4");
    expect(ipRateKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(ipRateKey("2a01:4f8:1:2::5")).toBe("2a01:4f8:1:2::/64");
    expect(ipRateKey("2a01:04f8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2a01:4f8:1:2::/64");
    expect(ipRateKey("2a01:4f8::1")).toBe("2a01:4f8:0:0::/64");
    expect(ipRateKey("::1")).toBe("0:0:0:0::/64");
  });

  it("quita alias +etiqueta y los puntos de Gmail", () => {
    expect(emailRateKey("ana+juego@ejemplo.com")).toBe("ana@ejemplo.com");
    expect(emailRateKey("a.n.a+x@googlemail.com")).toBe("ana@gmail.com");
    expect(emailRateKey("a.na@ejemplo.com")).toBe("a.na@ejemplo.com");
  });

  it("enmascara el correo", () => {
    expect(maskEmail("andrea@ejemplo.com")).toBe("an***@ejemplo.com");
    expect(maskEmail("a@b.com")).toBe("a***@b.com");
  });

  it("la cookie lleva el prefijo __Host- solo con HTTPS", () => {
    expect(sessionCookieName({ COOKIE_SECURE: true })).toBe("__Host-aeon_session");
    expect(sessionCookieName({ COOKIE_SECURE: false })).toBe("aeon_session");
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
