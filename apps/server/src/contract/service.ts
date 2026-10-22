/**
 * Contratos (`docs/juego-solitario.md`): tablero de ofertas que se renueva cada
 * día (generado de forma determinista por Emperador y día), contratos aceptados
 * con su progreso y su pago al cumplirse. El progreso lo empujan sucesos que ya
 * existen (descubrir sistemas, derribar Carroñeros, extraer mineral); el
 * servidor decide y paga: el juego sigue sin el jugador.
 */
import { CONTRACTS, type ContractKind as Kind } from "@imperium/content";
import type { CommandError, Contract, ContractKind, ContractOffer, ContractsView } from "@imperium/shared";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { contracts } from "../db/schema";
import type { Tx } from "../events/queue";
import type { HumanityService } from "../humanity/service";
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

function toContract(r: Row): Contract {
  return {
    id: r.id,
    offerId: r.offerId,
    kind: r.kind as ContractKind,
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
    private readonly now: () => number = Date.now,
  ) {}

  /** Día de juego (las ofertas cambian al pasar de uno a otro). */
  private day(now: number): number {
    return Math.floor((now * this.config.TIME_SCALE) / DAY_MS);
  }

  /** Ofertas del día para un Emperador (las mismas cada vez que se piden ese día). */
  offers(emperorId: string, now = this.now()): ContractOffer[] {
    const day = this.day(now);
    const next = rng(`${emperorId}:${day}`);
    const total = KINDS.reduce((n, k) => n + CONTRACTS.kinds[k].weight, 0);
    const out: ContractOffer[] = [];
    for (let i = 0; i < CONTRACTS.offersPerDay; i++) {
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
      out.push({ id: `${day}:${i}`, kind, target, credits: Math.round(target * def.creditsPer), reputation: def.reputationPerTier * (tier + 1), hours: def.hours });
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
    return {
      offers: this.offers(emperorId, now).filter((o) => !taken.has(o.id)),
      list: rows.map(toContract),
      maxActive: CONTRACTS.maxActive,
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
    const offer = this.offers(emperorId, now).find((o) => o.id === offerId);
    if (!offer) return { ok: false, error: "unknown_contract" };
    await this.expire(emperorId, now);
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(contracts)
      .where(and(eq(contracts.emperorId, emperorId), eq(contracts.status, "active")));
    if (n >= CONTRACTS.maxActive) return { ok: false, error: "too_many_contracts" };
    const rows = await this.db
      .insert(contracts)
      .values({ emperorId, offerId, kind: offer.kind, target: offer.target, credits: offer.credits, reputation: offer.reputation, expiresAt: new Date(now + offer.hours * 3_600_000) })
      .onConflictDoNothing()
      .returning({ id: contracts.id });
    if (rows.length === 0) return { ok: false, error: "unknown_contract" };
    return { ok: true };
  }

  async abandon(emperorId: string, contractId: string): Promise<boolean> {
    const rows = await this.db
      .update(contracts)
      .set({ status: "abandoned" })
      .where(and(eq(contracts.id, contractId), eq(contracts.emperorId, emperorId), eq(contracts.status, "active")))
      .returning({ id: contracts.id });
    return rows.length > 0;
  }

  /**
   * Avanza los contratos en curso de este tipo; los que llegan a su objetivo se
   * cumplen y pagan (créditos a la cartera y reputación). Devuelve si cambió algo.
   */
  async progress(emperorId: string, kind: ContractKind, amount: number): Promise<{ changed: boolean; completed: Contract[] }> {
    if (!(amount > 0)) return { changed: false, completed: [] };
    const now = this.now();
    return this.db.transaction(async (tx: Tx) => {
      const active = await tx
        .select()
        .from(contracts)
        .where(and(eq(contracts.emperorId, emperorId), eq(contracts.kind, kind), eq(contracts.status, "active")))
        .for("update");
      const live = active.filter((r) => r.expiresAt.getTime() >= now);
      if (live.length === 0) return { changed: false, completed: [] };
      const completed: Contract[] = [];
      for (const r of live) {
        const progress = Math.min(r.target, r.progress + amount);
        const done = progress >= r.target;
        const [row] = await tx
          .update(contracts)
          .set({ progress, ...(done ? { status: "done", doneAt: new Date(now) } : {}) })
          .where(eq(contracts.id, r.id))
          .returning();
        if (done && row) {
          await this.humanity.credit(tx, emperorId, r.credits, "contract", `contract:${r.id}`);
          await this.reputation.add(emperorId, r.reputation, tx);
          completed.push(toContract(row));
        }
      }
      return { changed: true, completed };
    });
  }

  /** Contratos de una cuenta (exportación de datos). */
  async exportFor(emperorIds: string[]) {
    if (emperorIds.length === 0) return [];
    return this.db.select().from(contracts).where(inArray(contracts.emperorId, emperorIds));
  }
}
