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
import { ProbeService } from "./probe/service";
import { MercenaryService } from "./fleet/mercenaries";
import { designRoutes } from "./design/routes";
import { rankingRoutes } from "./ranking/routes";
import { ResearchService } from "./research/service";
import { researchRoutes } from "./research/routes";
import { gateRoutes } from "./gate/routes";
import { MarketService } from "./market/service";
import { inHumanCore } from "./emperor/world";
import { FlagshipService } from "./space/flagship";
import { SpaceService } from "./space/service";
import { DeepSpaceService } from "./space/deep";
import { alienRoutes } from "./ai/routes";
import { AiEmperorService } from "./ai/emperors";
import { AlienService } from "./ai/service";
import { TerritoryService } from "./ai/territory";
import { warRoutes } from "./war/routes";
import { WarService } from "./war/service";
import { SiegeService } from "./war/siege";
import { LineageService, type LineageEffects, type RebirthInfo } from "./lineage/service";
import { createMailer, type Mailer } from "./mail";
import { ipRateKey, RateLimiter } from "./auth/rateLimit";
import { wikiRoutes } from "./wiki/routes";
import { WikiService } from "./wiki/service";

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
    // Al cerrar, corta las conexiones abiertas (los WebSocket de los jugadores no se cierran solos).
    forceCloseConnections: true,
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
  // Sondas de exploración: se compran con créditos y descubren un sistema lejano.
  const probes = new ProbeService(deps.db, config, emperors, humanity);
  // Mercenarios: flotas contratadas con créditos que se marchan al acabar el contrato.
  const mercenaries = new MercenaryService(deps.db, config.TIME_SCALE, emperors, humanity);
  // Niveles de los proyectos comunes: al arrancar (index.ts) o, si no, la primera vez que hagan falta.
  colonies.setBonuses(() => humanity.bonuses());
  colonies.setWallet(humanity);
  const research = new ResearchService(deps.db, config);
  research.setWallet(humanity);
  wars.setShieldFactor((systemId) => (inHumanCore(systemId) ? humanity.bonuses().coreShield : 1));
  const market = new MarketService(deps.db, colonies, humanity);
  // Fase 11: facciones alienígenas (territorio, flotas, comercio y diplomacia básica) con la misma tubería de órdenes.
  const territory = new TerritoryService(deps.db, config);
  const aliens = new AlienService(deps.db, config, territory, fleets, colonies, humanity, (summary) => discoveries.detail(summary));
  // Emperadores humanos de la IA: juegan con las órdenes de un jugador (se crean en index.ts).
  const aiEmperors = new AiEmperorService(deps.db, config, territory, discoveries, fleets, colonies, humanity, market, app.log);
  aliens.market = market;
  wars.setAlienHooks(
    (db, a, b, systemId) => aliens.hostile(db, a, b, systemId),
    (tx, emperorId, factionId) => aliens.onIntercept(tx, emperorId, factionId),
  );
  // Fase 9b: asedios y conquista de planetas (jugadores, facciones alienígenas y Emperadores de la IA).
  const sieges = new SiegeService(deps.db, config, colonies, wars, market);
  sieges.aliens = {
    isActor: (id) => aliens.isActor(id),
    factionOf: (id) => aliens.factionOf(id),
    onSieged: (tx, emperorId, factionId) => aliens.onSieged(tx, emperorId, factionId),
  };
  aliens.sieges = sieges;
  aiEmperors.sieges = sieges;
  const hub = new Hub(emperors, fleets, social, discoveries, colonies, wars, humanity, app.log, config.TIME_SCALE);
  // Nave del Emperador fuera del pilotaje (aparcada) y disposición de los sistemas, que
  // depende de su detalle secreto.
  const flagships = new FlagshipService(deps.db, config, (summary) => discoveries.detail(summary), colonies);
  hub.flagships = flagships;
  emperors.layoutOf = (systemId) => flagships.layout(systemId);
  const space = new SpaceService(flagships, emperors, social, app.log);
  space.onFlagship = (emperorId) => void hub.publishFlagship(emperorId);
  // Espacio profundo: contenido secreto de las regiones y minería de sus asteroides.
  space.deep = new DeepSpaceService(deps.db, config);
  space.onFleetCargo = (emperorId, fleetId) => void hub.publishFleet(emperorId, fleetId);
  // Naves alienígenas en el espacio local: hostilidad de su facción y rencor si se les dispara.
  space.aliens = {
    hostile: (factionId, emperorId) => aliens.isHostileTo(deps.db, factionId, emperorId),
    provoked: (factionId, emperorId) => aliens.onLocalAttack(emperorId, factionId),
  };
  // Naves de flota pilotadas a distancia: su casco vuelve a la flota; si caen, la flota la pierde.
  space.fleetShips = {
    saveHull: async (emperorId, fleetId, shipId, hull) => {
      await fleets.setShipHull(fleetId, shipId, hull);
      await hub.publishFleet(emperorId, fleetId);
    },
    destroyed: async (emperorId, fleetId, shipId) => {
      await fleets.removeShip(fleetId, shipId);
      await hub.publishFleet(emperorId, fleetId);
    },
    escorts: (emperorId, systemId, max) => fleets.escorts(emperorId, systemId, max),
    aliensIn: (systemId, max) => fleets.alienShipsIn(systemId, max),
  };
  // Fase 10: muerte y linaje (Cunas, gestación, Herederos y encarnación).
  const lineage = new LineageService(deps.db, config, colonies, app.log);
  lineage.layoutOf = (systemId) => flagships.layout(systemId);
  lineage.inCombat = (emperorId) => space.inCombat(emperorId);
  hub.lineage = lineage;
  hub.probes = probes;
  aiEmperors.lineage = lineage;
  /** Un Emperador cae: los demás dejan de verlo en el mapa y su dueño ve la gestación. */
  const announceDeath = (emperorId: string) => {
    void hub.publish(emperorId);
    void hub.publishFlagship(emperorId);
    void hub.publishHumans(emperorId);
    void hub.publishLineage(emperorId);
  };
  /** Un Emperador renace (o se encarna): su nave sale de donde estuviera y aparece en el sistema nuevo. */
  const announceRebirth = (info: RebirthInfo, fresh: boolean) => {
    space.relocated(info.emperorId, fresh);
    void hub.publish(info.emperorId);
    void hub.publishFlagship(info.emperorId);
    void hub.publishHumans(info.emperorId);
    void hub.publishLineage(info.emperorId);
    if (info.discovered.length) void hub.publishDiscovered(info.emperorId, info.discovered);
    for (const id of info.colonies) void hub.publishColony(info.emperorId, id);
  };
  const announceLineage = (fx: LineageEffects) => {
    if (fx.rebirth) announceRebirth(fx.rebirth, false);
    void hub.publishLineage(fx.emperorId);
    for (const id of fx.colonies) void hub.publishColony(fx.emperorId, id);
  };
  aiEmperors.onLineage = announceLineage;
  space.onDeath = async (emperorId, systemId, by) => {
    const death = await lineage.die(emperorId, { systemId, cause: "combat", by });
    if (death) announceDeath(emperorId);
    return death;
  };
  wars.flagshipHooks = { liveHull: (id) => space.liveHull(id), die: (tx, id, info) => lineage.dieTx(tx, id, info) };
  hub.onWarFlagships = (fx) => {
    for (const [id, hull] of fx.hulls) space.setHull(id, hull);
    for (const d of fx.deaths) {
      space.kill(d.emperorId, d.by, d.rebornAt, d.systemId);
      announceDeath(d.emperorId);
    }
  };
  // Al reponer la nave cambian las existencias de la colonia.
  space.onColony = (emperorId, colonyId) => void hub.publishColony(emperorId, colonyId);
  hub.sieges = sieges;
  app.addHook("onClose", async () => space.stop());
  // Taller de las naves nodriza: repara las naves de su flota cada minuto.
  const workshop = setInterval(() => {
    void fleets.repairInMotherships().then(
      (list) => {
        for (const f of list) void hub.publishFleet(f.emperorId, f.fleetId);
      },
      (err: unknown) => app.log.error(err, "Error en el taller de las naves nodriza"),
    );
  }, 60_000);
  app.addHook("onClose", async () => clearInterval(workshop));
  // Antes de cerrar conexiones: dejar de difundir y parar la cola de eventos, para que
  // nada use la base de datos mientras se apaga.
  app.addHook("preClose", async () => {
    // Las naves que se pilotaban quedan aparcadas donde estaban.
    await space.flushParks();
    await worker.stop();
    await hub.close();
  });
  app.decorate("space", space);
  app.decorate("flagships", flagships);
  await app.register(emperorRoutes, { config, db: deps.db, emperors, hub });
  aliens.onMarket = (res) => {
    for (const id of res.wallets) void hub.publishWallet(id);
    for (const [colonyId, emperorId] of res.colonies) void hub.publishColony(emperorId, colonyId);
  };
  aiEmperors.onEffects = (fx) => {
    for (const id of fx.colonies) void hub.publishColony(fx.emperorId, id);
    for (const id of fx.fleets) void hub.publishFleet(fx.emperorId, id);
    for (const m of fx.market) aliens.onMarket?.(m);
    for (const s of fx.sieges) hub.publishSiegeFx(s);
  };
  aliens.onSiege = (fx) => hub.publishSiegeFx(fx);
  await app.register(realtimeRoutes, { config, db: deps.db, emperors, fleets, flagships, colonies, logistics, wars, space, hub, humanity, market, aliens, sieges, lineage, onLineage: announceLineage, probes, mercenaries });
  await app.register(humanityRoutes, { config, db: deps.db, emperors, humanity, market });
  await app.register(warRoutes, { config, db: deps.db, emperors, wars, aliens });
  await app.register(alienRoutes, { config, db: deps.db, emperors, discoveries, wars, aliens });
  await app.register(socialRoutes, { config, db: deps.db, emperors, social, hub });
  await app.register(rankingRoutes, { config, db: deps.db, emperors });
  await app.register(researchRoutes, { config, db: deps.db, emperors, research });
  await app.register(discoveryRoutes, { config, db: deps.db, emperors, discoveries });
  // Wiki editable por los administradores (ADMIN_EMAILS).
  const wiki = new WikiService(deps.db);
  await app.register(wikiRoutes, { config, db: deps.db, wiki });
  await app.register(accountRoutes, { config, db: deps.db, hub, space, colonies, humanity, market, sieges, lineage, wiki });
  await app.register(colonyRoutes, { config, db: deps.db, emperors, discoveries, colonies, sieges });
  // Editor de naves: diseños guardados de cada Emperador.
  await app.register(designRoutes, { config, db: deps.db, emperors });
  // Puerta de entrada antes de abrir al público (Caddy la consulta con forward_auth).
  await app.register(gateRoutes, { config });

  // Cola de eventos programados: llegadas de flotas y del Emperador (y, más adelante, construcciones…).
  // Al llegar se descubre lo que cubre el escáner (niebla de guerra).
  const worker = new EventWorker(deps.db, app.log);
  worker.on("fleet.arrive", async (tx, { fleetId }) => {
    await aliens.ensure();
    const owner = await fleets.arrive(tx, fleetId);
    // Las flotas de las facciones alienígenas no descubren nada ni tienen a quién avisar.
    const alien = owner !== null && aliens.isActor(owner);
    const found = alien ? null : await discoveries.fleetArrived(tx, fleetId);
    // Fase 9a: si coincide con flotas hostiles, combate (y la ruta espera a que acabe).
    const war = owner ? await wars.onArrive(tx, fleetId) : null;
    // Fase 11: si llega a territorio alienígena, la región despierta y quizá responde.
    if (owner && !alien) await aliens.onFleetArrived(tx, fleetId);
    // Incursión: a un convoy con ruta fuera del Núcleo le puede caer una partida de Carroñeros.
    const raider = owner && !alien && !war?.inBattle ? await aliens.raidRoute(tx, fleetId) : null;
    const raid = raider ? await wars.onArrive(tx, raider) : null;
    // Combustible: en un sistema con colonia propia, reposta sola (antes de que la ruta la vuelva a sacar).
    const refuel = owner && !alien && !war?.inBattle ? await fleets.refuel(tx, owner, fleetId, colonies, true) : null;
    // Ruta automática: descarga, carga y sale hacia la otra colonia.
    const step = owner && !war?.inBattle && !raid?.fx.fleets.has(fleetId) ? await logistics.onArrive(tx, fleetId) : null;
    return () => {
      if (refuel?.ok && refuel.colonyId && owner) void hub.publishColony(owner, refuel.colonyId);
      if (owner && !alien) void hub.publishFleet(owner, fleetId);
      if (found) void hub.publishDiscovered(found.emperorId, found.systemIds);
      if (step) for (const id of step.colonyIds) void hub.publishColony(step.emperorId, id);
      if (war) hub.publishWar(war.fx);
      if (raid) hub.publishWar(raid.fx);
    };
  });
  // Una ronda de una batalla de flotas: daños, naves destruidas y, quizá, el final.
  worker.on("battle.round", async (tx, { battleId }) => {
    const fx = await wars.round(tx, battleId);
    if (fx)
      return () => {
        hub.publishWar(fx);
        // Una nodriza caída se lleva al Emperador que iba acoplado en ella.
        for (const m of fx.motherships) space.mothershipLost(m.emperorId, m.fleetId);
      };
  });
  worker.on("emperor.arrive", async (tx, { emperorId, systemId }) => {
    const found = await discoveries.emperorArrived(tx, emperorId, systemId);
    if (found) await aliens.onEmperorArrived(tx, emperorId, systemId);
    if (found) return () => void hub.publishDiscovered(found.emperorId, found.systemIds);
  });
  // Fin de una construcción: instalación nueva o flota nueva con la nave construida.
  worker.on("research.done", async (tx, { emperorId }) => {
    await research.complete(tx, emperorId);
  });
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
  // Fase 9b: resolución de un asedio (progreso, daño de las defensas, presencia y ocupación alienígena).
  worker.on("siege.tick", async (tx, { siegeId }) => {
    await aliens.ensure();
    const fx = await sieges.tick(tx, siegeId);
    if (fx) return () => hub.publishSiegeFx(fx);
  });
  // Fase 11: una decisión de la IA de una región alienígena activa.
  // Fase 10: fin de la gestación de un Emperador caído, nacimiento y gobierno de los Herederos.
  worker.on("lineage.rebirth", async (tx, { emperorId }) => {
    const info = await lineage.rebirth(tx, emperorId);
    if (info) return () => announceRebirth(info, true);
  });
  worker.on("heir.born", async (tx, { heirId }) => {
    const fx = await lineage.born(tx, heirId);
    if (fx) return () => announceLineage(fx);
  });
  // Autogestión de las colonias de un jugador por la IA.
  worker.on("colony.govern", async (tx, { emperorId }) => {
    const run = await aiEmperors.governFor(tx, emperorId);
    if (run)
      return () =>
        void run().then(
          (ids) => {
            for (const id of ids) void hub.publishColony(emperorId, id);
          },
          (err: unknown) => app.log.error({ err, emperorId }, "Fallo en la autogestión de colonias"),
        );
  });
  worker.on("mercenary.leave", async (tx, { fleetId }) => {
    const gone = await mercenaries.leave(tx, fleetId);
    if (gone)
      return () => {
        void hub.publishFleet(gone.emperorId, gone.fleetId);
        void hub.publishColonies(gone.emperorId);
      };
  });
  worker.on("probe.arrive", async (tx, { probeId }) => {
    const done = await probes.arrive(tx, probeId);
    if (done)
      return () => {
        void hub.publishProbe(done.emperorId, done.probeId, null);
        if (done.systemIds.length) void hub.publishDiscovered(done.emperorId, done.systemIds);
      };
  });
  worker.on("heir.govern", async (tx, { heirId }) => {
    const run = await lineage.govern(tx, heirId);
    if (run)
      return () =>
        void run().then(
          (fx) => fx && announceLineage(fx),
          (err: unknown) => app.log.error({ err, heirId }, "Fallo en la decisión de un gobernador"),
        );
  });
  worker.on("ai.region", async (tx, { regionKey }) => aliens.tick(tx, regionKey));
  worker.on("ai.raidEnd", async (tx, { fleetId }) => aliens.raidEnd(tx, fleetId));
  worker.on("ai.emperor", async (tx, { emperorId }) => aiEmperors.tick(tx, emperorId));
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
  app.decorate("aliens", aliens);
  app.decorate("aiEmperors", aiEmperors);
  app.decorate("sieges", sieges);
  app.decorate("lineage", lineage);
  app.decorate("mercenaries", mercenaries);
  app.decorate("wars", wars);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    eventWorker: EventWorker;
    colonies: ColonyService;
    space: SpaceService;
    humanity: HumanityService;
    market: MarketService;
    aliens: AlienService;
    aiEmperors: AiEmperorService;
    flagships: FlagshipService;
    sieges: SiegeService;
    lineage: LineageService;
    wars: WarService;
    mercenaries: MercenaryService;
  }
}
