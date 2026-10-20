import Fastify from "fastify";
import { GENERATOR_VERSION, type HealthResponse } from "@imperium/shared";
import type { ServerConfig } from "./config";

/** Versión del servidor; la inyecta esbuild al compilar y en desarrollo vale "dev". */
declare const __SERVER_VERSION__: string | undefined;
const SERVER_VERSION = typeof __SERVER_VERSION__ === "string" ? __SERVER_VERSION__ : "dev";

/**
 * Construye la aplicación sin ponerla a escuchar, para poder probarla con
 * `app.inject()` en los tests.
 */
export function buildApp(config: ServerConfig) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Solo Caddy, en la misma máquina, puede indicar la IP real del cliente.
    trustProxy: "127.0.0.1",
    // Las órdenes son pequeñas; un cuerpo grande es un error o un abuso.
    bodyLimit: 64 * 1024,
  });

  const startedAt = Date.now();

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    ok: true,
    version: SERVER_VERSION,
    generatorVersion: GENERATOR_VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }));

  return app;
}
