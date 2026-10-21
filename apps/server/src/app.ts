import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { GENERATOR_VERSION, type ApiError, type HealthResponse } from "@imperium/shared";
import { accountRoutes } from "./account/routes";
import { authRoutes } from "./auth/routes";
import type { ServerConfig } from "./config";
import type { Database } from "./db/client";
import { colonyRoutes } from "./colony/routes";
import { ColonyService } from "./colony/service";
import { discoveryRoutes } from "./discovery/routes";
import { DiscoveryService } from "./discovery/service";
import { emperorRoutes } from "./emperor/routes";
import { EmperorService } from "./emperor/service";
import { EventWorker } from "./events/queue";
import { FleetService } from "./fleet/service";
import { Hub } from "./realtime/hub";
import { realtimeRoutes } from "./realtime/routes";
import { socialRoutes } from "./social/routes";
import { SocialService } from "./social/service";
import { LogisticsService } from "./logistics/service";
import { humanityRoutes } from "./humanity/routes";
import { HumanityService } from "./humanity/service";
import { MarketService } from "./market/service";
import { inHumanCore } from "./emperor/world";
import { SpaceService } from "./space/service";
import { warRoutes } from "./war/routes";
import { WarService } from "./war/service";
import { createMailer, type Mailer } from "./mail";
import { ipRateKey, RateLimiter } from "./auth/rateLimit";

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

  // Tope general por IP para toda la API, antes de tocar la base de datos: frena
  // las avalanchas contra rutas sin límite propio (p. ej. consultar la sesión).
  const apiPerIp = new RateLimiter(config.API_REQUESTS_PER_IP_MINUTE, 60_000);
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (!apiPerIp.consume(ipRateKey(req.ip))) return reply.code(429).send({ error: "rate_limited" } satisfies ApiError);
  });

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
  const discoveries = new DiscoveryService(deps.db, config);
  const colonies = new ColonyService(deps.db, config, (summary) => discoveries.detail(summary));
  const logistics = new LogisticsService(deps.db, config, colonies, fleets);
  const wars = new WarService(deps.db, config, fleets, colonies, logistics);
  // Economía de la humanidad (créditos, tesoro del Núcleo, proyectos comunes) y mercado global.
  const humanity = new HumanityService(deps.db, config, colonies);
  // Niveles de los proyectos comunes: al arrancar (index.ts) o, si no, la primera vez que hagan falta.
  colonies.setBonuses(() => humanity.bonuses());
  wars.setShieldFactor((systemId) => (inHumanCore(systemId) ? humanity.bonuses().coreShield : 1));
  const market = new MarketService(deps.db, colonies, humanity);
  const hub = new Hub(emperors, fleets, social, discoveries, colonies, wars, humanity, app.log, config.TIME_SCALE);
  const space = new SpaceService(
    config,
    emperors,
    social,
    app.log,
    (emperorId) => void hub.publish(emperorId),
    // El borde del sistema depende de su detalle, que se genera con la semilla secreta.
    (summary) => discoveries.detail(summary),
  );
  app.addHook("onClose", async () => space.stop());
  // Antes de cerrar conexiones: dejar de difundir y parar la cola de eventos, para que
  // nada use la base de datos mientras se apaga.
  app.addHook("preClose", async () => {
    await worker.stop();
    await hub.close();
  });
  app.decorate("space", space);
  await app.register(emperorRoutes, { config, db: deps.db, emperors, hub });
  await app.register(realtimeRoutes, { config, db: deps.db, emperors, fleets, colonies, logistics, wars, space, hub, humanity, market });
  await app.register(humanityRoutes, { config, db: deps.db, emperors, humanity, market });
  await app.register(warRoutes, { config, db: deps.db, emperors, wars });
  await app.register(socialRoutes, { config, db: deps.db, emperors, social, hub });
  await app.register(discoveryRoutes, { config, db: deps.db, emperors, discoveries });
  await app.register(accountRoutes, { config, db: deps.db, hub, space, colonies, humanity, market });
  await app.register(colonyRoutes, { config, db: deps.db, emperors, discoveries, colonies });

  // Cola de eventos programados: llegadas de flotas y del Emperador (y, más adelante, construcciones…).
  // Al llegar se descubre lo que cubre el escáner (niebla de guerra).
  const worker = new EventWorker(deps.db, app.log);
  worker.on("fleet.arrive", async (tx, { fleetId }) => {
    const owner = await fleets.arrive(tx, fleetId);
    const found = await discoveries.fleetArrived(tx, fleetId);
    // Fase 9a: si coincide con flotas hostiles, combate (y la ruta espera a que acabe).
    const war = owner ? await wars.onArrive(tx, fleetId) : null;
    // Ruta automática: descarga, carga y sale hacia la otra colonia.
    const step = owner && !war?.inBattle ? await logistics.onArrive(tx, fleetId) : null;
    return () => {
      if (owner) void hub.publishFleet(owner, fleetId);
      if (found) void hub.publishDiscovered(found.emperorId, found.systemIds);
      if (step) for (const id of step.colonyIds) void hub.publishColony(step.emperorId, id);
      if (war) hub.publishWar(war.fx);
    };
  });
  // Una ronda de una batalla de flotas: daños, naves destruidas y, quizá, el final.
  worker.on("battle.round", async (tx, { battleId }) => {
    const fx = await wars.round(tx, battleId);
    if (fx) return () => hub.publishWar(fx);
  });
  worker.on("emperor.arrive", async (tx, { emperorId, systemId }) => {
    const found = await discoveries.emperorArrived(tx, emperorId, systemId);
    if (found) return () => void hub.publishDiscovered(found.emperorId, found.systemIds);
  });
  // Fin de una construcción: instalación nueva o flota nueva con la nave construida.
  worker.on("colony.build", async (tx, { buildId }) => {
    const done = await colonies.completeBuild(tx, buildId);
    if (!done) return;
    return () => {
      void hub.publishColony(done.emperorId, done.colonyId);
      // La capital paga el mantenimiento de la nave nueva: sus tasas han cambiado.
      if (done.capitalId) void hub.publishColony(done.emperorId, done.capitalId);
      if (done.fleetId) void hub.publishFleet(done.emperorId, done.fleetId);
      if (done.discovered) void hub.publishDiscovered(done.discovered.emperorId, done.discovered.systemIds);
    };
  });
  // Economía de la humanidad: recálculo periódico de cada cartera (renta según la población).
  worker.on("economy.settle", async (tx, { emperorId }) => {
    const res = await humanity.onSettle(tx, emperorId);
    if (res) return () => {
      if (res.leveled) void humanity.reload();
      if (res.changed) void hub.publishWallet(emperorId);
    };
  });
  // Llega un envío del Núcleo: una compra a su colonia o un aporte a un proyecto común.
  worker.on("shipment.arrive", async (tx, { shipmentId }) => {
    const done = await market.arrive(tx, shipmentId);
    return () => {
      void humanity.reload();
      if (done) void hub.publishColony(done.emperorId, done.colonyId);
    };
  });
  // El tesoro ya debería poder pagar un proyecto que tiene todos sus recursos.
  worker.on("humanity.fund", async (tx, { projectId }) => {
    if (await humanity.onFund(tx, projectId)) return () => void humanity.reload();
  });
  if (deps.startWorker !== false) {
    app.addHook("onReady", async () => worker.start());
    app.addHook("onClose", async () => worker.stop());
  }
  app.decorate("eventWorker", worker);
  app.decorate("colonies", colonies);
  app.decorate("humanity", humanity);
  app.decorate("market", market);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    eventWorker: EventWorker;
    colonies: ColonyService;
    space: SpaceService;
    humanity: HumanityService;
    market: MarketService;
  }
}
