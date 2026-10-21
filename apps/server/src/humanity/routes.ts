import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiError, HumanityResponse, MarketMineResponse, MarketResponse } from "@imperium/shared";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { EmperorService } from "../emperor/service";
import type { MarketService } from "../market/service";
import type { HumanityService } from "./service";

export interface HumanityDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  humanity: HumanityService;
  market: MarketService;
}

const MINUTE = 60_000;

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/**
 * Economía de la humanidad y mercado: lectura. Las órdenes (comprar, vender,
 * cancelar, aportar) van por el WebSocket como cualquier otra (`cmd`).
 * - `GET /api/humanity`: agregados, tesoro y proyectos (iguales para todos).
 * - `GET /api/market`: libro, precios e historial de cada recurso.
 * - `GET /api/market/mine`: órdenes, envíos y operaciones propias.
 */
export async function humanityRoutes(app: FastifyInstance, { config, db, emperors, humanity, market }: HumanityDeps) {
  const cookieName = sessionCookieName(config);
  const perAccount = new RateLimiter(60, MINUTE);

  const emperorOf = async (req: Parameters<typeof accountFromRequest>[2], reply: FastifyReply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return void fail(reply, 401, "unauthenticated");
    if (!perAccount.consume(account.id)) return void fail(reply, 429, "rate_limited");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return void fail(reply, 404, "no_emperor");
    reply.header("cache-control", "private, no-store");
    return emperor;
  };

  app.get("/api/humanity", async (req, reply) => {
    if (!(await emperorOf(req, reply))) return reply;
    return (await humanity.view()) satisfies HumanityResponse;
  });

  app.get("/api/market", async (req, reply) => {
    if (!(await emperorOf(req, reply))) return reply;
    return (await market.view()) satisfies MarketResponse;
  });

  app.get("/api/market/mine", async (req, reply) => {
    const emperor = await emperorOf(req, reply);
    if (!emperor) return reply;
    return (await market.mine(emperor.id)) satisfies MarketMineResponse;
  });
}
