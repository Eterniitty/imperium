import type { ShipClassDefinition, ShipClassId, ShipCombat, WeaponDefinition } from "./types";

/** Cañón estándar: ráfagas rápidas, sin límite de munición. */
const CANNON: WeaponDefinition = { kind: "cannon", damage: 14, cooldownSec: 0.2, rangeU: 2000, speedU: 1500, ammo: null, ammoRegenSec: null };
/** Cañón ligero de las naves que no son de combate. */
const CANNON_LIGHT: WeaponDefinition = { ...CANNON, damage: 6, cooldownSec: 0.35 };
/** Misil: mucho daño, sigue al objetivo fijado; munición limitada que se repone con el tiempo. */
const MISSILE: WeaponDefinition = { kind: "missile", damage: 90, cooldownSec: 2.5, rangeU: 5000, speedU: 700, ammo: 6, ammoRegenSec: 15 };

/**
 * Clases de nave humanas del MVP. Escala decidida el 20-10-2026: saltar entre
 * estrellas cercanas (10–20 a.l.) lleva minutos; cruzar un sector (100 a.l.),
 * entre media hora y una hora; construir sigue llevando horas.
 */
export const SHIP_CLASSES: readonly ShipClassDefinition[] = [
  {
    id: "explorer",
    nameKey: "ship.explorer.name",
    descriptionKey: "ship.explorer.description",
    role: "exploration",
    cost: { metal: 120, volatiles: 80, crystal: 10 },
    buildTimeHours: 2,
    hull: 60,
    attack: 2,
    speedLyPerHour: 240,
    cargo: 20,
    scannerRangeLy: 25,
    upkeepVolatilesPerHour: 1,
    consumedOnUse: false,
    combat: { shield: 40, shieldRegenPerSec: 8, shieldDelaySec: 4, weapons: [CANNON_LIGHT] },
  },
  {
    id: "freighter",
    nameKey: "ship.freighter.name",
    descriptionKey: "ship.freighter.description",
    role: "logistics",
    cost: { metal: 200, volatiles: 60, crystal: 0 },
    buildTimeHours: 3,
    hull: 50,
    attack: 0,
    speedLyPerHour: 90,
    cargo: 1000,
    scannerRangeLy: 5,
    upkeepVolatilesPerHour: 2,
    consumedOnUse: false,
    combat: { shield: 60, shieldRegenPerSec: 6, shieldDelaySec: 5, weapons: [] },
  },
  {
    id: "colonizer",
    nameKey: "ship.colonizer.name",
    descriptionKey: "ship.colonizer.description",
    role: "colonization",
    cost: { metal: 600, volatiles: 300, crystal: 40 },
    buildTimeHours: 12,
    hull: 120,
    attack: 0,
    speedLyPerHour: 60,
    cargo: 300,
    scannerRangeLy: 8,
    upkeepVolatilesPerHour: 4,
    consumedOnUse: true,
    combat: { shield: 80, shieldRegenPerSec: 6, shieldDelaySec: 5, weapons: [] },
  },
  {
    id: "frigate",
    nameKey: "ship.frigate.name",
    descriptionKey: "ship.frigate.description",
    role: "combat",
    cost: { metal: 400, volatiles: 150, crystal: 25 },
    buildTimeHours: 6,
    hull: 300,
    attack: 40,
    speedLyPerHour: 150,
    cargo: 40,
    scannerRangeLy: 12,
    upkeepVolatilesPerHour: 3,
    consumedOnUse: false,
    combat: { shield: 150, shieldRegenPerSec: 12, shieldDelaySec: 4, weapons: [CANNON, MISSILE] },
  },
];

/** Busca una clase de nave por id. */
export function getShipClass(id: ShipClassId): ShipClassDefinition | undefined {
  return SHIP_CLASSES.find((s) => s.id === id);
}

/**
 * Nave del Emperador. No se construye: cada Emperador tiene la suya. Rápida y
 * con buen escáner, pero sola no gana batallas.
 */
export const EMPEROR_FLAGSHIP: {
  speedLyPerHour: number;
  scannerRangeLy: number;
  hull: number;
  combat: ShipCombat;
} = {
  speedLyPerHour: 200,
  scannerRangeLy: 15,
  hull: 400,
  combat: { shield: 200, shieldRegenPerSec: 20, shieldDelaySec: 4, weapons: [CANNON, MISSILE] },
};

/** Naves con las que empieza cada Emperador nuevo, como su primera flota. */
export const STARTING_FLEET: readonly ShipClassId[] = ["explorer"];

/** Velocidad de una flota: la de su nave más lenta (años luz por hora). */
export function fleetSpeedLyPerHour(classIds: readonly string[]): number {
  let speed = Infinity;
  for (const id of classIds) {
    const c = getShipClass(id as ShipClassId);
    if (!c) throw new Error(`Clase de nave desconocida: ${id}`);
    speed = Math.min(speed, c.speedLyPerHour);
  }
  if (!Number.isFinite(speed)) throw new Error("Una flota sin naves no puede viajar");
  return speed;
}

/**
 * Asaltante de los Carroñeros (IA). Más débil que la nave del Emperador, pero
 * suelen ir en grupo. Viven fuera del Núcleo Humano y atacan a quien se acerca.
 * Distancias en metros y velocidades en metros por segundo.
 */
export const PIRATE_RAIDER: {
  speciesId: string;
  hull: number;
  speedU: number;
  /** Distancia a la que detectan y persiguen a una nave. */
  aggroRangeU: number;
  /** Distancia a la que intentan mantenerse del objetivo. */
  preferredRangeU: number;
  /** Segundos hasta que reaparecen tras ser destruidos. */
  respawnSec: number;
  combat: ShipCombat;
} = {
  speciesId: "scavengers",
  hull: 120,
  speedU: 230,
  aggroRangeU: 6000,
  preferredRangeU: 900,
  respawnSec: 300,
  combat: {
    shield: 40,
    shieldRegenPerSec: 6,
    shieldDelaySec: 4,
    weapons: [{ kind: "cannon", damage: 7, cooldownSec: 0.45, rangeU: 1800, speedU: 1300, ammo: null, ammoRegenSec: null }],
  },
};
