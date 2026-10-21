/**
 * Naves de las especies alienígenas y parámetros comunes de su IA (Fase 11).
 * Solo datos: la capa de territorio está en `@imperium/procgen` (territory.ts)
 * y la IA que mueve las flotas en el servidor (`apps/server/src/ai`).
 *
 * Las naves alienígenas no se construyen en astilleros humanos: las despliega
 * la IA en su territorio. Usan las mismas reglas que las humanas en el combate
 * de flotas por rondas (`attack`, `battleShield`, `hull`) y llevan ya los datos
 * del combate en tiempo real (`combat`) y del modelo procedural (`model`; la
 * silueta y los colores son los de su especie, `SpeciesDefinition.visual`) para
 * cuando se pilote contra ellas.
 */
import { factionsOfSpecies } from "./factions";
import { withHardpoints } from "./shipModels";
import { SHIP_CLASSES } from "./ships";
import { SPECIES } from "./species";
import type { FleetDoctrine, HullShape, ShipCombat, ShipClassId, ShipModelHints, WeaponDefinition } from "./types";

/** Papel de una nave alienígena en su flota. */
export type AlienShipRole = "raider" | "line" | "heavy" | "swarm" | "carrier" | "trader" | "escort" | "scout" | "stealth" | "guardian" | "boarder" | "bomber";

/** Forma del casco para el modelo procedural (junto con la silueta de la especie). */
export type AlienHullShape = HullShape;

/** Pistas del modelo procedural (las mismas que las naves humanas). */
export type AlienShipModel = ShipModelHints;

/**
 * Vuelo en el combate en tiempo real (piratas Carroñeros del espacio local):
 * velocidad máxima y distancia a la que intentan mantenerse del objetivo.
 * Metros y metros por segundo.
 */
export interface AlienFlight {
  speedU: number;
  preferredRangeU: number;
}

/** Ficha de una clase de nave alienígena. */
export interface AlienShipClassDefinition {
  id: string;
  speciesId: string;
  /** Clave i18n del nombre: `ship.<id>.name` (mismo espacio que las humanas). */
  nameKey: string;
  /** Clave i18n de la descripción: `ship.<id>.description`. */
  descriptionKey: string;
  role: AlienShipRole;
  /** Puntos de casco. */
  hull: number;
  /** Daño por ronda en el combate de flotas (±20 %). */
  attack: number;
  /** Escudo por ronda en el combate de flotas. */
  battleShield: number;
  /** Velocidad de crucero en años luz por hora. */
  speedLyPerHour: number;
  /** Alcance del escáner en años luz. */
  scannerRangeLy: number;
  /** Bodega (los Nómadas comercian). */
  cargo: number;
  /** Disparos por ronda en el combate de flotas (por defecto 1; ver `ShipClassDefinition.battleShots`). */
  battleShots?: number;
  /** Tamaño como blanco en el combate de flotas (por defecto, según la eslora; ver `battleProfileOf`). */
  battleProfile?: number;
  /** Combate en tiempo real (los Carroñeros ya lo usan; el resto, cuando se pilote contra ellos). */
  combat: ShipCombat;
  model: AlienShipModel;
  /** Vuelo en el espacio local (solo las naves que la IA pilota ya en tiempo real: los Carroñeros). */
  flight?: AlienFlight;
}

const cannon = (damage: number, cooldownSec: number, rangeU = 2000, speedU = 1500): WeaponDefinition => ({
  kind: "cannon",
  damage,
  cooldownSec,
  rangeU,
  speedU,
  ammo: null,
  ammoRegenSec: null,
});
const missile = (damage: number, ammo: number, rangeU = 5000): WeaponDefinition => ({
  kind: "missile",
  damage,
  cooldownSec: 2.5,
  rangeU,
  speedU: 700,
  ammo,
  ammoRegenSec: 15,
});

/**
 * Naves alienígenas, de dos en dos por especie (los Precursores, un guardián
 * que nunca se mueve). Referencia humana: la fragata tiene casco 300, ataque 40
 * y escudo 15. Las especies que viven más lejos del Núcleo son más fuertes.
 */
