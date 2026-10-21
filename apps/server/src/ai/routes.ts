import type { FastifyInstance, FastifyReply } from "fastify";
import { universeSeedFromString } from "@imperium/procgen";
import type { AliensResponse, ApiError, SystemAliensResponse } from "@imperium/shared";
import { SystemIdSchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { DiscoveryService } from "../discovery/service";
import type { EmperorService } from "../emperor/service";
import { findSystem } from "../emperor/world";
import type { WarService } from "../war/service";
import type { AlienService } from "./service";

export interface AlienDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  discoveries: DiscoveryService;
  wars: WarService;
  aliens: AlienService;
}

const MINUTE = 60_000;

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/**
 * Especies alienígenas (Fase 11): territorio de lo descubierto, relación con
 * cada facción y presencia alienígena en un sistema. Todo respeta la niebla de
 * guerra: el territorio solo de los sistemas descubiertos y las flotas solo si
 * los sensores del jugador las cubren.
 */
export async function alienRoutes(app: FastifyInstance, { config, db, emperors, discoveries, wars, aliens }: AlienDeps) {
  const cookieName = sessionCookieName(config);
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  const perAccount = new RateLimiter(60, MINUTE);

  app.get("/api/aliens", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!perAccount.consume(account.id)) return fail(reply, 429, "rate_limited");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return fail(reply, 404, "no_emperor");
    reply.header("cache-control", "private, no-store");
    return (await aliens.view(emperor.id, await discoveries.list(emperor.id))) satisfies AliensResponse;
  });

  app.get<{ Params: { systemId: string } }>("/api/systems/:systemId/aliens", async (req, reply) => {
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
    return (await aliens.systemView(summary, await wars.sensors(emperor.id))) satisfies SystemAliensResponse;
  });
}
