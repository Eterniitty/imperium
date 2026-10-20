/**
 * Datos de la Fase 7: humanos, colonias y economía. Solo números y fichas; las
 * reglas que los usan están en `@imperium/sim` (economy.ts).
 *
 * Todas las tasas son por hora de juego: el servidor las multiplica por
 * `TIME_SCALE` (y divide los tiempos de construcción por ella).
 */
import type { ShipClassId } from "./types";

/** Recursos que se almacenan en una colonia (la energía no: se produce y gasta en el sitio). */
export type StockId = "metal" | "volatiles" | "crystal" | "alloys";
export const STOCK_IDS: readonly StockId[] = ["metal", "volatiles", "crystal", "alloys"];

/** Cantidades de cada recurso almacenable (existencias, costes, topes o tasas). */
export type StockAmounts = Record<StockId, number>;

/**
 * Humanos (Ley II del Emperador: la humanidad se reproduce de forma autónoma).
 * La nave del Emperador los genera poco a poco hasta su capacidad; con ellos
 * se fundan colonias.
 */
export const HUMANS = {
  /** Humanos que caben en la nave del Emperador. */
  flagshipCapacity: 500,
  /** Humanos con los que despierta un Emperador nuevo. */
  flagshipStart: 200,
  /** Humanos que genera la nave del Emperador por hora (hasta su capacidad). */
  flagshipPerHour: 5,
  /**
   * Mínimo para fundar una colonia: `base + hostile × (1 − habitabilidad)`.
   * Un mundo jardín pide 50 colonos; una roca sin aire, unos 200: cuántos
   * humanos lleves decide qué puedes colonizar.
   */
  minColonistsBase: 50,
  minColonistsHostile: 150,
  /** Población que queda siempre en una colonia cuando embarcan colonos en una nave. */
  colonyKeep: 50,
} as const;

/** Humanos que transporta cada clase de nave (las que no aparecen, ninguno). */
export const SHIP_HUMAN_CAPACITY: Partial<Record<ShipClassId, number>> = {
  colonizer: 1000,
};

/** Crecimiento de la población de una colonia (logístico, hacia un tope). */
export const POPULATION = {
  /**
   * Tope de población: `capMin + capPerHabitability × habitabilidad`. El mínimo
   * cubre siempre a los colonos necesarios para fundar (hasta 200 en un mundo
   * hostil): ninguna colonia nace por encima de lo que su planeta admite.
   */
  capMin: 400,
  capPerHabitability: 9600,
  /** Tasa de crecimiento logístico por hora (≈ duplica la población en un día y medio). */
  growthPerHour: 0.02,
} as const;

/** Clases de instalación de una colonia. */
export type InstallationId = "mine" | "refinery" | "power_plant" | "shipyard";

export interface InstallationDefinition {
  id: InstallationId;
  /** Clave i18n del nombre (en `@imperium/shared`): `installation.<id>`. */
  nameKey: string;
  cost: StockAmounts;
  /** Horas de juego que tarda en construirse. */
  buildTimeHours: number;
  /** Energía que consume mientras funciona. */
  energyUse: number;
  /** Máximo por colonia. */
  maxPerColony: number;
}

export const INSTALLATIONS: readonly InstallationDefinition[] = [
  {
    id: "mine",
    nameKey: "installation.mine",
    cost: { metal: 150, volatiles: 20, crystal: 0, alloys: 0 },
    buildTimeHours: 2,
    energyUse: 2,
    maxPerColony: 6,
  },
  {
    id: "refinery",
    nameKey: "installation.refinery",
    cost: { metal: 300, volatiles: 100, crystal: 0, alloys: 0 },
    buildTimeHours: 4,
    energyUse: 4,
    maxPerColony: 3,
  },
  {
    id: "power_plant",
    nameKey: "installation.power_plant",
    cost: { metal: 200, volatiles: 50, crystal: 0, alloys: 0 },
    buildTimeHours: 3,
    energyUse: 0,
    maxPerColony: 4,
  },
  {
    id: "shipyard",
    nameKey: "installation.shipyard",
    cost: { metal: 400, volatiles: 150, crystal: 20, alloys: 0 },
    buildTimeHours: 6,
    energyUse: 3,
    maxPerColony: 1,
  },
];