export const ALIEN_SHIP_CLASSES: readonly AlienShipClassDefinition[] = withHardpoints<AlienShipClassDefinition>([
  // --- Carroñeros (anillo 2+): débiles pero en manada. Cuanto más lejos del
  // Núcleo, más naves y más pesadas (ver `SCAVENGER_DANGER` y su doctrina de flota). ---
  {
    id: "scav_skiff", speciesId: "scavengers", nameKey: "ship.scav_skiff.name", descriptionKey: "ship.scav_skiff.description",
    role: "swarm", hull: 70, attack: 9, battleShield: 0, speedLyPerHour: 170, scannerRangeLy: 6, cargo: 20,
    combat: { shield: 20, shieldRegenPerSec: 5, shieldDelaySec: 4, weapons: [cannon(5, 0.35, 1500, 1300)] },
    model: { lengthM: 20, hullShape: "needle", engines: 1, wings: true },
    flight: { speedU: 280, preferredRangeU: 600 },
  },
  {
    id: "scav_raider", speciesId: "scavengers", nameKey: "ship.scav_raider.name", descriptionKey: "ship.scav_raider.description",
    role: "raider", hull: 120, attack: 14, battleShield: 5, speedLyPerHour: 160, scannerRangeLy: 10, cargo: 60,
    combat: { shield: 40, shieldRegenPerSec: 6, shieldDelaySec: 4, weapons: [cannon(7, 0.45, 1800, 1300)] },
    model: { lengthM: 34, hullShape: "wedge", engines: 2 },
    flight: { speedU: 230, preferredRangeU: 900 },
  },
  {
    // Arponero: se pega a la presa con arpones magnéticos (cañón corto y pesado); lleva cápsulas de abordaje.
    id: "scav_harpoon", speciesId: "scavengers", nameKey: "ship.scav_harpoon.name", descriptionKey: "ship.scav_harpoon.description",
    role: "boarder", hull: 190, attack: 20, battleShield: 8, speedLyPerHour: 150, scannerRangeLy: 8, cargo: 200,
    combat: { shield: 60, shieldRegenPerSec: 6, shieldDelaySec: 4, weapons: [cannon(16, 0.7, 900, 1100)] },
    model: { lengthM: 42, hullShape: "spindle", engines: 2, hangar: true },
    flight: { speedU: 260, preferredRangeU: 350 },
  },
  {
    // Bombardero: se queda lejos y lanza misiles; frágil si lo alcanzan.
    id: "scav_bomber", speciesId: "scavengers", nameKey: "ship.scav_bomber.name", descriptionKey: "ship.scav_bomber.description",
    role: "bomber", hull: 150, attack: 28, battleShield: 6, speedLyPerHour: 140, scannerRangeLy: 10, cargo: 40,
    combat: { shield: 40, shieldRegenPerSec: 5, shieldDelaySec: 4, weapons: [cannon(5, 0.5, 1500, 1300), { ...missile(60, 6), cooldownSec: 5, ammoRegenSec: 20 }] },
    model: { lengthM: 48, hullShape: "brick", engines: 2 },
    flight: { speedU: 200, preferredRangeU: 3200 },
  },
  {
    id: "scav_breaker", speciesId: "scavengers", nameKey: "ship.scav_breaker.name", descriptionKey: "ship.scav_breaker.description",
    role: "heavy", hull: 260, attack: 24, battleShield: 10, speedLyPerHour: 110, scannerRangeLy: 8, cargo: 300,
    combat: { shield: 70, shieldRegenPerSec: 6, shieldDelaySec: 5, weapons: [cannon(10, 0.5, 1800, 1300), missile(70, 4)] },
    model: { lengthM: 70, hullShape: "brick", engines: 3, turrets: 2 },
    flight: { speedU: 170, preferredRangeU: 1200 },
  },
  {
    // Nave nodriza: un casco de carguero enorme lleno de talleres y esquifes; guía la manada.
    id: "scav_mothership", speciesId: "scavengers", nameKey: "ship.scav_mothership.name", descriptionKey: "ship.scav_mothership.description",
    role: "carrier", hull: 900, attack: 48, battleShots: 4, battleShield: 25, speedLyPerHour: 90, scannerRangeLy: 14, cargo: 1200,
    combat: { shield: 220, shieldRegenPerSec: 10, shieldDelaySec: 5, weapons: [cannon(9, 0.3, 2000, 1300), missile(80, 8)] },
    model: { lengthM: 160, hullShape: "brick", engines: 4, hangar: true, turrets: 4, pods: 4 },
    flight: { speedU: 110, preferredRangeU: 2500 },
  },
  // --- VESPERI (anillo 3+): defensas extraordinarias ---
  {
    id: "vesperi_aegis", speciesId: "vesperi", nameKey: "ship.vesperi_aegis.name", descriptionKey: "ship.vesperi_aegis.description",
    role: "escort", hull: 380, attack: 26, battleShield: 40, speedLyPerHour: 100, scannerRangeLy: 12, cargo: 0,
    combat: { shield: 260, shieldRegenPerSec: 22, shieldDelaySec: 3, weapons: [cannon(12, 0.25)] },
    model: { lengthM: 60, hullShape: "disc", engines: 2 },
  },
  {
    id: "vesperi_watchtower", speciesId: "vesperi", nameKey: "ship.vesperi_watchtower.name", descriptionKey: "ship.vesperi_watchtower.description",
    role: "scout", hull: 140, attack: 12, battleShield: 20, speedLyPerHour: 180, scannerRangeLy: 25, cargo: 0,
    combat: { shield: 90, shieldRegenPerSec: 12, shieldDelaySec: 3, weapons: [cannon(8, 0.3)] },
    model: { lengthM: 30, hullShape: "spindle", engines: 1 },
  },
  // --- Nómadas del Vacío (anillo 3+): caravanas que comercian ---
  {
    id: "nomad_ark", speciesId: "void_nomads", nameKey: "ship.nomad_ark.name", descriptionKey: "ship.nomad_ark.description",
    role: "trader", hull: 420, attack: 10, battleShield: 20, speedLyPerHour: 120, scannerRangeLy: 15, cargo: 2000,
    combat: { shield: 150, shieldRegenPerSec: 10, shieldDelaySec: 5, weapons: [cannon(6, 0.4)] },
    model: { lengthM: 180, hullShape: "pod", engines: 4 },
  },
  {
    id: "nomad_corsair", speciesId: "void_nomads", nameKey: "ship.nomad_corsair.name", descriptionKey: "ship.nomad_corsair.description",
    role: "escort", hull: 200, attack: 30, battleShield: 15, speedLyPerHour: 200, scannerRangeLy: 15, cargo: 80,
    combat: { shield: 100, shieldRegenPerSec: 12, shieldDelaySec: 4, weapons: [cannon(12, 0.22), missile(80, 4)] },
    model: { lengthM: 38, hullShape: "needle", engines: 2 },
  },
  // --- ELYDRI (anillo 3+): escudos y tecnología antigua ---
  {
    id: "elydri_prism", speciesId: "elydri", nameKey: "ship.elydri_prism.name", descriptionKey: "ship.elydri_prism.description",
    role: "line", hull: 260, attack: 34, battleShield: 60, speedLyPerHour: 140, scannerRangeLy: 20, cargo: 0,
    combat: { shield: 320, shieldRegenPerSec: 30, shieldDelaySec: 3, weapons: [cannon(15, 0.25, 2400, 1800)] },
    model: { lengthM: 50, hullShape: "shard", engines: 0 },
  },
  {
    id: "elydri_reliquary", speciesId: "elydri", nameKey: "ship.elydri_reliquary.name", descriptionKey: "ship.elydri_reliquary.description",
    role: "heavy", hull: 600, attack: 40, battleShield: 120, speedLyPerHour: 90, scannerRangeLy: 30, cargo: 500,
    combat: { shield: 700, shieldRegenPerSec: 45, shieldDelaySec: 4, weapons: [cannon(18, 0.3, 2400, 1800), missile(110, 6)] },
    model: { lengthM: 220, hullShape: "shard", engines: 0 },
  },
  // --- Grises (anillo 4+): precisión ---
  {
    id: "grey_watcher", speciesId: "greys", nameKey: "ship.grey_watcher.name", descriptionKey: "ship.grey_watcher.description",
    role: "scout", hull: 120, attack: 10, battleShield: 40, speedLyPerHour: 260, scannerRangeLy: 30, cargo: 0,
    combat: { shield: 160, shieldRegenPerSec: 20, shieldDelaySec: 3, weapons: [cannon(9, 0.3, 2600, 2000)] },
    model: { lengthM: 26, hullShape: "disc", engines: 0 },
  },
  {
    id: "grey_theorem", speciesId: "greys", nameKey: "ship.grey_theorem.name", descriptionKey: "ship.grey_theorem.description",
    role: "line", hull: 320, attack: 55, battleShield: 45, speedLyPerHour: 160, scannerRangeLy: 20, cargo: 0,
    combat: { shield: 260, shieldRegenPerSec: 25, shieldDelaySec: 3, weapons: [cannon(20, 0.3, 2800, 2200), missile(100, 4, 6000)] },
    model: { lengthM: 70, hullShape: "ring", engines: 0 },
  },
  // --- AURELIANOS (anillo 4+): flotas nobles ---
  {
    id: "aurelian_lancer", speciesId: "aurelians", nameKey: "ship.aurelian_lancer.name", descriptionKey: "ship.aurelian_lancer.description",
    role: "line", hull: 300, attack: 42, battleShield: 20, speedLyPerHour: 170, scannerRangeLy: 12, cargo: 40,
    combat: { shield: 160, shieldRegenPerSec: 14, shieldDelaySec: 4, weapons: [cannon(15, 0.2), missile(90, 6)] },
    model: { lengthM: 55, hullShape: "needle", engines: 3 },
  },
  {
    id: "aurelian_bastion", speciesId: "aurelians", nameKey: "ship.aurelian_bastion.name", descriptionKey: "ship.aurelian_bastion.description",
    role: "heavy", hull: 900, attack: 70, battleShots: 3, battleShield: 50, speedLyPerHour: 80, scannerRangeLy: 15, cargo: 200,
    combat: { shield: 500, shieldRegenPerSec: 25, shieldDelaySec: 5, weapons: [cannon(24, 0.25, 2400, 1600), missile(140, 8)] },
    model: { lengthM: 320, hullShape: "monolith", engines: 6 },
  },
  // --- THARAXI (anillo 5+): enjambres ---
  {
    id: "tharaxi_drone", speciesId: "tharaxi", nameKey: "ship.tharaxi_drone.name", descriptionKey: "ship.tharaxi_drone.description",
    role: "swarm", hull: 60, attack: 12, battleShield: 0, speedLyPerHour: 190, scannerRangeLy: 6, cargo: 0,
    combat: { shield: 0, shieldRegenPerSec: 0, shieldDelaySec: 0, weapons: [cannon(6, 0.3, 1200, 1100)] },
    model: { lengthM: 14, hullShape: "pod", engines: 1 },
  },
  {
    id: "tharaxi_node", speciesId: "tharaxi", nameKey: "ship.tharaxi_node.name", descriptionKey: "ship.tharaxi_node.description",
    role: "carrier", hull: 700, attack: 30, battleShots: 4, battleShield: 10, speedLyPerHour: 90, scannerRangeLy: 12, cargo: 400,
    combat: { shield: 100, shieldRegenPerSec: 8, shieldDelaySec: 6, weapons: [cannon(10, 0.4, 1500, 1100), missile(80, 10)] },
    model: { lengthM: 260, hullShape: "spindle", engines: 5 },
  },
  // --- NIHIL (anillo 6+): ocultación y anomalías gravitatorias ---
  {
    id: "nihil_veil", speciesId: "nihil", nameKey: "ship.nihil_veil.name", descriptionKey: "ship.nihil_veil.description",
    role: "stealth", hull: 180, attack: 50, battleShield: 25, speedLyPerHour: 210, scannerRangeLy: 18, cargo: 0,
    combat: { shield: 140, shieldRegenPerSec: 18, shieldDelaySec: 3, weapons: [cannon(18, 0.3, 2200, 1800)] },
    model: { lengthM: 40, hullShape: "crescent", engines: 0 },
  },
  {
    id: "nihil_rift", speciesId: "nihil", nameKey: "ship.nihil_rift.name", descriptionKey: "ship.nihil_rift.description",
    role: "heavy", hull: 520, attack: 80, battleShield: 40, speedLyPerHour: 100, scannerRangeLy: 20, cargo: 0,
    combat: { shield: 300, shieldRegenPerSec: 20, shieldDelaySec: 4, weapons: [cannon(26, 0.35, 2400, 1800), missile(160, 4, 6000)] },
    model: { lengthM: 150, hullShape: "crescent", engines: 0 },
  },
  // --- Erradicadores (anillo 7+): los más peligrosos ---
  {
    id: "erad_purger", speciesId: "eradicators", nameKey: "ship.erad_purger.name", descriptionKey: "ship.erad_purger.description",
    role: "line", hull: 420, attack: 60, battleShield: 40, speedLyPerHour: 170, scannerRangeLy: 15, cargo: 0,
    combat: { shield: 260, shieldRegenPerSec: 22, shieldDelaySec: 3, weapons: [cannon(20, 0.2), missile(120, 6)] },
    model: { lengthM: 80, hullShape: "wedge", engines: 4 },
  },
  {
    id: "erad_sentence", speciesId: "eradicators", nameKey: "ship.erad_sentence.name", descriptionKey: "ship.erad_sentence.description",
    role: "heavy", hull: 1200, attack: 110, battleShots: 3, battleShield: 80, speedLyPerHour: 90, scannerRangeLy: 20, cargo: 0,
    combat: { shield: 800, shieldRegenPerSec: 40, shieldDelaySec: 4, weapons: [cannon(32, 0.25, 2600, 1800), missile(200, 8, 6000)] },
    model: { lengthM: 400, hullShape: "monolith", engines: 6 },
  },
  // --- Precursores: guardián dormido de sus ruinas (no se despliega en flotas) ---
  {
    id: "precursor_sentinel", speciesId: "precursors", nameKey: "ship.precursor_sentinel.name", descriptionKey: "ship.precursor_sentinel.description",
    role: "guardian", hull: 3000, attack: 150, battleShots: 5, battleShield: 200, speedLyPerHour: 1, scannerRangeLy: 40, cargo: 0,
    combat: { shield: 2000, shieldRegenPerSec: 60, shieldDelaySec: 6, weapons: [cannon(40, 0.5, 3000, 2000)] },
    model: { lengthM: 600, hullShape: "ring", engines: 0 },
  },
]);

