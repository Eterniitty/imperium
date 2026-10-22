/**
 * Tablas de la Wiki generadas con los datos del juego (`@imperium/content`,
 * `@imperium/procgen`, `@imperium/sim` y las teclas por defecto). Así, si
 * cambia un número en el código, la Wiki cambia con él. Los artículos las
 * insertan con `{{tabla:<id>}}`.
 */
import { FLIGHT_MODEL, PLANET_BODIES, WORLD_SCALE } from "@imperium/content";
import { rockyBody, starBody } from "@imperium/sim";
/** Radios del generador por tipo (radios terrestres; packages/procgen system.ts). */
const PLANET_RADIUS_RANGE: Record<string, [number, number]> = { gas_giant: [6, 12], ice_giant: [3, 5], lava: [0.2, 1.2], barren: [0.2, 1.2], rocky: [0.4, 1.8], desert: [0.4, 1.8], ocean: [0.4, 1.8], toxic: [0.4, 1.8], ice: [0.4, 1.8] };
import {
  AI_EMPERORS,
  AI_PERSONALITIES,
  type AiPersonality,
  ALIEN_AI,
  ROUTE_RAID,
  SCAVENGER_LAIR,
  MERCENARIES,
  HELP_CALL,
  getAlienShipClass,
  ALIEN_SHIP_CLASSES,
  ALIEN_SIEGE,
  INSTALLATION_DEFENSE,
  SIEGE,
  alienShipsOf,
  battleProfileOf,
  fleetComposition,
  CONTACT_SENSORS,
  CREDITS,
  HUMANITY,
  HUMANITY_PROJECTS,
  MARKET,
  FACTIONS,
  SPECIES,
  ECONOMY,
  EMPEROR_FLAGSHIP,
  AIM_ASSIST,
  SHIP_COLLISION,
  BODY_COLLISION,
  STAR_HEAT,
  FLEET_TACTICS,
  PROBE,
  ESCORT,
  ALIEN_LOCAL,
  CORE_MILITIA,
  INTEREST,
  MOTHERSHIP_WORKSHOP,
  MOTHERSHIP_HANGAR,
  TRAVEL_SPEED_SCALE,
  FLEET_TACTIC_IDS,
  STAR_HEAT_LETHAL_DPS,
  FLEET_BATTLE,
  FLAGSHIP_BATTLE,
  FLAGSHIP_REPAIR,
  FLAGSHIP_SUPPLIES,
  HEIR_DOCTRINES,
  HEIRS,
  LINEAGE,
  HUMANS,
  INSTALLATIONS,
  PIRATE_AI,
  SCAVENGER_DANGER,
  POPULATION,
  SHIP_CLASSES,
  SHIP_HUMAN_CAPACITY,
  SHIP_PASSENGERS,
  STARTING_FLEET,
  STOCK_IDS,
  CARGO_STOCK_IDS,
  ASTEROID_KINDS,
  DEEP_REGIONS,
  DEEP_SPACE,
  FLAGSHIP_HOLD,
  MINING,
  type AsteroidKind,
  contentDictionaries,
  type InstallationId,
  type ShipClassDefinition,
  type StockAmounts,
  type WeaponDefinition,
} from "@imperium/content";
import { DEPOSIT_TABLE, STAR_CLASSES } from "@imperium/procgen";
import { SECTOR_SIZE, translate, type I18nKey, type Locale, type PlanetType, type StarClass } from "@imperium/shared";
import {
  PILOT_BOOST,
  PILOT_SPEED,
  PULSE_MIN_SPEED,
  PULSE_MAX_SPEED,
  colonyEnergy,
  colonyFlows,
  minColonists,
  netRates,
  populationCap,
  type InstallationCounts,
  gestationMinutes,
} from "@imperium/sim";
import { ACTIONS, DEFAULT_BINDINGS, keyLabel, type ActionContext } from "../state/settings";

export interface GenTable {
  head: string[];
  rows: string[][];
  /** Columnas numéricas (alineadas a la derecha). */
  numeric?: number[];
}

type T = (key: I18nKey, params?: Record<string, string | number>) => string;

function num(locale: Locale, n: number, digits = 2): string {
  return n.toLocaleString(locale === "es" ? "es-ES" : "en-GB", { maximumFractionDigits: digits });
}

const shipName = (locale: Locale, id: string) => contentDictionaries[locale][`ship.${id}.name`] ?? id;

