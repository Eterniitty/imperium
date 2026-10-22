import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  WS_CLOSE,
  type ApiError,
  type ServerMessage,
  type WsTicketResponse,
} from "@imperium/shared";
import { ClientMessageSchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { ColonyService } from "../colony/service";
import type { LogisticsService } from "../logistics/service";
import type { Database } from "../db/client";
import type { EmperorService } from "../emperor/service";
import type { FleetService } from "../fleet/service";
import type { SpaceService } from "../space/service";
import type { FlagshipService } from "../space/flagship";
import type { WarService } from "../war/service";
import type { HumanityService } from "../humanity/service";
import type { ProbeService } from "../probe/service";
import type { MercenaryService } from "../fleet/mercenaries";
import { FLAGSHIP_DOCK } from "@imperium/content";
import { fleetRallyPoint, fleetSlotPosition } from "@imperium/sim";
import type { MarketService } from "../market/service";
import type { AlienService } from "../ai/service";
import type { SiegeService } from "../war/siege";
import type { LineageEffects, LineageService } from "../lineage/service";
import type { Client, Hub } from "./hub";
import { TicketStore } from "./tickets";

export interface RealtimeDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  fleets: FleetService;
  colonies: ColonyService;
  logistics: LogisticsService;
  wars: WarService;
  space: SpaceService;
  /** Nave del Emperador fuera del pilotaje (bodega: descargar en una colonia). */
  flagships: FlagshipService;
  hub: Hub;
  humanity: HumanityService;
  market: MarketService;
  /** Fase 11: facciones alienígenas (tributos y rencor al colonizar su territorio). */
  aliens?: AlienService;
  /** Fase 9b: asedios y conquista de planetas. */
  sieges?: SiegeService;
  /** Fase 10: muerte y linaje (Cunas, Herederos, encarnación) y cómo difundir sus cambios. */
  lineage?: LineageService;
  onLineage?: (fx: LineageEffects) => void;
  /** Sondas de exploración. */
  probes?: ProbeService;
  mercenaries?: MercenaryService;
}

const MINUTE = 60_000;
const HEARTBEAT_MS = 30_000;
/** Conexiones simultáneas: por cuenta (varias pestañas) y en total. */
const MAX_CONNECTIONS_PER_ACCOUNT = 5;
const MAX_CONNECTIONS = 1_000;

