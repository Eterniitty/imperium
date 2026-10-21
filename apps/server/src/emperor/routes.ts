import type { FastifyInstance, FastifyReply } from "fastify";
import type { ApiError, CompanionInboxResponse, CompanionRequestResponse, EmperorResponse } from "@imperium/shared";
import { CompanionRequestBodySchema, CompanionRespondBodySchema, EmperorCreateBodySchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { Hub } from "../realtime/hub";
import { CompanionService } from "./companion";
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
 * Consultar y crear el Emperador de la cuenta, y el alta con compañero
 * (`/api/emperor/companion` para quien se da de alta; `/api/companion-requests`
 * para el compañero que la recibe). Las órdenes (como viajar) van por el
 * WebSocket; ver `realtime/routes.ts`.
 */
export async function emperorRoutes(app: FastifyInstance, { config, db, emperors, hub }: EmperorDeps) {
  const cookieName = sessionCookieName(config);
  // Crear tiene un límite bajo: cada intento consulta nombres.
  const createPerAccount = new RateLimiter(10, 15 * MINUTE);
  // Responder a solicitudes de alta: límite holgado, solo frena abusos.
  const respondPerAccount = new RateLimiter(30, MINUTE);
  const companions = new CompanionService(db);

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
    // Los demás jugadores lo ven aparecer (y su compañero, que ya lo es, aunque se oculte).
    void hub.publish(res.emperor.id);
    if (res.companionId) void hub.publish(res.companionId);
    return reply.code(201).send({ emperor: res.emperor } satisfies EmperorResponse);
  });

  // --- Alta con compañero: quien se da de alta (cuenta sin Emperador) ---

  app.get("/api/emperor/companion", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    return (await companions.forAccount(account.id)) satisfies CompanionRequestResponse;
  });

  app.post("/api/emperor/companion", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    // Comparte el límite con crear: cada intento consulta nombres.
    if (!createPerAccount.consume(account.id)) return fail(reply, 429, "rate_limited");
    const parsed = CompanionRequestBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const res = await companions.request(account.id, parsed.data.name, parsed.data.companion);
    if (!res.ok) return fail(reply, res.error === "unknown_emperor" ? 404 : 409, res.error);
    return (await companions.forAccount(account.id)) satisfies CompanionRequestResponse;
  });

  app.post("/api/emperor/companion/cancel", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    await companions.cancel(account.id);
    return reply.code(204).send();
  });

  // --- Alta con compañero: el compañero que recibe la solicitud ---

  app.get("/api/companion-requests", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return fail(reply, 404, "no_emperor");
    return (await companions.inbox(emperor.id)) satisfies CompanionInboxResponse;
  });

  app.post("/api/companion-requests/respond", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!respondPerAccount.consume(account.id)) return fail(reply, 429, "rate_limited");
    const parsed = CompanionRespondBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return fail(reply, 404, "no_emperor");
    const res = await companions.respond(emperor.id, parsed.data.id, parsed.data.accept);
    if (!res.ok) return fail(reply, 409, res.error);
    return (await companions.inbox(emperor.id)) satisfies CompanionInboxResponse;
  });
}