/** «150 metal · 20 volátiles» (sin los recursos a cero). */
function cost(t: T, locale: Locale, c: Partial<StockAmounts>): string {
  const parts = STOCK_IDS.filter((r) => (c[r] ?? 0) > 0).map((r) => `${num(locale, c[r]!)} ${t(`resource.${r}`).toLowerCase()}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Tabla de dos columnas «concepto · valor». */
function kv(t: T, rows: Array<[I18nKey, string]>): GenTable {
  return { head: [t("wiki.col.concept"), t("wiki.col.value")], rows: rows.map(([k, v]) => [t(k), v]) };
}

const INSTALLATION_EFFECT: Record<InstallationId, I18nKey> = {
  mine: "wiki.effect.mine",
  refinery: "wiki.effect.refinery",
  power_plant: "wiki.effect.power_plant",
  shipyard: "wiki.effect.shipyard",
  drydock: "wiki.effect.drydock",
  defense_platform: "wiki.effect.defense_platform",
  lineage_cradle: "wiki.effect.lineage_cradle",
};

/** «Astillero, refinería» (las instalaciones que pide una nave). */
function requiresText(t: T, locale: Locale, req: Partial<Record<InstallationId, number>>): string {
  return Object.entries(req)
    .map(([id, n]) => (n! > 1 ? `${t(`installation.${id}` as I18nKey)} ×${num(locale, n!)}` : t(`installation.${id}` as I18nKey)))
    .join(", ");
}

const SCAVENGER_SHIPS = () => ALIEN_SHIP_CLASSES.filter((s) => s.speciesId === "scavengers");

function weaponName(t: T, w: WeaponDefinition): string {
  return t(w.kind === "cannon" ? "combat.cannon" : "wiki.weapon.missile");
}

function keysTable(t: T, locale: Locale, ctx: ActionContext): GenTable {
  return {
    head: [t("wiki.col.action"), t("wiki.col.keys")],
    rows: ACTIONS[ctx].map((a) => [t(`action.${a}`), DEFAULT_BINDINGS[a].map((c) => keyLabel(c, locale)).join(" / ") || t("wiki.v.buttonOnly")]),
  };
}

const PLANET_TYPES: PlanetType[] = ["lava", "barren", "rocky", "desert", "ocean", "toxic", "ice", "gas_giant", "ice_giant"];
const STAR_ORDER: StarClass[] = ["O", "B", "A", "F", "G", "K", "M", "RG", "WD", "NS", "BH"];

const range = (locale: Locale, [a, b]: readonly [number, number]) => (a === b ? num(locale, a) : `${num(locale, a)}–${num(locale, b)}`);

function shipHumans(s: ShipClassDefinition): number {
  return SHIP_HUMAN_CAPACITY[s.id] ?? 0;
}

/** Distancia mínima al centro del Núcleo Humano de un anillo de sectores (a.l.). */
function ringDistance(ring: number): number {
  return Math.max(0, ring * SECTOR_SIZE - SECTOR_SIZE / 2);
}

/** Instalaciones de la colonia del ejemplo de economía. */
export const EXAMPLE_INSTALLATIONS: InstallationCounts = { mine: 2, refinery: 1, power_plant: 1 };

type Builder = (t: T, locale: Locale) => GenTable;

export const GEN_TABLES: Record<string, Builder> = {
  recursos: (t, locale) => ({
    head: [t("wiki.col.resource"), t("wiki.col.storage"), t("wiki.col.founding"), t("wiki.col.transport")],
    rows: [
      ...STOCK_IDS.map((r) => [t(`resource.${r}`), num(locale, ECONOMY.storage[r]), num(locale, ECONOMY.foundingStock[r]), t((CARGO_STOCK_IDS as readonly string[]).includes(r) ? "wiki.yes" : "wiki.minedOnly")]),
      [t("resource.energy"), "—", "—", t("wiki.no")],
    ],
    numeric: [1, 2],
  }),

  instalaciones: (t, locale) => ({
    head: [t("wiki.col.installation"), t("wiki.col.cost"), t("wiki.col.time"), t("wiki.col.energy"), t("wiki.col.upkeep"), t("wiki.col.max"), t("wiki.col.effect")],
    rows: INSTALLATIONS.map((i) => [
      t(`installation.${i.id}`),
      cost(t, locale, i.cost),
      t("colony.costHours", { h: num(locale, i.buildTimeHours) }),
      num(locale, i.energyUse),
      t("colony.upkeepValue", { n: num(locale, i.upkeepVolatilesPerHour) }),
      num(locale, i.maxPerColony),
      t(INSTALLATION_EFFECT[i.id], {
        mine: num(locale, ECONOMY.mineExtractionPerRichness),
        metal: num(locale, ECONOMY.refinery.metal),
        volatiles: num(locale, ECONOMY.refinery.volatiles),
        alloys: num(locale, ECONOMY.refinery.alloys),
        energy: num(locale, ECONOMY.powerPlantEnergyPerStarEnergy),
        defense: num(locale, INSTALLATION_DEFENSE[i.id]?.defense ?? 0),
        attack: num(locale, INSTALLATION_DEFENSE[i.id]?.attackPerHour ?? 0),
        garrison: num(locale, INSTALLATION_DEFENSE[i.id]?.garrison ?? 0),
      }),
    ]),
    numeric: [3, 5],
  }),

  produccion: (t, locale) =>
    kv(t, [
      ["wiki.k.baseExtraction", num(locale, ECONOMY.baseExtractionPerRichness)],
      ["wiki.k.mineExtraction", num(locale, ECONOMY.mineExtractionPerRichness)],
      ["wiki.k.crystalFactor", `× ${num(locale, ECONOMY.crystalFactor)}`],
      ["wiki.k.moonFactor", `× ${num(locale, ECONOMY.moonFactor)}`],
      ["wiki.k.laborFull", num(locale, ECONOMY.laborFullPopulation)],
      ["wiki.k.laborMin", `${num(locale, ECONOMY.laborMin * 100)} %`],
      ["wiki.k.baseEnergy", num(locale, ECONOMY.baseEnergyPerStarEnergy)],
      ["wiki.k.plantEnergy", num(locale, ECONOMY.powerPlantEnergyPerStarEnergy)],
      ["wiki.k.refinery", t("wiki.v.refinery", { metal: num(locale, ECONOMY.refinery.metal), volatiles: num(locale, ECONOMY.refinery.volatiles), alloys: num(locale, ECONOMY.refinery.alloys) })],
      ["wiki.k.maxQueue", num(locale, ECONOMY.maxQueue)],
      ["wiki.k.cancelRefund", `${num(locale, ECONOMY.cancelRefundStarted * 100)} %`],
    ]),

  minas: (t, locale) => {
    const mine = INSTALLATIONS.find((i) => i.id === "mine")!;
    const rows: string[][] = [];
    for (let m = 0; m <= mine.maxPerColony; m++) {
      const perPoint = ECONOMY.baseExtractionPerRichness + ECONOMY.mineExtractionPerRichness * m;
      rows.push([num(locale, m), num(locale, perPoint), num(locale, perPoint * 3), num(locale, perPoint * ECONOMY.crystalFactor), num(locale, mine.energyUse * m)]);
    }
    return { head: [t("wiki.col.mines"), t("wiki.col.perPoint"), t("wiki.col.richness3"), t("wiki.col.crystalPerPoint"), t("wiki.col.minesEnergy")], rows, numeric: [0, 1, 2, 3, 4] };
  },

  /** Ejemplo resuelto con las reglas reales (`@imperium/sim`). */
  ejemplo: (t, locale) => {
    const planet = { habitability: 0.6, deposits: { metal: 2, volatiles: 1, crystal: 1 } as const, moons: [{ deposits: { metal: 1, volatiles: 2, crystal: 0 } as const }] };
    const installations: InstallationCounts = EXAMPLE_INSTALLATIONS;
    const starEnergy = 3;
    const population = 500;
    const flows = colonyFlows(planet, starEnergy, installations, population);
    const energy = colonyEnergy(starEnergy, installations);
    const half = { metal: ECONOMY.storage.metal / 2, volatiles: ECONOMY.storage.volatiles / 2, crystal: ECONOMY.storage.crystal / 2, alloys: ECONOMY.storage.alloys / 2, rare_metals: 0, exotic: 0 };
    const net = netRates(half, flows);
    const h = (n: number) => t("colony.perHour", { n: num(locale, n, 1) });
    return kv(t, [
      ["wiki.ex.energy", t("colony.energyValue", { produced: num(locale, energy.produced), consumed: num(locale, energy.consumed) }) + ` (${num(locale, energy.efficiency * 100, 0)} %)`],
      ["wiki.ex.metal", h(flows.extraction.metal)],
      ["wiki.ex.volatiles", h(flows.extraction.volatiles)],
      ["wiki.ex.crystal", h(flows.extraction.crystal)],
      ["wiki.ex.refinery", t("wiki.v.refinery", { metal: num(locale, flows.refinery.metal, 1), volatiles: num(locale, flows.refinery.volatiles, 1), alloys: num(locale, flows.refinery.alloys, 1) })],
      ["colony.upkeep", t("colony.upkeepValue", { n: num(locale, flows.upkeep, 1) })],
      ["wiki.ex.net", STOCK_IDS.map((r) => `${t(`resource.${r}`)} ${net[r] >= 0 ? "+" : ""}${num(locale, net[r], 1)}`).join(" · ")],
    ]);
  },

  humanos: (t, locale) =>
    kv(t, [
      ["wiki.k.flagshipCapacity", num(locale, HUMANS.flagshipCapacity)],
      ["wiki.k.flagshipStart", num(locale, HUMANS.flagshipStart)],
      ["wiki.k.flagshipPerHour", num(locale, HUMANS.flagshipPerHour)],
      ["wiki.k.minColonists", t("wiki.v.minColonists", { base: num(locale, HUMANS.minColonistsBase), hostile: num(locale, HUMANS.minColonistsHostile) })],
      ["wiki.k.colonyKeep", num(locale, HUMANS.colonyKeep)],
      ["wiki.k.popCap", t("wiki.v.popCap", { min: num(locale, POPULATION.capMin), per: num(locale, POPULATION.capPerHabitability) })],
      ["wiki.k.growth", `${num(locale, POPULATION.growthPerHour * 100)} %`],
      ...SHIP_CLASSES.filter((s) => shipHumans(s) > 0).map((s): [I18nKey, string] => ["wiki.k.colonizerHumans", `${shipName(locale, s.id)}: ${num(locale, shipHumans(s))}`]),
      ...Object.entries(SHIP_PASSENGERS).map(([id, n]): [I18nKey, string] => ["wiki.k.passengers", `${shipName(locale, id)}: ${num(locale, n!)}`]),
    ]),

  colonos: (t, locale) => ({
    head: [t("system.habitability"), t("wiki.col.minColonists"), t("wiki.col.popCap")],
    rows: [0, 0.1, 0.25, 0.5, 0.75, 1].map((h) => [`${num(locale, h * 100)} %`, num(locale, minColonists(h)), num(locale, populationCap(h))]),
    numeric: [0, 1, 2],
  }),

  naves: (t, locale) => ({
    head: [t("wiki.col.ship"), t("wiki.col.role"), t("wiki.col.cost"), t("wiki.col.requires"), t("wiki.col.time"), t("wiki.col.speed"), t("wiki.col.cargo"), t("wiki.col.humans"), t("wiki.col.scanner"), t("wiki.col.upkeep")],
    rows: SHIP_CLASSES.map((s) => [
      shipName(locale, s.id) + (s.consumedOnUse ? " *" : ""),
      t(`wiki.role.${s.role}`),
      cost(t, locale, s.cost),
      requiresText(t, locale, s.requires),
      t("colony.costHours", { h: num(locale, s.buildTimeHours) }),
      t("wiki.v.lyh", { n: num(locale, s.speedLyPerHour * TRAVEL_SPEED_SCALE) }),
      num(locale, s.cargo),
      num(locale, shipHumans(s) || (SHIP_PASSENGERS[s.id] ?? 0)),
      t("wiki.v.ly", { n: num(locale, s.scannerRangeLy) }),
      t("colony.upkeepValue", { n: num(locale, s.upkeepVolatilesPerHour) }),
    ]),
    numeric: [6, 7],
  }),

  "naves-combate": (t, locale) => ({
    head: [
      t("wiki.col.ship"),
      t("combat.hull"),
      t("wiki.col.attack"),
      t("wiki.col.shots"),
      t("wiki.col.battleShield"),
      t("wiki.col.profile"),
      t("wiki.col.rtShield"),
      t("wiki.col.weapons"),
    ],
    rows: [
      ...SHIP_CLASSES.map((s) => [
        shipName(locale, s.id),
        num(locale, s.hull),
        num(locale, s.attack),
        num(locale, s.battleShots ?? 1),
        num(locale, s.battleShield),
        num(locale, battleProfileOf(s)),
        t("wiki.v.shield", { n: num(locale, s.combat.shield), regen: num(locale, s.combat.shieldRegenPerSec), delay: num(locale, s.combat.shieldDelaySec) }),
        s.combat.weapons.map((w) => weaponName(t, w)).join(", ") || "—",
      ]),
    ],
    numeric: [1, 2, 3, 4, 5],
  }),

  "naves-modelos": (t, locale) => ({
    head: [t("wiki.col.ship"), t("wiki.col.length"), t("wiki.col.shape"), t("wiki.col.engines"), t("wiki.col.weapons")],
    rows: SHIP_CLASSES.map((s) => [
      shipName(locale, s.id),
      `${num(locale, s.model.lengthM)} m`,
      t(`wiki.shape.${s.model.hullShape}`),
      num(locale, s.model.engines),
      `${num(locale, s.combat.hardpoints?.cannon.length ?? 0)} + ${num(locale, s.combat.hardpoints?.missile.length ?? 0)}`,
    ]),
    numeric: [1, 3],
  }),

  escaneres: (t, locale) => ({
    head: [t("wiki.col.ship"), t("wiki.col.scanner")],
    rows: [
      { name: t("wiki.emperorShip"), range: EMPEROR_FLAGSHIP.scannerRangeLy },
      ...SHIP_CLASSES.map((s) => ({ name: shipName(locale, s.id), range: s.scannerRangeLy })),
    ]
      .sort((a, b) => b.range - a.range)
      .map((r) => [r.name, t("wiki.v.ly", { n: num(locale, r.range) })]),
    numeric: [1],
  }),

  "nave-emperador": (t, locale) =>
    kv(t, [
      ["wiki.k.speed", t("wiki.v.lyh", { n: num(locale, EMPEROR_FLAGSHIP.speedLyPerHour) })],
      ["wiki.k.scanner", t("wiki.v.ly", { n: num(locale, EMPEROR_FLAGSHIP.scannerRangeLy) })],
      ["combat.hull", num(locale, EMPEROR_FLAGSHIP.hull)],
      ["combat.shield", t("wiki.v.shield", { n: num(locale, EMPEROR_FLAGSHIP.combat.shield), regen: num(locale, EMPEROR_FLAGSHIP.combat.shieldRegenPerSec), delay: num(locale, EMPEROR_FLAGSHIP.combat.shieldDelaySec) })],
      ["wiki.col.weapons", EMPEROR_FLAGSHIP.combat.weapons.map((w) => weaponName(t, w)).join(", ")],
      ["wiki.k.flagshipCapacity", num(locale, HUMANS.flagshipCapacity)],
      ["wiki.k.startingFleet", STARTING_FLEET.map((id) => shipName(locale, id)).join(", ")],
    ]),

  armas: (t, locale) => {
    const seen = new Map<string, { w: WeaponDefinition; on: string[] }>();
    const add = (w: WeaponDefinition, who: string) => {
      const key = JSON.stringify(w);
      const e = seen.get(key) ?? { w, on: [] };
      if (!e.on.includes(who)) e.on.push(who);
      seen.set(key, e);
    };
    for (const w of EMPEROR_FLAGSHIP.combat.weapons) add(w, t("wiki.emperorShip"));
    for (const s of SHIP_CLASSES) for (const w of s.combat.weapons) add(w, shipName(locale, s.id));
    for (const s of SCAVENGER_SHIPS()) for (const w of s.combat.weapons) add(w, `${t("npc.pirate")} (${shipName(locale, s.id)})`);
    return {
      head: [t("wiki.col.weapon"), t("wiki.col.carriedBy"), t("wiki.col.damage"), t("wiki.col.cooldown"), t("wiki.col.range"), t("wiki.col.projectile"), t("wiki.col.ammo")],
      rows: [...seen.values()].map(({ w, on }) => [
        weaponName(t, w),
        on.join(", "),
        num(locale, w.damage),
        `${num(locale, w.cooldownSec)} s`,
        `${num(locale, w.rangeU)} m`,
        `${num(locale, w.speedU)} m/s`,
        w.ammo === null ? t("wiki.unlimited") : t("wiki.v.ammo", { n: num(locale, w.ammo), s: num(locale, w.ammoRegenSec ?? 0) }),
      ]),
      numeric: [2],
    };
  },

  punteria: (t, locale) =>
    kv(t, [
      ["wiki.k.gimbal", `${num(locale, AIM_ASSIST.cannonGimbalDeg)}°`],
      ["wiki.k.collisionMin", `${num(locale, SHIP_COLLISION.minClosingMps)} m/s`],
      ["wiki.k.collisionDamage", num(locale, SHIP_COLLISION.damagePerMps)],
      ["wiki.k.collisionMax", num(locale, SHIP_COLLISION.maxDamage)],
      ["wiki.k.collisionCooldown", `${num(locale, SHIP_COLLISION.cooldownSec)} s`],
    ]),

  choques: (t, locale) =>
    kv(t, [
      ["wiki.k.collisionMin", `${num(locale, SHIP_COLLISION.minClosingMps)} m/s`],
      ["wiki.k.collisionDamage", num(locale, SHIP_COLLISION.damagePerMps)],
      ["wiki.k.collisionMax", num(locale, SHIP_COLLISION.maxDamage)],
      ["wiki.k.collisionCooldown", `${num(locale, SHIP_COLLISION.cooldownSec)} s`],
      ["wiki.k.bodyImpactMin", `${num(locale, BODY_COLLISION.minImpactMps)} m/s`],
      ["wiki.k.bodyImpactDamage", num(locale, BODY_COLLISION.damagePerMps)],
      ["wiki.k.bodyImpactCooldown", `${num(locale, BODY_COLLISION.cooldownSec)} s`],
    ]),

  carroneros: (t, locale) =>
    kv(t, [
      ["wiki.k.aggro", `${num(locale, PIRATE_AI.aggroRangeU)} m`],
      ["wiki.k.packRadius", `${num(locale, PIRATE_AI.packRadiusU)} m`],
      ["wiki.k.fleeHull", `${num(locale, PIRATE_AI.fleeHullPct * 100)} %`],
      ["wiki.k.regroupShield", `${num(locale, PIRATE_AI.regroupShieldPct * 100)} %`],
      ["wiki.k.respawn", `${num(locale, PIRATE_AI.respawnSec / 60)} min`],
    ]),

  "carroneros-naves": (t, locale) => ({
    head: [t("wiki.col.ship"), t("wiki.col.role"), t("combat.hull"), t("wiki.col.rtShield"), t("wiki.col.weapons"), t("wiki.col.flight"), t("wiki.col.attack"), t("wiki.col.length")],
    rows: SCAVENGER_SHIPS().map((s) => [
      shipName(locale, s.id),
      t(`wiki.role.${s.role}`),
      num(locale, s.hull),
      t("wiki.v.shield", { n: num(locale, s.combat.shield), regen: num(locale, s.combat.shieldRegenPerSec), delay: num(locale, s.combat.shieldDelaySec) }),
      s.combat.weapons.map((w) => `${weaponName(t, w)} (${num(locale, w.damage)})`).join(", "),
      s.flight ? t("wiki.v.flight", { speed: num(locale, s.flight.speedU), range: num(locale, s.flight.preferredRangeU) }) : "—",
      num(locale, s.attack),
      `${num(locale, s.model.lengthM)} m`,
    ]),
    numeric: [2, 6],
  }),

  "carroneros-peligro": (t, locale) => ({
    head: [t("wiki.col.ring"), t("wiki.col.chance"), t("wiki.col.count"), t("wiki.col.ships"), t("wiki.col.leader"), t("wiki.col.aim")],
    rows: SCAVENGER_DANGER.map((l, i) => {
      const next = SCAVENGER_DANGER[i + 1];
      const total = l.ships.reduce((a, [, w]) => a + w, 0);
      return [
        next ? `${num(locale, l.minRing)}–${num(locale, next.minRing - 1)}` : `${num(locale, l.minRing)}+`,
        `${num(locale, l.chancePct)} %`,
        range(locale, l.count),
        l.ships.map(([id, w]) => `${shipName(locale, id)} ${num(locale, (w / total) * 100, 0)} %`).join(", "),
        l.leader ? t("wiki.v.chanceLeader", { ship: shipName(locale, l.leader[0]), pct: num(locale, l.leader[1]) }) : "—",
        `± ${num(locale, (l.aimJitter / 2) * (180 / Math.PI), 1)}°`,
      ];
    }),
  }),

  "carroneros-flotas": (t, locale) => {
    const sp = SPECIES.find((s) => s.id === "scavengers")!;
    const near = fleetComposition(sp.fleet, 0);
    const deep = fleetComposition(sp.fleet, 1);
    const pct = (list: Array<[string, number]>) => {
      const total = list.reduce((a, [, w]) => a + w, 0);
      return list.map(([id, w]) => `${shipName(locale, id)} ${num(locale, (w / total) * 100, 0)} %`).join(", ");
    };
    return kv(t, [
      ["wiki.k.fleetNear", `${pct(near)} · ${t("wiki.col.ships").toLowerCase()}: ${num(locale, sp.fleet.shipsPerFleet[0])}`],
      ["wiki.k.fleetDeep", `${pct(deep)} · ${t("wiki.col.ships").toLowerCase()}: ${num(locale, sp.fleet.shipsPerFleet[1])}`],
    ]);
  },

  vuelo: (t, locale) =>
    kv(t, [
      ["wiki.k.pilotSpeed", `${num(locale, PILOT_SPEED)} m/s`],
      ["wiki.k.boost", `× ${num(locale, PILOT_BOOST)} (${num(locale, PILOT_SPEED * PILOT_BOOST)} m/s)`],
      ["wiki.k.pulse", `${num(locale, PULSE_MAX_SPEED / 1000)} km/s`],
      ["wiki.k.pulseSafe", `${num(locale, PULSE_MIN_SPEED)} m/s`],
      ["wiki.k.jumpSpeed", t("wiki.v.lyh", { n: num(locale, EMPEROR_FLAGSHIP.speedLyPerHour) })],
    ]),

  batallas: (t, locale) =>
    kv(t, [
      ["wiki.k.round", `${num(locale, FLEET_BATTLE.roundGameSeconds)} s`],
      ["wiki.k.maxRounds", num(locale, FLEET_BATTLE.maxRounds)],
      ["wiki.k.spread", `± ${num(locale, FLEET_BATTLE.damageSpreadPct)} %`],
      ["wiki.k.colonySensor", t("wiki.v.ly", { n: num(locale, CONTACT_SENSORS.colonyRangeLy) })],
      ["wiki.k.flagshipSensor", t("wiki.v.ly", { n: num(locale, EMPEROR_FLAGSHIP.scannerRangeLy) })],
    ]),

  // --- Fase 9b: conquista ---

  asedio: (t, locale) =>
    kv(t, [
      ["wiki.k.siegeBase", t("wiki.v.hours", { n: num(locale, SIEGE.baseHours) })],
      ["wiki.k.siegeTick", `${num(locale, SIEGE.tickGameMinutes)} min`],
      ["wiki.k.defenseBase", num(locale, SIEGE.defenseBase)],
      ["wiki.k.defensePerPop", num(locale, SIEGE.defensePerPopulation)],
      ["wiki.k.militia", `${num(locale, SIEGE.militiaShare * 100)} %`],
      ["wiki.k.attackerLoss", num(locale, SIEGE.attackerLossPerDefender)],
      ["wiki.k.defenderLoss", num(locale, SIEGE.defenderLossPerAttacker)],
      ["wiki.k.capturePop", `${num(locale, SIEGE.capture.populationLoss * 100)} %`],
      ["wiki.k.captureStock", `${num(locale, SIEGE.capture.stockLoss * 100)} %`],
      ["wiki.k.captureInst", `${num(locale, SIEGE.capture.installationLoss * 100)} %`],
      ["wiki.k.siegeGrace", t("wiki.v.hours", { n: num(locale, SIEGE.noviceGraceHours) })],
    ]),

  defensas: (t, locale) => ({
    head: [t("wiki.col.installation"), t("wiki.col.defense"), t("wiki.col.fire"), t("wiki.col.garrison")],
    rows: (Object.keys(INSTALLATION_DEFENSE) as InstallationId[]).map((id) => {
      const d = INSTALLATION_DEFENSE[id]!;
      return [t(`installation.${id}`), num(locale, d.defense), num(locale, d.attackPerHour), num(locale, d.garrison)];
    }),
    numeric: [1, 2, 3],
  }),

  "asedio-alien": (t, locale) =>
    kv(t, [
      ["wiki.k.alienSiegeChance", `${num(locale, ALIEN_SIEGE.chancePerTick * 100)} %`],
      ["wiki.k.alienSiegeMax", num(locale, ALIEN_SIEGE.maxPerRegion)],
      ["wiki.k.alienOccupation", `${num(locale, ALIEN_SIEGE.occupationPopulationLoss * 100)} %`],
      ["wiki.k.siegeGrudge", num(locale, ALIEN_SIEGE.grudge)],
    ]),

  estrellas: (t, locale) => {
    const total = STAR_ORDER.reduce((a, c) => a + STAR_CLASSES[c].weight, 0);
    return {
      head: [t("system.class"), t("wiki.col.frequency"), t("system.energy"), t("system.planets"), t("wiki.col.crystalChance")],
      rows: STAR_ORDER.map((c) => {
        const s = STAR_CLASSES[c];
        return [t(`star.${c}`), `${num(locale, (s.weight / total) * 100, 1)} %`, range(locale, [Math.max(0, s.energy - 0.5), Math.min(5, s.energy + 0.5)]), range(locale, s.planets), `${num(locale, (0.03 + s.crystalBonus) * 100)} %`];
      }),
      numeric: [1, 4],
    };
  },

  // --- Escala astronómica, cuerpos y gravedad (packages/content bodies.ts) ---

  "escala-estrellas": (t, locale) => ({
    head: [t("system.class"), t("wiki.col.radius"), t("wiki.col.gravity")],
    rows: STAR_ORDER.map((c) => {
      const b = starBody(c);
      return [t(`star.${c}`), `${num(locale, b.radius / 1000)} km`, `${num(locale, b.surfaceGravityG, 1)} g (${num(locale, b.surfaceGravity, 1)} m/s²)`];
    }),
    numeric: [1, 2],
  }),

  taller: (t, locale) =>
    kv(t, [
      ["wiki.k.workshopHull", `${num(locale, MOTHERSHIP_WORKSHOP.hullPerMinute)}/min`],
      ["wiki.k.workshopAlloys", num(locale, MOTHERSHIP_WORKSHOP.alloysPerHull)],
      ["wiki.k.hangarFighters", `${num(locale, MOTHERSHIP_HANGAR.fighters)} × ${shipName(locale, MOTHERSHIP_HANGAR.classId)}`],
      ["wiki.k.hangarRebuild", `${num(locale, MOTHERSHIP_HANGAR.rebuildSec / 60)} min`],
    ]),

  interes: (t, locale) => kv(t, [["wiki.k.interestRange", `${num(locale, INTEREST.rangeLy)} a.l.`]]),

  bombardeo: (t, locale) => kv(t, [["wiki.k.razeProgress", `${num(locale, SIEGE.razeProgressAfter * 100)} %`]]),

  suministro: (t, locale) =>
    kv(t, [
      ["wiki.k.supplyRange", `${num(locale, ECONOMY.supplyRangeLy)} a.l.`],
      ["wiki.k.isolatedExtraction", `${num(locale, ECONOMY.isolatedExtraction * 100)} %`],
    ]),

  milicia: (t, locale) =>
    kv(t, [
      ["wiki.k.militiaShips", CORE_MILITIA.ships.map((id) => shipName(locale, id)).join(", ")],
      ["wiki.k.militiaAggressor", `${num(locale, CORE_MILITIA.aggressorSec)} s`],
      ["wiki.k.militiaRespawn", `${num(locale, CORE_MILITIA.respawnSec / 60)} min`],
    ]),

  "alienigenas-local": (t, locale) =>
    kv(t, [
      ["wiki.k.alienLocalMax", num(locale, ALIEN_LOCAL.maxShips)],
      ["wiki.k.alienGrudgeAttack", num(locale, ALIEN_AI.grudge.attack)],
    ]),

  escoltas: (t, locale) =>
    kv(t, [
      ["wiki.k.escortMax", num(locale, ESCORT.maxShips)],
      ["wiki.k.escortEngage", `${num(locale, ESCORT.engageRangeU)} m`],
      ["wiki.k.escortSpeed", `${num(locale, ESCORT.speedU)} m/s`],
      ["wiki.k.escortCatchUp", `${num(locale, ESCORT.catchUpM / 1000)} km`],
    ]),

  sondas: (t, locale) =>
    kv(t, [
      ["wiki.k.probeCost", `₢${num(locale, PROBE.costCredits)}`],
      ["wiki.k.probeSpeed", `${num(locale, PROBE.speedLyPerHour)} a.l./h`],
      ["wiki.k.probeRange", `${num(locale, PROBE.maxRangeLy)} a.l.`],
      ["wiki.k.probeScanner", `${num(locale, PROBE.scannerRangeLy)} a.l.`],
      ["wiki.k.probeMax", num(locale, PROBE.maxActive)],
    ]),

  tacticas: (t, locale) => ({
    head: [t("tactic.label"), t("wiki.col.attack"), t("wiki.col.battleShield"), t("wiki.col.targeting")],
    rows: FLEET_TACTIC_IDS.map((id) => {
      const x = FLEET_TACTICS[id];
      return [t(`tactic.${id}`), `× ${num(locale, x.attack)}`, `× ${num(locale, x.shield)}`, t(x.focus ? "wiki.v.focusTarget" : "wiki.v.randomTarget")];
    }),
    numeric: [1, 2],
  }),

  calor: (t, locale) => ({
    head: [t("system.class"), t("wiki.col.heatZone"), t("wiki.col.heatSurface")],
    rows: STAR_ORDER.map((c) => {
      const h = STAR_HEAT[c];
      const r = starBody(c).radius;
      return [t(`star.${c}`), `${num(locale, h.zoneRadii)} × (${num(locale, (r * h.zoneRadii) / 1000)} km)`, `${num(locale, h.surfaceDps)}/s`];
    }).concat([[t("wiki.k.heatLethal"), "—", `${num(locale, STAR_HEAT_LETHAL_DPS)}/s`]]),
    numeric: [1, 2],
  }),

  cuerpos: (t, locale) => ({
    head: [t("wiki.col.planetType"), t("wiki.col.radius"), t("wiki.col.gravity"), t("wiki.col.atmosphere"), t("wiki.col.landable")],
    rows: PLANET_TYPES.map((p) => {
      const [lo, hi] = PLANET_RADIUS_RANGE[p]!;
      const a = rockyBody("a", "planet", "star", p, lo);
      const b = rockyBody("b", "planet", "star", p, hi);
      const info = PLANET_BODIES[p];
      return [
        t(`planet.${p}`),
        `${num(locale, a.radius / 1000)}–${num(locale, b.radius / 1000)} km`,
        `${num(locale, a.surfaceGravityG, 2)}–${num(locale, b.surfaceGravityG, 2)} g`,
        info.atmosphere ? `${num(locale, info.atmosphere.heightFraction * 100, 1)} % R` : "—",
        t(info.landable ? "wiki.v.yes" : "wiki.v.no"),
      ];
    }),
    numeric: [1, 2],
  }),

  "modelo-vuelo": (t, locale) =>
    kv(t, [
      ["wiki.k.mainAccel", `${num(locale, FLIGHT_MODEL.mainAccel)} m/s²`],
      ["wiki.k.lateralAccel", `${num(locale, FLIGHT_MODEL.lateralAccel)} m/s²`],
      ["wiki.k.turnRates", `${num(locale, (FLIGHT_MODEL.pitchRate * 180) / Math.PI, 0)}° / ${num(locale, (FLIGHT_MODEL.yawRate * 180) / Math.PI, 0)}° / ${num(locale, (FLIGHT_MODEL.rollRate * 180) / Math.PI, 0)}° /s`],
      ["wiki.k.earthRadius", `${num(locale, WORLD_SCALE.earthRadiusM / 1000)} km`],
      ["wiki.k.maxSimGravity", `${num(locale, WORLD_SCALE.maxSimGravity)} m/s²`],
    ]),

  depositos: (t, locale) => ({
    head: [t("wiki.col.planetType"), t("resource.metal"), t("resource.volatiles")],
    rows: PLANET_TYPES.map((p) => [t(`planet.${p}`), range(locale, DEPOSIT_TABLE[p].metal), range(locale, DEPOSIT_TABLE[p].volatiles)]),
    numeric: [1, 2],
  }),

  // Economía de la humanidad y mercado global.
  humanidad: (t, locale) =>
    kv(t, [
      ["wiki.k.creditsPerPop", t("wiki.v.creditsPerPop", { n: num(locale, CREDITS.perPopulationPerHour, 3), k: num(locale, CREDITS.perPopulationPerHour * 1000) })],
      ["wiki.k.startingCredits", `₢ ${num(locale, CREDITS.starting)}`],
      ["wiki.k.taxRate", `${num(locale, HUMANITY.taxRate * 100)} %`],
      ["wiki.k.settleEvery", t("colony.costHours", { h: num(locale, HUMANITY.settleEveryHours) })],
      ["wiki.k.shipmentSpeed", `${num(locale, HUMANITY.shipmentSpeedLyPerHour)} ${t("unit.ly")}/h`],
      ["wiki.k.minShipment", t("colony.costHours", { h: num(locale, HUMANITY.minShipmentHours) })],
      ["wiki.k.minContribution", num(locale, HUMANITY.minContribution)],
    ]),

  proyectos: (t, locale) => ({
    head: [t("wiki.col.project"), t("wiki.col.maxLevel"), t("wiki.col.effect"), t("wiki.col.costL1"), t("wiki.col.growth")],
    rows: HUMANITY_PROJECTS.map((p) => [
      t(`project.${p.id}.name`),
      num(locale, p.maxLevel),
      t(`wiki.effect.${p.id}`, { per: `${num(locale, p.effectPerLevel * 100)} %` }),
      `₢ ${num(locale, p.baseCost.credits)} · ${cost(t, locale, p.baseCost)}`,
      `× ${num(locale, p.costGrowth)}`,
    ]),
    numeric: [1],
  }),

  mercado: (t, locale) =>
    kv(t, [
      ["wiki.k.marketFee", `${num(locale, MARKET.feeRate * 100)} %`],
      ["wiki.k.maxOrders", num(locale, MARKET.maxOpenOrders)],
      ["wiki.k.maxQuantity", num(locale, MARKET.maxQuantity)],
      ["wiki.k.priceRange", `₢ ${num(locale, MARKET.minPrice)} – ₢ ${num(locale, MARKET.maxPrice)}`],
      ["wiki.k.history", t("colony.costHours", { h: num(locale, MARKET.historyHours) })],
    ]),

  // Fase 11: especies alienígenas, territorios e IA.
  "especies-resumen": (t, locale) => {
    const d = contentDictionaries[locale];
    return {
      head: [t("wiki.col.species"), t("wiki.col.stance"), t("wiki.col.ring"), t("wiki.col.response"), t("wiki.col.expansion"), t("wiki.k.fleetStyle")],
      rows: SPECIES.map((s) => [
        d[s.nameKey] ?? s.id,
        t(`wiki.stance.${s.stance}`),
        `${num(locale, s.territory.minCoreRing)} (${t("wiki.v.ringDistance", { ly: num(locale, ringDistance(s.territory.minCoreRing)) })})`,
        t(`wiki.response.${s.ai.intruders}`),
        t("wiki.v.perDay", { n: num(locale, s.ai.expansionPerDay) }),
        t(`wiki.fleetStyle.${s.fleet.style}`),
      ]),
    };
  },

  "naves-alienigenas": (t, locale) => {
    const d = contentDictionaries[locale];
    return {
      head: [
        t("wiki.col.ship"),
        t("wiki.col.species"),
        t("wiki.col.role"),
        t("combat.hull"),
        t("wiki.col.attack"),
        t("wiki.col.battleShield"),
        t("wiki.col.speed"),
        t("wiki.col.scanner"),
        t("wiki.col.length"),
        t("wiki.col.shape"),
      ],
      rows: ALIEN_SHIP_CLASSES.map((s) => [
        shipName(locale, s.id),
        d[`species.${s.speciesId}.name`] ?? s.speciesId,
        t(`wiki.role.${s.role}`),
        num(locale, s.hull),
        num(locale, s.attack),
        num(locale, s.battleShield),
        t("wiki.v.lyh", { n: num(locale, s.speedLyPerHour * TRAVEL_SPEED_SCALE) }),
        t("wiki.v.ly", { n: num(locale, s.scannerRangeLy) }),
        `${num(locale, s.model.lengthM)} m`,
        `${t(`wiki.shape.${s.model.hullShape}`)} · ${t(`wiki.style.${SPECIES.find((x) => x.id === s.speciesId)?.visual.silhouette ?? "geometric"}`)}`,
      ]),
      numeric: [3, 4, 5],
    };
  },

  anillos: (t, locale) => {
    const d = contentDictionaries[locale];
    const rings = [...new Set(SPECIES.map((s) => s.territory.minCoreRing))].sort((a, b) => a - b);
    return {
      head: [t("wiki.col.ring"), t("wiki.col.distance"), t("wiki.col.speciesThere")],
      rows: [
        ["0–1", t("wiki.v.coreRing"), "—"],
        ...rings.map((r) => [
          `${num(locale, r)}+`,
          t("wiki.v.ringDistance", { ly: num(locale, ringDistance(r)) }),
          SPECIES.filter((s) => s.territory.minCoreRing <= r).map((s) => d[s.nameKey] ?? s.id).join(", "),
        ]),
      ],
    };
  },

  ayuda: (t, locale) => kv(t, [
    ["wiki.k.helpCooldown", t("wiki.v.seconds", { n: num(locale, HELP_CALL.cooldownSec) })],
    ["wiki.k.helpMaxRing", num(locale, HELP_CALL.militiaMaxRing)],
    ["wiki.k.helpShips", HELP_CALL.militiaShips.map((id) => shipName(locale, id)).join(", ")],
    ["wiki.k.helpStay", t("wiki.v.seconds", { n: num(locale, HELP_CALL.militiaStaySec) })],
  ]),
  mercenarios: (t, locale) => ({
    head: [t("wiki.col.offer"), t("wiki.col.ships"), t("wiki.col.cost"), t("wiki.col.time")],
    rows: MERCENARIES.offers.map((o) => [
      t(o.nameKey as I18nKey),
      o.ships.map(([id, n]) => `${num(locale, n)}× ${shipName(locale, id)}`).join(", "),
      `₢ ${num(locale, o.credits)}`,
      t("colony.costHours", { h: num(locale, o.hours) }),
    ]),
    numeric: [2],
  }),
  guaridas: (t, locale) => {
    const L = SCAVENGER_LAIR;
    const cls = getAlienShipClass(L.classId)!;
    const h = (n: number) => t("colony.costHours", { h: num(locale, n) });
    return kv(t, [
      ["wiki.k.raidMinRing", num(locale, L.minRing)],
      ["wiki.k.lairChance", `${num(locale, L.chancePct)} %`],
      ["wiki.k.lairHull", num(locale, cls.hull * L.hullMult)],
      ["wiki.k.lairShield", num(locale, cls.combat!.shield * L.shieldMult)],
      ["wiki.k.lairClear", h(L.clearHours)],
      ["wiki.k.lairRespawn", h(L.respawnHours)],
    ]);
  },
  incursiones: (t, locale) => {
    const R = ROUTE_RAID;
    const pct = (x: number) => `${num(locale, Math.round(x * 100))} %`;
    return kv(t, [
      ["wiki.k.raidMinRing", num(locale, R.minRing)],
      ["wiki.k.raidChance", pct(R.chance)],
      ["wiki.k.raidEscorted", pct(R.escortedChance)],
      ["wiki.k.raidShips", `${num(locale, R.ships[0])}–${num(locale, R.ships[1])}`],
      ["wiki.k.raidLeave", t("colony.costHours", { h: num(locale, R.leaveHours) })],
    ]);
  },
  "ia-alienigena": (t, locale) => {
    const g = ALIEN_AI.grudge;
    const h = (n: number) => t("colony.costHours", { h: num(locale, n) });
    return kv(t, [
      ["wiki.k.regionSize", t("wiki.v.sectors", { n: num(locale, ALIEN_AI.regionSizeSectors), ly: num(locale, ALIEN_AI.regionSizeSectors * SECTOR_SIZE) })],
      ["wiki.k.aiTick", t("wiki.v.minutes", { n: num(locale, ALIEN_AI.tickGameMinutes) })],
      ["wiki.k.activeHours", h(ALIEN_AI.activeHours)],
      ["wiki.k.reinforce", h(ALIEN_AI.reinforceHours)],
      ["wiki.k.patrolRange", t("wiki.v.ly", { n: num(locale, ALIEN_AI.patrolRangeLy) })],
      ["wiki.k.responseRange", t("wiki.v.ly", { n: num(locale, ALIEN_AI.responseRangeLy) })],
      ["wiki.k.expansionRange", t("wiki.v.ly", { n: num(locale, ALIEN_AI.expansionRangeLy) })],
      ["wiki.k.novice", h(ALIEN_AI.noviceGraceHours)],
      ["wiki.k.hostileAt", num(locale, g.hostileAt)],
      ["wiki.k.interceptGrudge", num(locale, g.intercept)],
      ["wiki.k.grudgeDecay", num(locale, g.decayPerDay)],
      ["wiki.k.punishAt", num(locale, ALIEN_AI.punish.grudgeAt)],
      ["wiki.k.punishRange", t("wiki.v.ly", { n: num(locale, ALIEN_AI.punish.rangeLy) })],
      ["wiki.k.punishCooldown", h(ALIEN_AI.punish.cooldownHours)],
      ["wiki.k.tribute", `₢ ${num(locale, g.tributeCreditsPerPoint)}`],
      ["wiki.k.minTribute", `₢ ${num(locale, g.minTribute)}`],
      [
        "wiki.k.tradeSells",
        `${ALIEN_AI.trade.sells.map((r) => t(`resource.${r}`)).join(", ")} / ${ALIEN_AI.trade.buys.map((r) => t(`resource.${r}`)).join(", ")}`,
      ],
      ["wiki.k.tradeSpread", `± ${num(locale, ALIEN_AI.trade.spread * 100)} %`],
      ["wiki.k.tradeOrders", num(locale, ALIEN_AI.trade.maxOpenOrders)],
    ]);
  },

  "ia-emperadores": (t, locale) => ({
    head: [t("wiki.col.personality"), t("wiki.col.emperors"), t("wiki.col.maxColonies"), t("wiki.col.buildOrder"), t("wiki.col.keeps"), t("wiki.col.war")],
    rows: (Object.keys(AI_PERSONALITIES) as AiPersonality[]).map((id) => {
      const p = AI_PERSONALITIES[id];
      return [
        t(`wiki.personality.${id}`),
        AI_EMPERORS.filter((e) => e.personality === id).map((e) => e.name).join(", "),
        num(locale, p.maxColonies),
        p.buildOrder.map(([i, n]) => `${t(`installation.${i}`)} ×${n}`).join(" → "),
        p.ships.map(([s, n]) => `${shipName(locale, s)} ×${n}`).join(", ") || "—",
        p.war ? t("wiki.v.war", { n: num(locale, p.war.minWarships), ly: num(locale, p.war.rangeLy) }) : p.defends ? t("wiki.v.defends") : "—",
      ];
    }),
    numeric: [2],
  }),

  // --- Fase 10: muerte y linaje ---

  "linaje-gestacion": (t, locale) => {
    const rows: string[][] = [];
    for (let n = 1; n <= 12; n++) {
      rows.push([String(n), t("wiki.v.minutes", { n: num(locale, gestationMinutes(n, false), 1) }), t("wiki.v.minutes", { n: num(locale, gestationMinutes(n, true), 1) })]);
      if (gestationMinutes(n, false) >= LINEAGE.gestationMaxMinutes) break;
    }
    return { head: [t("wiki.col.deathStreak"), t("wiki.col.atCradle"), t("wiki.col.atCore")], rows, numeric: [0, 1, 2] };
  },

  linaje: (t, locale) => {
    const onboard = (kind: "cannon" | "missile") => {
      const w = EMPEROR_FLAGSHIP.combat.weapons.find((x) => x.kind === kind);
      return w ? Math.min(w.ammo ?? 0, w.ammoRegenMax ?? w.ammo ?? 0) : 0;
    };
    return kv(t, [
      ["wiki.k.gestationBase", t("wiki.v.minutes", { n: num(locale, LINEAGE.gestationBaseMinutes) })],
      ["wiki.k.gestationGrowth", `× ${num(locale, LINEAGE.gestationGrowth)}`],
      ["wiki.k.gestationMax", t("wiki.v.hours", { n: num(locale, LINEAGE.gestationMaxMinutes / 60) })],
      ["wiki.k.coreGestation", `× ${num(locale, LINEAGE.coreGestationFactor)}`],
      ["wiki.k.streakDecay", t("wiki.v.hours", { n: num(locale, LINEAGE.streakDecayHours) })],
      ["wiki.k.rebirthHumans", num(locale, LINEAGE.rebirthHumans)],
      ["wiki.k.rebirthFuel", `${num(locale, FLAGSHIP_SUPPLIES.emergencyFuelMax)} / ${num(locale, FLAGSHIP_SUPPLIES.fuelMax)}`],
      ["wiki.k.rebirthAmmo", `${num(locale, onboard("cannon"))} · ${num(locale, onboard("missile"))}`],
      ["wiki.k.incarnateCooldown", t("wiki.v.hours", { n: num(locale, LINEAGE.incarnateCooldownHours) })],
      ["wiki.k.incarnateLock", t("wiki.v.seconds", { n: num(locale, LINEAGE.incarnateCombatLockSec) })],
      ["wiki.k.flagshipBattle", t("wiki.v.flagshipBattle", { attack: num(locale, FLAGSHIP_BATTLE.attack), shield: num(locale, FLAGSHIP_BATTLE.battleShield), hull: num(locale, EMPEROR_FLAGSHIP.hull) })],
      ["wiki.k.repairOnboard", t("wiki.v.repairOnboard", { n: num(locale, FLAGSHIP_REPAIR.onboardPerSec), s: num(locale, FLAGSHIP_REPAIR.onboardDelaySec) })],
      ["wiki.k.repairColony", t("wiki.v.repairColony", { n: num(locale, FLAGSHIP_REPAIR.colonyPerSec), alloys: num(locale, FLAGSHIP_REPAIR.alloysPerHull) })],
    ]);
  },

  herederos: (t, locale) =>
    kv(t, [
      ["wiki.k.heirsMax", num(locale, HEIRS.maxPerEmperor)],
      ["wiki.k.heirCost", cost(t, locale, HEIRS.cost)],
      ["wiki.k.heirPopulation", num(locale, HEIRS.population)],
      ["wiki.k.heirGestation", t("wiki.v.hours", { n: num(locale, HEIRS.gestationHours) })],
      ["wiki.k.governEvery", t("wiki.v.hours", { n: num(locale, HEIRS.governEveryHours) })],
      ["wiki.k.governReserve", `${num(locale, HEIRS.reserveShare * 100)} %`],
    ]),

  doctrinas: (t, locale) => ({
    head: [t("wiki.col.doctrine"), t("wiki.col.extraction"), t("wiki.col.defense"), t("wiki.col.governorBuilds")],
    rows: HEIR_DOCTRINES.map((d) => [
      t(`doctrine.${d.id}`),
      `× ${num(locale, d.extraction)}`,
      `× ${num(locale, d.defense)}`,
      d.buildPriority.map((i) => t(`installation.${i}`)).join(" → "),
    ]),
  }),

  // Espacio profundo y minería (packages/content deepspace.ts).
  asteroides: (t, locale) => ({
    head: [t("wiki.col.asteroid"), t("wiki.col.yields"), t("wiki.col.unitsPerRadius")],
    rows: (Object.keys(ASTEROID_KINDS) as AsteroidKind[]).map((k) => [
      t(`asteroid.${k}`),
      Object.entries(ASTEROID_KINDS[k].yields)
        .map(([r, f]) => `${t(`resource.${r}` as I18nKey)} ${num(locale, (f ?? 0) * 100, 0)} %`)
        .join(" · "),
      num(locale, ASTEROID_KINDS[k].unitsPerRadiusM),
    ]),
    numeric: [2],
  }),
  "regiones-profundas": (t, locale) => {
    const total = Object.values(DEEP_REGIONS).reduce((n, r) => n + r.weight, 0);
    return {
      head: [t("wiki.col.region"), t("wiki.col.frequency"), t("wiki.col.asteroids"), t("wiki.col.mix"), t("wiki.col.fieldRadius")],
      rows: Object.entries(DEEP_REGIONS).map(([k, r]) => [
        t(`deep.kind.${k}` as I18nKey),
        `${num(locale, (r.weight / total) * 100, 0)} %`,
        r.asteroids[1] > 0 ? range(locale, r.asteroids) : "—",
        Object.entries(r.mix)
          .map(([a, f]) => `${t(`asteroid.${a}` as I18nKey)} ${num(locale, (f ?? 0) * 100, 0)} %`)
          .join(" · ") || "—",
        r.fieldRadiusM[1] > 0 ? `${num(locale, r.fieldRadiusM[0] / 1000, 0)}–${num(locale, r.fieldRadiusM[1] / 1000, 0)} km` : "—",
      ]),
      numeric: [1, 2],
    };
  },
  mineria: (t, locale) =>
    kv(t, [
      ["wiki.deep.cell", `${num(locale, DEEP_SPACE.cellLy)} a.l.`],
      ["wiki.deep.asteroidRadius", `${range(locale, DEEP_SPACE.asteroidRadiusM)} m`],
      ["wiki.deep.regen", `${num(locale, DEEP_SPACE.regenHours)} h`],
      ["wiki.deep.range", `${num(locale, MINING.rangeM)} m`],
      ["wiki.deep.rate", num(locale, MINING.unitsPerSec)],
      ["wiki.deep.energy", num(locale, MINING.energyPerSec)],
      ["wiki.deep.hold", num(locale, FLAGSHIP_HOLD.capacity)],
      ["wiki.deep.refineRatio", num(locale, FLAGSHIP_HOLD.refineVolatilesPerFuel)],
      ["wiki.deep.refineRate", num(locale, FLAGSHIP_HOLD.refineFuelPerSec)],
    ]),
  "teclas-vuelo": (t, locale) => keysTable(t, locale, "flight"),
  "teclas-mapa": (t, locale) => keysTable(t, locale, "map"),
  "teclas-general": (t, locale) => keysTable(t, locale, "general"),
};

export function buildTable(id: string, locale: Locale): GenTable | null {
  const builder = GEN_TABLES[id];
  if (!builder) return null;
  return builder((key, params) => translate(locale, key, params), locale);
}

/** Ficha generada (especies con sus facciones). */
export interface GenCard {
  title: string;
  subtitle: string;
  badge: string;
  text: string;
  items: Array<{ name: string; badge: string; text: string }>;
  /** Color de la ficha (el de la especie). */
  color?: string;
  /** Datos «concepto · valor» (territorio, flotas, IA…). */
  facts?: Array<[string, string]>;
  /** Tabla propia (sus naves). */
  table?: GenTable;
}

type CardBuilder = (t: T, locale: Locale) => GenCard[];

export const GEN_CARDS: Record<string, CardBuilder> = {
  especies: (t, locale) => {
    const d = contentDictionaries[locale];
    const stars = (list: readonly StarClass[]) => list.join(", ");
    return SPECIES.map((s) => {
      const ships = alienShipsOf(s.id);
      const facts: Array<[string, string]> = [
        [t("wiki.k.philosophy"), d[s.philosophyKey] ?? ""],
        [t("wiki.k.attitude"), d[s.attitudeKey] ?? ""],
        [
          t("wiki.k.territory"),
          s.extinct
            ? t("wiki.v.relics", { stars: stars(s.geography.preferredStarClasses), ring: num(locale, s.territory.minCoreRing), ly: num(locale, ringDistance(s.territory.minCoreRing)) })
            : t("wiki.v.territory", {
                ring: num(locale, s.territory.minCoreRing),
                ly: num(locale, ringDistance(s.territory.minCoreRing)),
                stars: stars(s.geography.preferredStarClasses),
                region: t(`wiki.region.${s.territory.region}`),
              }),
        ],
      ];
      if (!s.extinct) {
        facts.push(
          [t("wiki.k.fleetStyle"), t("wiki.v.fleet", { style: t(`wiki.fleetStyle.${s.fleet.style}`), ships: range(locale, s.fleet.shipsPerFleet), fleets: range(locale, s.fleet.fleetsPerRegion) })],
          [
            t("wiki.k.ai"),
            t("wiki.v.ai", {
              intruders: t(`wiki.intruders.${s.ai.intruders}`, { n: num(locale, s.ai.responders) }),
              patrol: num(locale, s.ai.patrol * 100),
              exp: num(locale, s.ai.expansionPerDay),
              trade: s.ai.trades ? t("wiki.v.trades") : "",
            }),
          ],
          [t("wiki.k.diplomacy"), t("wiki.v.diplomacy", { diplomacy: t(`wiki.diplomacy.${s.diplomacy}`), grudge: num(locale, s.ai.grudgePerColony) })],
        );
      }
      return {
        title: d[s.nameKey] ?? s.id,
        subtitle: d[s.mottoKey] ?? "",
        badge: t(s.extinct ? "wiki.species.extinct" : s.enabledInMvp ? "wiki.species.active" : "wiki.species.notYet"),
        text: d[s.descriptionKey] ?? "",
        color: s.visual.emissiveColor,
        facts,
        table: ships.length
          ? {
              head: [t("wiki.k.ships"), t("wiki.col.role"), t("combat.hull"), t("wiki.col.attack"), t("wiki.col.battleShield"), t("wiki.col.speed")],
              rows: ships.map((a) => [shipName(locale, a.id), t(`wiki.role.${a.role}`), num(locale, a.hull), num(locale, a.attack), num(locale, a.battleShield), t("wiki.v.lyh", { n: num(locale, a.speedLyPerHour * TRAVEL_SPEED_SCALE) })]),
              numeric: [2, 3, 4],
            }
          : undefined,
        items: FACTIONS.filter((f) => f.speciesId === s.id).map((f) => ({
          name: d[f.nameKey] ?? f.id,
          badge: t(`wiki.relation.${f.relation}`),
          text: d[f.descriptionKey] ?? "",
        })),
      };
    });
  },
};

export function buildCards(id: string, locale: Locale): GenCard[] | null {
  const builder = GEN_CARDS[id];
  if (!builder) return null;
  return builder((key, params) => translate(locale, key, params), locale);
}

/** Texto plano de una tabla o fichas generadas (para el buscador). */
export function generatedText(kind: "gen" | "cards", id: string, locale: Locale): string {
  if (kind === "gen") {
    const table = buildTable(id, locale);
    return table ? [table.head.join(" "), ...table.rows.map((r) => r.join(" "))].join(" \n") : "";
  }
  const cards = buildCards(id, locale) ?? [];
  return cards
    .map((c) =>
      [c.title, c.subtitle, c.text, ...(c.facts ?? []).flat(), ...(c.table?.rows.map((r) => r.join(" ")) ?? []), ...c.items.flatMap((i) => [i.name, i.text])].join(" \n"),
    )
    .join(" \n");
}
