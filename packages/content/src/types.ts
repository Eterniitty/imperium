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
export type SpeciesNature = "biological" | "mechanical" | "hybrid" | "energy" | "crystalline" | "exotic";

/** Forma preferida de hacer la guerra. */
export type WarDoctrine =
  | "swarm_assault"
  | "guerrilla"
  | "fortified_defense"
  | "assimilation"
  | "precision_strike"
  | "raiding"
  /** Destrucción selectiva de lo que permite a la humanidad volver (reconstrucción, población). */
  | "purge"
  /** Tecnología antigua muy superior, escudos y recuperación de artefactos. */
  | "ancient_technology"
  /** Ocultación, interferencia de sensores y ataques a infraestructuras. */
  | "stealth_sabotage"
  /** Flotas nobles, comandantes de élite y campañas de conquista territorial. */
  | "noble_conquest";

/** Cómo se expande por el mapa. */
export type ExpansionStyle = "fast_fragile" | "slow_solid" | "nomadic" | "static" | "extinct";

/** Qué quiere de la humanidad. */
export type StanceTowardHumanity =
  | "exterminate"
  | "dominate"
  | "plunder"
  | "assimilate"
  | "territorial"
  /** Someter a la humanidad a un orden calculable (límites a cambio de pactos). */
  | "control"
  /** Comerciar con quien respete sus rutas. */
  | "trade"
  /** Estudiar a los Emperadores y su persistencia. */
  | "study"
  /** Rivales naturales: demostrar quién merece gobernar. */
  | "rivalry"
  /** Dividida: unas facciones quieren acabar con la humanidad y otras ayudarla. */
  | "divided"
  /** Desconocida (civilizaciones desaparecidas). */
  | "unknown";

/** Disposición a pactar con los Emperadores. */
export type DiplomacyStance = "never" | "conditional" | "open";

/** Relación de una facción concreta con la humanidad. */
export type FactionRelation = "hostile" | "neutral" | "potential_ally";

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

/** Densidad de estrellas que prefiere una especie para su territorio. */
export type RegionPreference = "dense" | "sparse" | "any";

/**
 * Dónde vive una especie: datos de la capa de territorio (`@imperium/procgen`
 * territory.ts). La galaxia se divide en regiones cúbicas y cada una se reparte
 * entre las especies que pueden vivir a esa distancia del Núcleo Humano.
 */
export interface TerritoryPreferences {
  /**
   * Anillo mínimo (distancia al Núcleo Humano en sectores, contada como el
   * mayor de |x|, |y|, |z| del sector). El Núcleo es el anillo 0–1: ninguna
   * especie vive ahí. Las más peligrosas, más lejos.
   */
  minCoreRing: number;
  /** Peso al repartir las regiones entre especies (0 = no tiene regiones propias). */
  regionWeight: number;
  /** Fracción de los sistemas de sus regiones que ocupa si la estrella es de sus clases preferidas (con las demás, un tercio). */
  systemShare: number;
  /** Densidad de estrellas de las regiones que prefiere. */
  region: RegionPreference;
}

/** Estilo de flota: cómo agrupa una especie sus naves. */
export type FleetStyle = "pack" | "bastion" | "caravan" | "relic" | "phalanx" | "swarm" | "line" | "shadow" | "precision";

/** Flotas de una especie (las que despliega la IA en su territorio). */
export interface FleetDoctrine {
  style: FleetStyle;
  /** Naves de la especie (ids de `ALIEN_SHIP_CLASSES`) y su peso al formar una flota. */
  composition: ReadonlyArray<readonly [string, number]>;
  /** Naves por flota: [en el borde de su territorio más cercano al Núcleo, en lo más profundo]. */
  shipsPerFleet: readonly [number, number];
  /** Flotas de guarnición por región activa: [cerca, lejos]. */
  fleetsPerRegion: readonly [number, number];
}

/** Qué hace la IA de una especie cuando una flota humana entra en su territorio (si es hostil a ese Emperador). */
export type IntruderResponse = "attack" | "guard" | "ignore";

