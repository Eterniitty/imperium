/**
 * Objetivos del día y de la semana (`GOALS` en `@imperium/content`): se
 * generan de forma determinista por Emperador y periodo, avanzan con los mismos
 * sucesos que los contratos y pagan experiencia (con la racha) y créditos.
 * Solo se guardan los del periodo en curso.
 */
import { GOALS, goalXp, type GoalKind, type GoalPeriodDef } from "@imperium/content";
import type { Goal, GoalsView } from "@imperium/shared";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { emperors, goals } from "../db/schema";
import type { Tx } from "../events/queue";
import type { HumanityService } from "../humanity/service";
import type { RankService } from "../rank/service";

const DAY_MS = 24 * 3_600_000;
const KINDS: GoalKind[] = ["hunt", "explore", "mine", "contract"];

/** Número pseudoaleatorio estable a partir de un texto (FNV-1a + xorshift). */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}

type Row = typeof goals.$inferSelect;

export class GoalService {
  constructor(
    private readonly db: Database,
    private readonly config: ServerConfig,
    private readonly humanity: HumanityService,
    private readonly rank: RankService,
    private readonly now: () => number = Date.now,
  ) {}

  private day(now: number): number {
    return Math.floor((now * this.config.TIME_SCALE) / DAY_MS);
  }

  /** Periodos en curso: `d:<día>` y `w:<semana>`. */
  private periods(now: number): { day: number; daily: string; weekly: string } {
    const day = this.day(now);
    return { day, daily: `d:${day}`, weekly: `w:${Math.floor(day / 7)}` };
  }

  /** Los objetivos de un periodo (deterministas: los mismos cada vez). */
  private generate(emperorId: string, period: string, def: GoalPeriodDef, count: number): Array<{ idx: number; kind: GoalKind; target: number }> {
    const next = rng(`${emperorId}:${period}`);
    const pool = [...KINDS];
    const out: Array<{ idx: number; kind: GoalKind; target: number }> = [];
    for (let idx = 0; idx < count && pool.length; idx++) {
      const kind = pool.splice(Math.floor(next() * pool.length), 1)[0]!;
      const targets = def.kinds[kind];
      out.push({ idx, kind, target: targets[Math.floor(next() * targets.length)]! });
    }
    return out;
  }

  /** Crea los objetivos del periodo en curso si faltan y borra los de periodos pasados. */
  private async ensure(tx: Tx | Database, emperorId: string, now: number): Promise<{ day: number; daily: string; weekly: string }> {
    const p = this.periods(now);
    // La minería llega en tandas pequeñas: no se rehace en cada una si ya están los de este periodo.
    if (this.ensured.get(emperorId) === p.daily) return p;
    await tx.delete(goals).where(and(eq(goals.emperorId, emperorId), notInArray(goals.period, [p.daily, p.weekly])));
    const rows = [
      ...this.generate(emperorId, p.daily, GOALS.daily, GOALS.dailyCount).map((g) => ({ ...g, period: p.daily })),
      ...this.generate(emperorId, p.weekly, GOALS.weekly, 1).map((g) => ({ ...g, period: p.weekly })),
    ];
    await tx
      .insert(goals)
      .values(rows.map((g) => ({ emperorId, period: g.period, idx: g.idx, kind: g.kind, target: g.target })))
      .onConflictDoNothing();
    if (this.ensured.size > 50_000) this.ensured.clear();
    this.ensured.set(emperorId, p.daily);
    return p;
  }

  /** Último periodo del día ya preparado para cada Emperador (en memoria). */
  private readonly ensured = new Map<string, string>();

  /** Racha vigente: se rompe si ayer no se cumplieron los tres. */
  private streakOf(row: { goalStreak: number; goalStreakDay: number } | undefined, day: number): number {
    return row && row.goalStreakDay >= day - 1 ? row.goalStreak : 0;
  }

  private toGoal(r: Row, def: GoalPeriodDef, streak: number): Goal {
    return {
      id: r.id,
      kind: r.kind as GoalKind,
      target: r.target,
      progress: Math.min(r.target, Math.floor(r.progress)),
      done: r.doneAt !== null,
      xp: goalXp(def.xp, streak),
      credits: def.credits,
    };
  }

