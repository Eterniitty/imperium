import { getMercenaryOffer, getShipClass, MERCENARIES } from "@imperium/content";
import type { CommandError } from "@imperium/shared";
import { isTravelling } from "@imperium/sim";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { emperors, fleets, mercenaryContracts, ships } from "../db/schema";
import type { EmperorService } from "../emperor/service";
import { schedule, type Tx } from "../events/queue";
import type { HumanityService } from "../humanity/service";
import { realDurationMs } from "@imperium/sim";

export type MercenaryHireResult = { ok: true; emperorId: string; fleetId: string } | { ok: false; error: CommandError };

/**
 * Mercenarios (`MERCENARIES`, fase 3 del plan): se contratan con créditos donde
 * esté la nave del Emperador (parada, no en pleno salto) y aparecen allí como
 * una flota propia. Al acabar el contrato (evento `mercenary.leave`) se marchan;
 * si están combatiendo, al terminar la batalla.
 */
export class MercenaryService {
  constructor(
    private readonly db: Database,
    private readonly timeScale: number,
    private readonly emperors: EmperorService,
    private readonly humanity: HumanityService,
    private readonly now: () => number = Date.now,
  ) {}

  /** Orden `mercenary.hire`. */
  async hire(emperorId: string, offerId: string): Promise<MercenaryHireResult> {
    const offer = getMercenaryOffer(offerId);
    if (!offer) return { ok: false, error: "invalid_command" };
    const emperor = await this.emperors.byId(emperorId);
    if (!emperor) return { ok: false, error: "no_emperor" };
    if (emperor.gestating) return { ok: false, error: "dead" };
    const now = this.now();
    if (isTravelling(emperor, now)) return { ok: false, error: "in_transit" };
    const systemId = emperor.location.systemId;
    return this.db.transaction(async (tx): Promise<MercenaryHireResult> => {
      // Bloquea al Emperador: el tope de contratos y el número de flota se comprueban sin carreras.
      await tx.select({ id: emperors.id }).from(emperors).where(eq(emperors.id, emperorId)).for("update");
      const [{ n: active } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(mercenaryContracts).where(eq(mercenaryContracts.emperorId, emperorId));
      if (active >= MERCENARIES.maxActive) return { ok: false, error: "limit_reached" };
      if (!(await this.humanity.spend(tx, emperorId, offer.credits, "mercenary", offer.id, now))) return { ok: false, error: "insufficient_credits" };
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`coalesce(max(${fleets.number}), 0)::int` }).from(fleets).where(eq(fleets.emperorId, emperorId));
      const [fleet] = await tx.insert(fleets).values({ emperorId, number: n + 1, systemId }).returning({ id: fleets.id });
      const rows = offer.ships.flatMap(([classId, count]) => Array.from({ length: count }, () => ({ fleetId: fleet!.id, classId, hull: getShipClass(classId)!.hull })));
      await tx.insert(ships).values(rows);
      const endsAt = new Date(now + realDurationMs(offer.hours, this.timeScale));
      await tx.insert(mercenaryContracts).values({ fleetId: fleet!.id, emperorId, offerId: offer.id, endsAt });
      await schedule(tx, "mercenary.leave", endsAt, { fleetId: fleet!.id });
      return { ok: true, emperorId, fleetId: fleet!.id };
    });
  }

  /** Evento `mercenary.leave`: se marchan (o, en plena batalla, esperan a que acabe). Devuelve su dueño si se fueron. */
  async leave(tx: Tx, fleetId: string): Promise<{ emperorId: string; fleetId: string } | null> {
    const [f] = await tx.select({ emperorId: fleets.emperorId, battleId: fleets.battleId }).from(fleets).where(eq(fleets.id, fleetId)).for("update").limit(1);
    if (!f) return null;
    if (f.battleId) {
      await schedule(tx, "mercenary.leave", new Date(this.now() + realDurationMs(0.25, this.timeScale)), { fleetId });
      return null;
    }
    await tx.delete(fleets).where(eq(fleets.id, fleetId));
    return { emperorId: f.emperorId, fleetId };
  }
}
