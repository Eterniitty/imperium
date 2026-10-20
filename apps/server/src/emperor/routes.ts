import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { universeSeedFromString } from "@imperium/procgen";
import type { ApiError, Emperor, EmperorResponse } from "@imperium/shared";
import { EmperorCreateBodySchema, EmperorMoveBodySchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { emperors } from "../db/schema";
import { findSystem, nameKey, pickSpawnSystem, toLocation } from "./world";

export interface EmperorDeps {
  config: ServerConfig;
  db: Database;
}

const MINUTE = 60_000;

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

export async function emperorRoutes(app: FastifyInstance, { config, db }: EmperorDeps) {
  const seed = universeSeedFromString(config.UNIVERSE_SEED);
  const cookieName = sessionCookieName(config);
  // Crear tiene un límite bajo (cada intento consulta nombres); mover, uno holgado.
  const createPerAccount = new RateLimiter(10, 15 * MINUTE);
  const movePerAccount = new RateLimiter(60, MINUTE);

  /** Fila de la base de datos → Emperador con su ubicación deducida del generador. */
  const toEmperor = (row: { id: string; name: string; systemId: string }): Emperor => {
    const system = findSystem(seed, row.systemId);
    // Solo pasaría si cambiase la semilla o el generador con Emperadores ya creados.
    if (!system) throw new Error(`El Emperador ${row.id} está en un sistema inexistente: ${row.systemId}`);
    return { id: row.id, name: row.name, location: toLocation(system) };
  };

  const columns = { id: emperors.id, name: emperors.name, systemId: emperors.systemId };

  app.get("/api/emperor", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    const [row] = await db.select(columns).from(emperors).where(eq(emperors.accountId, account.id)).limit(1);
    if (!row) return fail(reply, 404, "no_emperor");
    return { emperor: toEmperor(row) } satisfies EmperorResponse;
  });

  app.post("/api/emperor", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!createPerAccount.consume(account.id)) return fail(reply, 429, "rate_limited");
    const parsed = EmperorCreateBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");

    const { name } = parsed.data;
    const spawn = pickSpawnSystem(seed);
    // Sin objetivo de conflicto: si ya hay Emperador en la cuenta o el nombre está
    // cogido, no inserta nada. Así dos peticiones simultáneas no crean dos.
    const [row] = await db
      .insert(emperors)
      .values({ accountId: account.id, name, nameKey: nameKey(name), systemId: spawn.id })
      .onConflictDoNothing()
      .returning(columns);
    if (row) return reply.code(201).send({ emperor: toEmperor(row) } satisfies EmperorResponse);

    const [existing] = await db.select({ id: emperors.id }).from(emperors).where(eq(emperors.accountId, account.id)).limit(1);
    return existing ? fail(reply, 409, "emperor_exists") : fail(reply, 409, "name_taken");
  });

  // Traslado instantáneo a cualquier sistema existente. Provisional: en el paso 4d
  // el movimiento será una orden por WebSocket, con tiempo de viaje.
  app.post("/api/emperor/move", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!movePerAccount.consume(account.id)) return fail(reply, 429, "rate_limited");
    const parsed = EmperorMoveBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const system = findSystem(seed, parsed.data.systemId);
    if (!system) return fail(reply, 400, "unknown_system");

    const [row] = await db
      .update(emperors)
      .set({ systemId: system.id, updatedAt: sql`now()` })
      .where(eq(emperors.accountId, account.id))
      .returning(columns);
    if (!row) return fail(reply, 404, "no_emperor");
    return { emperor: toEmperor(row) } satisfies EmperorResponse;
  });
}