export function getInstallation(id: string): InstallationDefinition | undefined {
  return INSTALLATIONS.find((i) => i.id === id);
}

/** Producción, energía y almacenes de una colonia. */
export const ECONOMY = {
  /** Extracción por hora y punto de riqueza sin minas (la colonia rasca la superficie). */
  baseExtractionPerRichness: 2,
  /** Extracción por hora, mina y punto de riqueza (con toda la energía y mano de obra). */
  mineExtractionPerRichness: 6,
  /** El cristal es raro: se extrae a esta fracción del ritmo de los demás. */
  crystalFactor: 0.25,
  /** Las lunas del planeta también se explotan, a esta fracción de su riqueza. */
  moonFactor: 0.5,
  /** Mano de obra: con esta población las instalaciones van a pleno rendimiento. */
  laborFullPopulation: 500,
  /** Rendimiento mínimo por mano de obra (automatización), aunque haya pocos colonos. */
  laborMin: 0.25,
  /** Energía por punto de energía estelar (0–5) que capta la colonia sin centrales. */
  baseEnergyPerStarEnergy: 2,
  /** Energía por punto de energía estelar de cada central. */
  powerPlantEnergyPerStarEnergy: 4,
  /** Una refinería, por hora: consume metal y volátiles y produce aleaciones. */
  refinery: { metal: 6, volatiles: 2, alloys: 3 },
  /** Tope de almacenamiento de cada recurso. */
  storage: { metal: 3000, volatiles: 1500, crystal: 400, alloys: 800 } satisfies StockAmounts,
  /** Existencias con las que nace una colonia (lo que traen los colonos). */
  foundingStock: { metal: 300, volatiles: 150, crystal: 40, alloys: 0 } satisfies StockAmounts,
  /** Construcciones en cola por colonia (incluida la que está en marcha). */
  maxQueue: 5,
} as const;

/** Errores de coherencia de los datos de economía (vacío si todo está bien). */
export function validateEconomy(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const i of INSTALLATIONS) {
    if (ids.has(i.id)) errors.push(`Instalación duplicada: ${i.id}`);
    ids.add(i.id);
    if (i.nameKey !== `installation.${i.id}`) errors.push(`instalación ${i.id}: nameKey inesperada`);
    if (!(i.buildTimeHours > 0)) errors.push(`instalación ${i.id}: buildTimeHours debe ser > 0`);
    if (!(i.maxPerColony >= 1)) errors.push(`instalación ${i.id}: maxPerColony debe ser ≥ 1`);
    for (const r of STOCK_IDS) if (!(i.cost[r] >= 0)) errors.push(`instalación ${i.id}: coste de ${r} negativo`);
  }
  if (HUMANS.flagshipStart > HUMANS.flagshipCapacity) errors.push("La nave del Emperador empieza con más humanos de los que caben");
  if (HUMANS.minColonistsBase + HUMANS.minColonistsHostile > HUMANS.flagshipCapacity) errors.push("Hay planetas que ni la nave del Emperador llena podría colonizar");
  if (HUMANS.minColonistsBase + HUMANS.minColonistsHostile > POPULATION.capMin)
    errors.push("Los colonos mínimos de un mundo hostil superan su tope de población: la colonia nacería menguando");
  for (const [id, cap] of Object.entries(SHIP_HUMAN_CAPACITY)) if (!(cap > 0)) errors.push(`nave ${id}: capacidad de humanos no positiva`);
  for (const r of STOCK_IDS) if (ECONOMY.foundingStock[r] > ECONOMY.storage[r]) errors.push(`Existencias iniciales de ${r} por encima del almacén`);
  return errors;
}
