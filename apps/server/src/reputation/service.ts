import { REPUTATION } from "@imperium/content";
import { eq, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../db/client";
import { emperors } from "../db/schema";
import type { Tx } from "../events/queue";

/** Reputación ante la humanidad (`REPUTATION`): sumar o restar, sin pasar de los límites. */
export class ReputationService {
  constructor(
    private readonly db: Database,
    private readonly log: FastifyBaseLogger,
  ) {}

  async add(emperorId: string, delta: number, tx?: Tx): Promise<void> {
    if (!delta) return;
    await (tx ?? this.db)
      .update(emperors)
      .set({ reputation: sql`least(${REPUTATION.max}, greatest(${REPUTATION.min}, ${emperors.reputation} + ${delta}))` })
      .where(eq(emperors.id, emperorId));
  }

  /** Para el espacio local (en memoria): sin esperar y sin romper nada si falla. */
  addLater(emperorId: string, delta: number): void {
    void this.add(emperorId, delta).catch((err: unknown) => this.log.error(err, "Error al cambiar la reputación"));
  }

  async of(emperorId: string): Promise<number> {
    const [row] = await this.db.select({ r: emperors.reputation }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    return row?.r ?? 0;
  }
}
