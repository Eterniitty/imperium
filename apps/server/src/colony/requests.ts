/**
 * Peticiones de las colonias (`COLONY_REQUESTS` en `@imperium/content`): se
 * crean y vencen con el recálculo periódico de la cartera (`economy.settle`,
 * una vez por hora de juego), así que pasan también sin el jugador. La escasez
 * avanza con lo que llega a la colonia; el malestar se calma pagando.
 */
import { COLONY_REQUESTS, type ColonyRequestKind, type ShortageResource } from "@imperium/content";
import type { ColonyRequest, CommandError } from "@imperium/shared";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { colonies, colonyRequests, emperors } from "../db/schema";
import type { Tx } from "../events/queue";
import type { HumanityService } from "../humanity/service";
import type { RankService } from "../rank/service";
import type { ReputationService } from "../reputation/service";
import type { ColonyService } from "./service";

type Row = typeof colonyRequests.$inferSelect;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export class ColonyRequestService {
  constructor(
    private readonly db: Database,
    private readonly colonies: ColonyService,
    private readonly humanity: HumanityService,
    private readonly reputation: ReputationService,
    private readonly rank: RankService,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  /** Nombre de una colonia sin bautizar: la designación de su planeta (lo pone app.ts). */
  planetName: (systemId: string, planetIndex: number) => string = () => "";

  /** Las abiertas y las últimas terminadas de un Emperador, con el nombre y el sitio de su colonia. */
  async view(emperorId: string): Promise<ColonyRequest[]> {
    const rows = await this.db
      .select({ r: colonyRequests, name: colonies.name, systemId: colonies.systemId, planetIndex: colonies.planetIndex })
      .from(colonyRequests)
      .innerJoin(colonies, eq(colonies.id, colonyRequests.colonyId))
      .where(eq(colonyRequests.emperorId, emperorId))
      .orderBy(desc(colonyRequests.createdAt))
      .limit(12);
    return rows.map(({ r, name, systemId, planetIndex }) => ({
      id: r.id,
      colonyId: r.colonyId,
      colonyName: name ?? this.planetName(systemId, planetIndex),
      systemId,
      planetIndex,
      kind: r.kind as ColonyRequestKind,
      ...(r.resource ? { resource: r.resource as ShortageResource } : {}),
      amount: r.amount,
      progress: Math.min(r.amount, Math.floor(r.progress)),
      status: r.status as ColonyRequest["status"],
      expiresAt: r.expiresAt.getTime(),
    }));
  }

  /**
   * Cada recálculo de la cartera: vencen las pasadas de plazo (la colonia pierde
   * población) y, con cierta probabilidad, una colonia pide algo. Devuelve si cambió algo.
   */
  async tick(tx: Tx, emperorId: string): Promise<boolean> {
    const now = this.now();
    const [me] = await tx.select({ kind: emperors.kind }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    if (!me || me.kind !== "player") return false;
    let changed = false;
    const overdue = await tx
      .select()
      .from(colonyRequests)
      .where(and(eq(colonyRequests.emperorId, emperorId), eq(colonyRequests.status, "active"), lt(colonyRequests.expiresAt, new Date(now))))
      .for("update");
    for (const r of overdue) {
      await tx.update(colonyRequests).set({ status: "failed", doneAt: new Date(now) }).where(eq(colonyRequests.id, r.id));
      const c = await this.colonies.lockResolved(tx, emperorId, r.colonyId, now);
      if (c) await this.colonies.writeState(tx, r.colonyId, { ...c.state, population: c.state.population * (1 - COLONY_REQUESTS.penalty.popPct / 100) }, now);
      changed = true;
    }
    if (this.random() >= COLONY_REQUESTS.chancePerHour) return changed;
    const open = await tx
      .select({ colonyId: colonyRequests.colonyId })
      .from(colonyRequests)
      .where(and(eq(colonyRequests.emperorId, emperorId), eq(colonyRequests.status, "active")));
    if (open.length >= COLONY_REQUESTS.maxActive) return changed;
    const busy = new Set(open.map((o) => o.colonyId));
    const mine = (await tx.select({ id: colonies.id, population: colonies.population }).from(colonies).where(eq(colonies.emperorId, emperorId))).filter(
      (c) => !busy.has(c.id) && c.population >= COLONY_REQUESTS.minPopulation,
    );
    if (mine.length === 0) return changed;
    const colony = mine[Math.floor(this.random() * mine.length)]!;
    const W = COLONY_REQUESTS.weights;
    const kind: ColonyRequestKind = this.random() * (W.shortage + W.unrest) < W.shortage ? "shortage" : "unrest";
    const S = COLONY_REQUESTS.shortage;
    const U = COLONY_REQUESTS.unrest;
    const values =
      kind === "shortage"
        ? { resource: S.resources[Math.floor(this.random() * S.resources.length)]!, amount: Math.round(clamp(colony.population * S.perPop, S.min, S.max)) }
        : { resource: null, amount: Math.round(clamp(colony.population * U.creditsPerPop, U.min, U.max)) };
    await tx.insert(colonyRequests).values({ emperorId, colonyId: colony.id, kind, ...values, expiresAt: new Date(now + COLONY_REQUESTS.hours * 3_600_000) });
    return true;
  }

  /**
   * Llegó carga a una colonia propia: avanza su escasez si pide ese recurso.
   * Devuelve las que se cumplieron (para avisar y pagar fuera).
   */
  async delivered(emperorId: string, colonyId: string, amounts: Partial<Record<string, number>>): Promise<{ changed: boolean; done: number }> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(colonyRequests)
        .where(and(eq(colonyRequests.emperorId, emperorId), eq(colonyRequests.colonyId, colonyId), eq(colonyRequests.kind, "shortage"), eq(colonyRequests.status, "active")))
        .for("update");
      let changed = false;
      let done = 0;
      for (const r of rows) {
        const add = r.resource ? (amounts[r.resource] ?? 0) : 0;
        if (!(add > 0) || r.expiresAt.getTime() < now) continue;
        const progress = Math.min(r.amount, r.progress + add);
        changed = true;
        await tx.update(colonyRequests).set({ progress }).where(eq(colonyRequests.id, r.id));
        if (progress >= r.amount) {
          await this.complete(tx, emperorId, r, now);
          done++;
        }
      }
      return { changed, done };
    });
  }

  /** Malestar: paga los créditos que pide la colonia y queda calmada. */
  async pay(emperorId: string, id: string): Promise<{ ok: true } | { ok: false; error: CommandError }> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(colonyRequests)
        .where(and(eq(colonyRequests.id, id), eq(colonyRequests.emperorId, emperorId), eq(colonyRequests.status, "active")))
        .for("update")
        .limit(1);
      if (!r || r.kind !== "unrest" || r.expiresAt.getTime() < now) return { ok: false, error: "not_present" } as const;
      if (!(await this.humanity.spend(tx, emperorId, r.amount, "colony_request", `request:${r.id}`, now))) return { ok: false, error: "insufficient_resources" } as const;
      await tx.update(colonyRequests).set({ progress: r.amount }).where(eq(colonyRequests.id, r.id));
      await this.complete(tx, emperorId, r, now);
      return { ok: true } as const;
    });
  }

  /** Cumplida: la colonia crece (sin pasar de su tope), y su dueño gana reputación y experiencia. */
  private async complete(tx: Tx, emperorId: string, r: Row, now: number): Promise<void> {
    await tx.update(colonyRequests).set({ status: "done", doneAt: new Date(now) }).where(eq(colonyRequests.id, r.id));
    const c = await this.colonies.lockResolved(tx, emperorId, r.colonyId, now);
    if (c) await this.colonies.writeState(tx, r.colonyId, { ...c.state, population: Math.min(c.cap, c.state.population * (1 + COLONY_REQUESTS.reward.popPct / 100)) }, now);
    await this.reputation.add(emperorId, COLONY_REQUESTS.reward.reputation, tx);
    await this.rank.add(emperorId, COLONY_REQUESTS.reward.xp, tx);
  }

  /** Peticiones de una cuenta (exportación de datos). */
  async exportFor(emperorIds: string[]) {
    if (emperorIds.length === 0) return [];
    return this.db.select().from(colonyRequests).where(inArray(colonyRequests.emperorId, emperorIds));
  }
}

/** Para los tests: cuántas abiertas tiene un Emperador. */
export async function openRequests(db: Database, emperorId: string): Promise<number> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(colonyRequests)
    .where(and(eq(colonyRequests.emperorId, emperorId), eq(colonyRequests.status, "active")));
  return n;
}