/** Busca una clase de nave alienígena. */
export function getAlienShipClass(id: string): AlienShipClassDefinition | undefined {
  return ALIEN_SHIP_CLASSES.find((s) => s.id === id);
}

/** Naves de una especie. */
export function alienShipsOf(speciesId: string): AlienShipClassDefinition[] {
  return ALIEN_SHIP_CLASSES.filter((s) => s.speciesId === speciesId);
}

/** Lo que el combate de flotas y los viajes necesitan de cualquier nave, humana o alienígena. */
export interface ShipStats {
  id: string;
  hull: number;
  attack: number;
  battleShield: number;
  speedLyPerHour: number;
  scannerRangeLy: number;
  cargo: number;
  battleShots?: number;
  battleProfile?: number;
  model: ShipModelHints;
}

/** Datos de una nave cualquiera (primero las humanas, luego las alienígenas). */
export function getAnyShipClass(id: string): ShipStats | undefined {
  return SHIP_CLASSES.find((s) => s.id === (id as ShipClassId)) ?? getAlienShipClass(id);
}

/**
 * Tamaño como blanco en el combate de flotas: el de la ficha o, si no lo trae,
 * según la eslora (1 hasta 30 m, 2 hasta 70, 3 hasta 130, 4 hasta 250, 5 más).
 */
