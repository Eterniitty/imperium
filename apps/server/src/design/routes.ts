import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getHull, getPart } from "@imperium/content";
import { SHIP_DESIGNS_MAX, type ApiError, type ShipDesignRecord, type ShipDesignsResponse } from "@imperium/shared";
import { ShipDesignDeleteBodySchema, ShipDesignSaveBodySchema } from "@imperium/shared/schemas";
import { and, asc, eq, sql } from "drizzle-orm";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { shipDesigns } from "../db/schema";
import type { EmperorService } from "../emperor/service";

export interface DesignDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
}

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

type Row = typeof shipDesigns.$inferSelect;
const view = (r: Row): ShipDesignRecord => ({ id: r.id, name: r.name, hullId: r.hullId, parts: r.parts, updatedAt: r.updatedAt.getTime() });

/**
 * Diseños de nave del editor (fase E2, `docs/editor-naves.md`): guardar,
 * listar y borrar los propios. Se guardan aunque estén a medias (la validez la
 * dice `validateDesign`), pero solo con casco y piezas que existen y en
 * anclajes del casco. Construirlos llegará con la fase E4.
 */
export async function designRoutes(app: FastifyInstance, { config, db, emperors }: DesignDeps) {
  const cookieName = sessionCookieName(config);
  const writesPerEmperor = new RateLimiter(60, 60_000);

  async function me(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return void fail(reply, 401, "unauthenticated"), null;
    const emperor = await emperors.byAccount(account.id);
    if (!emperor) return void fail(reply, 404, "no_emperor"), null;
    return emperor.id;
  }
  const list = async (emperorId: string) => (await db.select().from(shipDesigns).where(eq(shipDesigns.emperorId, emperorId)).orderBy(asc(shipDesigns.createdAt))).map(view);

  app.get("/api/designs", async (req, reply) => {
    const id = await me(req, reply);
    if (!id) return;
    return { designs: await list(id) } satisfies ShipDesignsResponse;
  });

  app.post("/api/designs/save", async (req, reply) => {
    const id = await me(req, reply);
    if (!id) return;
    if (!writesPerEmperor.consume(id)) return fail(reply, 429, "rate_limited");
    const parsed = ShipDesignSaveBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const { name, hullId, parts } = parsed.data;
    const hull = getHull(hullId);
    // Solo piezas que existen en anclajes que existen (que encajen o no lo dice el editor).
    if (!hull || Object.entries(parts).some(([slot, part]) => !hull.slots.some((s) => s.id === slot) || !getPart(part))) return fail(reply, 400, "invalid_request");
    const now = new Date();
    if (parsed.data.id) {
      const [row] = await db
        .update(shipDesigns)
        .set({ name, hullId, parts, updatedAt: now })
        .where(and(eq(shipDesigns.id, parsed.data.id), eq(shipDesigns.emperorId, id)))
        .returning();
      if (!row) return fail(reply, 404, "unknown_design");
      return { designs: await list(id), saved: view(row) } satisfies ShipDesignsResponse;
    }
    const saved = await db.transaction(async (tx) => {
      // Tope de diseños, sin carreras: se cuenta con el Emperador bloqueado.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`designs:${id}`}))`);
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shipDesigns).where(eq(shipDesigns.emperorId, id));
      if (n >= SHIP_DESIGNS_MAX) return null;
      const [row] = await tx.insert(shipDesigns).values({ emperorId: id, name, hullId, parts }).returning();
      return row!;
    });
    if (!saved) return fail(reply, 409, "limit_reached");
    return { designs: await list(id), saved: view(saved) } satisfies ShipDesignsResponse;
  });

  app.post("/api/designs/delete", async (req, reply) => {
    const id = await me(req, reply);
    if (!id) return;
    if (!writesPerEmperor.consume(id)) return fail(reply, 429, "rate_limited");
    const parsed = ShipDesignDeleteBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const gone = await db.delete(shipDesigns).where(and(eq(shipDesigns.id, parsed.data.id), eq(shipDesigns.emperorId, id))).returning({ id: shipDesigns.id });
    if (gone.length === 0) return fail(reply, 404, "unknown_design");
    return { designs: await list(id) } satisfies ShipDesignsResponse;
  });
}
