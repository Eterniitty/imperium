import type { FleetTactic } from "@imperium/shared";
import { withHardpoints } from "./shipModels";
import type { ShipClassDefinition, ShipClassId, ShipCombat, ShipHardpoints, WeaponDefinition } from "./types";

/**
 * Eslora de la nave insignia del Emperador (m). Lleva hasta 500 humanos
 * (`HUMANS.flagshipCapacity`, Ley II): tripulación, colonos y tropas, con
 * hábitats, hangar, reactor, motor cuántico y bodega. Un portaaviones actual
 * (~333 m) aloja a unas 5000 personas apretadas; una nave que debe sostener a
 * 500 durante meses, con gravedad de giro y blindaje, y que además es nave de
 * mando con hangar, ronda los 300 m. Decidido el 21-10-2026: 320 m. El modelo
 * 3D, las cámaras, la grieta del salto, el túnel y el radio de impacto se
 * miden con ella.
 */
export const FLAGSHIP_LENGTH_M = 320;

/** Radio de impacto de la nave insignia en el combate en tiempo real (m): casco largo y estrecho, algo de margen por la latencia. */
export const FLAGSHIP_HIT_RADIUS_M = Math.round(FLAGSHIP_LENGTH_M * 0.3);

/** Boca de fuego en fracciones de la eslora de la insignia → metros. */
const fl = (x: number, y: number, z: number): [number, number, number] => [
  Math.round(x * FLAGSHIP_LENGTH_M * 100) / 100,
  Math.round(y * FLAGSHIP_LENGTH_M * 100) / 100,
  Math.round(z * FLAGSHIP_LENGTH_M * 100) / 100,
];

/**
 * Bocas de fuego de la nave insignia (la misma forma para todos los Emperadores):
 * dos cañones en barquillas a los lados de la proa y dos lanzadores de misiles
 * en la proa de los módulos de hábitat, a los costados. En metros (fracciones
 * de la eslora); el modelo 3D del cliente (receta `flagship`) pone los cañones
 * y la cara de los lanzadores justo ahí, y el servidor dispara desde ahí.
 */
export const FLAGSHIP_HARDPOINTS: ShipHardpoints = {
  cannon: [fl(0.078, -0.012, -0.43), fl(-0.078, -0.012, -0.43)],
  missile: [fl(0.118, 0.004, -0.112), fl(-0.118, 0.004, -0.112)],
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
 *
 * Esloras (21-10-2026, a escala de la insignia de 320 m): cazas de 20–32 m
 * (uno o dos tripulantes), corbetas y fragatas de 80–140 m, destructores de
 * 230 m y capitales de 480–620 m; transportes según su carga. Los planetas
 * siguen siendo cientos o miles de veces mayores (20–350 km de radio).
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
    model: { archetype: "scout", lengthM: 60, hullShape: "needle", engines: 2, dish: true },
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
    model: { archetype: "fighter", lengthM: 20, hullShape: "needle", engines: 1, wings: true },
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
    model: { archetype: "fighter", lengthM: 32, hullShape: "needle", engines: 2, wings: true },
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
    model: { archetype: "frigate", lengthM: 80, hullShape: "wedge", engines: 2 },
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
    model: { archetype: "frigate", lengthM: 140, hullShape: "spindle", engines: 2 },
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
    model: { archetype: "frigate", lengthM: 230, hullShape: "wedge", engines: 3, turrets: 2 },
  },
  {
    id: "cruiser",
    nameKey: "ship.cruiser.name",
    descriptionKey: "ship.cruiser.description",
    role: "combat",
    cost: { metal: 1300, volatiles: 420, crystal: 80, alloys: 150, rare_metals: 40 },
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
    model: { archetype: "capital", lengthM: 480, hullShape: "monolith", engines: 4, turrets: 4 },
  },
  {
    id: "carrier",
    nameKey: "ship.carrier.name",
    descriptionKey: "ship.carrier.description",
    role: "combat",
    cost: { metal: 1500, volatiles: 500, crystal: 100, alloys: 180, rare_metals: 60, exotic: 6 },
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
    model: { archetype: "capital", lengthM: 620, hullShape: "brick", engines: 4, hangar: true, turrets: 2 },
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
    model: { archetype: "transport", lengthM: 160, hullShape: "pod", engines: 2, pods: 4 },
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
    model: { archetype: "transport", lengthM: 400, hullShape: "pod", engines: 3, pods: 10 },
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
    model: { archetype: "transport", lengthM: 210, hullShape: "brick", engines: 2, hangar: true },
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
    model: { archetype: "transport", lengthM: 280, hullShape: "spindle", engines: 3, habitat: true },
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
  /** Segundos que tarda la nave en estirarse y desaparecer en la grieta al saltar (casi a la velocidad de la luz). */
  departSec: 0.5,
  /** Segundos que la grieta de llegada sigue abierta. */
  arriveSec: 2.2,
  /** Llegada: segundos desde que se abre la grieta hasta que sale el rayo de luz, y lo que tarda el rayo en contraerse en la nave. */
  arriveBeamDelaySec: 0.3,
  arriveBeamSec: 0.45,
  /** Segundos desde que se abre la grieta de llegada hasta que el piloto recupera los mandos. */
  arriveShipSec: 1.4,
} as const;

