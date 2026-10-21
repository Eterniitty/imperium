import { eq, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { WS_CLOSE, type ApiError } from "@imperium/shared";
import { AccountDeleteBodySchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import {
  accounts,
  alienStandings,
  battles,
  battleSides,
  colonies,
  colonyBuilds,
  discoveries,
  emperorAllies,
  emperorWallets,
  emperors,
  humanityContributions,
  fleetCargo,
  fleetRoutes,
  fleets,
  installations,
  magicLinkTokens,
  resourceLedger,
  scheduledEvents,
  sessions,
  ships,
} from "../db/schema";
import type { ColonyService } from "../colony/service";
import type { HumanityService } from "../humanity/service";
import type { MarketService } from "../market/service";
import type { Hub } from "../realtime/hub";
import type { SpaceService } from "../space/service";
import { maskEmail } from "../auth/tokens";
import type { SiegeService } from "../war/siege";
import type { LineageService } from "../lineage/service";
import type { WikiService } from "../wiki/service";

export interface AccountDeps {
  config: ServerConfig;
  db: Database;
  hub: Hub;
  space: SpaceService;
  colonies: ColonyService;
  humanity: HumanityService;
  market: MarketService;
  /** Fase 9b: asedios (como atacante o defensor) en la exportación. */
  sieges?: SiegeService;
  /** Fase 10: Herederos y muertes en la exportación; eventos de los Herederos al borrar. */
  lineage?: LineageService;
  /** Wiki: revisiones y cambios hechos como administrador (exportación; al borrar quedan sin autor). */
  wiki?: WikiService;
}

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/**
 * Derechos del RGPD que el jugador ejerce solo (ver /legal/privacidad.html):
 * descargar sus datos (art. 15 y 20) y borrar su cuenta (art. 17).
 */
export async function accountRoutes(app: FastifyInstance, { config, db, hub, space, colonies: colonyService, humanity, market, sieges, lineage, wiki }: AccountDeps) {
  const cookieName = sessionCookieName(config);
  const cookieOptions = { path: "/", httpOnly: true, secure: config.COOKIE_SECURE, sameSite: "lax" } as const;
  // La exportación lee muchas tablas: pocas por cuenta.
  const exportsPerAccount = new RateLimiter(5, 15 * 60_000);

  app.get("/api/account/export", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!exportsPerAccount.consume(account.id)) return fail(reply, 429, "rate_limited");

    const [acc] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    const sessionRows = await db
      .select({ createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, ip: sessions.ip })
      .from(sessions)
      .where(eq(sessions.accountId, account.id));
    const [emperor] = await db.select().from(emperors).where(eq(emperors.accountId, account.id));
    let game: Record<string, unknown> | null = null;
    if (emperor) {
      const fleetRows = await db.select().from(fleets).where(eq(fleets.emperorId, emperor.id));
      const fleetIds = fleetRows.map((f) => f.id);
      const colonyRows = await db.select().from(colonies).where(eq(colonies.emperorId, emperor.id));
      const colonyIds = colonyRows.map((c) => c.id);
      const byFleet = fleetIds.length > 0;
      const byColony = colonyIds.length > 0;
      const allies = await db
        .select({ name: emperors.name })
        .from(emperorAllies)
        .innerJoin(emperors, eq(emperors.id, emperorAllies.allyId))
        .where(eq(emperorAllies.emperorId, emperor.id));
      game = {
        emperor,
        allies: allies.map((a) => a.name),
        fleets: fleetRows,
        ships: byFleet ? await db.select().from(ships).where(inArray(ships.fleetId, fleetIds)) : [],
        fleetCargo: byFleet ? await db.select().from(fleetCargo).where(inArray(fleetCargo.fleetId, fleetIds)) : [],
        fleetRoutes: byFleet ? await db.select().from(fleetRoutes).where(inArray(fleetRoutes.fleetId, fleetIds)) : [],
        colonies: colonyRows,
        installations: byColony ? await db.select().from(installations).where(inArray(installations.colonyId, colonyIds)) : [],
        colonyBuilds: byColony ? await db.select().from(colonyBuilds).where(inArray(colonyBuilds.colonyId, colonyIds)) : [],
        discoveries: await db.select().from(discoveries).where(eq(discoveries.emperorId, emperor.id)),
        resourceLedger: await db.select().from(resourceLedger).where(eq(resourceLedger.emperorId, emperor.id)),
        // Batallas en las que ha combatido (bando, resultado y la batalla).
        battles: await db
          .select({ side: battleSides.side, outcome: battleSides.outcome, battle: battles })
          .from(battleSides)
          .innerJoin(battles, eq(battles.id, battleSides.battleId))
          .where(eq(battleSides.emperorId, emperor.id)),
        // Economía de la humanidad y mercado: cartera, aportes, órdenes, operaciones y envíos.
        wallet: (await db.select().from(emperorWallets).where(eq(emperorWallets.emperorId, emperor.id)))[0] ?? null,
        humanityContributions: await db.select().from(humanityContributions).where(eq(humanityContributions.emperorId, emperor.id)),
        // Fase 11: relación (rencor) de cada facción alienígena con este Emperador.
        alienStandings: await db.select().from(alienStandings).where(eq(alienStandings.emperorId, emperor.id)),
        ...(await market.exportFor(emperor.id)),
        // Fase 9b: asedios en los que ha sido atacante o defensor.
        sieges: sieges ? await sieges.exportFor(emperor.id) : [],
        // Fase 10: sus Herederos y el historial de sus muertes (el estado de la gestación va en `emperor`).
        lineage: lineage ? await lineage.exportFor(emperor.id) : { heirs: [], deaths: [] },
      };
    }
    // Wiki: lo que editó como administrador (las revisiones son públicas; aquí, con su autoría).
    const wikiData = wiki ? await wiki.exportFor(account.id) : { revisions: [], log: [] };
    const data = { exportedAt: new Date().toISOString(), account: acc, sessions: sessionRows, game, wiki: wikiData };
    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="aeonarch-datos.json"')
      .header("Cache-Control", "no-store")
      .send(JSON.stringify(data, null, 2));
  });

  app.post("/api/account/delete", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    if (!AccountDeleteBodySchema.safeParse(req.body).success) return fail(reply, 400, "invalid_request");

    const emperorId = await db.transaction(async (tx) => {
      const [emperor] = await tx.select({ id: emperors.id }).from(emperors).where(eq(emperors.accountId, account.id)).for("update");
      if (emperor) {
        // Eventos pendientes de sus flotas, construcciones y viajes: sin ellos no
        // quedan reintentos eternos sobre filas borradas.
        const fleetIds = (await tx.select({ id: fleets.id }).from(fleets).where(eq(fleets.emperorId, emperor.id))).map((r) => r.id);
        const buildIds = (
          await tx
            .select({ id: colonyBuilds.id })
            .from(colonyBuilds)
            .innerJoin(colonies, eq(colonies.id, colonyBuilds.colonyId))
            .where(eq(colonies.emperorId, emperor.id))
        ).map((r) => r.id);
        const heirIds = lineage ? await lineage.heirIds(tx, emperor.id) : [];
        await tx
          .delete(scheduledEvents)
          .where(
            or(
              sql`${scheduledEvents.payload}->>'emperorId' = ${emperor.id}`,
              fleetIds.length ? inArray(sql`${scheduledEvents.payload}->>'fleetId'`, fleetIds) : undefined,
              buildIds.length ? inArray(sql`${scheduledEvents.payload}->>'buildId'`, buildIds) : undefined,
              heirIds.length ? inArray(sql`${scheduledEvents.payload}->>'heirId'`, heirIds) : undefined,
            ),
          );
        // Mercado: sus órdenes se cancelan (lo retenido vuelve a sus colonias antes de independizarse)
        // y su renta deja de aportar al tesoro del Núcleo.
        const at = Date.now();
        await market.cancelAll(tx, emperor.id, at);
        await humanity.onEmperorDeleted(tx, emperor.id, at);
        // Lo hecho en el universo se queda: sus colonias pasan a ser independientes
        // (congeladas, con su nombre, población e instalaciones; conquistables en la Fase 9b).
        await colonyService.makeIndependent(tx, emperor.id, Date.now());
      }
      // Wiki: sus revisiones se conservan (contenido público) con el autor anónimo.
      if (wiki) await wiki.anonymize(tx, account.id);
      // Enlaces de acceso pendientes o usados (guardan el correo).
      await tx.delete(magicLinkTokens).where(eq(magicLinkTokens.email, account.email));
      // En cascada: sesiones, Emperador, flotas, naves, descubrimientos, compañeros, bandos de batallas…
      // El libro de recursos se queda (no admite borrados) solo con identificadores internos.
      await tx.delete(accounts).where(eq(accounts.id, account.id));
      return emperor?.id ?? null;
    });

    req.log.info({ account: { email: maskEmail(account.email) } }, "Cuenta borrada a petición del jugador");
    hub.disconnectAccount(account.id, WS_CLOSE.unauthorized, "account deleted");
    if (emperorId) {
      space.leave(emperorId, "left");
      // Quien lo veía en el mapa recibe su baja.
      void hub.publish(emperorId);
    }
    reply.clearCookie(cookieName, cookieOptions);
    return reply.code(204).send();
  });
}
