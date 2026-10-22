import { isDeepId, type AllyEntry, type CompanionTrailResponse, type SocialResponse, type Visibility } from "@imperium/shared";
import { AI_COMPANIONS, AI_EMPERORS, REPUTATION } from "@imperium/content";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { emperorAllies, emperors, sieges, systemParks } from "../db/schema";
import { nameKey } from "../emperor/world";

export type AddAllyResult = { ok: true; allyId: string } | { ok: false; error: "unknown_emperor" | "cannot_ally_self" };

/** Quién puede ver a quién: visibilidad de cada Emperador y compañeros (aliados mutuos). */
export class SocialService {
  constructor(private readonly db: Database) {}

  /** Compañeros de un Emperador: los que lo han añadido y a los que él ha añadido. */
  async mutualAllies(emperorId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ emperorId: emperorAllies.emperorId, allyId: emperorAllies.allyId })
      .from(emperorAllies)
      .where(or(eq(emperorAllies.emperorId, emperorId), eq(emperorAllies.allyId, emperorId)));
    const added = new Set(rows.filter((r) => r.emperorId === emperorId).map((r) => r.allyId));
    const addedMe = new Set(rows.filter((r) => r.allyId === emperorId).map((r) => r.emperorId));
    return new Set([...added].filter((id) => addedMe.has(id)));
  }

  async visibility(emperorId: string): Promise<Visibility> {
    const [row] = await this.db.select({ v: emperors.visibility }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    return (row?.v ?? "hidden") as Visibility;
  }

  /** Visibilidad de varios Emperadores a la vez. */
  async visibilities(): Promise<Map<string, Visibility>> {
    const rows = await this.db.select({ id: emperors.id, v: emperors.visibility }).from(emperors);
    return new Map(rows.map((r) => [r.id, r.v as Visibility]));
  }

  async setVisibility(emperorId: string, visibility: Visibility): Promise<void> {
    await this.db.update(emperors).set({ visibility }).where(eq(emperors.id, emperorId));
  }

  /** Añade como compañero al Emperador con ese nombre (sin distinguir mayúsculas ni formas Unicode). */
  async addAlly(emperorId: string, name: string): Promise<AddAllyResult> {
    const [target] = await this.db
      .select({ id: emperors.id, kind: emperors.kind, name: emperors.name })
      .from(emperors)
      .where(eq(emperors.nameKey, nameKey(name.normalize("NFC").trim().replace(/\s+/gu, " "))))
      .limit(1);
    if (!target) return { ok: false, error: "unknown_emperor" };
    if (target.id === emperorId) return { ok: false, error: "cannot_ally_self" };
    await this.db.insert(emperorAllies).values({ emperorId, allyId: target.id }).onConflictDoNothing();
    if (target.kind === "ai" && (await this.aiAccepts(emperorId, target.id, target.name))) {
      await this.db.insert(emperorAllies).values({ emperorId: target.id, allyId: emperorId }).onConflictDoNothing();
    }
    return { ok: true, allyId: target.id };
  }

  /** Un Emperador de la IA contesta a una petición de compañero según su personalidad (`AI_COMPANIONS`). */
  private async aiAccepts(fromId: string, aiId: string, aiName: string): Promise<boolean> {
    const personality = AI_EMPERORS.find((e) => e.name === aiName)?.personality ?? "expansionist";
    // Reputación ante la humanidad: con buena fama acepta incluso la IA militarista (`REPUTATION.aiPact`).
    const [from] = await this.db.select({ r: emperors.reputation }).from(emperors).where(eq(emperors.id, fromId)).limit(1);
    const minRep = REPUTATION.aiPact[personality] ?? 0;
    if ((from?.r ?? 0) < minRep) return false;
    if (!AI_COMPANIONS.acceptCompanions.includes(personality) && (from?.r ?? 0) < (REPUTATION.aiPact.militarist ?? 40)) return false;
    const [war] = await this.db
      .select({ id: sieges.id })
      .from(sieges)
      .where(and(isNull(sieges.endedAt), or(and(eq(sieges.attackerId, fromId), eq(sieges.defenderId, aiId)), and(eq(sieges.attackerId, aiId), eq(sieges.defenderId, fromId)))))
      .limit(1);
    return !war;
  }

  /** Quita a alguien de tus compañeros (o rechaza su petición): deja de haber relación en ningún sentido. */
  async removeAlly(emperorId: string, otherId: string): Promise<void> {
    await this.db
      .delete(emperorAllies)
      .where(
        or(
          and(eq(emperorAllies.emperorId, emperorId), eq(emperorAllies.allyId, otherId)),
          and(eq(emperorAllies.emperorId, otherId), eq(emperorAllies.allyId, emperorId)),
        ),
      );
  }

  /** Estado social de un Emperador, para su pantalla de ajustes. */
  async summary(emperorId: string): Promise<SocialResponse> {
    const rows = await this.db
      .select({ emperorId: emperorAllies.emperorId, allyId: emperorAllies.allyId })
      .from(emperorAllies)
      .where(or(eq(emperorAllies.emperorId, emperorId), eq(emperorAllies.allyId, emperorId)));
    const added = new Set(rows.filter((r) => r.emperorId === emperorId).map((r) => r.allyId));
    const addedMe = new Set(rows.filter((r) => r.allyId === emperorId).map((r) => r.emperorId));
    const ids = [...new Set([...added, ...addedMe])];
    const names = ids.length
      ? new Map(
          (await this.db.select({ id: emperors.id, name: emperors.name }).from(emperors).where(inArray(emperors.id, ids))).map((r) => [r.id, r.name]),
        )
      : new Map<string, string>();
    const entry = (id: string): AllyEntry => ({ id, name: names.get(id) ?? "?" });
    const byName = (a: AllyEntry, b: AllyEntry) => a.name.localeCompare(b.name);
    return {
      visibility: await this.visibility(emperorId),
      allies: [...added].filter((id) => addedMe.has(id)).map(entry).sort(byName),
      pending: [...added].filter((id) => !addedMe.has(id)).map(entry).sort(byName),
      requests: [...addedMe].filter((id) => !added.has(id)).map(entry).sort(byName),
    };
  }

  /**
   * Memoria de posición: dónde están y dónde estuvieron los compañeros (salvo
   * los que se ocultan a todos), para poder saltar junto a ellos.
   */
  async trail(emperorId: string): Promise<CompanionTrailResponse> {
    const ids = [...(await this.mutualAllies(emperorId))];
    if (ids.length === 0) return { companions: [] };
    const rows = await this.db
      .select({ id: emperors.id, name: emperors.name, visibility: emperors.visibility, systemId: emperors.systemId, destSystemId: emperors.destSystemId, deadAt: emperors.deadAt })
      .from(emperors)
      .where(inArray(emperors.id, ids));
    const shown = rows.filter((r) => r.visibility !== "hidden");
    if (shown.length === 0) return { companions: [] };
    const parks = await this.db
      .select({ emperorId: systemParks.emperorId, systemId: systemParks.systemId })
      .from(systemParks)
      .where(inArray(systemParks.emperorId, shown.map((r) => r.id)));
    return {
      companions: shown
        .map((r) => {
          // Si viaja (o ya llegó sin resolverse la fila), el destino.
          const at = r.deadAt ? null : (r.destSystemId ?? r.systemId);
          return { id: r.id, name: r.name, at: at && !isDeepId(at) ? at : null, systems: parks.filter((p) => p.emperorId === r.id).map((p) => p.systemId) };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}

/** ¿Puede `viewerId` ver al Emperador `targetId`? `targetAllies` son los compañeros del objetivo. */
export function canSee(viewerId: string, targetId: string, visibility: Visibility, targetAllies: Set<string>): boolean {
  if (viewerId === targetId || visibility === "public") return true;
  return visibility === "allies" && targetAllies.has(viewerId);
}
