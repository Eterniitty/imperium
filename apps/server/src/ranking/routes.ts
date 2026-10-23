import type { FastifyInstance } from "fastify";
import { LEGENDS, prestigeOf, rankOf, type MetaStat } from "@imperium/content";
import { GALAXY_CENTER_SECTOR } from "@imperium/procgen";
import { systemId, type ApiError, type EmperorProfile, type RankingEntry, type RankingResponse } from "@imperium/shared";
import { eq, sql } from "drizzle-orm";
import { emperors as emperorsTable, legends } from "../db/schema";
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
  let legendRows: Array<typeof legends.$inferSelect> = [];

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
    // Leyendas: la primera vez que alguien cumple una hazaña, queda inscrito (y gana prestigio de legado).
    const held = new Map((await db.select().from(legends)).map((l) => [l.id, l]));
    for (const def of LEGENDS) {
      if (held.has(def.id)) continue;
      const first = [...res].filter((r) => r.kind === "player" && (def.stat === "core" ? (r.core > 0 ? 1 : 0) : def.stat === "population" ? r.population : r[def.stat]) >= def.target)[0];
      if (!first) continue;
      const [row] = await db.insert(legends).values({ id: def.id, emperorId: first.id, emperorName: first.name }).onConflictDoNothing().returning();
      if (row) held.set(def.id, row);
    }
    legendRows = [...held.values()];
    const bonus = new Map<string, number>();
    for (const l of legendRows) if (l.emperorId) bonus.set(l.emperorId, (bonus.get(l.emperorId) ?? 0) + (LEGENDS.find((d) => d.id === l.id)?.prestige ?? 0));
    const rows = [...res]
      .map((r) => {
        const stats: Record<MetaStat, number> = { colonies: r.colonies, population: Math.round(r.population), discoveries: r.discoveries, ships: r.ships, core: r.core > 0 ? 1 : 0 };
        return { id: r.id, name: r.name, kind: r.kind, visibility: r.visibility, stats, prestige: prestigeOf(stats) + (bonus.get(r.id) ?? 0) };
      })
      .sort((a, b) => b.prestige - a.prestige || a.name.localeCompare(b.name));
    cache = { at: Date.now(), rows };
    return rows;
  }

  /** Compañeros mutuos de un Emperador (ven su nombre aunque no sea público). */
  async function mutualAllies(emperorId: string | null): Promise<Set<string>> {
    const allies = new Set<string>();
    if (!emperorId) return allies;
    const res = await db.execute<{ ally_id: string }>(sql`
      select a.ally_id from emperor_allies a
      join emperor_allies b on b.emperor_id = a.ally_id and b.ally_id = a.emperor_id
      where a.emperor_id = ${emperorId}`);
    for (const r of res) allies.add(r.ally_id);
    return allies;
  }

  // Perfil público: solo de quien se ve por su nombre (si no, como si no existiera).
  app.get<{ Params: { id: string } }>("/api/ranking/profile/:id", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return reply.code(401).send({ error: "unauthenticated" } satisfies ApiError);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return reply.code(404).send({ error: "unknown_emperor" } satisfies ApiError);
    const me = await emperors.byAccount(account.id);
    const rows = await load();
    const i = rows.findIndex((r) => r.id === req.params.id);
    const r = rows[i];
    const allies = await mutualAllies(me?.id ?? null);
    if (!r || !(r.kind === "ai" || r.visibility === "public" || r.id === me?.id || allies.has(r.id))) return reply.code(404).send({ error: "unknown_emperor" } satisfies ApiError);
    const [e] = await db
      .select({ xp: emperorsTable.xp, generation: emperorsTable.generation, createdAt: emperorsTable.createdAt, best: emperorsTable.challengeBest })
      .from(emperorsTable)
      .where(eq(emperorsTable.id, r.id))
      .limit(1);
    const ai = r.kind === "ai";
    return {
      id: r.id,
      name: r.name,
      ai,
      rankId: ai ? null : rankOf(e?.xp ?? 0).rank.id,
      generation: e?.generation ?? 1,
      joinedAt: ai || !e ? null : e.createdAt.getTime(),
      prestige: r.prestige,
      position: i + 1,
      total: rows.length,
      stats: { colonies: r.stats.colonies, population: r.stats.population, discoveries: r.stats.discoveries, ships: r.stats.ships },
      core: r.stats.core > 0,
      legends: legendRows.filter((l) => l.emperorId === r.id).map((l) => l.id),
      challengeBest: e?.best ?? 0,
    } satisfies EmperorProfile;
  });

  app.get("/api/ranking", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return reply.code(401).send({ error: "unauthenticated" } satisfies ApiError);
    const me = await emperors.byAccount(account.id);
    const rows = await load();
    // Compañeros mutuos de quien pregunta: ven su nombre aunque no sean públicos.
    const allies = await mutualAllies(me?.id ?? null);
    const visible = (r: Row) => r.kind === "ai" || r.visibility === "public" || r.id === me?.id || allies.has(r.id);
    const entry = (r: Row, i: number): RankingEntry => ({
      rank: i + 1,
      ...(visible(r) ? { id: r.id } : {}),
      name: visible(r) ? r.name : null,
      ai: r.kind === "ai",
      prestige: r.prestige,
      core: r.stats.core > 0,
    });
    const myIndex = me ? rows.findIndex((r) => r.id === me.id) : -1;
    const [mine] = me ? await db.select({ r: emperorsTable.reputation }).from(emperorsTable).where(eq(emperorsTable.id, me.id)).limit(1) : [];
    return {
      // Las leyendas son historia pública: se ven con nombre (de los que eran públicos o de la IA; si no, sin él).
      legends: legendRows.map((l) => {
        const r = rows.find((x) => x.id === l.emperorId);
        const visible = !r || r.kind === "ai" || r.visibility === "public" || r.id === me?.id || allies.has(r.id);
        return { id: l.id, name: visible ? l.emperorName : "", at: l.at.getTime() };
      }),
      top: rows.slice(0, 50).map(entry),
      me: myIndex >= 0 ? { ...entry(rows[myIndex]!, myIndex), stats: rows[myIndex]!.stats, reputation: Math.round(mine?.r ?? 0) } : null,
      total: rows.length,
    } satisfies RankingResponse;
  });
}
