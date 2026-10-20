import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { GENERATOR_VERSION, type ApiError, type HealthResponse } from "@imperium/shared";
import { authRoutes } from "./auth/routes";
import type { ServerConfig } from "./config";
import type { Database } from "./db/client";
import { emperorRoutes } from "./emperor/routes";
import { EmperorService } from "./emperor/service";
import { EventWorker } from "./events/queue";
import { FleetService } from "./fleet/service";
import { Hub } from "./realtime/hub";
import { realtimeRoutes } from "./realtime/routes";
import { socialRoutes } from "./social/routes";
import { SocialService } from "./social/service";
import { createMailer, type Mailer } from "./mail";

/** Versión del servidor; la inyecta esbuild al compilar y en desarrollo vale "dev". */
declare const __SERVER_VERSION__: string | undefined;
const SERVER_VERSION = typeof __SERVER_VERSION__ === "string" ? __SERVER_VERSION__ : "dev";

export interface AppDeps {
  db: Database;
  /** Permite sustituir el correo en los tests. */
  mailer?: Mailer;
  /** Los tests pueden procesar la cola a mano (`app.eventWorker.drain()`) en vez de arrancar el trabajador. */
  startWorker?: boolean;
}

/**
 * Construye la aplicación sin ponerla a escuchar, para poder probarla con
 * `app.inject()` en los tests.
 */
export async function buildApp(config: ServerConfig, deps: AppDeps) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Solo Caddy, en la misma máquina, puede indicar la IP real del cliente.
    trustProxy: "127.0.0.1",
    // Las órdenes son pequeñas; un cuerpo grande es un error o un abuso.
    bodyLimit: 64 * 1024,
  });

  // Solo se aceptan cuerpos JSON. text/plain se puede enviar desde un formulario
  // de otra web sin permiso del navegador (CSRF), así que se desactiva.
  app.removeContentTypeParser("text/plain");

  // Los errores internos no muestran detalles al cliente; los de validación de
  // Fastify (JSON mal formado, tipo de contenido) se responden como petición no válida.
  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    const error: ApiError["error"] = status === 429 ? "rate_limited" : status < 500 ? "invalid_request" : "internal";
    return reply.code(status).send({ error } satisfies ApiError);
  });

  await app.register(cookie);

  const startedAt = Date.now();

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    ok: true,
    version: SERVER_VERSION,
    generatorVersion: GENERATOR_VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }));

  await app.register(authRoutes, {
    config,
    db: deps.db,
    mailer: deps.mailer ?? createMailer(config, app.log),
  });

  const emperors = new EmperorService(deps.db, config);
  const fleets = new FleetService(deps.db, config);
  const social = new SocialService(deps.db);
  const hub = new Hub(emperors, fleets, social, app.log, config.TIME_SCALE);
  await app.register(emperorRoutes, { config, db: deps.db, emperors, hub });
  await app.register(realtimeRoutes, { config, db: deps.db, emperors, fleets, hub });
  await app.register(socialRoutes, { config, db: deps.db, emperors, social, hub });

  // Cola de eventos programados: llegadas de flotas (y, más adelante, construcciones…).
  const worker = new EventWorker(deps.db, app.log);
  worker.on("fleet.arrive", async (tx, { fleetId }) => {
    const owner = await fleets.arrive(tx, fleetId);
    if (owner) return () => void hub.publishFleet(owner, fleetId);
  });
  if (deps.startWorker !== false) {
    app.addHook("onReady", async () => worker.start());
    app.addHook("onClose", async () => worker.stop());
  }
  app.decorate("eventWorker", worker);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    eventWorker: EventWorker;
  }
}