export function battleProfileOf(s: Pick<ShipStats, "battleProfile" | "model">): number {
  if (s.battleProfile) return s.battleProfile;
  const l = s.model.lengthM;
  return l <= 30 ? 1 : l <= 70 ? 2 : l <= 130 ? 3 : l <= 250 ? 4 : 5;
}

/**
 * Pesos de cada nave al formar una flota a la profundidad `t` (0 = el borde de
 * su territorio más cercano al Núcleo, 1 = lo más profundo): interpola entre
 * `composition` y `deepComposition` (si la doctrina la trae).
 */
export function fleetComposition(doctrine: FleetDoctrine, t: number): Array<[string, number]> {
  const k = Math.min(1, Math.max(0, t));
  const deep = doctrine.deepComposition;
  if (!deep) return doctrine.composition.map(([id, w]) => [id, w]);
  const ids = [...new Set([...doctrine.composition.map(([id]) => id), ...deep.map(([id]) => id)])];
  const near = new Map(doctrine.composition);
  const far = new Map(deep);
  return ids.map((id): [string, number] => [id, (near.get(id) ?? 0) * (1 - k) + (far.get(id) ?? 0) * k]).filter(([, w]) => w > 0);
}

/**
 * Piratas Carroñeros del espacio local (combate en tiempo real; la IA de
 * `SpaceService`). Distancias en metros, tiempos en segundos.
 */
