/**
 * Tablas de la Wiki generadas con los datos del juego (`@imperium/content`,
 * `@imperium/procgen`, `@imperium/sim` y las teclas por defecto). Así, si
 * cambia un número en el código, la Wiki cambia con él. Los artículos las
 * insertan con `{{tabla:<id>}}`.
 */
import {
  CONTACT_SENSORS,
  FACTIONS,
  SPECIES,
  ECONOMY,
  EMPEROR_FLAGSHIP,
  FLEET_BATTLE,
  HUMANS,
  INSTALLATIONS,
  PIRATE_RAIDER,
  POPULATION,
  SHIP_CLASSES,
  SHIP_HUMAN_CAPACITY,
  SHIP_PASSENGERS,
  STARTING_FLEET,
  STOCK_IDS,
  contentDictionaries,
  type InstallationId,
  type ShipClassDefinition,
  type StockAmounts,
  type WeaponDefinition,
} from "@imperium/content";
import { DEPOSIT_TABLE, STAR_CLASSES } from "@imperium/procgen";
import { translate, type I18nKey, type Locale, type PlanetType, type StarClass } from "@imperium/shared";
import {
  PILOT_BOOST,
  PILOT_SPEED,
  PULSE_SAFE_RADII,
  PULSE_SPEED,
  colonyEnergy,
  colonyFlows,
  minColonists,
  netRates,
  populationCap,
  type InstallationCounts,
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
};

function weaponName(t: T, w: WeaponDefinition): string {
  return t(w.kind === "cannon" ? "combat.cannon" : "wiki.weapon.missile");
}

function keysTable(t: T, locale: Locale, ctx: ActionContext): GenTable {
  return {
    head: [t("wiki.col.action"), t("wiki.col.keys")],
    rows: ACTIONS[ctx].map((a) => [t(`action.${a}`), DEFAULT_BINDINGS[a].map((c) => keyLabel(c, locale)).join(" / ") || "—"]),
  };
}

const PLANET_TYPES: PlanetType[] = ["lava", "barren", "rocky", "desert", "ocean", "toxic", "ice", "gas_giant", "ice_giant"];
const STAR_ORDER: StarClass[] = ["O", "B", "A", "F", "G", "K", "M", "RG", "WD", "NS", "BH"];

const range = (locale: Locale, [a, b]: readonly [number, number]) => (a === b ? num(locale, a) : `${num(locale, a)}–${num(locale, b)}`);

function shipHumans(s: ShipClassDefinition): number {
  return SHIP_HUMAN_CAPACITY[s.id] ?? 0;
}

/** Instalaciones de la colonia del ejemplo de economía. */
export const EXAMPLE_INSTALLATIONS: InstallationCounts = { mine: 2, refinery: 1, power_plant: 1 };

type Builder = (t: T, locale: Locale) => GenTable;

