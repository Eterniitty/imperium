/**
 * El sistema de Aeon (Era II): la estrella, los siete mundos, sus lunas y los
 * lugares especiales, como DATOS (regla 4). Decisiones del dueño en la rama
 * plan-unreal: docs/roadmap-unreal.md §2, docs/sistema-aeon.md y
 * docs/mecanicas-era2.md (parcelas, zonas). Escala compacta y no realista.
 *
 * Lo usa el servidor de la Era II y se exporta a JSON para el cliente de Unreal
 * (scripts/export-aeon.ts → aeonarch-ue/Data/aeon.json). Los nombres van en es/en
 * aquí mismo porque son nombres propios del mundo, no textos de interfaz.
 *
 * Los secretos del lore (docs/lore-era2.md) NO van aquí: estos datos los ve el
 * cliente.
 */

export type AeonZone = "safe" | "disputed" | "lawless";

export type AeonPeople =
  | "humanity"
  | "aurelians"
  | "elydri"
  | "tharaxi"
  | "vesperi"
  | "nomads"
  | "greys"
  | "nihil"
  | "scavengers"
  | "eradicators";

/** Color en RGB lineal [0, 1]. */
export type RGB = readonly [number, number, number];

export interface AeonName {
  es: string;
  en: string;
}

/** Relieve de un mundo (ver TerrainParams en packages/procgen terrain.ts; la semilla la pone el servidor). */
export interface AeonTerrain {
  reliefM: number;
  seaLevel: number;
  continentFreq: number;
  mountainFreq: number;
  ridge: number;
}

/**
 * Un bioma: se elige el de clima más parecido (temperatura y humedad en [0, 1])
 * entre los de tierra; bajo el nivel del mar va el bioma `sea` del mundo.
 */
export interface AeonBiome {
  id: string;
  name: AeonName;
  temperature: number;
  humidity: number;
  /** Rampa de color estilizada: sombra → luz. */
  colors: readonly [RGB, RGB];
  /** Producción base de una parcela de este bioma, en unidades por hora (propuesta para ajustar jugando). */
  yields: Partial<Record<AeonResource, number>>;
}

/**
 * Recursos de la Era II: los de hoy (`StockId`) más la biomasa (comida y vida) y
 * la esencia de cada dios (de la tierra sagrada; ver mecanicas-era2.md §6.3).
 */
export type AeonResource =
  | "metal"
  | "volatiles"
  | "crystal"
  | "alloys"
  | "rare_metals"
  | "exotic"
  | "biomass"
  | "essence";

export interface AeonMoon {
  id: string;
  name: AeonName;
  radiusKm: number;
  /** Distancia al centro del planeta. */
  orbitKm: number;
  orbitPeriodH: number;
  zone: AeonZone;
  owner: AeonPeople | null;
  /** Frecuencia de la malla de parcelas (10·f²+2 parcelas), o null si no se puede reclamar. */
  parcelFrequency: number | null;
  color: RGB;
}

export interface AeonWorld {
  id: string;
  name: AeonName;
  kind: "rocky" | "gas";
  radiusKm: number;
  /** Distancia a la estrella. */
  orbitKm: number;
  /** Vuelta a la estrella, en horas reales. */
  orbitPeriodH: number;
  /** Día del planeta (rotación), en minutos reales. */
  dayLengthMin: number;
  /** Altura de la atmósfera, en km (0: sin atmósfera). */
  atmosphereKm: number;
  zone: AeonZone;
  people: AeonPeople;
  parcelFrequency: number | null;
  /** Color de lejos y de la atmósfera (estilizados, no físicos). */
  color: RGB;
  atmosphereColor: RGB;
  terrain: AeonTerrain | null;
  /** Bioma bajo el nivel del mar (océano, lava, metano…), o null si no hay mar. */
  sea: AeonBiome | null;
  biomes: readonly AeonBiome[];
  moons: readonly AeonMoon[];
}

export interface AeonPlace {
  id: string;
  name: AeonName;
  kind: "station" | "belt" | "ring" | "rift";
  /** Distancia a la estrella (o radios interior y exterior para cinturones y anillos). */
  orbitKm: number | readonly [number, number];
  zone: AeonZone;
  owner: AeonPeople | null;
}

