import { universeSeedFromString } from "@imperium/procgen";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiError, SystemDetailResponse } from "@imperium/shared";
import { SystemIdSchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { EmperorService } from "../emperor/service";
import { findSystem } from "../emperor/world";
import type { DiscoveryService } from "./service";

export interface DiscoveryDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  discoveries: DiscoveryService;
}

const MINUTE = 60_000;

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/**
 * Detalle de los sistemas (niebla de guerra): solo se entrega el de los
 * sistemas que el Emperador del jugador ha descubierto.
 */
export async function discoveryRoutes(app: FastifyInstance, { config, db, emperors, discoveries }: DiscoveryDeps) {
  const cookieName = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  // Holgado para curiosear el mapa (el cliente guarda lo recibido), corto para recorrer el universo a base de peticiones.
  const perAccount = new RateLimiter(120, MINUTE);

  app.get<{ Params: { systemId: string } }>("/api/systems/:systemId", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!perAccount.consume(account.id)) return fail(reply, 429, "rate_limited");
    const parsed = SystemIdSchema.safeParse(req.params.systemId);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const summary = findSystem(seed, parsed.data);
    if (!summary) return fail(reply, 404, "unknown_system");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return fail(reply, 404, "no_emperor");
    if (!(await discoveries.has(emperor.id, summary.id))) return fail(reply, 403, "not_discovered");
    // Es información privada de cada jugador: que ningún intermediario la guarde.
    reply.header("cache-control", "private, no-store");
    return { detail: discoveries.detail(summary) } satisfies SystemDetailResponse;
  });
}
