/**
 * Rango del Emperador (`docs/juego-solitario.md`, prioridad 2): experiencia que
 * se gana jugando (contratos, Carroñeros derribados, sistemas descubiertos y
 * mineral extraído) y que sube por diez rangos con título propio. Algunos
 * rangos dan una mejora; todas las aplica el servidor. La experiencia nunca se
 * pierde (tampoco al morir: el linaje la conserva).
 */
import { FLAGSHIP_HOLD } from "./deepspace";
import { EMPEROR_FLAGSHIP, FLAGSHIP_SUPPLIES } from "./ships";

/** Mejoras acumuladas a partir de un rango (se suman a las de los anteriores). */
export interface RankPerk {
  /** Contratos en curso a la vez, de más. */
  contractSlots?: number;
  /** Ofertas de contrato al día, de más. */
  contractOffers?: number;
  /** Recompensa de los contratos (créditos), en tanto por ciento de más. */
  contractRewardPct?: number;
  /** Capacidad de la bodega de la nave del Emperador, en tanto por ciento de más. */
  holdPct?: number;
  /** Depósito de combustible de la nave del Emperador, en tanto por ciento de más. */
  fuelPct?: number;
  /** Misiles de más en la nave del Emperador. */
  missiles?: number;
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
  { id: "captain", xp: 100, perk: { holdPct: 10 } },
  { id: "commander", xp: 250, perk: { contractSlots: 1, missiles: 1 } },
  { id: "commodore", xp: 500, perk: { holdPct: 10, fuelPct: 10 } },
  { id: "rearAdmiral", xp: 900, perk: { contractOffers: 1, missiles: 1 } },
  { id: "admiral", xp: 1500, perk: { holdPct: 15, fuelPct: 10 } },
  { id: "grandAdmiral", xp: 2400, perk: { contractRewardPct: 20, missiles: 2 } },
  { id: "voidLord", xp: 3600, perk: { holdPct: 15, fuelPct: 10 } },
  { id: "archon", xp: 5200, perk: { contractSlots: 1, contractOffers: 1 } },
  { id: "aeonarch", xp: 7500, perk: { contractRewardPct: 20, fuelPct: 20 } },
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
  const out: Required<RankPerk> = { contractSlots: 0, contractOffers: 0, contractRewardPct: 0, holdPct: 0, fuelPct: 0, missiles: 0 };
  for (let i = 0; i <= index && i < RANKS.length; i++) {
    const p = RANKS[i]!.perk;
    if (!p) continue;
    out.contractSlots += p.contractSlots ?? 0;
    out.contractOffers += p.contractOffers ?? 0;
    out.contractRewardPct += p.contractRewardPct ?? 0;
    out.holdPct += p.holdPct ?? 0;
    out.fuelPct += p.fuelPct ?? 0;
    out.missiles += p.missiles ?? 0;
  }
  return out;
}

/** Capacidad de la bodega de la nave del Emperador con la experiencia `xp` (`FLAGSHIP_HOLD` más la mejora del rango). */
export function holdCapacityFor(xp: number): number {
  return Math.round(FLAGSHIP_HOLD.capacity * (1 + rankPerks(rankOf(xp).index).holdPct / 100));
}

/** Depósito de combustible de la nave del Emperador con la experiencia `xp` (`FLAGSHIP_SUPPLIES` más la mejora del rango). */
export function fuelCapacityFor(xp: number): number {
  return Math.round(FLAGSHIP_SUPPLIES.fuelMax * (1 + rankPerks(rankOf(xp).index).fuelPct / 100));
}

/** Misiles que caben en la nave del Emperador con la experiencia `xp` (los de serie más la mejora del rango). */
export function missileCapacityFor(xp: number): number {
  const base = EMPEROR_FLAGSHIP.combat.weapons.find((w) => w.kind === "missile")?.ammo ?? 0;
  return base + rankPerks(rankOf(xp).index).missiles;
}
