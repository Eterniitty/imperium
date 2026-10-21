import { COMPANION_REQUEST_TTL_HOURS, type CompanionInboxResponse, type CompanionRequestResponse } from "@imperium/shared";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Database } from "../db/client";
import { companionRequests, emperors } from "../db/schema";
import { nameKey } from "./world";

export type CompanionRequestResult = { ok: true } | { ok: false; error: "emperor_exists" | "name_taken" | "unknown_emperor" };
export type CompanionRespondResult = { ok: true; accountId: string } | { ok: false; error: "invalid_or_expired" };

const TTL_MS = COMPANION_REQUEST_TTL_HOURS * 3600_000;

/**
 * Alta con compañero: una cuenta que aún no tiene Emperador pide aparecer
 * cerca de un Emperador existente; este la acepta o la rechaza desde el juego.
 * Crear el Emperador (y elegir el sistema cercano) lo hace `EmperorService.create`.
 */
export class CompanionService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  private cutoff(): Date {
    return new Date(this.now() - TTL_MS);
  }

  /** La solicitud de la cuenta (la que envió), con el nombre del compañero. */
  async forAccount(accountId: string): Promise<CompanionRequestResponse> {
    const [row] = await this.db
      .select({ name: companionRequests.name, companion: emperors.name, status: companionRequests.status, createdAt: companionRequests.createdAt })
      .from(companionRequests)
      .innerJoin(emperors, eq(emperors.id, companionRequests.targetId))
      .where(eq(companionRequests.accountId, accountId))
      .limit(1);
    if (!row) return { request: null };
    const expired = row.status === "pending" && row.createdAt.getTime() < this.cutoff().getTime();
    return {
      request: {
        name: row.name,
        companion: row.companion,
        status: expired ? "expired" : (row.status as "pending" | "accepted" | "rejected"),
        createdAt: row.createdAt.getTime(),
      },
    };
  }

  /**
   * Envía (o reemplaza) la solicitud de la cuenta. Comprueba de antemano que el
   * nombre esté libre, aunque no lo reserva: se vuelve a comprobar al crear.
   */
  async request(accountId: string, name: string, companionName: string): Promise<CompanionRequestResult> {
    const [own] = await this.db.select({ id: emperors.id }).from(emperors).where(eq(emperors.accountId, accountId)).limit(1);
    if (own) return { ok: false, error: "emperor_exists" };
    const [taken] = await this.db.select({ id: emperors.id }).from(emperors).where(eq(emperors.nameKey, nameKey(name))).limit(1);
    if (taken) return { ok: false, error: "name_taken" };
    const [target] = await this.db
      .select({ id: emperors.id })
      .from(emperors)
      // Solo Emperadores de jugadores: la IA no puede responder.
      .where(and(eq(emperors.nameKey, nameKey(companionName.normalize("NFC").trim().replace(/\s+/gu, " "))), eq(emperors.kind, "player")))
      .limit(1);
    if (!target) return { ok: false, error: "unknown_emperor" };
    const values = { targetId: target.id, name, status: "pending", createdAt: new Date(this.now()), respondedAt: null };
    await this.db
      .insert(companionRequests)
      .values({ accountId, ...values })
      .onConflictDoUpdate({ target: companionRequests.accountId, set: values });
    return { ok: true };
  }

  /** Retira la solicitud de la cuenta (para empezar solo o probar con otro compañero). */
  async cancel(accountId: string): Promise<void> {
    await this.db.delete(companionRequests).where(eq(companionRequests.accountId, accountId));
  }

  /** Solicitudes pendientes (y vigentes) que ha recibido un Emperador. */
  async inbox(emperorId: string): Promise<CompanionInboxResponse> {
    const rows = await this.db
      .select({ id: companionRequests.id, name: companionRequests.name, createdAt: companionRequests.createdAt })
      .from(companionRequests)
      .where(and(eq(companionRequests.targetId, emperorId), eq(companionRequests.status, "pending"), gte(companionRequests.createdAt, this.cutoff())))
      .orderBy(asc(companionRequests.createdAt));
    return { requests: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.getTime() })) };
  }

  /** Acepta o rechaza una solicitud pendiente dirigida a este Emperador. */
  async respond(emperorId: string, id: string, accept: boolean): Promise<CompanionRespondResult> {
    const [row] = await this.db
      .update(companionRequests)
      .set({ status: accept ? "accepted" : "rejected", respondedAt: new Date(this.now()) })
      .where(
        and(
          eq(companionRequests.id, id),
          eq(companionRequests.targetId, emperorId),
          eq(companionRequests.status, "pending"),
          gte(companionRequests.createdAt, this.cutoff()),
        ),
      )
      .returning({ accountId: companionRequests.accountId });
    return row ? { ok: true, accountId: row.accountId } : { ok: false, error: "invalid_or_expired" };
  }
}