export const PIRATE_AI = {
  /** Distancia a la que detectan y persiguen a una nave pilotada. */
  aggroRangeU: 6000,
  /** Segundos hasta que reaparecen tras ser destruidos. */
  respawnSec: 300,
  /** Huyen con el casco por debajo de esta fracción si les están dando (acosan, no se suicidan). */
  fleeHullPct: 0.35,
  /** Dejan de huir a esta distancia del enemigo más cercano y se reagrupan. */
  fleeDistanceU: 9000,
  /** Vuelven a cazar cuando el escudo se ha recargado hasta esta fracción. */
  regroupShieldPct: 0.8,
  /** Segundos que cuenta un impacto como «me están dando» (esquivar y huir). */
  underFireSec: 2.5,
  /** Fuerza de las maniobras laterales para romper la puntería (fracción de su velocidad). */
  jink: 0.45,
  /** La manada elige presa entre las naves a esta distancia de cualquiera de sus miembros. */
  packRadiusU: 9000,
  /** Esquivar cuerpos: segundos de anticipación y margen sobre su superficie (m). */
  avoidLookaheadSec: 5,
  avoidMarginM: 4000,
  /** No disparan si un compañero de manada está a menos de esto de la línea de tiro (m). */
  friendlyFireClearanceU: 150,
} as const;

