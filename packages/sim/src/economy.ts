/**
 * Reglas de la Fase 7: humanos, población y producción de las colonias.
 * Funciones puras: las usa el servidor (fuente de verdad) y, para mostrar
 * cifras que avanzan solas, el cliente.
 *
 * Resolución perezosa (docs/arquitectura.md §4): no hay un bucle que recorra
 * las colonias. Cada una guarda sus existencias y su población en un instante
 * (`resolvedAt`); el estado en otro instante se calcula con estas funciones a
 * partir de las horas de juego transcurridas (milisegundos × TIME_SCALE / 3.6e6).
 */
import {
  ECONOMY,
  HUMANS,
  INSTALLATIONS,
  POPULATION,
  STOCK_IDS,
  getInstallation,
  type InstallationId,
  type StockAmounts,
} from "@imperium/content";
import type { ResourceDeposits, ResourceId } from "@imperium/shared";

export const HOUR_MS = 3_600_000;

/** Horas de juego entre dos instantes (milisegundos) con la escala de tiempo del servidor. */
export function gameHours(fromMs: number, toMs: number, timeScale: number): number {
  return Math.max(0, toMs - fromMs) * timeScale / HOUR_MS;
}

/** Milisegundos reales que dura algo que lleva `hours` horas de juego. */
export function realDurationMs(hours: number, timeScale: number): number {
  return Math.ceil((hours * HOUR_MS) / timeScale);
}

export const zeroStock = (): StockAmounts => ({ metal: 0, volatiles: 0, crystal: 0, alloys: 0 });

// --- Humanos y población ---

/**
 * Humanos de la nave del Emperador tras `hours` horas (Ley II: los genera solo,
 * hasta su capacidad). Si por lo que sea tiene más de los que caben, no pierde ninguno.
 */
export function flagshipHumansAfter(humans: number, hours: number): number {
  if (humans >= HUMANS.flagshipCapacity) return humans;
  return Math.min(HUMANS.flagshipCapacity, humans + HUMANS.flagshipPerHour * hours);
}

/** Colonos necesarios para fundar una colonia en un planeta de esta habitabilidad (0–1). */
export function minColonists(habitability: number): number {
  const h = Math.min(1, Math.max(0, habitability));
  return Math.ceil(HUMANS.minColonistsBase + HUMANS.minColonistsHostile * (1 - h));
}

/** Población máxima que sostiene un planeta de esta habitabilidad. */
export function populationCap(habitability: number): number {
  const h = Math.min(1, Math.max(0, habitability));
  return Math.round(POPULATION.capMin + POPULATION.capPerHabitability * h);
}

/**
 * Población tras `hours` horas: crecimiento logístico hacia el tope `cap`
 * (si está por encima del tope, baja hacia él).
 */
export function populationAfter(population: number, cap: number, hours: number): number {
  if (population <= 0 || hours <= 0) return population;
  const r = POPULATION.growthPerHour;
  return cap / (1 + ((cap - population) / population) * Math.exp(-r * hours));
}

/** Crecimiento instantáneo de la población, en humanos por hora de juego. */
export function populationGrowthPerHour(population: number, cap: number): number {
  if (population <= 0) return 0;
  return POPULATION.growthPerHour * population * (1 - population / cap);
}

// --- Producción ---

/** Lo que hace falta del planeta: su habitabilidad y depósitos (y los de sus lunas). */
export interface ColonyPlanet {
  habitability: number;
  deposits: ResourceDeposits;
  moons: ReadonlyArray<{ deposits: ResourceDeposits }>;
}

export type InstallationCounts = Partial<Record<InstallationId, number>>;

/** Riqueza aprovechable de cada recurso: la del planeta más una fracción de la de sus lunas. */
export function effectiveRichness(planet: ColonyPlanet): Record<ResourceId, number> {
  const out: Record<ResourceId, number> = { ...planet.deposits };
  for (const m of planet.moons) {
    out.metal += ECONOMY.moonFactor * m.deposits.metal;
    out.volatiles += ECONOMY.moonFactor * m.deposits.volatiles;
    out.crystal += ECONOMY.moonFactor * m.deposits.crystal;
  }
  return out;
}

/** Energía de la colonia: la que capta de su estrella (0–5) y la que gastan sus instalaciones. */
export function colonyEnergy(starEnergy: number, installations: InstallationCounts): { produced: number; consumed: number; efficiency: number } {
  const plants = installations.power_plant ?? 0;
  const produced = starEnergy * (ECONOMY.baseEnergyPerStarEnergy + ECONOMY.powerPlantEnergyPerStarEnergy * plants);
  let consumed = 0;
  for (const def of INSTALLATIONS) consumed += def.energyUse * (installations[def.id] ?? 0);
  // Sin energía suficiente, todas las instalaciones van más despacio en la misma proporción.
  const efficiency = consumed <= 0 ? 1 : Math.min(1, produced / consumed);
  return { produced, consumed, efficiency };
}

