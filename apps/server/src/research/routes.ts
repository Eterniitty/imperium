import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiError, ResearchStatus } from "@imperium/shared";
import { ResearchStartBodySchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { EmperorService } from "../emperor/service";
import type { ResearchService } from "./service";

export interface ResearchDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
  research: ResearchService;
}

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/** Tecnología por niveles: ver los niveles y empezar a investigar (`/api/research`). */
export async function researchRoutes(app: FastifyInstance, { config, db, emperors, research }: ResearchDeps) {
  const cookieName = sessionCookieName(config);
  const writes = new RateLimiter(30, 60_000);

  app.get("/api/research", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return fail(reply, 404, "no_emperor");
    const status = await research.status(emperor.id);
    if (!status) return fail(reply, 404, "no_emperor");
    return status satisfies ResearchStatus;
  });

  app.post("/api/research/start", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return fail(reply, 404, "no_emperor");
    if (!writes.consume(emperor.id)) return fail(reply, 429, "rate_limited");
    const parsed = ResearchStartBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const res = await research.start(emperor.id, parsed.data.tree);
    if (!res.ok) return fail(reply, 409, res.error as ApiError["error"]);
    return res.status satisfies ResearchStatus;
  });
}