  async view(emperorId: string): Promise<GoalsView> {
    const now = this.now();
    const p = await this.ensure(this.db, emperorId, now);
    let rows = await this.db.select().from(goals).where(eq(goals.emperorId, emperorId));
    // La caché decía que ya estaban, pero no (una transacción que se deshizo): se vuelven a crear.
    if (!rows.some((r) => r.period === p.daily)) {
      this.ensured.delete(emperorId);
      await this.ensure(this.db, emperorId, now);
      rows = await this.db.select().from(goals).where(eq(goals.emperorId, emperorId));
    }
    const [me] = await this.db.select({ goalStreak: emperors.goalStreak, goalStreakDay: emperors.goalStreakDay }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    const streak = this.streakOf(me, p.day);
    const weekStart = Math.floor(p.day / 7) * 7;
    return {
      daily: rows
        .filter((r) => r.period === p.daily)
        .sort((a, b) => a.idx - b.idx)
        .map((r) => this.toGoal(r, GOALS.daily, streak)),
      weekly: rows.filter((r) => r.period === p.weekly).map((r) => this.toGoal(r, GOALS.weekly, streak))[0] ?? null,
      streak,
      dayEndsAt: Math.ceil(((p.day + 1) * DAY_MS) / this.config.TIME_SCALE),
      weekEndsAt: Math.ceil(((weekStart + 7) * DAY_MS) / this.config.TIME_SCALE),
    };
  }

  /**
   * Avanza los objetivos de este tipo; los que se cumplen pagan experiencia y
   * créditos, y cumplir los tres del día suma un día a la racha.
   */
  async progress(emperorId: string, kind: GoalKind, amount: number): Promise<{ changed: boolean; rank?: { xp: number; up: boolean } }> {
    if (!(amount > 0)) return { changed: false };
    const now = this.now();
    return this.db.transaction(async (tx: Tx) => {
      const p = await this.ensure(tx, emperorId, now);
      const open = await tx
        .select()
        .from(goals)
        .where(and(eq(goals.emperorId, emperorId), eq(goals.kind, kind), inArray(goals.period, [p.daily, p.weekly]), isNull(goals.doneAt)))
        .for("update");
      if (open.length === 0) return { changed: false };
      const [me] = await tx.select({ goalStreak: emperors.goalStreak, goalStreakDay: emperors.goalStreakDay }).from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
      let streak = this.streakOf(me, p.day);
      let xp = 0;
      let credits = 0;
      let dailyDone = false;
      for (const r of open) {
        const progress = Math.min(r.target, r.progress + amount);
        const done = progress >= r.target;
        await tx
          .update(goals)
          .set({ progress, ...(done ? { doneAt: new Date(now) } : {}) })
          .where(eq(goals.id, r.id));
        if (!done) continue;
        const def = r.period === p.daily ? GOALS.daily : GOALS.weekly;
        xp += goalXp(def.xp, streak);
        credits += def.credits;
        if (r.period === p.daily) dailyDone = true;
      }
      // Los tres del día cumplidos: un día más de racha (una vez por día).
      if (dailyDone && me && me.goalStreakDay !== p.day) {
        const [{ left } = { left: 1 }] = await tx
          .select({ left: sql<number>`count(*)::int` })
          .from(goals)
          .where(and(eq(goals.emperorId, emperorId), eq(goals.period, p.daily), isNull(goals.doneAt)));
        if (left === 0) {
          streak = streak + 1;
          await tx.update(emperors).set({ goalStreak: streak, goalStreakDay: p.day }).where(eq(emperors.id, emperorId));
        }
      }
      if (credits > 0) {
        await this.humanity.recompute(tx, emperorId, now);
        await this.humanity.credit(tx, emperorId, credits, "goal", `goal:${p.daily}`);
      }
      const rank = xp > 0 ? await this.rank.add(emperorId, xp, tx) : null;
      return { changed: true, ...(rank ? { rank } : {}) };
    });
  }
}
