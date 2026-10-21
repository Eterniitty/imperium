import { universeSeedFromString } from "@imperium/procgen";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiError, SystemClaimsResponse } from "@imperium/shared";
import { SystemIdSchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { DiscoveryService } from "../discovery/service";
import type { EmperorService } from "../emperor/service";
import { findSystem } from "../emperor/world";
import type { ColonyService } from "./service";
import type { SiegeService } from "../war/siege";

export interface ColonyRoutesDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  discoveries: DiscoveryService;
  colonies: ColonyService;
  /** Fase 9b: para marcar los planetas asediados. */
  sieges?: SiegeService;
}

const MINUTE = 60_000;

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/**
 * Territorio: dueño y nombre de los planetas reclamados de un sistema. Va
 * aparte del detalle (que no cambia y el cliente guarda) porque cambia con
 * cada reclamación o cambio de nombre. Solo para quien ha descubierto el sistema.
 */
export async function colonyRoutes(app: FastifyInstance, { config, db, emperors, discoveries, colonies, sieges }: ColonyRoutesDeps) {
  const cookieName = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  const perAccount = new RateLimiter(120, MINUTE);

  app.get<{ Params: { systemId: string } }>("/api/systems/:systemId/claims", async (req, reply) => {
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
    reply.header("cache-control", "private, no-store");
    const claims = await colonies.claims(summary.id);
    const besieged = sieges ? await sieges.besiegedIn(summary.id) : new Set<string>();
    return { claims: claims.map((c) => (besieged.has(c.colonyId) ? { ...c, besieged: true } : c)) } satisfies SystemClaimsResponse;
  });
}