/** Rendimiento por mano de obra: crece con la población hasta 1. */
export function laborFactor(population: number): number {
  return Math.min(1, Math.max(ECONOMY.laborMin, population / ECONOMY.laborFullPopulation));
}

/**
 * Flujos por hora de juego de una colonia con su población actual: lo que
 * extrae de cada recurso y lo que haría la refinería a pleno rendimiento (que
 * solo alcanza si tiene metal y volátiles; ver `advanceStock`).
 */
export interface ColonyFlows {
  extraction: StockAmounts;
  refinery: { metal: number; volatiles: number; alloys: number };
  /**
   * Mantenimiento en volátiles por hora: el de sus instalaciones y, si es la
   * capital, el de las flotas del Emperador. Va antes que la refinería.
   */
  upkeep: number;
}

/** Mantenimiento por hora de las instalaciones de una colonia. */
export function installationsUpkeep(installations: InstallationCounts): number {
  let total = 0;
  for (const def of INSTALLATIONS) total += def.upkeepVolatilesPerHour * (installations[def.id] ?? 0);
  return total;
}

/**
 * `extraUpkeep`: mantenimiento que paga esta colonia además del suyo (la
 * capital paga el de las flotas del Emperador).
 */
export function colonyFlows(
  planet: ColonyPlanet,
  starEnergy: number,
  installations: InstallationCounts,
  population: number,
  extraUpkeep = 0,
  /** Multiplicador de la extracción (proyecto común «Investigación del Núcleo»). */
  extractionMultiplier = 1,
): ColonyFlows {
  const rich = effectiveRichness(planet);
  const { efficiency } = colonyEnergy(starEnergy, installations);
  const labor = laborFactor(population);
  const mines = installations.mine ?? 0;
  const perRichness = (ECONOMY.baseExtractionPerRichness + ECONOMY.mineExtractionPerRichness * mines * efficiency) * labor * extractionMultiplier;
  const refineries = (installations.refinery ?? 0) * efficiency * labor;
  return {
    extraction: {
      metal: rich.metal * perRichness,
      volatiles: rich.volatiles * perRichness,
      crystal: rich.crystal * perRichness * ECONOMY.crystalFactor,
      alloys: 0,
    },
    refinery: {
      metal: ECONOMY.refinery.metal * refineries,
      volatiles: ECONOMY.refinery.volatiles * refineries,
      alloys: ECONOMY.refinery.alloys * refineries,
    },
    upkeep: installationsUpkeep(installations) + extraUpkeep,
  };
}

/**
 * ¿Le faltan volátiles para pagar el mantenimiento? Con el almacén vacío y
 * extrayendo menos de lo que debe: la refinería se para y no puede construir
 * (un imperio sobredimensionado se desangra).
 */
export function upkeepShortage(stock: StockAmounts, flows: ColonyFlows): boolean {
  return flows.upkeep > 0 && stock.volatiles <= EPS && flows.extraction.volatiles < flows.upkeep - EPS;
}

const EPS = 1e-9;

/**
 * Tasas netas por hora en este instante, teniendo en cuenta los almacenes:
 * lo que no cabe se pierde, y la refinería solo usa lo que hay (si un insumo
 * está a cero, trabaja al ritmo al que llega) y se para con su almacén lleno.
 */
export function netRates(stock: StockAmounts, flows: ColonyFlows, storage: StockAmounts = ECONOMY.storage): StockAmounts {
  let f = stock.alloys >= storage.alloys - EPS ? 0 : 1;
  // Con el almacén de volátiles vacío, primero se paga el mantenimiento y la refinería usa lo que sobre.
  const volatilesEmpty = stock.volatiles <= EPS;
  const volatilesForRefinery = volatilesEmpty ? Math.max(0, flows.extraction.volatiles - flows.upkeep) : Infinity;
  if (flows.refinery.metal > 0 && stock.metal <= EPS) f = Math.min(f, flows.extraction.metal / flows.refinery.metal);
  if (flows.refinery.volatiles > 0 && volatilesEmpty) f = Math.min(f, volatilesForRefinery / flows.refinery.volatiles);
  // El mantenimiento solo consume lo que hay (lo que no se puede pagar, no se paga).
  const upkeepPaid = volatilesEmpty ? Math.min(flows.upkeep, flows.extraction.volatiles) : flows.upkeep;
  const rates: StockAmounts = {
    metal: flows.extraction.metal - f * flows.refinery.metal,
    volatiles: flows.extraction.volatiles - f * flows.refinery.volatiles - upkeepPaid,
    crystal: flows.extraction.crystal,
    alloys: f * flows.refinery.alloys,
  };
  for (const r of STOCK_IDS) {
    if (Math.abs(rates[r]) < 1e-12) rates[r] = 0;
    if (rates[r] > 0 && stock[r] >= storage[r] - EPS) rates[r] = 0;
  }
  return rates;
}

