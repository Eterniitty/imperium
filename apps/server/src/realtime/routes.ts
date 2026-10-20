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
import type { Database } from "../db/client";
import type { EmperorService } from "../emperor/service";
import type { Client, Hub } from "./hub";
import { TicketStore } from "./tickets";

export interface RealtimeDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  hub: Hub;
}

const MINUTE = 60_000;
const HEARTBEAT_MS = 30_000;
/** Conexiones simultáneas: por cuenta (varias pestañas) y en total. */
const MAX_CONNECTIONS_PER_ACCOUNT = 5;
const MAX_CONNECTIONS = 1_000;

export async function realtimeRoutes(app: FastifyInstance, { config, db, emperors, hub }: RealtimeDeps) {
  const cookieName = sessionCookieName(config);
  const tickets = new TicketStore();
  const ticketsPerAccount = new RateLimiter(30, MINUTE);
  // Mensajes por cuenta: holgado para jugar, corto para abusar.
  const messagesPerAccount = new RateLimiter(60, 10_000);
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
        subscribed: false,
        send: (msg: ServerMessage) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
        },
      };
      sockets.add(socket);
      alive.set(socket, true);
      socket.on("pong", () => alive.set(socket, true));
      hub.add(client);
      client.send({ t: "hello", protocol: PROTOCOL_VERSION, emperorId: owner.emperorId, serverTime: Date.now() });

      socket.on("message", (data, isBinary) => {
        if (!messagesPerAccount.consume(owner.accountId)) return socket.close(WS_CLOSE.rateLimited, "rate limited");
        let parsed: ReturnType<typeof ClientMessageSchema.safeParse> | null = null;
        try {
          if (!isBinary) parsed = ClientMessageSchema.safeParse(JSON.parse(data.toString()));
        } catch {
          // JSON no válido: se trata igual que un mensaje mal formado.
        }
        if (!parsed?.success) return socket.close(WS_CLOSE.protocol, "invalid message");

        const msg = parsed.data;
        switch (msg.t) {
          case "sub":
            void hub.subscribe(client);
            return;
          case "cmd":
            void hub
              .command(client, msg.cmdId, async () => {
                const res = await emperors.move(owner.accountId, msg.args.systemId);
                if (res.ok) await hub.publish(res.emperor.id);
                return res;
              })
              .then((ack) => client.send(ack));
            return;
        }
      });

      socket.on("close", () => {
        sockets.delete(socket);
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
