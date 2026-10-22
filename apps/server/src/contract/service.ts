/**
 * Contratos (`docs/juego-solitario.md`): tablero de ofertas que se renueva cada
 * día (generado de forma determinista por Emperador y día), contratos aceptados
 * con su progreso y su pago al cumplirse. El progreso lo empujan sucesos que ya
 * existen (descubrir sistemas, derribar Carroñeros, extraer mineral); el
 * servidor decide y paga: el juego sigue sin el jugador.
 */
import { CONTRACTS, RANK_XP, rankOf, rankPerks, type ContractKind as Kind } from "@imperium/content";
import type { CommandError, Contract, ContractKind, ContractOffer, ContractsView } from "@imperium/shared";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { contracts } from "../db/schema";
import type { Tx } from "../events/queue";
import type { HumanityService } from "../humanity/service";
import type { RankService } from "../rank/service";
import type { ReputationService } from "../reputation/service";

const DAY_MS = 24 * 3_600_000;
const KINDS = Object.keys(CONTRACTS.kinds) as Kind[];

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

type Row = typeof contracts.$inferSelect;

/** Nivel de dificultad de un contrato (1 = el objetivo más fácil de su tipo). */
function tierOf(kind: Kind, target: number): number {
  const i = CONTRACTS.kinds[kind]?.targets.indexOf(target) ?? -1;
  return i >= 0 ? i + 1 : 1;
}

/** Punto de rescate de un contrato, para el espacio local. */
export interface RescueSpot {
  contractId: string;
  systemId: string;
  p: [number, number, number];
}

function toContract(r: Row, systemName: (id: string) => string | undefined): Contract {
  return {
    id: r.id,
    offerId: r.offerId,
    kind: r.kind as ContractKind,
    ...(r.systemId ? { systemId: r.systemId, systemName: systemName(r.systemId) } : {}),
    ...(r.point ? { point: r.point } : {}),
    target: r.target,
    progress: Math.min(r.target, Math.floor(r.progress)),
    credits: r.credits,
    reputation: r.reputation,
    status: r.status as Contract["status"],
    acceptedAt: r.acceptedAt.getTime(),
    expiresAt: r.expiresAt.getTime(),
    doneAt: r.doneAt ? r.doneAt.getTime() : null,
  };
}

