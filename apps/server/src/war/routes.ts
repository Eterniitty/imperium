import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiError, ContactsResponse } from "@imperium/shared";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { EmperorService } from "../emperor/service";
import type { AlienService } from "../ai/service";
import type { WarService } from "./service";

export interface WarDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  wars: WarService;
  /** Fase 11: avistamientos de flotas alienígenas paradas. */
  aliens?: AlienService;
}

const MINUTE = 60_000;

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/** Contactos: flotas enemigas en tránsito que detectan los sensores del jugador (para interceptarlas). */
export async function warRoutes(app: FastifyInstance, { config, db, emperors, wars, aliens }: WarDeps) {
  const cookieName = sessionCookieName(config);
  const perAccount = new RateLimiter(30, MINUTE);

  app.get("/api/contacts", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!perAccount.consume(account.id)) return fail(reply, 429, "rate_limited");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return fail(reply, 404, "no_emperor");
    reply.header("cache-control", "private, no-store");
    const sightings = aliens ? await aliens.sightings(await wars.sensors(emperor.id)) : [];
    return { contacts: await wars.contacts(emperor.id), sightings } satisfies ContactsResponse;
  });
}