export const AEON_STAR = {
  id: "aeon",
  name: { es: "Aeon", en: "Aeon" },
  radiusKm: 25,
  color: [1.0, 0.86, 0.62] as RGB,
  /** Distancia a la que el calor empieza a dañar (se suma al radio). */
  heatRangeKm: 40,
} as const;

const b = (
  id: string,
  es: string,
  en: string,
  temperature: number,
  humidity: number,
  dark: RGB,
  light: RGB,
  yields: Partial<Record<AeonResource, number>> = {},
): AeonBiome => ({
  id,
  name: { es, en },
  temperature,
  humidity,
  colors: [dark, light],
  yields,
});

export const AEON_WORLDS: readonly AeonWorld[] = [
  {
    id: "brasa",
    name: { es: "Brasa", en: "Ember" },
    kind: "rocky",
    radiusKm: 3,
    orbitKm: 120,
    orbitPeriodH: 8,
    dayLengthMin: 0, // Acoplado a la estrella: siempre la misma cara de día.
    atmosphereKm: 0.6,
    zone: "disputed",
    people: "aurelians",
    parcelFrequency: 6,
    color: [0.85, 0.32, 0.12],
    atmosphereColor: [1.0, 0.45, 0.15],
    terrain: { reliefM: 900, seaLevel: 0.35, continentFreq: 1.6, mountainFreq: 9, ridge: 0.8 },
    sea: b("lava", "Mar de lava", "Lava sea", 1, 0, [0.5, 0.06, 0.02], [1.0, 0.55, 0.1], { metal: 4, exotic: 0.2 }),
    biomes: [
      b("glass", "Vidrio negro", "Black glass", 0.2, 0.2, [0.03, 0.03, 0.05], [0.25, 0.22, 0.3], { crystal: 3, metal: 2 }),
      b("dusk", "Crepúsculo", "Twilight", 0.5, 0.4, [0.25, 0.08, 0.06], [0.75, 0.4, 0.25], { metal: 5, biomass: 1 }),
      b("ash", "Ceniza", "Ash", 0.8, 0.1, [0.2, 0.18, 0.17], [0.55, 0.5, 0.46], { metal: 4, rare_metals: 0.3 }),
    ],
    moons: [],
  },
  {
    id: "elyss",
    name: { es: "Elyss", en: "Elyss" },
    kind: "rocky",
    radiusKm: 4,
    orbitKm: 220,
    orbitPeriodH: 14,
    dayLengthMin: 70,
    atmosphereKm: 1.4,
    zone: "disputed",
    people: "elydri",
    parcelFrequency: 6,
    color: [0.62, 0.48, 0.9],
    atmosphereColor: [0.8, 0.55, 1.0],
    terrain: { reliefM: 1400, seaLevel: 0.2, continentFreq: 1.2, mountainFreq: 12, ridge: 0.9 },
    sea: null,
    biomes: [
      b("crystal_plain", "Llanura cantora", "Singing plain", 0.5, 0.5, [0.3, 0.2, 0.5], [0.85, 0.75, 1.0], { crystal: 6, biomass: 1 }),
      b("crystal_spires", "Agujas de cristal", "Crystal spires", 0.3, 0.8, [0.45, 0.25, 0.6], [1.0, 0.8, 0.95], { crystal: 8, rare_metals: 0.4 }),
      b("frost", "Escarcha", "Frost", 0.1, 0.3, [0.5, 0.5, 0.7], [0.95, 0.95, 1.0], { crystal: 3, volatiles: 2 }),
    ],
    moons: [
      { id: "elyss_shard", name: { es: "La Esquirla", en: "The Shard" }, radiusKm: 1, orbitKm: 18, orbitPeriodH: 3, zone: "disputed", owner: null, parcelFrequency: 4, color: [0.8, 0.7, 1.0] },
    ],
  },
  {
    id: "origen",
    name: { es: "Origen", en: "Origin" },
    kind: "rocky",
    radiusKm: 6,
    orbitKm: 340,
    orbitPeriodH: 24,
    dayLengthMin: 60,
    atmosphereKm: 2.2,
    zone: "safe",
    people: "humanity",
    parcelFrequency: 8,
    color: [0.16, 0.45, 0.75],
    atmosphereColor: [0.45, 0.75, 1.0],
    terrain: { reliefM: 1800, seaLevel: 0.5, continentFreq: 1.8, mountainFreq: 10, ridge: 0.5 },
    sea: b("ocean", "Océano", "Ocean", 0.6, 1, [0.02, 0.12, 0.3], [0.2, 0.75, 0.8], { biomass: 4, volatiles: 2 }),
    biomes: [
      b("beach", "Playa", "Beach", 0.85, 0.4, [0.55, 0.5, 0.35], [0.95, 0.9, 0.7], { biomass: 2, crystal: 1 }),
      b("forest", "Bosque de las islas", "Island forest", 0.6, 0.65, [0.05, 0.25, 0.12], [0.3, 0.65, 0.3], { biomass: 6 }),
      b("highland", "Tierras altas", "Highlands", 0.35, 0.35, [0.3, 0.32, 0.28], [0.6, 0.62, 0.5], { metal: 4, biomass: 1 }),
      b("snow", "Nieve", "Snow", 0, 0.45, [0.7, 0.75, 0.85], [1.0, 1.0, 1.0], { volatiles: 3 }),
    ],
    moons: [
      { id: "origen_yard", name: { es: "La Luna Astillero", en: "Shipyard Moon" }, radiusKm: 1.2, orbitKm: 25, orbitPeriodH: 4, zone: "safe", owner: "humanity", parcelFrequency: 4, color: [0.55, 0.55, 0.6] },
    ],
  },
  {
    id: "tharax",
    name: { es: "Tharax", en: "Tharax" },
    kind: "rocky",
    radiusKm: 5.5,
    orbitKm: 480,
    orbitPeriodH: 36,
    dayLengthMin: 50,
    atmosphereKm: 2.6,
    zone: "lawless",
    people: "tharaxi",
    parcelFrequency: 6,
    color: [0.3, 0.62, 0.22],
    atmosphereColor: [0.55, 1.0, 0.45],
    terrain: { reliefM: 2200, seaLevel: 0.4, continentFreq: 1.4, mountainFreq: 8, ridge: 0.7 },
    sea: b("spore_marsh", "Pantano de esporas", "Spore marsh", 0.7, 1, [0.1, 0.2, 0.05], [0.45, 0.7, 0.2], { biomass: 5, volatiles: 3 }),
    biomes: [
      b("fungal_forest", "Selva de hongos", "Fungal jungle", 0.7, 0.8, [0.08, 0.2, 0.1], [0.55, 0.95, 0.4], { biomass: 8 }),
      b("hive", "Colmena", "Hive", 0.6, 0.4, [0.25, 0.15, 0.05], [0.8, 0.6, 0.2], { biomass: 4, exotic: 0.3 }),
      b("ribs", "Costillas", "Ribs", 0.3, 0.3, [0.35, 0.32, 0.25], [0.8, 0.75, 0.6], { metal: 4, rare_metals: 0.3 }),
    ],
    moons: [
      { id: "tharax_seed", name: { es: "La Semilla", en: "The Seed" }, radiusKm: 1.4, orbitKm: 20, orbitPeriodH: 3.5, zone: "lawless", owner: "tharaxi", parcelFrequency: 4, color: [0.4, 0.55, 0.2] },
      { id: "tharax_refuge", name: { es: "El Refugio", en: "The Refuge" }, radiusKm: 1, orbitKm: 31, orbitPeriodH: 6, zone: "lawless", owner: "tharaxi", parcelFrequency: 4, color: [0.5, 0.5, 0.35] },
    ],
  },
  {
    id: "vesperia",
    name: { es: "Vesperia", en: "Vesperia" },
    kind: "rocky",
    radiusKm: 4.5,
    orbitKm: 700,
    orbitPeriodH: 52,
    dayLengthMin: 90,
    atmosphereKm: 1.8,
    zone: "disputed",
    people: "vesperi",
    parcelFrequency: 6,
    color: [0.85, 0.68, 0.3],
    atmosphereColor: [1.0, 0.7, 0.85],
    terrain: { reliefM: 1100, seaLevel: 0.45, continentFreq: 1.3, mountainFreq: 7, ridge: 0.3 },
    sea: b("lake", "Lagos", "Lakes", 0.6, 1, [0.1, 0.2, 0.3], [0.5, 0.65, 0.75], { biomass: 3, volatiles: 1 }),
    biomes: [
      b("golden_prairie", "Pradera dorada", "Golden prairie", 0.6, 0.4, [0.45, 0.35, 0.1], [1.0, 0.85, 0.4], { biomass: 7 }),
      b("tower_forest", "Bosque de árboles torre", "Tower forest", 0.55, 0.8, [0.15, 0.25, 0.12], [0.55, 0.7, 0.4], { biomass: 5, crystal: 1 }),
      b("mauve_hills", "Colinas malva", "Mauve hills", 0.3, 0.5, [0.35, 0.25, 0.35], [0.8, 0.65, 0.8], { crystal: 3, metal: 2 }),
    ],
    moons: [
      { id: "vesperia_wild_a", name: { es: "Jardín Mayor", en: "Greater Garden" }, radiusKm: 1.3, orbitKm: 19, orbitPeriodH: 3, zone: "disputed", owner: null, parcelFrequency: 4, color: [0.4, 0.6, 0.3] },
      { id: "vesperia_wild_b", name: { es: "Jardín Menor", en: "Lesser Garden" }, radiusKm: 0.9, orbitKm: 28, orbitPeriodH: 5, zone: "disputed", owner: null, parcelFrequency: 4, color: [0.5, 0.65, 0.35] },
    ],
  },
  {
    id: "cefiro",
    name: { es: "Céfiro", en: "Zephyr" },
    kind: "gas",
    radiusKm: 16,
    orbitKm: 950,
    orbitPeriodH: 72,
    dayLengthMin: 40,
    atmosphereKm: 4,
    zone: "safe", // Las ciudades nómadas; las lunas y el anillo tienen su propia zona.
    people: "nomads",
    parcelFrequency: null,
    color: [0.95, 0.62, 0.75],
    atmosphereColor: [1.0, 0.8, 0.9],
    terrain: null,
    sea: null,
    biomes: [],
    moons: [
      { id: "cefiro_sail", name: { es: "Vela Alta", en: "High Sail" }, radiusKm: 1.6, orbitKm: 40, orbitPeriodH: 4, zone: "disputed", owner: "nomads", parcelFrequency: 4, color: [0.7, 0.55, 0.45] },
      { id: "cefiro_harbor", name: { es: "Puerto Nómada", en: "Nomad Harbor" }, radiusKm: 1.4, orbitKm: 52, orbitPeriodH: 6, zone: "disputed", owner: "nomads", parcelFrequency: 4, color: [0.6, 0.6, 0.55] },
      { id: "cefiro_drift", name: { es: "La Deriva", en: "The Drift" }, radiusKm: 1.1, orbitKm: 65, orbitPeriodH: 8, zone: "disputed", owner: "nomads", parcelFrequency: 4, color: [0.65, 0.6, 0.7] },
      { id: "cefiro_den", name: { es: "La Guarida", en: "The Den" }, radiusKm: 1.2, orbitKm: 80, orbitPeriodH: 11, zone: "lawless", owner: "scavengers", parcelFrequency: 4, color: [0.45, 0.35, 0.3] },
      { id: "cefiro_frost", name: { es: "Escarcha", en: "Rime" }, radiusKm: 1.8, orbitKm: 100, orbitPeriodH: 15, zone: "disputed", owner: null, parcelFrequency: 4, color: [0.8, 0.88, 0.95] },
    ],
  },
  {
    id: "umbra",
    name: { es: "Umbra", en: "Umbra" },
    kind: "rocky",
    radiusKm: 5,
    orbitKm: 1300,
    orbitPeriodH: 96,
    dayLengthMin: 80,
    atmosphereKm: 1,
    zone: "lawless",
    people: "nihil",
    parcelFrequency: 6,
    color: [0.4, 0.7, 0.85],
    atmosphereColor: [0.5, 0.9, 1.0],
    terrain: { reliefM: 1600, seaLevel: 0.3, continentFreq: 1.1, mountainFreq: 11, ridge: 0.75 },
    sea: b("methane", "Mar de metano", "Methane sea", 0.1, 1, [0.02, 0.05, 0.1], [0.15, 0.3, 0.4], { volatiles: 6 }),
    biomes: [
      b("blue_ice", "Hielo azul", "Blue ice", 0.2, 0.6, [0.2, 0.4, 0.6], [0.7, 0.9, 1.0], { volatiles: 4, crystal: 1 }),
      b("geysers", "Géiseres", "Geysers", 0.4, 0.8, [0.3, 0.45, 0.55], [0.85, 0.95, 1.0], { volatiles: 5, exotic: 0.3 }),
      b("dark_rock", "Roca oscura", "Dark rock", 0.3, 0.2, [0.05, 0.06, 0.08], [0.25, 0.28, 0.32], { metal: 3, rare_metals: 0.6, exotic: 0.2 }),
    ],
    moons: [
      { id: "umbra_hollow", name: { es: "La Luna Hueca", en: "The Hollow Moon" }, radiusKm: 1.5, orbitKm: 22, orbitPeriodH: 4, zone: "lawless", owner: null, parcelFrequency: null, color: [0.5, 0.48, 0.42] },
    ],
  },
];

