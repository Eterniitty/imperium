import { isTechTree, TECH, techLevel, type TechLevels, type TechTree } from "@imperium/content";
import type { CommandError, ResearchStatus } from "@imperium/shared";
import { realDurationMs } from "@imperium/sim";
import { eq } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Wallet } from "../colony/service";
import type { Database } from "../db/client";
import { emperors } from "../db/schema";
import { schedule, type Tx } from "../events/queue";

/** Margen para dar por terminada una investigación algo antes de su hora (el trabajador va con retraso). */
const FINISH_TOLERANCE_MS = 1500;

/**
 * Tecnología por niveles (`TECH` en `@imperium/content`): una investigación a
 * la vez por Emperador, pagada con créditos al empezarla; el evento
 * `research.done` sube el nivel al terminar.
 */
export class ResearchService {
  private readonly timeScale: number;
  private wallet: Wallet | null = null;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "TIME_SCALE">,
    private readonly now: () => number = Date.now,
  ) {
    this.timeScale = config.TIME_SCALE;
  }

  setWallet(wallet: Wallet): void {
    this.wallet = wallet;
  }

  /** Niveles de un Emperador (para los efectos en combate, viajes y construcción). */
  async levels(db: Database | Tx, emperorId: string): Promise<TechLevels> {
    const [row] = await db.select({ tech: emperors.tech }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    return (row?.tech ?? {}) as TechLevels;
  }

  async status(emperorId: string): Promise<ResearchStatus | null> {
    const [row] = await this.db.select({ tech: emperors.tech, research: emperors.research }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    if (!row) return null;
    return { levels: row.tech, current: row.research ?? null };
  }

  /** Empieza a investigar el siguiente nivel de una rama. */
  async start(emperorId: string, tree: string): Promise<{ ok: true; status: ResearchStatus } | { ok: false; error: CommandError }> {
    if (!isTechTree(tree)) return { ok: false, error: "invalid_command" };
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select({ tech: emperors.tech, research: emperors.research, deadAt: emperors.deadAt }).from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
      if (!row) return { ok: false as const, error: "no_emperor" as const };
      // Muerto (gestándose), como con las demás órdenes, no se manda nada.
      if (row.deadAt) return { ok: false as const, error: "dead" as const };
      if (row.research) return { ok: false as const, error: "research_busy" as const };
      const level = techLevel(row.tech as TechLevels, tree as TechTree) + 1;
      if (level > TECH.maxLevel) return { ok: false as const, error: "max_level" as const };
      const now = this.now();
      const credits = TECH.credits[level - 1]!;
      if (!(await this.wallet?.spend(tx, emperorId, credits, "research", `${tree}:${level}`, now))) return { ok: false as const, error: "insufficient_credits" as const };
      const finishAt = now + realDurationMs(TECH.hours[level - 1]!, this.timeScale);
      const research = { tree, level, finishAt };
      await tx.update(emperors).set({ research }).where(eq(emperors.id, emperorId));
      await schedule(tx, "research.done", new Date(finishAt), { emperorId });
      return { ok: true as const, status: { levels: row.tech, current: research } };
    });
  }

  /** Manejador de `research.done`: sube el nivel. Devuelve el Emperador si terminó. */
  async complete(tx: Tx, emperorId: string): Promise<string | null> {
    const [row] = await tx.select({ tech: emperors.tech, research: emperors.research }).from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
    const r = row?.research;
    if (!row || !r) return null;
    if (r.finishAt > this.now() + FINISH_TOLERANCE_MS) {
      await schedule(tx, "research.done", new Date(r.finishAt), { emperorId });
      return null;
    }
    await tx.update(emperors).set({ tech: { ...row.tech, [r.tree]: r.level }, research: null }).where(eq(emperors.id, emperorId));
    return emperorId;
  }
}
