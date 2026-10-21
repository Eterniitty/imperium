import { withHardpoints } from "./shipModels";
import type { ShipClassDefinition, ShipClassId, ShipCombat, ShipHardpoints, WeaponDefinition } from "./types";

/**
 * Bocas de fuego de la nave insignia (la misma forma para todos los Emperadores):
 * dos cañones en barquillas a los lados de la proa y dos lanzadores en la cara
 * delantera de las barquillas laterales. En metros;
 * el modelo 3D del cliente pone los cañones y los lanzadores justo ahí.
 */
export const FLAGSHIP_HARDPOINTS: ShipHardpoints = {
  cannon: [
    [3.8, -1.2, -20.5],
    [-3.8, -1.2, -20.5],
  ],
  missile: [
    [6.2, -0.5, -9.4],
    [-6.2, -0.5, -9.4],
  ],
};

/** Cañón estándar: ráfagas rápidas, sin límite de munición. */
const CANNON: WeaponDefinition = { kind: "cannon", damage: 14, cooldownSec: 0.2, rangeU: 2000, speedU: 1500, ammo: null, ammoRegenSec: null };
/** Cañón ligero de las naves que no son de combate. */
const CANNON_LIGHT: WeaponDefinition = { ...CANNON, damage: 6, cooldownSec: 0.35 };
/** Cañón rápido de los cazas: poco daño, mucha cadencia. */
const CANNON_RAPID: WeaponDefinition = { ...CANNON, damage: 8, cooldownSec: 0.12, rangeU: 1600, speedU: 1700 };
/** Antiaéreo de las corbetas: ráfagas cortas y muy rápidas contra naves pequeñas. */
const FLAK: WeaponDefinition = { ...CANNON, damage: 5, cooldownSec: 0.08, rangeU: 1400, speedU: 1900 };
/** Cañón pesado de las torretas: lento, de largo alcance y mucho daño. */
const CANNON_HEAVY: WeaponDefinition = { ...CANNON, damage: 34, cooldownSec: 0.6, rangeU: 2800, speedU: 1700 };
/** Misil: mucho daño, sigue al objetivo fijado; munición limitada que se repone con el tiempo. */
const MISSILE: WeaponDefinition = { kind: "missile", damage: 90, cooldownSec: 2.5, rangeU: 5000, speedU: 700, ammo: 6, ammoRegenSec: 15 };
/** Torpedo de los destructores y cruceros: más daño, más lento, pocas unidades. */
const TORPEDO: WeaponDefinition = { ...MISSILE, damage: 160, cooldownSec: 4, rangeU: 6000, speedU: 550, ammo: 4, ammoRegenSec: 25 };

const SHIPYARD = { shipyard: 1 } as const;
const SHIPYARD_REFINERY = { shipyard: 1, refinery: 1 } as const;
const DRYDOCK = { shipyard: 1, drydock: 1, refinery: 1 } as const;

/**
 * Clases de nave humanas. Escala decidida el 20-10-2026: saltar entre
 * estrellas cercanas (10–20 a.l.) lleva minutos; cruzar un sector (100 a.l.),
 * entre media hora y una hora; construir sigue llevando horas.
 *
 * Catálogo ampliado el 21-10-2026 (de 4 a 12 clases). Equilibrio del combate
 * de flotas por rondas con el mismo presupuesto (`packages/sim/test/balance.test.ts`):
 * - repartir el ataque en muchos disparos (`battleShots`) evita desperdiciar
 *   daño contra naves pequeñas sin escudo, pero cada escudo absorbe su parte:
 *   las corbetas barren cazas y pierden contra fragatas y destructores;
 * - los cazas son baratos y, en enjambre, desbordan el escudo de una nave sola
 *   (sobre todo del portanaves, si va sin escolta);
 * - las naves grandes atraen el fuego (`battleProfile`) y protegen a las
 *   pequeñas; las capitales (crucero, portanaves) piden dique orbital y aleaciones;
 * - el interceptor paga su velocidad (alcanza convoyes y huye de lo que no puede vencer).
 */