export const AEON_PLACES: readonly AeonPlace[] = [
  { id: "abacus", name: { es: "Ábaco", en: "Abacus" }, kind: "station", orbitKm: 340, zone: "safe", owner: "greys" },
  { id: "belt", name: { es: "El Cinturón", en: "The Belt" }, kind: "belt", orbitKm: [800, 880], zone: "lawless", owner: null },
  { id: "cefiro_ring", name: { es: "Anillo de Céfiro", en: "Zephyr's Ring" }, kind: "ring", orbitKm: [22, 34], zone: "lawless", owner: "scavengers" },
  { id: "rift", name: { es: "La Grieta", en: "The Rift" }, kind: "rift", orbitKm: 1600, zone: "lawless", owner: "eradicators" },
];

/** Número de parcelas de una malla de frecuencia f. */
export function parcelCount(frequency: number): number {
  return 10 * frequency * frequency + 2;
}

/** Errores de coherencia de los datos del sistema (vacío si todo está bien). */
export function validateAeon(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) errors.push(`aeon: id repetido ${id}`);
    ids.add(id);
  };
  let lastOrbit: number = AEON_STAR.radiusKm;
  for (const w of AEON_WORLDS) {
    unique(w.id);
    if (!(w.orbitKm > lastOrbit)) errors.push(`aeon: ${w.id} debe estar más lejos que el mundo anterior`);
    lastOrbit = w.orbitKm;
    if (!(w.radiusKm > 0)) errors.push(`aeon: ${w.id} sin radio`);
    if (w.kind === "rocky" && (!w.terrain || w.biomes.length === 0)) errors.push(`aeon: ${w.id} rocoso sin relieve o sin biomas`);
    if (w.kind === "gas" && w.parcelFrequency !== null) errors.push(`aeon: ${w.id} gaseoso con parcelas`);
    for (const biome of [...w.biomes, ...(w.sea ? [w.sea] : [])]) {
      if (!(biome.temperature >= 0 && biome.temperature <= 1 && biome.humidity >= 0 && biome.humidity <= 1)) errors.push(`aeon: bioma ${w.id}.${biome.id} fuera de [0, 1]`);
    }
    let lastMoon = w.radiusKm;
    for (const m of w.moons) {
      unique(m.id);
      if (!(m.orbitKm > lastMoon + m.radiusKm)) errors.push(`aeon: luna ${m.id} demasiado cerca`);
      lastMoon = m.orbitKm + m.radiusKm;
    }
  }
  for (const p of AEON_PLACES) unique(p.id);
  return errors;
}
