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
import type { WarService } from "../war/service";
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
  hub: Hub;
}

const MINUTE = 60_000;
const HEARTBEAT_MS = 30_000;
/** Conexiones simultáneas: por cuenta (varias pestañas) y en total. */
const MAX_CONNECTIONS_PER_ACCOUNT = 5;
const MAX_CONNECTIONS = 1_000;

export async function realtimeRoutes(app: FastifyInstance, { config, db, emperors, fleets, colonies, logistics, wars, space, hub }: RealtimeDeps) {
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
        const limiter = msg.t === "pose" ? posesPerAccount : msg.t === "fire" ? shotsPerAccount : messagesPerAccount;
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
          case "sub":
            void hub.subscribe(client, msg.topic);
            return;
          case "cmd":
            void hub
              .command(client, msg.cmdId, async () => {
                switch (msg.op) {
                  case "emperor.move": {
                    const res = await emperors.move(owner.accountId, msg.args.systemId);
                    if (res.ok) {
                      // Al saltar, la nave deja el sistema en el que volaba.
                      space.leave(res.emperor.id, "left");
                      await hub.publish(res.emperor.id);
                    }
                    return res;
                  }
                  case "fleet.move": {
                    const res = await fleets.move(owner.emperorId, msg.args.fleetId, msg.args.systemId);
                    if (res.ok) {
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
                      await logistics.clearRoute(owner.emperorId, res.fleet.id);
                      await hub.publishFleet(res.emperorId, res.fleet.id);
                      if (res.fledBattleId) await hub.publishBattle(res.fledBattleId);
                    }
                    return res;
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
                  case "fleet.routeStop": {
                    const ok = await logistics.clearRoute(owner.emperorId, msg.args.fleetId);
                    if (!ok) return { ok: false, error: "no_fleet" } as const;
                    await hub.publishFleet(owner.emperorId, msg.args.fleetId);
                    return { ok: true } as const;
                  }
                  // Fase 7: colonias (ver colony/service.ts).
                  case "colony.claim": {
                    const res = await colonies.claim(owner.emperorId, msg.args);
                    if (res.ok) {
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
                  case "colony.disembark": {
                    const res = await colonies.disembark(owner.emperorId, msg.args.colonyId, msg.args.humans);
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