/** Salto junto a un compañero: a cuántos metros de su nave aparece la propia (de lado; la grieta no la toca). */
export const COMPANION_ARRIVAL_OFFSET_M = 3000;

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

/** Táctica de una flota en las batallas por rondas (orden `fleet.tactic`, también a distancia). */
export type FleetTacticId = FleetTactic;

/**
 * Tácticas: multiplican el ataque y el escudo de batalla de las naves de la
 * flota; con `focus`, cada disparo va al enemigo con menos casco (en vez de al
 * azar según su tamaño), para rematar antes. La nave del Emperador combate
 * siempre con la táctica equilibrada.
 */
export const FLEET_TACTICS: Record<FleetTacticId, { attack: number; shield: number; focus: boolean }> = {
  balanced: { attack: 1, shield: 1, focus: false },
  aggressive: { attack: 1.25, shield: 0.7, focus: false },
  defensive: { attack: 0.7, shield: 1.4, focus: false },
  focus: { attack: 0.9, shield: 1, focus: true },
};

export const FLEET_TACTIC_IDS = Object.keys(FLEET_TACTICS) as FleetTacticId[];

/**
 * Sensores para detectar flotas en tránsito (contactos que se pueden
 * interceptar): las flotas paradas usan el escáner de su mejor nave, la nave
 * del Emperador el suyo y cada colonia este alcance.
 */
export const CONTACT_SENSORS = {
  colonyRangeLy: 10,
} as const;

/**
 * Sondas de exploración (orden `probe.launch`): se compran con créditos y
 * salen de la nave del Emperador (esté donde esté, también viajando) o de la
 * colonia propia más cercana al destino; vuelan solas hasta un sistema a
 * menos de `maxRangeLy`, descubren lo que cubre su escáner y se pierden.
 */
export const PROBE = {
  costCredits: 120,
  speedLyPerHour: 600,
  maxRangeLy: 50,
  maxActive: 3,
  scannerRangeLy: 4,
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
 * Asistencia de puntería del combate en tiempo real (petición del usuario,
 * 21-10-2026: «para atacar necesitaremos un aim casi automático»). Los
 * cañones de la insignia van en montajes que giran solos hacia el punto de
 * adelanto del blanco fijado, dentro de un cono alrededor del morro; el
 * servidor rechaza los disparos fuera de ese cono.
 */
export const AIM_ASSIST = {
  /** Ángulo máximo (grados) entre el morro y la dirección de un disparo de cañón. */
  cannonGimbalDeg: 25,
} as const;

/**
 * Choques entre naves en el combate en tiempo real (los resuelve el servidor):
 * si dos naves se tocan (suma de sus radios de impacto) acercándose a más de
 * `minClosingMps`, las dos reciben `damagePerMps` de daño por cada m/s de
 * velocidad de acercamiento (hasta `maxDamage`), como mucho una vez cada
 * `cooldownSec` por pareja. El cliente separa las naves y las hace rebotar.
 */
export const SHIP_COLLISION = {
  minClosingMps: 10,
  damagePerMps: 0.25,
  maxDamage: 60,
  cooldownSec: 1.5,
  /** Parte de la velocidad de acercamiento que se devuelve al rebotar (0: se para, 1: rebote perfecto). */
  restitution: 0.3,
} as const;

/**
 * Choques contra la estrella, planetas, lunas y asteroides (los detecta el
 * servidor con las posiciones del piloto): si la nave llega a la superficie a
 * más de `minImpactMps` respecto al cuerpo, recibe `damagePerMps` por cada m/s
 * por encima de ese umbral, sin tope (estrellarse a toda velocidad destruye la
 * nave), como mucho una vez cada `cooldownSec`. Aterrizar o rozar despacio no hace daño.
 */
export const BODY_COLLISION = {
  minImpactMps: 20,
  damagePerMps: 0.5,
  cooldownSec: 1.5,
  /** Margen (m) sobre la superficie en el que se cuenta el contacto (desfase de reloj entre cliente y servidor). */
  contactSlackM: 80,
} as const;
