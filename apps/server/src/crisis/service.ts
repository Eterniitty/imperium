import { randomInt } from "node:crypto";
import { CRISES, CRISIS, type CrisisId } from "@imperium/content";
import type { CrisisStatus } from "@imperium/shared";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { crises, scheduledEvents } from "../db/schema";
import { schedule, type Tx } from "../events/queue";

/**
 * Crisis galácticas (`CRISES`): una a la vez, unas horas cada una, con
 * `CRISIS.quietHours` de calma entre una y otra. El evento `crisis.tick` las
 * empieza y programa la siguiente; los demás servicios leen la activa en
 * memoria (`factor`).
 */
export class CrisisService {
  private current: { kind: CrisisId; endsAt: number } | null = null;

  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  /** Al arrancar: carga la activa y se asegura de que hay un `crisis.tick` programado. */
  async init(): Promise<void> {
    await this.load(this.db);
    const [pending] = await this.db.select({ id: scheduledEvents.id }).from(scheduledEvents).where(eq(scheduledEvents.kind, "crisis.tick")).limit(1);
    if (!pending) {
      await this.db.transaction(async (tx) => {
        const at = this.current ? this.current.endsAt + 1000 : this.now() + 10 * 60_000;
        await schedule(tx, "crisis.tick", new Date(at), {});
      });
    }
  }

  private async load(db: Database | Tx): Promise<void> {
    const [row] = await db.select().from(crises).orderBy(desc(crises.endsAt)).limit(1);
    this.current = row && row.endsAt.getTime() > this.now() ? { kind: row.kind as CrisisId, endsAt: row.endsAt.getTime() } : null;
  }

  /** La crisis activa, o null. */
  active(): { kind: CrisisId; endsAt: number } | null {
    if (this.current && this.current.endsAt <= this.now()) this.current = null;
    return this.current;
  }

  status(): CrisisStatus {
    const c = this.active();
    return { active: c ? { id: c.kind, endsAt: c.endsAt } : null };
  }

  /** Multiplicador de un efecto si su crisis está activa (1 si no). */
  factor(effect: "quantumFuel" | "pirateRespawn" | "buildTime" | "miningYield"): number {
    const kind = this.active()?.kind;
    const by: Record<typeof effect, CrisisId> = { quantumFuel: "quantum_storm", pirateRespawn: "scavenger_surge", buildTime: "industrial_boom", miningYield: "ore_rain" };
    return kind === by[effect] ? CRISIS[effect] : 1;
  }

  /** Manejador de `crisis.tick`. Devuelve la crisis que acaba de empezar, si empezó una. */
  async tick(tx: Tx): Promise<CrisisId | null> {
    const now = this.now();
    const [last] = await tx.select().from(crises).orderBy(desc(crises.endsAt)).limit(1);
    if (last && last.endsAt.getTime() > now) {
      await schedule(tx, "crisis.tick", new Date(last.endsAt.getTime() + 1000), {});
      return null;
    }
    const calmUntil = last ? last.endsAt.getTime() + CRISIS.quietHours * 3600_000 : 0;
    if (now < calmUntil) {
      await schedule(tx, "crisis.tick", new Date(calmUntil), {});
      return null;
    }
    const total = CRISES.reduce((a, c) => a + c.weight, 0);
    let pick = randomInt(total);
    const def = CRISES.find((c) => (pick -= c.weight) < 0) ?? CRISES[0]!;
    const endsAt = now + def.hours * 3600_000;
    await tx.insert(crises).values({ kind: def.id, startedAt: new Date(now), endsAt: new Date(endsAt) });
    await schedule(tx, "crisis.tick", new Date(endsAt + 1000), {});
    this.current = { kind: def.id, endsAt };
    return def.id;
  }
}