/**
 * Escolta (Fase 9d, `docs/ia-naves.md` §5): las naves armadas de las flotas
 * propias paradas en el sistema donde pilota el Emperador salen a escoltarlo
 * (hasta `maxShips`), en formación a su alrededor, y atacan a los Carroñeros
 * que se acerquen a menos de `engageRangeU` de él. Con el pulso no le siguen el
 * paso: si se quedan a más de `catchUpM`, se reúnen con él de un salto.
 */
export const ESCORT = {
  maxShips: 6,
  engageRangeU: 7000,
  speedU: 320,
  preferredRangeU: 1500,
  spacingM: 900,
  catchUpM: 25000,
  aimJitter: 0.03,
} as const;

/**
 * Naves alienígenas en el espacio local (Fase 9d): las de las flotas de una
 * facción paradas en el sistema salen en 3D (hasta `maxShips` por sistema) y
 * vuelan con el mismo piloto que los Carroñeros; atacan a quien su facción es
 * hostil o a quien les dispare. `aimJitter`: su error de puntería (radianes).
 */
export const ALIEN_LOCAL = {
  maxShips: 8,
  aimJitter: 0.035,
  /** Segundos que vale la hostilidad consultada de una facción hacia un Emperador. */
  hostilityCacheSec: 30,
} as const;

