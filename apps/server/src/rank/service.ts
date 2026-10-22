/**
 * Rango del Emperador (`RANKS` en `@imperium/content`): suma experiencia por lo
 * que se hace en el juego (lo empujan los mismos sucesos que los contratos) y
 * da las mejoras de cada rango. El servidor decide; el cliente solo lo muestra.
 */
import { rankOf } from "@imperium/content";
import { eq, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../db/client";
import { emperors } from "../db/schema";
import type { Tx } from "../events/queue";

export class RankService {
  constructor(
    private readonly db: Database,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Suma experiencia; devuelve la nueva y si subió de rango (null si no hay tal Emperador o no se sumó nada). */
  async add(emperorId: string, amount: number, tx?: Tx): Promise<{ xp: number; up: boolean } | null> {
    const n = Math.floor(amount);
    if (!(n > 0)) return null;
    const [row] = await (tx ?? this.db)
      .update(emperors)
      .set({ xp: sql`${emperors.xp} + ${n}` })
      .where(eq(emperors.id, emperorId))
      .returning({ xp: emperors.xp });
    if (!row) return null;
    return { xp: row.xp, up: rankOf(row.xp).index > rankOf(row.xp - n).index };
  }

  async of(emperorId: string, tx?: Tx): Promise<number> {
    const [row] = await (tx ?? this.db).select({ xp: emperors.xp }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    return row?.xp ?? 0;
  }

  /** Para sucesos del espacio local (en memoria): sin esperar y sin romper nada si falla. */
  addLater(emperorId: string, amount: number, then: (r: { xp: number; up: boolean }) => void): void {
    void this.add(emperorId, amount)
      .then((r) => r && then(r))
      .catch((err: unknown) => this.log.error(err, "Error al sumar experiencia"));
  }
}