/**
 * Existencias tras `hours` horas con flujos constantes. Es lineal a trozos: se
 * avanza hasta que un recurso se llena o se agota, se recalculan las tasas y
 * se sigue.
 */
export function advanceStock(stock: StockAmounts, flows: ColonyFlows, hours: number, storage: StockAmounts = ECONOMY.storage): StockAmounts {
  const s = { ...stock };
  let left = hours;
  for (let iter = 0; left > EPS && iter < 32; iter++) {
    const rates = netRates(s, flows, storage);
    let dt = left;
    for (const r of STOCK_IDS) {
      if (rates[r] < 0) dt = Math.min(dt, s[r] / -rates[r]);
      else if (rates[r] > 0) dt = Math.min(dt, (storage[r] - s[r]) / rates[r]);
    }
    dt = Math.max(dt, Math.min(left, EPS));
    for (const r of STOCK_IDS) s[r] = Math.min(storage[r], Math.max(0, s[r] + rates[r] * dt));
    left -= dt;
  }
  return s;
}

/** Estado variable de una colonia. */
export interface ColonyState {
  population: number;
  stock: StockAmounts;
}

/** Lo fijo de una colonia mientras no se construye nada: su planeta, su estrella y sus instalaciones. */
export interface ColonySite {
  planet: ColonyPlanet;
  starEnergy: number;
  installations: InstallationCounts;
  /** Mantenimiento de las flotas, si esta colonia es la capital del Emperador. */
  extraUpkeep?: number;
  /** Multiplicador de la extracción de los proyectos comunes de la humanidad (1 = ninguno). */
  extractionMultiplier?: number;
}

/** Pasos de como mucho una hora (la población cambia la producción); más allá de este número, un solo paso. */
const MAX_STEPS = 1000;

/** Estado de una colonia tras `hours` horas de juego. */
export function resolveColony(state: ColonyState, site: ColonySite, hours: number): ColonyState {
  const extraUpkeep = site.extraUpkeep ?? 0;
  const cap = populationCap(site.planet.habitability);
  let population = state.population;
  let stock = state.stock;
  let left = hours;
  for (let i = 0; left > EPS; i++) {
    const step = i < MAX_STEPS ? Math.min(1, left) : left;
    stock = advanceStock(stock, colonyFlows(site.planet, site.starEnergy, site.installations, population, extraUpkeep, site.extractionMultiplier ?? 1), step);
    population = populationAfter(population, cap, step);
    left -= step;
  }
  return { population, stock };
}

// --- Construcción ---

/** ¿Alcanzan las existencias para pagar `cost`? */
export function canAfford(stock: StockAmounts, cost: StockAmounts): boolean {
  return STOCK_IDS.every((r) => stock[r] + EPS >= cost[r]);
}

/** Existencias tras pagar `cost` (sin bajar de cero). */
export function pay(stock: StockAmounts, cost: StockAmounts): StockAmounts {
  const out = { ...stock };
  for (const r of STOCK_IDS) out[r] = Math.max(0, out[r] - cost[r]);
  return out;
}

/**
 * ¿Se puede encargar otra instalación de este tipo? Cuenta las ya construidas
 * y las que están en cola.
 */
export function installationAllowed(id: InstallationId, built: InstallationCounts, queued: number): boolean {
  const def = getInstallation(id);
  return def !== undefined && (built[id] ?? 0) + queued < def.maxPerColony;
}

/**
 * Instalaciones que faltan en la colonia para construir algo que pide
 * `requires` (una nave o una instalación): solo cuentan las ya construidas.
 */
export function missingInstallations(requires: Partial<Record<InstallationId, number>> | undefined, built: InstallationCounts): InstallationId[] {
  const missing: InstallationId[] = [];
  for (const [id, n] of Object.entries(requires ?? {}) as Array<[InstallationId, number]>) if ((built[id] ?? 0) < n) missing.push(id);
  return missing;
}
