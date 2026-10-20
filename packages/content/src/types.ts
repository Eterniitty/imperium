/**
 * Tipos de las fichas de contenido de IMPERIUM.
 *
 * Todo lo que aquí se describe son DATOS: las especies, facciones y clases de
 * nave no contienen lógica. La simulación y la IA leen estas fichas para
 * decidir comportamiento, costes y aspecto visual.
 */

/** Recursos transportables que pueden figurar como preferencia económica. */
export type ResourceId = "metal" | "volatiles" | "crystal" | "energy";

/** Clases estelares (coinciden con las de procgen, duplicadas para no depender de él). */
export type StarClass = "O" | "B" | "A" | "F" | "G" | "K" | "M" | "RG" | "WD" | "NS" | "BH";

/** Tipos de planeta (coinciden con los de procgen). */
export type PlanetType =
  | "lava"
  | "barren"
  | "rocky"
  | "desert"
  | "ocean"
  | "toxic"
  | "ice"
  | "gas_giant"
  | "ice_giant";

/** Naturaleza física de la especie. */
export type SpeciesNature = "biological" | "mechanical" | "hybrid" | "energy";

/** Forma preferida de hacer la guerra. */
export type WarDoctrine =
  | "swarm_assault"
  | "guerrilla"
  | "fortified_defense"
  | "assimilation"
  | "precision_strike"
  | "raiding";

/** Cómo se expande por el mapa. */
export type ExpansionStyle = "fast_fragile" | "slow_solid" | "nomadic" | "static";

/** Qué quiere de la humanidad. */
export type StanceTowardHumanity = "exterminate" | "dominate" | "plunder" | "assimilate" | "territorial";

/** Silueta dominante de naves y estructuras. */
export type Silhouette = "organic" | "angular" | "crystalline" | "brutalist_scrap" | "geometric" | "ethereal";

/** Color en formato hexadecimal `#rrggbb`. */
export type HexColor = string;

/** Rasgos numéricos normalizados en [0, 1]. */
export interface SpeciesTraits {
  /** Propensión a atacar en lugar de esperar o negociar. */
  aggression: number;
  /** Velocidad a la que funda nuevos asentamientos. */
  expansionRate: number;
  /** Nivel tecnológico relativo (1 = muy por encima de la humanidad). */
  techLevel: number;
  /** Cantidad de unidades que despliega (1 = enjambres inmensos). */
  numbers: number;
  /** Resistencia individual de unidades y mundos. */
  resilience: number;
}

export interface EconomicNeeds {
  /** Recursos que busca, por orden de prioridad. */
  preferredResources: ResourceId[];
}

export interface GeographicPreferences {
  preferredStarClasses: StarClass[];
  preferredPlanetTypes: PlanetType[];
  /** Atracción hacia anomalías espaciales en [0, 1]. */
  anomalyAffinity: number;
}

export interface VisualLanguage {
  silhouette: Silhouette;
  primaryColor: HexColor;
  secondaryColor: HexColor;
  emissiveColor: HexColor;
}

/** Ficha de una especie alienígena. */
export interface SpeciesDefinition {
  id: string;
  /** Clave i18n del nombre: `species.<id>.name`. */
  nameKey: string;
  /** Clave i18n de la descripción: `species.<id>.description`. */
  descriptionKey: string;
  nature: SpeciesNature;
  doctrine: WarDoctrine;
  expansion: ExpansionStyle;
  stance: StanceTowardHumanity;
  economy: EconomicNeeds;
  geography: GeographicPreferences;
  traits: SpeciesTraits;
  /** Ids de especies rivales. */
  rivals: string[];
  visual: VisualLanguage;
  /** Las especies alienígenas nunca son jugables. */
  playable: false;
  /** Si aparece en el MVP. */
  enabledInMvp: boolean;
}

/** Objetivo estratégico principal de una facción. */
export type StrategicGoal =
  | "conquer_human_worlds"
  | "raid_supply_lines"
  | "defend_homeworlds"
  | "consume_resources"
  | "assimilate_worlds"
  | "guard_anomalies"
  | "destroy_rival_faction";

/**
 * Modificadores de una facción sobre los rasgos de su especie. Son
 * desplazamientos aditivos en [-1, 1]; el resultado se recorta a [0, 1].
 */
export type TraitModifiers = Partial<Record<keyof SpeciesTraits, number>>;

/** Ficha de una facción (un grupo concreto de una especie). */
export interface FactionDefinition {
  id: string;
  speciesId: string;
  /** Clave i18n del nombre: `faction.<id>.name`. */
  nameKey: string;
  /** Clave i18n de la descripción: `faction.<id>.description`. */
  descriptionKey: string;
  goal: StrategicGoal;
  traitModifiers: TraitModifiers;
  /** Ids de facciones con las que está enfrentada (pueden ser de su misma especie). */
  hostileTo: string[];
}

/** Clases de nave humanas del MVP. */
export type ShipClassId = "explorer" | "freighter" | "colonizer" | "frigate";

export type ShipRole = "exploration" | "logistics" | "colonization" | "combat";

/** Coste de construcción en recursos transportables. */
export interface ShipCost {
  metal: number;
  volatiles: number;
  crystal: number;
}

/** Ficha de una clase de nave. */
export interface ShipClassDefinition {
  id: ShipClassId;
  /** Clave i18n del nombre: `ship.<id>.name`. */
  nameKey: string;
  /** Clave i18n de la descripción: `ship.<id>.description`. */
  descriptionKey: string;
  role: ShipRole;
  cost: ShipCost;
  /** Tiempo de construcción en horas de juego real. */
  buildTimeHours: number;
  /** Puntos de casco. */
  hull: number;
  /** Poder de ataque por ronda de combate. */
  attack: number;
  /** Velocidad de crucero en años luz por hora. */
  speedLyPerHour: number;
  /** Capacidad de carga en unidades de recurso. */
  cargo: number;
  /** Alcance del escáner en años luz. */
  scannerRangeLy: number;
  /** Mantenimiento en volátiles por hora. */
  upkeepVolatilesPerHour: number;
  /** Se consume al cumplir su función (el colonizador al fundar). */
  consumedOnUse: boolean;
}
