import { PROBE } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { distance, type CommandError, type Probe, type WorldPosition } from "@imperium/shared";
import { positionAt, travelDurationMs } from "@imperium/sim";
import { and, asc, eq, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, discoveries, probes } from "../db/schema";
import { discoverAround } from "../discovery/service";
import type { EmperorService } from "../emperor/service";
import { findSystem } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";
import type { HumanityService } from "../humanity/service";

type ProbeRow = typeof probes.$inferSelect;

/** Resultado de lanzar una sonda. */
export type ProbeLaunchResult = { ok: true; emperorId: string; probe: Probe } | { ok: false; error: CommandError };

/**
 * Sondas de exploración (`PROBE`): se compran con créditos y salen de la nave
 * del Emperador (esté donde esté, también en pleno viaje cuántico) o de la
 * colonia propia más cercana al destino. Al llegar (evento `probe.arrive`)
 * descubren lo que cubre su escáner y desaparecen.
 */
export class ProbeService {
  private readonly seed: number;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED">,
    private readonly emperors: EmperorService,
    private readonly humanity: HumanityService,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
  }

  private view(r: ProbeRow): Probe {
    const target = findSystem(this.seed, r.systemId);
    return {
      id: r.id,
      systemId: r.systemId,
      systemName: target?.name ?? r.systemId,
      from: { x: r.fromX, y: r.fromY, z: r.fromZ },
      to: target?.position ?? { x: r.fromX, y: r.fromY, z: r.fromZ },
      launchedAt: r.launchedAt.getTime(),
      arriveAt: r.arriveAt.getTime(),
    };
  }

  /** Sondas en vuelo de un Emperador. */
  async list(emperorId: string): Promise<Probe[]> {
    const rows = await this.db.select().from(probes).where(eq(probes.emperorId, emperorId)).orderBy(asc(probes.arriveAt));
    return rows.map((r) => this.view(r));
  }

  /**
   * Orden `probe.launch`: a un sistema sin descubrir, con sitio para otra sonda
   * en vuelo, a alcance de la nave o de una colonia propia, y con créditos.
   */
  async launch(emperorId: string, systemId: string): Promise<ProbeLaunchResult> {
    const target = findSystem(this.seed, systemId);
    if (!target) return { ok: false, error: "unknown_system" };
    const emperor = await this.emperors.byId(emperorId);
    if (!emperor) return { ok: false, error: "no_emperor" };
    const now = this.now();
    return this.db.transaction(async (tx): Promise<ProbeLaunchResult> => {
      const [known] = await tx
        .select({ systemId: discoveries.systemId })
        .from(discoveries)
        .where(and(eq(discoveries.emperorId, emperorId), eq(discoveries.systemId, systemId)))
        .limit(1);
      if (known) return { ok: false, error: "already_discovered" };
      // Una a la vez por Emperador (el tope de sondas se comprueba con la fila bloqueada).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`probe:${emperorId}`}))`);
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(probes).where(eq(probes.emperorId, emperorId));
      if (n >= PROBE.maxActive) return { ok: false, error: "limit_reached" };
      // Origen: la nave del Emperador o la colonia propia más cercana al destino.
      const origins: WorldPosition[] = emperor.gestating ? [] : [positionAt(emperor, now)];
      const own = await tx.selectDistinct({ systemId: colonies.systemId }).from(colonies).where(eq(colonies.emperorId, emperorId));
      for (const c of own) {
        const s = findSystem(this.seed, c.systemId);
        if (s) origins.push(s.position);
      }
      let from: WorldPosition | null = null;
      for (const o of origins) if (!from || distance(o, target.position) < distance(from, target.position)) from = o;
      if (!from || distance(from, target.position) > PROBE.maxRangeLy) return { ok: false, error: "out_of_range" };
      if (!(await this.humanity.spend(tx, emperorId, PROBE.costCredits, "probe", systemId, now))) return { ok: false, error: "insufficient_credits" };
      const arriveAt = now + travelDurationMs(from, target.position, PROBE.speedLyPerHour);
      const [row] = await tx
        .insert(probes)
        .values({ emperorId, systemId, fromX: from.x, fromY: from.y, fromZ: from.z, launchedAt: new Date(now), arriveAt: new Date(arriveAt) })
        .returning();
      await schedule(tx, "probe.arrive", new Date(arriveAt), { probeId: row!.id });
      return { ok: true, emperorId, probe: this.view(row!) };
    });
  }

  /** Evento `probe.arrive`: la sonda descubre lo que cubre su escáner y se pierde. */
  async arrive(tx: Tx, probeId: string): Promise<{ emperorId: string; probeId: string; systemIds: string[] } | null> {
    const [row] = await tx.select().from(probes).where(eq(probes.id, probeId)).for("update").limit(1);
    if (!row) return null;
    const target = findSystem(this.seed, row.systemId);
    await tx.delete(probes).where(eq(probes.id, row.id));
    const systemIds = target ? await discoverAround(tx, this.seed, row.emperorId, target, PROBE.scannerRangeLy) : [];
    return { emperorId: row.emperorId, probeId: row.id, systemIds };
  }
}
