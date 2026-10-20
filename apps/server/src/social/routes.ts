import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiError, SocialResponse } from "@imperium/shared";
import { AllyAddBodySchema, AllyRemoveBodySchema, VisibilityBodySchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { EmperorService } from "../emperor/service";
import type { Hub } from "../realtime/hub";
import type { SocialService } from "./service";

export interface SocialDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  social: SocialService;
  hub: Hub;
}

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/** Visibilidad y compañeros. Cada cambio se difunde: quien deja de poder verte deja de recibirte. */
export async function socialRoutes(app: FastifyInstance, { config, db, emperors, social, hub }: SocialDeps) {
  const cookieName = sessionCookieName(config);
  // Buscar por nombre permite tantear qué Emperadores existen: límite moderado.
  const changesPerAccount = new RateLimiter(30, 60_000);

  /** Emperador de la sesión, o responde con el error y devuelve null. */
  async function me(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return void fail(reply, 401, "unauthenticated"), null;
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return void fail(reply, 404, "no_emperor"), null;
    return emperor.id;
  }

  const limited = async (req: FastifyRequest, reply: FastifyReply) => {
    const id = await me(req, reply);
    if (!id) return null;
    if (!changesPerAccount.consume(id)) return void fail(reply, 429, "rate_limited"), null;
    return id;
  };

  app.get("/api/social", async (req, reply) => {
    const id = await me(req, reply);
    if (!id) return;
    return (await social.summary(id)) satisfies SocialResponse;
  });

  app.post("/api/social/visibility", async (req, reply) => {
    const id = await limited(req, reply);
    if (!id) return;
    const parsed = VisibilityBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    await social.setVisibility(id, parsed.data.visibility);
    await hub.publish(id);
    return (await social.summary(id)) satisfies SocialResponse;
  });

  app.post("/api/social/allies", async (req, reply) => {
    const id = await limited(req, reply);
    if (!id) return;
    const parsed = AllyAddBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const res = await social.addAlly(id, parsed.data.name);
    if (!res.ok) return fail(reply, res.error === "unknown_emperor" ? 404 : 400, res.error);
    // Si ya era mutuo, ahora se ven: se avisa a los dos.
    await hub.publish(id);
    await hub.publish(res.allyId);
    return (await social.summary(id)) satisfies SocialResponse;
  });

  app.post("/api/social/allies/remove", async (req, reply) => {
    const id = await limited(req, reply);
    if (!id) return;
    const parsed = AllyRemoveBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    await social.removeAlly(id, parsed.data.emperorId);
    await hub.publish(id);
    await hub.publish(parsed.data.emperorId);
    return (await social.summary(id)) satisfies SocialResponse;
  });
}