export const GEN_TABLES: Record<string, Builder> = {
  recursos: (t, locale) => ({
    head: [t("wiki.col.resource"), t("wiki.col.storage"), t("wiki.col.founding"), t("wiki.col.transport")],
    rows: [
      ...STOCK_IDS.map((r) => [t(`resource.${r}`), num(locale, ECONOMY.storage[r]), num(locale, ECONOMY.foundingStock[r]), t("wiki.yes")]),
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
    const half = { metal: ECONOMY.storage.metal / 2, volatiles: ECONOMY.storage.volatiles / 2, crystal: ECONOMY.storage.crystal / 2, alloys: ECONOMY.storage.alloys / 2 };
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
    head: [t("wiki.col.ship"), t("wiki.col.cost"), t("wiki.col.time"), t("wiki.col.speed"), t("wiki.col.cargo"), t("wiki.col.humans"), t("wiki.col.scanner"), t("wiki.col.upkeep")],
    rows: SHIP_CLASSES.map((s) => [
      shipName(locale, s.id) + (s.consumedOnUse ? " *" : ""),
      cost(t, locale, s.cost),
      t("colony.costHours", { h: num(locale, s.buildTimeHours) }),
      t("wiki.v.lyh", { n: num(locale, s.speedLyPerHour) }),
      num(locale, s.cargo),
      num(locale, shipHumans(s) || (SHIP_PASSENGERS[s.id] ?? 0)),
      t("wiki.v.ly", { n: num(locale, s.scannerRangeLy) }),
      t("colony.upkeepValue", { n: num(locale, s.upkeepVolatilesPerHour) }),
    ]),
    numeric: [4, 5],
  }),

  "naves-combate": (t, locale) => ({
    head: [t("wiki.col.ship"), t("combat.hull"), t("wiki.col.attack"), t("wiki.col.battleShield"), t("wiki.col.rtShield"), t("wiki.col.weapons")],
    rows: [
      ...SHIP_CLASSES.map((s) => [
        shipName(locale, s.id),
        num(locale, s.hull),
        num(locale, s.attack),
        num(locale, s.battleShield),
        t("wiki.v.shield", { n: num(locale, s.combat.shield), regen: num(locale, s.combat.shieldRegenPerSec), delay: num(locale, s.combat.shieldDelaySec) }),
        s.combat.weapons.map((w) => weaponName(t, w)).join(", ") || "—",
      ]),
    ],
    numeric: [1, 2, 3],
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
    for (const w of PIRATE_RAIDER.combat.weapons) add(w, t("npc.pirate"));
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

  carroneros: (t, locale) =>
    kv(t, [
      ["combat.hull", num(locale, PIRATE_RAIDER.hull)],
      ["combat.shield", t("wiki.v.shield", { n: num(locale, PIRATE_RAIDER.combat.shield), regen: num(locale, PIRATE_RAIDER.combat.shieldRegenPerSec), delay: num(locale, PIRATE_RAIDER.combat.shieldDelaySec) })],
      ["wiki.k.pirateSpeed", `${num(locale, PIRATE_RAIDER.speedU)} m/s`],
      ["wiki.k.aggro", `${num(locale, PIRATE_RAIDER.aggroRangeU)} m`],
      ["wiki.k.preferred", `${num(locale, PIRATE_RAIDER.preferredRangeU)} m`],
      ["wiki.k.respawn", `${num(locale, PIRATE_RAIDER.respawnSec / 60)} min`],
    ]),

  vuelo: (t, locale) =>
    kv(t, [
      ["wiki.k.pilotSpeed", `${num(locale, PILOT_SPEED)} m/s`],
      ["wiki.k.boost", `× ${num(locale, PILOT_BOOST)} (${num(locale, PILOT_SPEED * PILOT_BOOST)} m/s)`],
      ["wiki.k.pulse", `${num(locale, PULSE_SPEED / 1000)} km/s`],
      ["wiki.k.pulseSafe", t("wiki.v.radii", { n: num(locale, PULSE_SAFE_RADII) })],
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

  depositos: (t, locale) => ({
    head: [t("wiki.col.planetType"), t("resource.metal"), t("resource.volatiles")],
    rows: PLANET_TYPES.map((p) => [t(`planet.${p}`), range(locale, DEPOSIT_TABLE[p].metal), range(locale, DEPOSIT_TABLE[p].volatiles)]),
    numeric: [1, 2],
  }),

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
}

type CardBuilder = (t: T, locale: Locale) => GenCard[];

export const GEN_CARDS: Record<string, CardBuilder> = {
  especies: (t, locale) => {
    const d = contentDictionaries[locale];
    return SPECIES.map((s) => ({
      title: d[s.nameKey] ?? s.id,
      subtitle: d[s.mottoKey] ?? "",
      badge: t(s.extinct ? "wiki.species.extinct" : s.enabledInMvp ? "wiki.species.active" : "wiki.species.notYet"),
      text: d[s.descriptionKey] ?? "",
      items: FACTIONS.filter((f) => f.speciesId === s.id).map((f) => ({
        name: d[f.nameKey] ?? f.id,
        badge: t(`wiki.relation.${f.relation}`),
        text: d[f.descriptionKey] ?? "",
      })),
    }));
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
  return cards.map((c) => [c.title, c.subtitle, c.text, ...c.items.flatMap((i) => [i.name, i.text])].join(" \n")).join(" \n");
}