/** Comportamiento de la IA de una especie (Fase 11). Ver `ALIEN_AI` para los parámetros comunes. */
export interface AlienAiBehavior {
  /** Probabilidad de que una flota parada salga a patrullar en cada decisión. */
  patrol: number;
  /**
   * `attack`: envía flotas contra el intruso; `guard`: solo combaten las que ya
   * están en el sistema; `ignore`: nunca combate.
   */
  intruders: IntruderResponse;
  /** Flotas que envía como mucho contra un intruso. */
  responders: number;
  /** Sistemas que intenta sumar a su territorio por día de juego (expansión lenta). */
  expansionPerDay: number;
  /** Comercia en el mercado global con su propia cartera (Nómadas del Vacío). */
  trades: boolean;
  /** Rencor que suma un Emperador al fundar una colonia en su territorio (con 1 se vuelve hostil). */
  grudgePerColony: number;
}

/** Ficha de una especie alienígena. */
export interface SpeciesDefinition {
  id: string;
  /** Clave i18n del nombre: `species.<id>.name`. */
  nameKey: string;
  /** Clave i18n de la descripción: `species.<id>.description`. */
  descriptionKey: string;
  /** Clave i18n del lema (p. ej. «Purificación · Exterminio»): `species.<id>.motto`. */
  mottoKey: string;
  /** Clave i18n de su filosofía: `species.<id>.philosophy`. */
  philosophyKey: string;
  /** Clave i18n de su actitud hacia la humanidad: `species.<id>.attitude`. */
  attitudeKey: string;
  nature: SpeciesNature;
  doctrine: WarDoctrine;
  expansion: ExpansionStyle;
  stance: StanceTowardHumanity;
  diplomacy: DiplomacyStance;
  /** Desaparecida: solo quedan ruinas y archivos (no actúa en el mundo). */
  extinct: boolean;
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
  /** Dónde vive (capa de territorio). */
  territory: TerritoryPreferences;
  /** Cómo forma sus flotas. */
  fleet: FleetDoctrine;
  /** Cómo se comporta su IA. */
  ai: AlienAiBehavior;
}

/** Objetivo estratégico principal de una facción. */
export type StrategicGoal =
  | "conquer_human_worlds"
  | "raid_supply_lines"
  | "defend_homeworlds"
  | "consume_resources"
  | "assimilate_worlds"
  | "guard_anomalies"
  | "destroy_rival_faction"
  | "prevent_human_rebirth"
  | "impose_order"
  | "protect_trade_routes"
  | "preserve_knowledge"
  | "study_emperors"
  | "absorb_human_reproduction"
  | "break_hive_mind"
  | "vassalize_emperors"
  | "surpass_emperors"
  | "end_humanity"
  | "liberate_emperors"
  | "protect_human_colonies"
  | "resist_annexation";

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
  /** Relación con la humanidad (dentro de una misma especie puede variar). */
  relation: FactionRelation;
  traitModifiers: TraitModifiers;
  /** Ids de facciones con las que está enfrentada (pueden ser de su misma especie). */
  hostileTo: string[];
  /** Peso de la facción al repartir las regiones de su especie (0 = sin territorio propio). */
  regionShare: number;
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
  /** Poder de ataque por ronda de combate de flotas (daño de un disparo, ±20 %). */
  attack: number;
  /**
   * Escudo en el combate de flotas por rondas: absorbe hasta este daño en cada
   * ronda y se recarga entero al empezar la siguiente.
   */
  battleShield: number;
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
  /** Combate en tiempo real: escudo y armas. */
  combat: ShipCombat;
}

/** Tipos de arma: cañón (proyectil recto, rápido) o misil (sigue al objetivo fijado). */
export type WeaponKind = "cannon" | "missile";

/** Arma de una nave. Distancias en metros (`rangeU`), velocidades en m/s, tiempos en segundos. */
export interface WeaponDefinition {
  kind: WeaponKind;
  damage: number;
  /** Tiempo mínimo entre disparos. */
  cooldownSec: number;
  rangeU: number;
  /** Velocidad del proyectil (us/s). */
  speedU: number;
  /** Munición máxima (null = ilimitada) y segundos para recuperar una unidad. */
  ammo: number | null;
  ammoRegenSec: number | null;
}

/** Defensas y armamento de una nave para el combate en tiempo real. */
export interface ShipCombat {
  /** Escudo: absorbe el daño antes que el casco y se recarga si no recibe impactos. */
  shield: number;
  /** Recarga del escudo por segundo, tras `shieldDelaySec` sin recibir daño. */
  shieldRegenPerSec: number;
  shieldDelaySec: number;
  weapons: WeaponDefinition[];
}