export const SHIP_CLASSES: readonly ShipClassDefinition[] = withHardpoints<ShipClassDefinition>([
  {
    id: "explorer",
    nameKey: "ship.explorer.name",
    descriptionKey: "ship.explorer.description",
    role: "exploration",
    cost: { metal: 120, volatiles: 80, crystal: 10, alloys: 0 },
    requires: SHIPYARD,
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
    model: { archetype: "scout", lengthM: 32, hullShape: "needle", engines: 2, dish: true },
  },
  {
    id: "fighter",
    nameKey: "ship.fighter.name",
    descriptionKey: "ship.fighter.description",
    role: "combat",
    cost: { metal: 140, volatiles: 50, crystal: 5, alloys: 0 },
    requires: SHIPYARD,
    buildTimeHours: 1.5,
    hull: 90,
    attack: 17,
    battleShield: 2,
    speedLyPerHour: 200,
    cargo: 0,
    scannerRangeLy: 6,
    upkeepVolatilesPerHour: 0.8,
    consumedOnUse: false,
    combat: { shield: 50, shieldRegenPerSec: 10, shieldDelaySec: 3, weapons: [CANNON_RAPID] },
    model: { archetype: "fighter", lengthM: 18, hullShape: "needle", engines: 1, wings: true },
  },
  {
    id: "interceptor",
    nameKey: "ship.interceptor.name",
    descriptionKey: "ship.interceptor.description",
    role: "combat",
    cost: { metal: 220, volatiles: 90, crystal: 15, alloys: 0 },
    requires: SHIPYARD,
    buildTimeHours: 2.5,
    hull: 140,
    attack: 30,
    battleShots: 2,
    battleShield: 8,
    speedLyPerHour: 230,
    cargo: 10,
    scannerRangeLy: 14,
    upkeepVolatilesPerHour: 1.5,
    consumedOnUse: false,
    combat: { shield: 80, shieldRegenPerSec: 12, shieldDelaySec: 3, weapons: [CANNON, { ...MISSILE, ammo: 2, damage: 70 }] },
    model: { archetype: "fighter", lengthM: 26, hullShape: "needle", engines: 2, wings: true },
  },
  {
    id: "corvette",
    nameKey: "ship.corvette.name",
    descriptionKey: "ship.corvette.description",
    role: "combat",
    cost: { metal: 260, volatiles: 100, crystal: 10, alloys: 0 },
    requires: SHIPYARD,
    buildTimeHours: 3,
    hull: 200,
    attack: 22,
    battleShots: 4,
    battleProfile: 2,
    battleShield: 14,
    speedLyPerHour: 170,
    cargo: 30,
    scannerRangeLy: 10,
    upkeepVolatilesPerHour: 1.8,
    consumedOnUse: false,
    combat: { shield: 120, shieldRegenPerSec: 14, shieldDelaySec: 3, weapons: [FLAK] },
    model: { archetype: "frigate", lengthM: 38, hullShape: "wedge", engines: 2 },
  },
  {
    id: "frigate",
    nameKey: "ship.frigate.name",
    descriptionKey: "ship.frigate.description",
    role: "combat",
    cost: { metal: 400, volatiles: 150, crystal: 25, alloys: 0 },
    requires: SHIPYARD,
    buildTimeHours: 6,
    hull: 300,
    attack: 40,
    battleProfile: 2,
    battleShield: 15,
    speedLyPerHour: 150,
    cargo: 40,
    scannerRangeLy: 12,
    upkeepVolatilesPerHour: 3,
    consumedOnUse: false,
    combat: { shield: 150, shieldRegenPerSec: 12, shieldDelaySec: 4, weapons: [CANNON, MISSILE] },
    model: { archetype: "frigate", lengthM: 55, hullShape: "spindle", engines: 2 },
  },
  {
    id: "destroyer",
    nameKey: "ship.destroyer.name",
    descriptionKey: "ship.destroyer.description",
    role: "combat",
    cost: { metal: 650, volatiles: 200, crystal: 35, alloys: 60 },
    requires: SHIPYARD_REFINERY,
    buildTimeHours: 9,
    hull: 480,
    attack: 68,
    battleShots: 2,
    battleProfile: 3,
    battleShield: 22,
    speedLyPerHour: 135,
    cargo: 40,
    scannerRangeLy: 12,
    upkeepVolatilesPerHour: 4.5,
    consumedOnUse: false,
    combat: { shield: 260, shieldRegenPerSec: 18, shieldDelaySec: 4, weapons: [CANNON_HEAVY, TORPEDO] },
    model: { archetype: "frigate", lengthM: 95, hullShape: "wedge", engines: 3, turrets: 2 },
  },
  {
    id: "cruiser",
    nameKey: "ship.cruiser.name",
    descriptionKey: "ship.cruiser.description",
    role: "combat",
    cost: { metal: 1300, volatiles: 420, crystal: 80, alloys: 150 },
    requires: DRYDOCK,
    buildTimeHours: 16,
    hull: 1000,
    attack: 140,
    battleShots: 3,
    battleProfile: 4,
    battleShield: 40,
    speedLyPerHour: 115,
    cargo: 120,
    scannerRangeLy: 16,
    upkeepVolatilesPerHour: 7,
    consumedOnUse: false,
    combat: { shield: 600, shieldRegenPerSec: 30, shieldDelaySec: 4, weapons: [CANNON_HEAVY, { ...TORPEDO, ammo: 8 }] },
    model: { archetype: "capital", lengthM: 180, hullShape: "monolith", engines: 4, turrets: 4 },
  },
  {
    id: "carrier",
    nameKey: "ship.carrier.name",
    descriptionKey: "ship.carrier.description",
    role: "combat",
    cost: { metal: 1500, volatiles: 500, crystal: 100, alloys: 180 },
    requires: DRYDOCK,
    buildTimeHours: 22,
    hull: 1400,
    attack: 220,
    battleShots: 8,
    battleProfile: 5,
    battleShield: 45,
    speedLyPerHour: 100,
    cargo: 200,
    scannerRangeLy: 20,
    upkeepVolatilesPerHour: 9,
    consumedOnUse: false,
    combat: { shield: 700, shieldRegenPerSec: 25, shieldDelaySec: 5, weapons: [FLAK, { ...MISSILE, ammo: 12 }] },
    model: { archetype: "capital", lengthM: 240, hullShape: "brick", engines: 4, hangar: true, turrets: 2 },
  },
  {
    id: "freighter",
    nameKey: "ship.freighter.name",
    descriptionKey: "ship.freighter.description",
    role: "logistics",
    cost: { metal: 200, volatiles: 60, crystal: 0, alloys: 0 },
    requires: SHIPYARD,
    buildTimeHours: 3,
    hull: 50,
    attack: 0,
    battleProfile: 2,
    battleShield: 5,
    speedLyPerHour: 90,
    cargo: 1000,
    scannerRangeLy: 5,
    upkeepVolatilesPerHour: 2,
    consumedOnUse: false,
    combat: { shield: 60, shieldRegenPerSec: 6, shieldDelaySec: 5, weapons: [] },
    model: { archetype: "transport", lengthM: 70, hullShape: "pod", engines: 2, pods: 4 },
  },
  {
    id: "hauler",
    nameKey: "ship.hauler.name",
    descriptionKey: "ship.hauler.description",
    role: "logistics",
    cost: { metal: 600, volatiles: 180, crystal: 0, alloys: 60 },
    requires: SHIPYARD_REFINERY,
    buildTimeHours: 7,
    hull: 280,
    attack: 0,
    battleProfile: 4,
    battleShield: 25,
    speedLyPerHour: 75,
    cargo: 4000,
    scannerRangeLy: 5,
    upkeepVolatilesPerHour: 4,
    consumedOnUse: false,
    combat: { shield: 160, shieldRegenPerSec: 8, shieldDelaySec: 5, weapons: [CANNON_LIGHT] },
    model: { archetype: "transport", lengthM: 160, hullShape: "pod", engines: 3, pods: 10 },
  },
  {
    id: "troopship",
    nameKey: "ship.troopship.name",
    descriptionKey: "ship.troopship.description",
    role: "transport",
    cost: { metal: 480, volatiles: 200, crystal: 20, alloys: 40 },
    requires: SHIPYARD_REFINERY,
    buildTimeHours: 6,
    hull: 380,
    attack: 6,
    battleProfile: 3,
    battleShield: 25,
    speedLyPerHour: 130,
    cargo: 100,
    scannerRangeLy: 6,
    upkeepVolatilesPerHour: 3,
    consumedOnUse: false,
    combat: { shield: 180, shieldRegenPerSec: 10, shieldDelaySec: 4, weapons: [CANNON_LIGHT] },
    model: { archetype: "transport", lengthM: 85, hullShape: "brick", engines: 2, hangar: true },
  },
  {
    id: "colonizer",
    nameKey: "ship.colonizer.name",
    descriptionKey: "ship.colonizer.description",
    role: "colonization",
    cost: { metal: 600, volatiles: 300, crystal: 40, alloys: 0 },
    requires: SHIPYARD,
    buildTimeHours: 12,
    hull: 120,
    attack: 0,
    battleProfile: 3,
    battleShield: 10,
    speedLyPerHour: 60,
    cargo: 300,
    scannerRangeLy: 8,
    upkeepVolatilesPerHour: 4,
    consumedOnUse: true,
    combat: { shield: 80, shieldRegenPerSec: 6, shieldDelaySec: 5, weapons: [] },
    model: { archetype: "transport", lengthM: 110, hullShape: "spindle", engines: 3, habitat: true },
  },
]);

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

/** Segundos que tarda en cargar el motor cuántico (con la nave ya alineada con el destino). */
export const QUANTUM_CHARGE_SEC = 5;
/** Eslora de la nave insignia del Emperador (m): el modelo 3D, las cámaras y la grieta del salto se miden con ella. */
export const FLAGSHIP_LENGTH_M = 46;

/**
 * Grieta del salto cuántico (solo visual, la ven todos los del sistema), en
 * esloras de la nave insignia: se abre `aheadLengths` por delante del morro,
 * mide `heightLengths` de alto y dura lo que la carga más la entrada o salida.
 * El servidor solo reenvía grietas a menos de `maxOffsetLengths` de la nave.
 */
export const QUANTUM_RIFT = {
  aheadLengths: 3.2,
  heightLengths: 2.6,
  maxOffsetLengths: 12,
  /** Segundos que tarda la nave en entrar en la grieta al saltar, y en salir de la de llegada. */
  departSec: 1.5,
  arriveSec: 2.2,
} as const;

/** Velocidad con la que la nave se alinea sola con el destino del salto (radianes por segundo). */
export const QUANTUM_ALIGN_RAD_PER_SEC = 1.4;

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
