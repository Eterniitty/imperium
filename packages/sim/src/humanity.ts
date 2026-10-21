/**
 * Reglas de la economía de la humanidad (créditos, tesoro común del Núcleo
 * Humano y proyectos comunes). Funciones puras; los datos están en
 * `@imperium/content` (humanity.ts).
 *
 * Resolución perezosa, como las colonias: cada cartera guarda su saldo en un
 * instante y su renta por hora; el tesoro guarda su saldo y la suma de los
 * aportes por hora de todas las carteras. Nadie recorre las colonias por tick.
 */
import {
  CREDITS,
  HUMANITY,
  STOCK_IDS,
  getHumanityProject,
  type HumanityProjectDefinition,
  type HumanityProjectId,
  type ProjectCost,
  type StockAmounts,
} from "@imperium/content";

/** Redondea a céntimos de crédito (las cuentas se guardan así para no acumular polvo). */
export function roundCredits(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Renta bruta en créditos por hora de juego de una población. */
export function creditIncomePerHour(population: number): number {
  return Math.max(0, population) * CREDITS.perPopulationPerHour;
}

/** Reparto de una renta bruta: lo que se queda el Emperador y el aporte al tesoro. */
export function taxSplit(gross: number, taxRate: number = HUMANITY.taxRate): { net: number; tax: number } {
  const tax = gross * taxRate;
  return { net: gross - tax, tax };
}

/**
 * Saldo tras `hours` horas de juego con una renta bruta constante: el
 * Emperador cobra la parte neta (el aporte lo acumula el tesoro por su cuenta).
 */
export function walletAfter(credits: number, grossPerHour: number, hours: number, taxRate: number = HUMANITY.taxRate): number {
  return credits + taxSplit(grossPerHour, taxRate).net * Math.max(0, hours);
}

/** Saldo del tesoro tras `hours` horas con unos aportes por hora constantes. */
export function treasuryAfter(credits: number, incomePerHour: number, hours: number): number {
  return credits + incomePerHour * Math.max(0, hours);
}

/**
 * Horas de juego que faltan para que el tesoro llegue a `target` créditos;
 * Infinity si no entra nada.
 */
export function hoursUntilTreasury(credits: number, incomePerHour: number, target: number): number {
  if (credits >= target) return 0;
  if (incomePerHour <= 0) return Infinity;
  return (target - credits) / incomePerHour;
}

// --- Proyectos comunes ---

/** Coste de completar el nivel `level + 1` (con `level` niveles ya hechos). */
export function projectCost(def: HumanityProjectDefinition, level: number): ProjectCost {
  const k = def.costGrowth ** Math.max(0, level);
  const out = { credits: Math.round(def.baseCost.credits * k) } as ProjectCost;
  for (const r of STOCK_IDS) out[r] = Math.round(def.baseCost[r] * k);
  return out;
}

/** Recursos que faltan para el nivel siguiente (sin bajar de cero). */
export function projectMissing(cost: StockAmounts, progress: StockAmounts): StockAmounts {
  const out = {} as StockAmounts;
  for (const r of STOCK_IDS) out[r] = Math.max(0, cost[r] - progress[r]);
  return out;
}

/** ¿Están todos los recursos del nivel? (solo faltarían los créditos del tesoro). */
export function projectResourcesReady(cost: StockAmounts, progress: StockAmounts): boolean {
  return STOCK_IDS.every((r) => progress[r] + 1e-9 >= cost[r]);
}

/** Nivel de cada proyecto (los que no aparecen, 0). */
export type ProjectLevels = Partial<Record<HumanityProjectId, number>>;

/** Efecto total de un proyecto con sus niveles completados (fracción: 0,08 = +8 %). */
export function projectEffect(id: HumanityProjectId, levels: ProjectLevels): number {
  const def = getHumanityProject(id);
  if (!def) return 0;
  return def.effectPerLevel * Math.min(def.maxLevel, levels[id] ?? 0);
}

/** Bonificaciones globales de los proyectos completados, listas para aplicar. */
export interface HumanityBonuses {
  /** Multiplicador de la extracción de todas las colonias (Investigación del Núcleo). */
  extraction: number;
  /** Multiplicador de las existencias con que nace una colonia (Subvenciones). */
  founding: number;
  /** Multiplicador del escudo de batalla de las flotas que combaten en el Núcleo (Defensas). */
  coreShield: number;
  /** Multiplicador de la velocidad de los envíos del Núcleo (Red de transporte). */
  shipmentSpeed: number;
}

export function humanityBonuses(levels: ProjectLevels): HumanityBonuses {
  return {
    extraction: 1 + projectEffect("core_research", levels),
    founding: 1 + projectEffect("colony_grants", levels),
    coreShield: 1 + projectEffect("core_defenses", levels),
    shipmentSpeed: 1 + projectEffect("trade_network", levels),
  };
}

export const NO_BONUSES: HumanityBonuses = { extraction: 1, founding: 1, coreShield: 1, shipmentSpeed: 1 };

// --- Envíos (aportes y mercado) ---

/** Horas de juego que tarda un envío del Núcleo en recorrer `distanceLy` años luz. */
export function shipmentHours(distanceLy: number, speedMultiplier = 1): number {
  const speed = HUMANITY.shipmentSpeedLyPerHour * Math.max(0.01, speedMultiplier);
  return Math.max(HUMANITY.minShipmentHours, Math.max(0, distanceLy) / speed);
}
