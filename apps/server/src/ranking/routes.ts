import type { FastifyInstance } from "fastify";
import { prestigeOf, type MetaStat } from "@imperium/content";
import { GALAXY_CENTER_SECTOR } from "@imperium/procgen";
import { systemId, type ApiError, type RankingEntry, type RankingResponse } from "@imperium/shared";
import { eq, sql } from "drizzle-orm";
import { emperors as emperorsTable } from "../db/schema";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import type { EmperorService } from "../emperor/service";

export interface RankingDeps {
  config: ServerConfig;
  db: Database;
  emperors: EmperorService;
}

interface Row {
  id: string;
  name: string;
  kind: string;
  visibility: string;
  stats: Record<MetaStat, number>;
  prestige: number;
}

/** La clasificación se calcula como mucho una vez por minuto (es una consulta grande). */
const CACHE_MS = 60_000;

/**
 * Metas (fase 5): clasificación por prestigio de los Emperadores humanos
 * (jugadores e IA) y las estadísticas propias para los objetivos de la era.
 * Privacidad: el nombre solo sale si el Emperador es público, de la IA, el
 * propio o un compañero mutuo; si no, la fila va sin nombre.
 */
export async function rankingRoutes(app: FastifyInstance, { config, db, emperors }: RankingDeps) {
  const cookieName = sessionCookieName(config);
  const coreId = systemId(GALAXY_CENTER_SECTOR, 0);
  let cache: { at: number; rows: Row[] } | null = null;

  async function load(): Promise<Row[]> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
    const res = await db.execute<{ id: string; name: string; kind: string; visibility: string; colonies: number; population: number; discoveries: number; ships: number; core: number }>(sql`
      select e.id, e.name, e.kind, e.visibility,
        (select count(*)::int from colonies c where c.emperor_id = e.id) as colonies,
        (select coalesce(sum(c.population), 0)::float from colonies c where c.emperor_id = e.id) as population,
        (select count(*)::int from discoveries d where d.emperor_id = e.id) as discoveries,
        (select count(*)::int from ships s join fleets f on f.id = s.fleet_id where f.emperor_id = e.id) as ships,
        (select count(*)::int from system_parks p where p.emperor_id = e.id and p.system_id = ${coreId}) as core
      from emperors e
      where e.kind in ('player', 'ai')`);
    const rows = [...res]
      .map((r) => {
        const stats: Record<MetaStat, number> = { colonies: r.colonies, population: Math.round(r.population), discoveries: r.discoveries, ships: r.ships, core: r.core > 0 ? 1 : 0 };
        return { id: r.id, name: r.name, kind: r.kind, visibility: r.visibility, stats, prestige: prestigeOf(stats) };
      })
      .sort((a, b) => b.prestige - a.prestige || a.name.localeCompare(b.name));
    cache = { at: Date.now(), rows };
    return rows;
  }

  app.get("/api/ranking", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return reply.code(401).send({ error: "unauthenticated" } satisfies ApiError);
    const me = await emperors.byAccount(account.id);
    const rows = await load();
    // Compañeros mutuos de quien pregunta: ven su nombre aunque no sean públicos.
    const allies = new Set<string>();
    if (me) {
      const res = await db.execute<{ ally_id: string }>(sql`
        select a.ally_id from emperor_allies a
        join emperor_allies b on b.emperor_id = a.ally_id and b.ally_id = a.emperor_id
        where a.emperor_id = ${me.id}`);
      for (const r of res) allies.add(r.ally_id);
    }
    const entry = (r: Row, i: number): RankingEntry => ({
      rank: i + 1,
      name: r.kind === "ai" || r.visibility === "public" || r.id === me?.id || allies.has(r.id) ? r.name : null,
      ai: r.kind === "ai",
      prestige: r.prestige,
      core: r.stats.core > 0,
    });
    const myIndex = me ? rows.findIndex((r) => r.id === me.id) : -1;
    const [mine] = me ? await db.select({ r: emperorsTable.reputation }).from(emperorsTable).where(eq(emperorsTable.id, me.id)).limit(1) : [];
    return {
      top: rows.slice(0, 50).map(entry),
      me: myIndex >= 0 ? { ...entry(rows[myIndex]!, myIndex), stats: rows[myIndex]!.stats, reputation: Math.round(mine?.r ?? 0) } : null,
      total: rows.length,
    } satisfies RankingResponse;
  });
}