/**
 * Milicia del Núcleo Humano (Fase 9d, `docs/ia-naves.md` §6b): patrullas en
 * los sistemas del Núcleo que persiguen a quien ataque a otro humano allí
 * (agresor durante `aggressorSec`) y nunca salen del Núcleo. Naves humanas de
 * `SHIP_CLASSES`, con buena puntería y disciplina (el piloto de la 9d).
 */
export const CORE_MILITIA = {
  ships: ["frigate", "corvette"] as readonly string[],
  aimJitter: 0.02,
  aggressorSec: 120,
  respawnSec: 600,
} as const;

/** Nivel de peligro de los Carroñeros de un sistema (según su distancia al Núcleo Humano). */
export interface ScavengerDangerLevel {
  /** Anillo mínimo (distancia al Núcleo en sectores, como en el territorio). */
  minRing: number;
  /** Probabilidad (en %) de que un sistema de este nivel tenga piratas. */
  chancePct: number;
  /** Cuántos: [mín, máx]. */
  count: readonly [number, number];
  /** Naves y su peso al elegir cada pirata. */
  ships: ReadonlyArray<readonly [string, number]>;
  /** Jefe de la manada: el primer pirata es esta nave con esta probabilidad (en %). */
  leader?: readonly [string, number];
  /** Error de puntería (radianes, de lado a lado): menos, mejor puntería. */
  aimJitter: number;
}

/**
 * Peligro de los Carroñeros por zona (petición de docs/ia-naves.md §6: más
 * lejos del Núcleo, más numerosos, mejor armados y con mejor puntería). En el
 * Núcleo Humano (anillos 0–1) nunca hay piratas.
 */
export const SCAVENGER_DANGER: readonly ScavengerDangerLevel[] = [
  { minRing: 2, chancePct: 40, count: [1, 2], ships: [["scav_skiff", 3], ["scav_raider", 3]], aimJitter: 0.16 },
  { minRing: 4, chancePct: 45, count: [2, 3], ships: [["scav_raider", 3], ["scav_skiff", 1], ["scav_harpoon", 2], ["scav_bomber", 2]], leader: ["scav_breaker", 30], aimJitter: 0.12 },
  {
    minRing: 7,
    chancePct: 50,
    count: [3, 4],
    ships: [["scav_raider", 2], ["scav_harpoon", 2], ["scav_bomber", 2], ["scav_breaker", 2]],
    leader: ["scav_mothership", 50],
    aimJitter: 0.08,
  },
];

/** Nivel de peligro de los Carroñeros en un anillo (null en el Núcleo Humano). */
export function scavengerDanger(ring: number): ScavengerDangerLevel | null {
  let level: ScavengerDangerLevel | null = null;
  for (const l of SCAVENGER_DANGER) if (ring >= l.minRing) level = l;
  return level;
}

/** Velocidad de una flota de naves de cualquier especie: la de su nave más lenta. */
export function anyFleetSpeedLyPerHour(classIds: readonly string[]): number {
  let speed = Infinity;
  for (const id of classIds) {
    const c = getAnyShipClass(id);
    if (!c) throw new Error(`Clase de nave desconocida: ${id}`);
    speed = Math.min(speed, c.speedLyPerHour);
  }
  if (!Number.isFinite(speed)) throw new Error("Una flota sin naves no puede viajar");
  return speed;
}

/**
 * Parámetros comunes de la IA de las facciones alienígenas (Fase 11) y de su
 * territorio. Las horas son de juego (se dividen por la escala de tiempo).
 */
