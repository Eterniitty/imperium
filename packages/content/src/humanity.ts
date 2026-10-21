/**
 * Economía de la humanidad y mercado global: solo números y fichas. Las reglas
 * que los usan están en `@imperium/sim` (humanity.ts y market.ts).
 *
 * Moneda: el **crédito** (₢). Lo generan las colonias según su población (el
 * trabajo de la gente), lo cobra el Emperador dueño y una parte va como aporte
 * al **tesoro común del Núcleo Humano**. Los créditos no son materia: no viajan
 * en bodegas, se apuntan en el libro como los recursos.
 *
 * Igual que en economy.ts, las tasas son por hora de juego.
 */
import { STOCK_IDS, type StockAmounts } from "./economy";

/** Créditos: origen y saldo inicial. */
export const CREDITS = {
  /** Créditos brutos por habitante y hora de juego (500 habitantes → 10 ₢/h). */
  perPopulationPerHour: 0.02,
  /** Saldo con el que empieza cada Emperador (para poder comprar antes de tener colonias). */
  starting: 500,
} as const;

/** Economía común de la humanidad (el Núcleo Humano). */
export const HUMANITY = {
  /** Aporte al tesoro común: parte de los créditos de cada colonia (tasa fija). */
  taxRate: 0.1,
  /**
   * Cada cuántas horas de juego se recalcula la renta de cada Emperador (su
   * población puede haber crecido) y se actualizan los agregados de la humanidad.
   */
  settleEveryHours: 1,
  /** Velocidad de los envíos de recursos del Núcleo (aportes y mercado), en años luz por hora de juego. */
  shipmentSpeedLyPerHour: 60,
  /** Duración mínima de un envío, en horas de juego (carga y descarga). */
  minShipmentHours: 0.25,
  /** Aporte mínimo de recursos o créditos (evita miles de envíos diminutos). */
  minContribution: 10,
  /** Emperadores que se muestran por proyecto como mayores contribuyentes. */
  topContributors: 5,
} as const;

/** Proyectos comunes de la humanidad. */
export type HumanityProjectId = "core_defenses" | "core_research" | "colony_grants" | "trade_network";

/** Coste de un proyecto: créditos (los paga el tesoro) y recursos (los aportan los Emperadores). */
export type ProjectCost = StockAmounts & { credits: number };

export interface HumanityProjectDefinition {
  id: HumanityProjectId;
  /** Niveles que se pueden completar. */
  maxLevel: number;
  /** Coste del primer nivel. */
  baseCost: ProjectCost;
  /** Cada nivel cuesta esto veces el anterior. */
  costGrowth: number;
  /**
   * Efecto por nivel completado (fracción): escudo en batalla en el Núcleo,
   * extracción, existencias de fundación o velocidad de los envíos.
   */
  effectPerLevel: number;
}

export const HUMANITY_PROJECTS: readonly HumanityProjectDefinition[] = [
  {
    // Las flotas que combaten en un sistema del Núcleo Humano tienen más escudo.
    id: "core_defenses",
    maxLevel: 5,
    baseCost: { credits: 1500, metal: 4000, volatiles: 1000, crystal: 200, alloys: 600 },
    costGrowth: 1.6,
    effectPerLevel: 0.1,
  },
  {
    // Todas las colonias extraen más (metal, volátiles y cristal).
    id: "core_research",
    maxLevel: 5,
    baseCost: { credits: 2000, metal: 2000, volatiles: 1500, crystal: 400, alloys: 400 },
    costGrowth: 1.6,
    effectPerLevel: 0.04,
  },
  {
    // Las colonias nuevas nacen con más existencias (subvención del Núcleo).
    id: "colony_grants",
    maxLevel: 4,
    baseCost: { credits: 1000, metal: 3000, volatiles: 1500, crystal: 100, alloys: 200 },
    costGrowth: 1.5,
    effectPerLevel: 0.25,
  },
  {
    // Los envíos del Núcleo (aportes y mercado) llegan antes.
    id: "trade_network",
    maxLevel: 5,
    baseCost: { credits: 1200, metal: 2500, volatiles: 2000, crystal: 150, alloys: 300 },
    costGrowth: 1.5,
    effectPerLevel: 0.2,
  },
];

export function getHumanityProject(id: string): HumanityProjectDefinition | undefined {
  return HUMANITY_PROJECTS.find((p) => p.id === id);
}

/** Mercado global entre Emperadores (y, más adelante, la IA). */
export const MARKET = {
  /** Comisión sobre cada venta, en créditos, que va al tesoro de la humanidad. */
  feeRate: 0.02,
  /** Órdenes abiertas a la vez por Emperador. */
  maxOpenOrders: 20,
  /** Cantidad máxima de una orden (unidades enteras). */
  maxQuantity: 100_000,
  /** Precio por unidad, en créditos (con dos decimales). */
  minPrice: 0.01,
  maxPrice: 10_000,
  /** Horas de historial de precios que se muestran. */
  historyHours: 48,
  /** Niveles de precio que se muestran de cada lado del libro. */
  depthLevels: 8,
} as const;

/** Errores de coherencia (vacío si todo está bien). */
export function validateHumanity(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const p of HUMANITY_PROJECTS) {
    if (ids.has(p.id)) errors.push(`Proyecto duplicado: ${p.id}`);
    ids.add(p.id);
    if (!(p.maxLevel >= 1)) errors.push(`proyecto ${p.id}: maxLevel debe ser ≥ 1`);
    if (!(p.costGrowth >= 1)) errors.push(`proyecto ${p.id}: costGrowth debe ser ≥ 1`);
    if (!(p.effectPerLevel > 0)) errors.push(`proyecto ${p.id}: effectPerLevel debe ser > 0`);
    if (!(p.baseCost.credits >= 0)) errors.push(`proyecto ${p.id}: coste en créditos negativo`);
    for (const r of STOCK_IDS) if (!(p.baseCost[r] >= 0)) errors.push(`proyecto ${p.id}: coste de ${r} negativo`);
  }
  if (!(HUMANITY.taxRate >= 0 && HUMANITY.taxRate < 1)) errors.push("La tasa del Núcleo debe estar en [0, 1)");
  if (!(MARKET.feeRate >= 0 && MARKET.feeRate < 1)) errors.push("La comisión del mercado debe estar en [0, 1)");
  if (!(MARKET.minPrice > 0 && MARKET.minPrice < MARKET.maxPrice)) errors.push("Precios del mercado incoherentes");
  return errors;
}
