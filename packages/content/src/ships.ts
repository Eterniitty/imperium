import type { ShipClassDefinition, ShipClassId, ShipCombat, ShipHardpoints, WeaponDefinition } from "./types";

/**
 * Bocas de fuego de la nave insignia (la misma forma para todos los Emperadores):
 * dos cañones en las raíces de las alas y dos lanzadores bajo ellas. En metros;
 * el modelo 3D del cliente pone los cañones y los lanzadores justo ahí.
 */
export const FLAGSHIP_HARDPOINTS: ShipHardpoints = {
  cannon: [
    [9.6, -1.4, -21],
    [-9.6, -1.4, -21],
  ],
  missile: [
    [15.5, -2.6, 3],
    [-15.5, -2.6, 3],
  ],
};

/** Bocas de fuego escaladas (los piratas usan el mismo casco, más pequeño). */
function scaledHardpoints(h: ShipHardpoints, k: number): ShipHardpoints {
  const s = (o: readonly number[]) => [o[0]! * k, o[1]! * k, o[2]! * k] as const;
  return { cannon: h.cannon.map(s), missile: h.missile.map(s) };
}

/** Escala del casco de los asaltantes Carroñeros respecto a la nave insignia. */
export const PIRATE_MODEL_SCALE = 0.75;

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
    battleShield: 0,
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
    battleShield: 5,
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
    battleShield: 10,
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
    battleShield: 15,
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
 * Cañón de la nave del Emperador: proyectiles contados (1500). A bordo solo se
 * fabrica una reserva de emergencia (hasta 300, uno cada 12 s); el resto se
 * repone junto a una colonia propia.
 */
const FLAGSHIP_CANNON: WeaponDefinition = { ...CANNON, ammo: 1500, ammoRegenSec: 12, ammoRegenMax: 300 };
/** Misiles de la nave del Emperador: 6; a bordo se fabrican hasta 2 (uno cada 30 min). */
const FLAGSHIP_MISSILE: WeaponDefinition = { ...MISSILE, ammo: 6, ammoRegenSec: 1800, ammoRegenMax: 2 };

/**
 * Recursos de la nave del Emperador (servidor autoritativo; ver docs/ayuda-pilotaje.md):
 * - Energía: la produce el reactor y se recarga sola; alimenta escudos, cañón y pulso.
 * - Combustible: lo gastan el pulso y el salto cuántico. Se repone junto a una
 *   colonia propia con sus volátiles; a bordo solo se regenera, muy despacio,
 *   una reserva de emergencia para que nadie quede atrapado.
 * Tiempos en segundos reales (son sistemas de la nave, no producción).
 */
export const FLAGSHIP_SUPPLIES = {
  energyMax: 100,
  /** Recarga del reactor por segundo. */
  energyRegenPerSec: 10,
  /** Energía por disparo de cañón. */
  cannonEnergy: 2.5,
  /** Energía por segundo con el pulso encendido. */
  pulseEnergyPerSec: 3,
  /** Energía por punto de escudo recargado. */
  shieldEnergyPerPoint: 0.25,
  fuelMax: 1000,
  /** Combustible por segundo de pulso. */
  pulseFuelPerSec: 0.4,
  /** Combustible por año luz de salto cuántico: con el depósito lleno, unos 133 a.l. (unos 40 min de viaje). */
  quantumFuelPerLy: 7.5,
  /** Reserva de emergencia: el combustible se regenera solo hasta aquí… */
  emergencyFuelMax: 150,
  /** …a este ritmo (por hora real): de vacío a la reserva, unas 5 horas. */
  emergencyFuelPerHour: 30,
  /** Distancia (m) a la superficie de un planeta con colonia propia a la que se repone. */
  resupplyRangeM: 150_000,
  /** Reposición por segundo junto a una colonia propia (si tiene existencias). */
  resupplyFuelPerSec: 30,
  resupplyCannonPerSec: 75,
  resupplyMissilesPerSec: 0.5,
  /** Coste en existencias de la colonia: volátiles por unidad de combustible, metal por proyectil y aleaciones por misil. */
  volatilesPerFuel: 0.2,
  metalPerRound: 0.04,
  alloysPerMissile: 3,
} as const;

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
  combat: { shield: 200, shieldRegenPerSec: 20, shieldDelaySec: 4, weapons: [FLAGSHIP_CANNON, FLAGSHIP_MISSILE], hardpoints: FLAGSHIP_HARDPOINTS },
};

/** Alcance máximo del salto cuántico con el depósito lleno (años luz). */
export const QUANTUM_MAX_LY = FLAGSHIP_SUPPLIES.fuelMax / FLAGSHIP_SUPPLIES.quantumFuelPerLy;

/**
 * Combate de flotas por rondas (Fase 9a), resuelto en el servidor. Cada ronda
 * dura `roundGameSeconds` segundos de juego (en tiempo real, dividido por la
 * escala de tiempo). Pasadas `maxRounds` rondas sin vencedor, la batalla acaba
 * en tablas.
 */
export const FLEET_BATTLE = {
  roundGameSeconds: 30,
  maxRounds: 40,
  /** Variación del daño de cada disparo, en tanto por ciento (±). */
  damageSpreadPct: 20,
} as const;

/**
 * Sensores para detectar flotas en tránsito (contactos que se pueden
 * interceptar): las flotas paradas usan el escáner de su mejor nave, la nave
 * del Emperador el suyo y cada colonia este alcance.
 */
export const CONTACT_SENSORS = {
  colonyRangeLy: 10,
} as const;

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
    hardpoints: scaledHardpoints(FLAGSHIP_HARDPOINTS, PIRATE_MODEL_SCALE),
  },
};