export const ALIEN_AI = {
  /** Lado de una región de territorio, en sectores (cada región es de una sola especie o de nadie). */
  regionSizeSectors: 2,
  /** Peso de «nadie» al repartir las regiones (más alto, más espacio libre). */
  emptyRegionWeight: 2.5,
  /** Anillo a partir del cual las flotas son las más grandes de su especie. */
  deepRing: 12,
  /** Cada cuánto decide la IA de una región activa (minutos de juego). */
  tickGameMinutes: 30,
  /** Una región se duerme (deja de decidir) tras estas horas sin actividad humana cerca. */
  activeHours: 12,
  /** Como mucho una flota nueva de refuerzo por región cada tantas horas. */
  reinforceHours: 6,
  /** Las patrullas van a sistemas de su territorio a esta distancia como mucho (a.l.). */
  patrolRangeLy: 35,
  /** Las flotas que responden a un intruso salen de esta distancia como mucho (a.l.). */
  responseRangeLy: 60,
  /** La expansión suma sistemas a esta distancia de su territorio como mucho (a.l.). */
  expansionRangeLy: 20,
  /**
   * Gracia para Emperadores nuevos: durante sus primeras horas de juego las
   * facciones no envían flotas contra ellos (sí combaten las que ya estén en el
   * sistema al que lleguen). Junto con el Núcleo Humano, que es seguro, evita
   * arrasar a quien empieza.
   */
  noviceGraceHours: 24,
  /** Créditos con los que empieza la cartera de una facción que comercia. */
  traderStartingCredits: 5000,
  /** Rencor (relación con cada Emperador): con `hostileAt` o más, la facción es hostil aunque sea neutral. */
  grudge: {
    hostileAt: 1,
    /** Interceptar una de sus flotas. */
    intercept: 1,
    /** Disparar a una de sus naves en el espacio local (una vez por nave y Emperador). */
    attack: 1,
    /** Rencor que se olvida por día de juego. */
    decayPerDay: 0.25,
    /** Créditos de tributo que borran un punto de rencor (diplomacia básica). */
    tributeCreditsPerPoint: 400,
    /** Tributo mínimo. */
    minTribute: 50,
  },
  /** Comercio de los Nómadas del Vacío en el mercado global. */
  trade: {
    /** Recursos que venden y compran. */
    sells: ["volatiles", "metal"] as const,
    /** También compran metales raros minados por los Emperadores (siempre hay a quién vendérselos). */
    buys: ["crystal", "rare_metals"] as const,
    /** Cantidad de cada orden [mín, máx]. */
    quantity: [100, 400] as const,
    /** Precio de referencia por unidad (si el mercado aún no tiene precio). */
    referencePrice: { metal: 1, volatiles: 1.5, crystal: 6, alloys: 4, rare_metals: 14, exotic: 90 } as const,
    /** Margen sobre el precio de referencia: venden más caro y compran más barato. */
    spread: 0.08,
    /** Órdenes abiertas como mucho. */
    maxOpenOrders: 6,
    /** Existencias que reponen en su hábitat por decisión (su producción propia). */
    restock: 300,
  },
} as const;

/**
 * Reglas de la capa de territorio (`@imperium/procgen` territory.ts) a partir
 * de las fichas de especies y facciones: qué especies tienen regiones, a qué
 * distancia del Núcleo, con qué estrellas, y qué facción lleva cada región.
 */
export function territoryRules() {
  const species = SPECIES.filter((s) => !s.extinct && s.territory.regionWeight > 0).map((s) => ({
    speciesId: s.id,
    minCoreRing: s.territory.minCoreRing,
    regionWeight: s.territory.regionWeight,
    systemShare: s.territory.systemShare,
    region: s.territory.region,
    preferredStarClasses: s.geography.preferredStarClasses,
    factions: factionsOfSpecies(s.id)
      .filter((f) => f.regionShare > 0)
      .map((f) => [f.id, f.regionShare] as const),
  }));
  const relic = SPECIES.find((s) => s.extinct);
  return {
    regionSizeSectors: ALIEN_AI.regionSizeSectors,
    emptyRegionWeight: ALIEN_AI.emptyRegionWeight,
    species,
    relics: relic
      ? { speciesId: relic.id, minCoreRing: relic.territory.minCoreRing, share: relic.territory.systemShare, starClasses: relic.geography.preferredStarClasses }
      : null,
  };
}