export class ContractService {
  constructor(
    private readonly db: Database,
    private readonly config: ServerConfig,
    private readonly humanity: HumanityService,
    private readonly reputation: ReputationService,
    private readonly rank: RankService | null = null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Rescate: dónde quedan los restos de un contrato recién aceptado (lo pone app.ts; null si no hay sitio). */
  rescuePlace: ((emperorId: string, seed: string) => Promise<{ systemId: string; point: [number, number, number] } | null>) | null = null;
  /** Rescate: los puntos activos de un Emperador cambiaron (para el espacio local). */
  onSpots: ((emperorId: string, spots: RescueSpot[]) => void) | null = null;
  /** Nombre de un sistema (para los contratos de rescate). */
  systemName: (systemId: string) => string | undefined = () => undefined;

  /** Avisa al espacio local de los puntos de rescate activos de un Emperador. */
  async syncSpots(emperorId: string): Promise<void> {
    if (!this.onSpots) return;
    const now = this.now();
    const rows = await this.db
      .select({ id: contracts.id, systemId: contracts.systemId, point: contracts.point, expiresAt: contracts.expiresAt })
      .from(contracts)
      .where(and(eq(contracts.emperorId, emperorId), eq(contracts.kind, "rescue"), eq(contracts.status, "active")));
    this.onSpots(
      emperorId,
      rows.filter((r) => r.systemId && r.point && r.expiresAt.getTime() >= now).map((r) => ({ contractId: r.id, systemId: r.systemId!, p: r.point! })),
    );
  }

  /** Mejoras del rango de un Emperador (más contratos a la vez, más ofertas, más recompensa). */
  private async perks(emperorId: string) {
    const xp = this.rank ? await this.rank.of(emperorId) : 0;
    return rankPerks(rankOf(xp).index);
  }

  /** Día de juego (las ofertas cambian al pasar de uno a otro). */
  private day(now: number): number {
    return Math.floor((now * this.config.TIME_SCALE) / DAY_MS);
  }

  /**
   * Ofertas del día para un Emperador (las mismas cada vez que se piden ese día). Las mejoras del rango
   * añaden ofertas al final (las primeras no cambian) y suben la recompensa en créditos.
   */
  offers(emperorId: string, now = this.now(), perks = rankPerks(0)): ContractOffer[] {
    const day = this.day(now);
    const next = rng(`${emperorId}:${day}`);
    const total = KINDS.reduce((n, k) => n + CONTRACTS.kinds[k].weight, 0);
    const out: ContractOffer[] = [];
    for (let i = 0; i < CONTRACTS.offersPerDay + perks.contractOffers; i++) {
      let roll = next() * total;
      let kind: Kind = KINDS[0]!;
      for (const k of KINDS) {
        roll -= CONTRACTS.kinds[k].weight;
        if (roll <= 0) {
          kind = k;
          break;
        }
      }
      const def = CONTRACTS.kinds[kind];
      const tier = Math.min(def.targets.length - 1, Math.floor(next() * def.targets.length));
      const target = def.targets[tier]!;
      const credits = Math.round(target * def.creditsPer * (1 + perks.contractRewardPct / 100));
      out.push({ id: `${day}:${i}`, kind, target, credits, reputation: def.reputationPerTier * (tier + 1), hours: def.hours });
    }
    return out;
  }

  /** El tablero: ofertas del día que aún no se aceptaron, contratos en curso y los últimos terminados. */
  async view(emperorId: string): Promise<ContractsView> {
    const now = this.now();
    await this.expire(emperorId, now);
    const rows = await this.db.select().from(contracts).where(eq(contracts.emperorId, emperorId)).orderBy(desc(contracts.acceptedAt)).limit(30);
    const taken = new Set(rows.map((r) => r.offerId));
    const day = this.day(now);
    await this.syncSpots(emperorId);
    const perks = await this.perks(emperorId);
    return {
      offers: this.offers(emperorId, now, perks).filter((o) => !taken.has(o.id)),
      list: rows.map((r) => toContract(r, this.systemName)),
      maxActive: CONTRACTS.maxActive + perks.contractSlots,
      refreshAt: Math.ceil(((day + 1) * DAY_MS) / this.config.TIME_SCALE),
    };
  }

  /** Los que pasaron de plazo sin cumplirse caducan (sin recompensa). */
  private async expire(emperorId: string, now: number): Promise<void> {
    await this.db
      .update(contracts)
      .set({ status: "expired" })
      .where(and(eq(contracts.emperorId, emperorId), eq(contracts.status, "active"), lt(contracts.expiresAt, new Date(now))));
  }

  async accept(emperorId: string, offerId: string): Promise<{ ok: true } | { ok: false; error: CommandError }> {
    const now = this.now();
    const perks = await this.perks(emperorId);
    const offer = this.offers(emperorId, now, perks).find((o) => o.id === offerId);
    if (!offer) return { ok: false, error: "unknown_contract" };
    await this.expire(emperorId, now);
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(contracts)
      .where(and(eq(contracts.emperorId, emperorId), eq(contracts.status, "active")));
    if (n >= CONTRACTS.maxActive + perks.contractSlots) return { ok: false, error: "too_many_contracts" };
    // Rescate: el sitio de los restos se elige ahora (cerca de donde está el Emperador).
    const place = offer.kind === "rescue" ? await this.rescuePlace?.(emperorId, `${emperorId}:${offerId}`) : null;
    if (offer.kind === "rescue" && !place) return { ok: false, error: "unknown_contract" };
    const rows = await this.db
      .insert(contracts)
      .values({
        emperorId,
        offerId,
        kind: offer.kind,
        target: offer.target,
        credits: offer.credits,
        reputation: offer.reputation,
        expiresAt: new Date(now + offer.hours * 3_600_000),
        ...(place ? { systemId: place.systemId, point: place.point } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: contracts.id });
    if (rows.length === 0) return { ok: false, error: "unknown_contract" };
    if (place) await this.syncSpots(emperorId);
    return { ok: true };
  }

  async abandon(emperorId: string, contractId: string): Promise<boolean> {
    const rows = await this.db
      .update(contracts)
      .set({ status: "abandoned" })
      .where(and(eq(contracts.id, contractId), eq(contracts.emperorId, emperorId), eq(contracts.status, "active")))
      .returning({ id: contracts.id, kind: contracts.kind });
    if (rows[0]?.kind === "rescue") await this.syncSpots(emperorId);
    return rows.length > 0;
  }

  /**
   * Avanza los contratos en curso de este tipo; los que llegan a su objetivo se
   * cumplen y pagan (créditos a la cartera y reputación). Devuelve si cambió algo.
   */
  async progress(emperorId: string, kind: ContractKind, amount: number, contractId?: string): Promise<{ changed: boolean; completed: Contract[]; rank?: { xp: number; up: boolean } }> {
    if (!(amount > 0)) return { changed: false, completed: [] };
    const res = await this.progressTx(emperorId, kind, amount, contractId);
    if (kind === "rescue" && res.changed) await this.syncSpots(emperorId);
    return res;
  }

  private async progressTx(emperorId: string, kind: ContractKind, amount: number, contractId?: string): Promise<{ changed: boolean; completed: Contract[]; rank?: { xp: number; up: boolean } }> {
    const now = this.now();
    return this.db.transaction(async (tx: Tx) => {
      const active = await tx
        .select()
        .from(contracts)
        .where(and(eq(contracts.emperorId, emperorId), eq(contracts.kind, kind), eq(contracts.status, "active"), contractId ? eq(contracts.id, contractId) : undefined))
        .for("update");
      const live = active.filter((r) => r.expiresAt.getTime() >= now);
      if (live.length === 0) return { changed: false, completed: [] };
      const completed: Contract[] = [];
      let xp = 0;
      for (const r of live) {
        const progress = Math.min(r.target, r.progress + amount);
        const done = progress >= r.target;
        const [row] = await tx
          .update(contracts)
          .set({ progress, ...(done ? { status: "done", doneAt: new Date(now) } : {}) })
          .where(eq(contracts.id, r.id))
          .returning();
        if (done && row) {
          // Sin cartera aún (nunca se ha conectado desde que se creó), el pago se perdería: se crea antes.
          if (completed.length === 0) await this.humanity.recompute(tx, emperorId, now);
          await this.humanity.credit(tx, emperorId, r.credits, "contract", `contract:${r.id}`);
          await this.reputation.add(emperorId, r.reputation, tx);
          xp += RANK_XP.contractPerTier * tierOf(r.kind as Kind, r.target);
          completed.push(toContract(row, this.systemName));
        }
      }
      const rank = xp > 0 && this.rank ? await this.rank.add(emperorId, xp, tx) : null;
      return { changed: true, completed, ...(rank ? { rank } : {}) };
    });
  }

  /** Contratos de una cuenta (exportación de datos). */
  async exportFor(emperorIds: string[]) {
    if (emperorIds.length === 0) return [];
    return this.db.select().from(contracts).where(inArray(contracts.emperorId, emperorIds));
  }
}
