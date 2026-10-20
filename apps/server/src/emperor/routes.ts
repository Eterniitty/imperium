import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiError, EmperorResponse } from "@imperium/shared";
import { EmperorCreateBodySchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { Hub } from "../realtime/hub";
import type { EmperorService } from "./service";

export interface EmperorDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  hub: Hub;
}

const MINUTE = 60_000;

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/**
 * Consultar y crear el Emperador de la cuenta. Las órdenes (como viajar) van por
 * el WebSocket; ver `realtime/routes.ts`.
 */
export async function emperorRoutes(app: FastifyInstance, { config, db, emperors, hub }: EmperorDeps) {
  const cookieName = sessionCookieName(config);
  // Crear tiene un límite bajo: cada intento consulta nombres.
  const createPerAccount = new RateLimiter(10, 15 * MINUTE);

  app.get("/api/emperor", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return fail(reply, 404, "no_emperor");
    return { emperor } satisfies EmperorResponse;
  });

  app.post("/api/emperor", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!createPerAccount.consume(account.id)) return fail(reply, 429, "rate_limited");
    const parsed = EmperorCreateBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");

    const res = await emperors.create(account.id, parsed.data.name);
    if (!res.ok) return fail(reply, 409, res.error);
    // Los demás jugadores lo ven aparecer.
    void hub.publish(res.emperor.id);
    return reply.code(201).send({ emperor: res.emperor } satisfies EmperorResponse);
  });
}