export async function realtimeRoutes(app: FastifyInstance, { config, db, emperors, fleets, flagships, colonies, logistics, wars, space, hub, humanity, market, aliens, sieges, lineage, onLineage, probes , mercenaries }: RealtimeDeps) {
  const cookieName = sessionCookieName(config);
  const tickets = new TicketStore();
  const ticketsPerAccount = new RateLimiter(30, MINUTE);
  // Mensajes por cuenta: holgado para jugar, corto para abusar.
  const messagesPerAccount = new RateLimiter(60, 10_000);
  // Las posiciones al pilotar van aparte: unas 8 por segundo, con margen.
  const posesPerAccount = new RateLimiter(25, 1_000);
  // Disparos: el cañón dispara 5 veces por segundo; el servidor aplica la cadencia real de cada arma.
  const shotsPerAccount = new RateLimiter(15, 1_000);
  // Solo se aceptan conexiones abiertas desde la propia web del juego: otra web
  // no puede abrir un WebSocket en nombre del jugador.
  const allowedOrigin = new URL(config.PUBLIC_URL).origin;

  await app.register(websocket, { options: { maxPayload: MAX_CLIENT_MESSAGE_BYTES } });

  app.post("/api/ws/ticket", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return reply.code(401).send({ error: "unauthenticated" } satisfies ApiError);
    if (!ticketsPerAccount.consume(account.id)) return reply.code(429).send({ error: "rate_limited" } satisfies ApiError);
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return reply.code(404).send({ error: "no_emperor" } satisfies ApiError);
    const ticket = tickets.issue({ accountId: account.id, emperorId: emperor.id });
    if (!ticket) return reply.code(429).send({ error: "rate_limited" } satisfies ApiError);
    return { ticket } satisfies WsTicketResponse;
  });

  // Los clientes que no responden al ping en un ciclo se dan por caídos.
  const alive = new WeakMap<WebSocket, boolean>();
  const sockets = new Set<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    for (const ws of sockets) ws.close(1001, "server shutdown");
  });

  app.get<{ Querystring: { ticket?: string; v?: string } }>(
    "/ws",
    {
      websocket: true,
      // Todo se comprueba antes de aceptar la conexión: un rechazo es un simple HTTP 4xx.
      preValidation: async (req, reply) => {
        if (req.headers.origin !== allowedOrigin) return reply.code(403).send({ error: "invalid_request" } satisfies ApiError);
        if (req.query.v !== String(PROTOCOL_VERSION)) return reply.code(400).send({ error: "invalid_request" } satisfies ApiError);
        const owner = req.query.ticket ? tickets.consume(req.query.ticket) : null;
        if (!owner) return reply.code(401).send({ error: "unauthenticated" } satisfies ApiError);
        if (hub.connectionCount >= MAX_CONNECTIONS || hub.connectionsOf(owner.accountId) >= MAX_CONNECTIONS_PER_ACCOUNT) {
          return reply.code(429).send({ error: "rate_limited" } satisfies ApiError);
        }
        req.ticketOwner = owner;
      },
    },
    (socket, req) => {
      const owner = req.ticketOwner!;
      const client: Client = {
        ...owner,
        subscribed: new Set(),
        known: new Set(),
        send: (msg: ServerMessage) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
        },
        close: (code, reason) => socket.close(code, reason),
      };
      sockets.add(socket);
      alive.set(socket, true);
      socket.on("pong", () => alive.set(socket, true));
      hub.add(client);

      socket.on("message", (data, isBinary) => {
        let parsed: ReturnType<typeof ClientMessageSchema.safeParse> | null = null;
        try {
          if (!isBinary) parsed = ClientMessageSchema.safeParse(JSON.parse(data.toString()));
        } catch {
          // JSON no válido: se trata igual que un mensaje mal formado.
        }
        if (!parsed?.success) return socket.close(WS_CLOSE.protocol, "invalid message");

        const msg = parsed.data;
        const limiter = msg.t === "pose" ? posesPerAccount : msg.t === "fire" || msg.t === "mine" ? shotsPerAccount : messagesPerAccount;
        if (!limiter.consume(owner.accountId)) return socket.close(WS_CLOSE.rateLimited, "rate limited");
        switch (msg.t) {
          case "pose":
            void space.pose(client, msg.systemId, { p: msg.p, q: msg.q, v: msg.v }).catch((err: unknown) => req.log.error(err, "Error en una posición"));
            return;
          case "leave":
            space.leaveClient(client);
            return;
          case "fire":
            space.fire(client, msg.weapon, msg.dir, msg.target);
            return;
          case "rift":
            space.rift(client, { phase: msg.phase, at: msg.at, q: msg.q });
            return;
          case "mine":
            space.mine(client, msg.asteroid);
            return;
          case "sub":
            void hub.subscribe(client, msg.topic);
            return;
          case "cmd":
            void hub
              .command(client, msg.cmdId, async () => {
                switch (msg.op) {
                  // Economía de la humanidad y mercado global (ver humanity/ y market/).
                  case "market.order":
                  case "market.cancel": {
                    const res = msg.op === "market.order" ? await market.place(owner.emperorId, msg.args) : await market.cancel(owner.emperorId, msg.args.orderId);
                    if (res.ok) {
                      for (const id of res.wallets) await hub.publishWallet(id);
                      for (const [colonyId, emperorId] of res.colonies) await hub.publishColony(emperorId, colonyId);
                    }
                    return res;
                  }
                  case "humanity.contribute": {
                    const res = await humanity.contribute(owner.emperorId, msg.args);
                    if (res.ok) {
                      await hub.publishWallet(res.emperorId);
                      if (res.colonyId) await hub.publishColony(res.emperorId, res.colonyId);
                    }
                    return res;
                  }
                  case "emperor.move": {
                    // El salto gasta combustible: primero se guarda el que lleva la nave en memoria.
                    await space.flushSupplies(owner.emperorId);
                    // Memoria de posición: dónde está ahora la nave (y el compañero junto al que se quiere llegar), en vivo.
                    const near = msg.args.near ?? null;
                    const res = await emperors.move(owner.accountId, msg.args.systemId, {
                      here: space.positionOf(owner.emperorId),
                      near,
                      nearLive: near ? space.positionOf(near) : null,
                    });
                    if (res.ok) {
                      // Al saltar, la nave deja el sistema en el que volaba (y su combustible cambió en la base de datos).
                      space.leave(res.emperor.id, "jump");
                      space.suppliesChanged(res.emperor.id);
                      await hub.publish(res.emperor.id);
                      // Dónde aparecerá al llegar (borde del destino).
                      await hub.publishFlagship(res.emperor.id);
                    }
                    return res;
                  }
                  // Espacio profundo: salir del túnel a mitad de viaje (ver emperor/service.ts drop).
                  case "emperor.drop": {
                    const res = await emperors.drop(owner.accountId);
                    if (res.ok) {
                      space.suppliesChanged(res.emperor.id);
                      await hub.publish(res.emperor.id);
                      await hub.publishFlagship(res.emperor.id);
                      if (res.discovered.length) await hub.publishDiscovered(res.emperor.id, res.discovered);
                    }
                    return res;
                  }
                  // Bodega de la nave: descargar en una colonia propia del sistema y refinería de a bordo.
                  case "flagship.unload": {
                    await space.flushSupplies(owner.emperorId);
                    const res = await flagships.unload(owner.emperorId, msg.args.colonyId);
                    if (res.ok) {
                      space.holdChanged(owner.emperorId);
                      await hub.publishFlagship(owner.emperorId);
                      await hub.publishColony(owner.emperorId, msg.args.colonyId);
                    }
                    return res.ok ? ({ ok: true } as const) : res;
                  }
                  case "flagship.jettison": {
                    const r = msg.args.resource;
                    const res = await flagships.updateHold(owner.emperorId, (hold) => ((hold[r] ?? 0) > 1e-6 ? { hold: { ...hold, [r]: 0 }, result: true } : null));
                    if (!res) return { ok: false, error: "hold_empty" } as const;
                    space.holdChanged(owner.emperorId);
                    await hub.publishFlagship(owner.emperorId);
                    return { ok: true } as const;
                  }
                  case "flagship.refine": {
                    await space.setRefining(owner.emperorId, msg.args.on);
                    return { ok: true } as const;
                  }
                  case "fleet.refuel": {
                    const res = await db.transaction((tx) => fleets.refuel(tx, owner.emperorId, msg.args.fleetId, colonies));
                    if (!res.ok) return res;
                    await hub.publishFleet(owner.emperorId, msg.args.fleetId);
                    if (res.colonyId) await hub.publishColony(owner.emperorId, res.colonyId);
                    return { ok: true } as const;
                  }
                  case "fleet.move": {
                    // Viaje acoplado: si la nave del Emperador va en el hangar de esta flota, viaja con ella.
                    const carried = space.dockedFleet(owner.emperorId) === msg.args.fleetId;
                    const here = carried ? space.positionOf(owner.emperorId) : null;
                    if (carried) await space.flushSupplies(owner.emperorId);
                    const res = await fleets.move(owner.emperorId, msg.args.fleetId, msg.args.systemId);
                    if (res.ok && carried && res.fleet.travel) {
                      const dest = res.fleet.travel.to.systemId;
                      const arriveAt = res.fleet.travel.arriveAt;
                      const slot = await fleets.arrivalSlot(owner.emperorId, res.fleet.id, dest);
                      const layout = flagships.layout(dest);
                      const at = layout ? fleetSlotPosition(fleetRallyPoint(layout, slot.colonyPlanet, arriveAt), slot.slot) : null;
                      const ride = await emperors.move(owner.accountId, dest, { here, withFleet: { arriveAt, at } });
                      if (ride.ok) {
                        space.expectDock(ride.emperor.id, { systemId: dest, fleetId: res.fleet.id, slot: slot.slot, colonyPlanet: slot.colonyPlanet });
                        space.leave(ride.emperor.id, "jump");
                        space.suppliesChanged(ride.emperor.id);
                        await hub.publish(ride.emperor.id);
                        await hub.publishFlagship(ride.emperor.id);
                      }
                    }
                    if (res.ok) {
                      space.releaseFleet(res.fleet.id);
                      // Una orden de viaje a mano saca a la flota de su ruta automática (y de su batalla: huye).
                      await logistics.clearRoute(owner.emperorId, res.fleet.id);
                      await hub.publishFleet(res.emperorId, res.fleet.id);
                      if (res.fledBattleId) await hub.publishBattle(res.fledBattleId);
                    }
                    return res;
                  }
                  // Fase 9a: interceptar una flota enemiga en tránsito (ver war/service.ts).
                  case "fleet.intercept": {
                    const res = await wars.intercept(owner.emperorId, msg.args.fleetId, msg.args.targetFleetId);
                    if (res.ok) {
                      space.releaseFleet(res.fleet.id);
                      await logistics.clearRoute(owner.emperorId, res.fleet.id);
                      await hub.publishFleet(res.emperorId, res.fleet.id);
                      if (res.fledBattleId) await hub.publishBattle(res.fledBattleId);
                    }
                    return res;
                  }
                  // Fase 11: tributo a una facción alienígena (diplomacia básica, ver ai/service.ts).
                  case "alien.tribute": {
                    if (!aliens) return { ok: false, error: "unknown_faction" } as const;
                    const res = await aliens.tribute(owner.emperorId, msg.args.factionId, msg.args.credits);
                    if (res.ok) await hub.publishWallet(res.emperorId);
                    return res;
                  }
                  // Fase 9b: asedio, desembarco y captura (ver war/siege.ts).
                  case "siege.raze": {
                    if (!sieges) return { ok: false, error: "no_siege" } as const;
                    const res = await sieges.raze(owner.emperorId, msg.args.siegeId, msg.args.installationId);
                    if (res.ok) hub.publishSiegeFx(res.fx);
                    return res;
                  }
                  case "siege.start":
                  case "siege.lift":
                  case "siege.assault": {
                    if (!sieges) return { ok: false, error: "no_siege" } as const;
                    const res =
                      msg.op === "siege.start"
                        ? await sieges.start(owner.emperorId, msg.args.colonyId)
                        : msg.op === "siege.lift"
                          ? await sieges.lift(owner.emperorId, msg.args.siegeId)
                          : await sieges.assault(owner.emperorId, msg.args.siegeId, msg.args.fleetId, msg.args.troops);
                    if (res.ok) hub.publishSiegeFx(res.fx);
                    return res;
                  }
                  // Fase 10: muerte y linaje (ver lineage/service.ts).
                  case "lineage.prefer":
                  case "heir.gestate":
                  case "heir.doctrine":
                  case "heir.assign":
                  case "heir.incarnate": {
                    if (!lineage) return { ok: false, error: "invalid_command" } as const;
                    const id = owner.emperorId;
                    let res: Awaited<ReturnType<LineageService["prefer"]>>;
                    if (msg.op === "lineage.prefer") res = await lineage.prefer(id, msg.args.colonyId);
                    else if (msg.op === "heir.gestate") res = await lineage.gestate(id, msg.args.colonyId, msg.args.doctrine);
                    else if (msg.op === "heir.doctrine") res = await lineage.setDoctrine(id, msg.args.heirId, msg.args.doctrine, msg.args.builds);
                    else if (msg.op === "heir.assign") res = await lineage.assign(id, msg.args.heirId, msg.args.colonyId);
                    else {
                      // Lo que lleva la nave en memoria se guarda antes: viaja con el Emperador.
                      await space.flushSupplies(id);
                      res = await lineage.incarnate(id, msg.args.heirId);
                    }
                    if (res.ok) onLineage?.(res.fx);
                    return res.ok ? { ok: true } : res;
                  }
                  // Fase 8: logística (ver logistics/service.ts).
                  case "fleet.transfer": {
                    const a = msg.args;
                    const res = await logistics.transfer(owner.emperorId, a.fleetId, a.colonyId, a.direction, a.amounts);
                    if (res.ok) {
                      await hub.publishFleet(res.emperorId, res.fleetId);
                      await hub.publishColony(res.emperorId, res.colonyId);
                    }
                    return res;
                  }
                  case "fleet.route": {
                    const { fleetId, ...route } = msg.args;
                    const res = await logistics.setRoute(owner.emperorId, fleetId, route);
                    if (res.ok) {
                      await hub.publishFleet(res.emperorId, res.fleetId);
                      for (const id of res.colonyIds) await hub.publishColony(res.emperorId, id);
                    }
                    return res;
                  }
                  case "escort.cruise": {
                    const error = space.setEscortCruise(client, msg.args.on);
                    return error ? ({ ok: false, error } as const) : ({ ok: true } as const);
                  }
                  case "escort.order": {
                    const error = space.orderEscorts(client, msg.args.order, msg.args.targetId ?? null);
                    return error ? ({ ok: false, error } as const) : ({ ok: true } as const);
                  }
                  case "flagship.dock": {
                    const systemId = space.pilotingIn(client);
                    if (!systemId) return { ok: false, error: "too_far" } as const;
                    const info = await fleets.dockInfo(owner.emperorId, msg.args.fleetId, systemId);
                    if (!info.ok) return info;
                    const error = space.dock(client, msg.args.fleetId, info.slot, info.colonyPlanet, FLAGSHIP_DOCK.rangeM + info.lengthM);
                    return error ? ({ ok: false, error } as const) : ({ ok: true } as const);
                  }
                  case "help.call": {
                    const res = space.callHelp(client);
                    if (!res.ok) return res;
                    hub.sendToEmperors(res.allies, { t: "helpCall", from: owner.emperorId, name: res.name, systemId: res.systemId, serverTime: Date.now() });
                    return { ok: true } as const;
                  }
                  case "flagship.undock": {
                    space.undock(client);
                    return { ok: true } as const;
                  }
                  case "emperor.friendlyFire": {
                    await emperors.setFriendlyFire(owner.emperorId, msg.args.on);
                    space.setFriendlyFire(owner.emperorId, msg.args.on);
                    await hub.publish(owner.emperorId);
                    return { ok: true } as const;
                  }
                  case "colony.autoGovern": {
                    await emperors.setAutoGovern(owner.emperorId, msg.args.on);
                    await hub.publish(owner.emperorId);
                    return { ok: true } as const;
                  }
                  case "probe.launch": {
                    if (!probes) return { ok: false, error: "invalid_command" } as const;
                    const res = await probes.launch(owner.emperorId, msg.args.systemId);
                    if (res.ok) {
                      await hub.publishProbe(res.emperorId, res.probe.id, res.probe);
                      await hub.publishWallet(res.emperorId);
                    }
                    return res;
                  }
                  case "mercenary.hire": {
                    if (!mercenaries) return { ok: false, error: "invalid_command" } as const;
                    const res = await mercenaries.hire(owner.emperorId, msg.args.offerId);
                    if (res.ok) {
                      await hub.publishFleet(res.emperorId, res.fleetId);
                      await hub.publishWallet(res.emperorId);
                    }
                    return res;
                  }
                  case "fleet.pilot": {
                    const res = await fleets.pilotable(owner.emperorId, msg.args.fleetId, msg.args.shipId);
                    if (!res.ok) return res;
                    space.startRemote(client, res.pilot);
                    return { ok: true } as const;
                  }
                  case "fleet.tactic": {
                    const ok = await fleets.setTactic(owner.emperorId, msg.args.fleetId, msg.args.tactic);
                    if (!ok) return { ok: false, error: "no_fleet" } as const;
                    await hub.publishFleet(owner.emperorId, msg.args.fleetId);
                    return { ok: true } as const;
                  }
                  case "fleet.routeStop": {
                    const ok = await logistics.clearRoute(owner.emperorId, msg.args.fleetId);
                    if (!ok) return { ok: false, error: "no_fleet" } as const;
                    await hub.publishFleet(owner.emperorId, msg.args.fleetId);
                    return { ok: true } as const;
                  }
                  // Fase 7: colonias (ver colony/service.ts).
                  case "colony.claim": {
                    const res = await colonies.claim(owner.emperorId, msg.args);
                    // Colonizar territorio alienígena despierta a su facción y le suma rencor.
                    if (res.ok && aliens) await aliens.onColonyClaimed(res.emperorId, msg.args.systemId);
                    if (res.ok) {
                      // Red de suministro: la colonia nueva puede unir (o no) a otras.
                      await colonies.refreshSupply(res.emperorId).catch(() => undefined);
                      // Todas sus colonias: la capital puede haber cambiado de mantenimiento (colonizador gastado).
                      await hub.publishColonies(res.emperorId);
                      await hub.publishColony(res.emperorId, res.colonyId);
                      if (res.fleetId) await hub.publishFleet(res.emperorId, res.fleetId);
                      else await hub.publishHumans(res.emperorId);
                    }
                    return res;
                  }
                  case "colony.rename": {
                    const res = await colonies.rename(owner.emperorId, msg.args.colonyId, msg.args.name);
                    if (res.ok) await hub.publishColony(res.emperorId, res.colonyId);
                    return res;
                  }
                  case "colony.build": {
                    const res = await colonies.build(owner.emperorId, msg.args.colonyId, msg.args.kind, msg.args.itemId);
                    if (res.ok) await hub.publishColony(res.emperorId, res.colonyId);
                    return res;
                  }
                  case "colony.cancel": {
                    const res = await colonies.cancel(owner.emperorId, msg.args.colonyId, msg.args.buildId);
                    if (res.ok) await hub.publishColony(res.emperorId, res.colonyId);
                    return res;
                  }
                  case "colony.demolish": {
                    const res = await colonies.demolish(owner.emperorId, msg.args.colonyId, msg.args.installationId);
                    // El mantenimiento de la capital puede cambiar: todas sus colonias.
                    if (res.ok) await hub.publishColonies(res.emperorId);
                    return res;
                  }
                  case "colony.disembark": {
                    const res = await colonies.disembark(owner.emperorId, msg.args.colonyId, msg.args.humans);
                    if (res.ok) {
                      await hub.publishColony(res.emperorId, res.colonyId);
                      await hub.publishHumans(res.emperorId);
                    }
                    return res;
                  }
                  case "colony.embark": {
                    const res = await colonies.embark(owner.emperorId, msg.args.colonyId, msg.args.humans);
                    if (res.ok) {
                      await hub.publishColony(res.emperorId, res.colonyId);
                      await hub.publishHumans(res.emperorId);
                    }
                    return res;
                  }
                }
              })
              .then((ack) => client.send(ack));
            return;
        }
      });

      socket.on("close", () => {
        sockets.delete(socket);
        space.leaveClient(client);
        hub.remove(client);
      });
    },
  );
}

declare module "fastify" {
  interface FastifyRequest {
    /** Dueño del ticket con el que se abrió el WebSocket. */
    ticketOwner?: import("./tickets").TicketOwner;
  }
}
