import { afterAll, describe, expect, it } from "vitest";
import { GENERATOR_VERSION } from "@imperium/shared";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

describe("configuración", () => {
  it("por defecto escucha solo en la máquina local", () => {
    const config = loadConfig({});
    expect(config.SERVER_HOST).toBe("127.0.0.1");
    expect(config.SERVER_PORT).toBe(3000);
  });

  it("rechaza un puerto no válido", () => {
    expect(() => loadConfig({ SERVER_PORT: "99999" })).toThrow();
  });
});

describe("GET /api/health", () => {
  const app = buildApp(loadConfig({ LOG_LEVEL: "silent" }));
  afterAll(() => app.close());

  it("responde que el servidor está vivo", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.generatorVersion).toBe(GENERATOR_VERSION);
    expect(typeof body.uptimeSeconds).toBe("number");
  });

  it("devuelve 404 en rutas desconocidas", async () => {
    const res = await app.inject({ method: "GET", url: "/api/no-existe" });
    expect(res.statusCode).toBe(404);
  });
});
