/**
 * Rango del Emperador (`docs/juego-solitario.md`, prioridad 2): experiencia que
 * se gana jugando (contratos, Carroñeros derribados, sistemas descubiertos y
 * mineral extraído) y que sube por diez rangos con título propio. Algunos
 * rangos dan una mejora; todas las aplica el servidor. La experiencia nunca se
 * pierde (tampoco al morir: el linaje la conserva).
 */

/** Mejoras acumuladas a partir de un rango (se suman a las de los anteriores). */
export interface RankPerk {
  /** Contratos en curso a la vez, de más. */
  contractSlots?: number;
  /** Ofertas de contrato al día, de más. */
  contractOffers?: number;
  /** Recompensa de los contratos (créditos), en tanto por ciento de más. */
  contractRewardPct?: number;
}

export interface RankDef {
  /** Clave del título (`rank.title.<id>`). */
  id: string;
  /** Experiencia total para alcanzarlo. */
  xp: number;
  perk?: RankPerk;
}

export const RANKS: readonly RankDef[] = [
  { id: "aspirant", xp: 0 },
  { id: "captain", xp: 100 },
  { id: "commander", xp: 250, perk: { contractSlots: 1 } },
  { id: "commodore", xp: 500 },
  { id: "rearAdmiral", xp: 900, perk: { contractOffers: 1 } },
  { id: "admiral", xp: 1500 },
  { id: "grandAdmiral", xp: 2400, perk: { contractRewardPct: 20 } },
  { id: "voidLord", xp: 3600 },
  { id: "archon", xp: 5200, perk: { contractSlots: 1, contractOffers: 1 } },
  { id: "aeonarch", xp: 7500, perk: { contractRewardPct: 20 } },
];

/** Experiencia por cada suceso. */
export const RANK_XP = {
  /** Por contrato cumplido, por nivel de dificultad (índice del objetivo + 1). */
  contractPerTier: 30,
  /** Por Carroñero derribado. */
  pirateKill: 8,
  /** Por sistema descubierto (con la nave, flotas o sondas). */
  discovery: 10,
  /** Unidades de mineral extraído por cada punto de experiencia. */
  minedPerXp: 25,
} as const;

/** Rango (índice en `RANKS`) para una experiencia, y lo que falta para el siguiente. */
export function rankOf(xp: number): { index: number; rank: RankDef; next: RankDef | null } {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i]!.xp) index = i;
  return { index, rank: RANKS[index]!, next: RANKS[index + 1] ?? null };
}

/** Mejoras de un rango: las suyas y las de todos los anteriores. */
export function rankPerks(index: number): Required<RankPerk> {
  const out: Required<RankPerk> = { contractSlots: 0, contractOffers: 0, contractRewardPct: 0 };
  for (let i = 0; i <= index && i < RANKS.length; i++) {
    const p = RANKS[i]!.perk;
    if (!p) continue;
    out.contractSlots += p.contractSlots ?? 0;
    out.contractOffers += p.contractOffers ?? 0;
    out.contractRewardPct += p.contractRewardPct ?? 0;
  }
  return out;
}
