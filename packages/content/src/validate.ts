import type { FactionDefinition, ShipClassDefinition, ShipCombat, SpeciesDefinition } from "./types";
import { SPECIES } from "./species";
import { FACTIONS } from "./factions";
import { SHIP_CLASSES } from "./ships";
import { contentEn, contentEs, type ContentDictionary } from "./i18n";
import { ALIEN_SHIP_CLASSES, type AlienShipClassDefinition } from "./aliens";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface ContentBundle {
  species: readonly SpeciesDefinition[];
  factions: readonly FactionDefinition[];
  ships: readonly ShipClassDefinition[];
  es: ContentDictionary;
  en: ContentDictionary;
  /** Naves alienígenas (por defecto, las del paquete). */
  alienShips?: readonly AlienShipClassDefinition[];
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/**
 * Valida la coherencia del contenido. Devuelve una lista de errores legibles;
 * vacía si todo es correcto. Por defecto valida el contenido incluido en el paquete.
 */
export function validateContent(
  bundle: ContentBundle = { species: SPECIES, factions: FACTIONS, ships: SHIP_CLASSES, es: contentEs, en: contentEn },
): string[] {
  const errors: string[] = [];
  const { species, factions, ships, es, en } = bundle;
  const alienShips = bundle.alienShips ?? ALIEN_SHIP_CLASSES;

  // Ids únicos
  for (const id of duplicates(species.map((s) => s.id))) errors.push(`Id de especie duplicado: ${id}`);
  for (const id of duplicates(factions.map((f) => f.id))) errors.push(`Id de facción duplicado: ${id}`);
  for (const id of duplicates([...ships.map((s) => s.id as string), ...alienShips.map((s) => s.id)])) errors.push(`Id de nave duplicado: ${id}`);

  const speciesIds = new Set(species.map((s) => s.id));
  const factionIds = new Set(factions.map((f) => f.id));
  const keys: string[] = [];

  const checkUnit = (where: string, name: string, v: number) => {
    if (!Number.isFinite(v) || v < 0 || v > 1) errors.push(`${where}: ${name} fuera de [0,1] (${v})`);
  };
  const checkHex = (where: string, name: string, v: string) => {
    if (!HEX_RE.test(v)) errors.push(`${where}: color ${name} no es hex válido (${v})`);
  };

  for (const s of species) {
    const where = `especie ${s.id}`;
    if (s.nameKey !== `species.${s.id}.name`) errors.push(`${where}: nameKey inesperada (${s.nameKey})`);
    if (s.descriptionKey !== `species.${s.id}.description`)
      errors.push(`${where}: descriptionKey inesperada (${s.descriptionKey})`);
    if (s.mottoKey !== `species.${s.id}.motto`) errors.push(`${where}: mottoKey inesperada (${s.mottoKey})`);
    keys.push(s.nameKey, s.descriptionKey, s.mottoKey, s.philosophyKey, s.attitudeKey);
    if (s.philosophyKey !== `species.${s.id}.philosophy`) errors.push(`${where}: philosophyKey inesperada (${s.philosophyKey})`);
    if (s.attitudeKey !== `species.${s.id}.attitude`) errors.push(`${where}: attitudeKey inesperada (${s.attitudeKey})`);
    // Territorio, flotas e IA (Fase 11).
    if (!Number.isInteger(s.territory.minCoreRing) || s.territory.minCoreRing < 2)
      errors.push(`${where}: minCoreRing debe ser un entero ≥ 2 (el Núcleo Humano es seguro)`);
    if (!(s.territory.regionWeight >= 0)) errors.push(`${where}: regionWeight negativo`);
    checkUnit(where, "systemShare", s.territory.systemShare);
    checkUnit(where, "patrol", s.ai.patrol);
    if (!(s.ai.expansionPerDay >= 0) || !(s.ai.grudgePerColony >= 0) || !Number.isInteger(s.ai.responders) || s.ai.responders < 0)
      errors.push(`${where}: valores de IA negativos o inválidos`);
    if (s.extinct && (s.territory.regionWeight > 0 || s.ai.intruders !== "ignore")) errors.push(`${where}: una especie desaparecida no tiene territorio ni ataca`);
    const [nearShips, deepShips] = s.fleet.shipsPerFleet;
    const [nearFleets, deepFleets] = s.fleet.fleetsPerRegion;
    if (!(nearShips >= 1 && deepShips >= nearShips) || !(nearFleets >= 0 && deepFleets >= nearFleets))
      errors.push(`${where}: tamaños de flota inválidos`);
    if (s.fleet.composition.length === 0) errors.push(`${where}: flota sin naves`);
    for (const [shipId, w] of s.fleet.composition) {
      const ship = alienShips.find((a) => a.id === shipId);
      if (!ship) errors.push(`${where}: nave inexistente en su flota ${shipId}`);
      else if (ship.speciesId !== s.id) errors.push(`${where}: la nave ${shipId} es de otra especie`);
      if (!(w > 0)) errors.push(`${where}: peso de ${shipId} no positivo`);
    }
    // Una especie desaparecida solo deja ruinas: ni facciones activas ni expansión.
    if (s.extinct !== (s.expansion === "extinct")) errors.push(`${where}: extinct y expansion "extinct" deben ir juntos`);
    if (s.extinct && s.enabledInMvp) errors.push(`${where}: una especie desaparecida no puede estar activa`);

    for (const [k, v] of Object.entries(s.traits)) checkUnit(where, k, v);
    checkUnit(where, "anomalyAffinity", s.geography.anomalyAffinity);

    for (const r of s.rivals) {
      if (!speciesIds.has(r)) errors.push(`${where}: rival inexistente ${r}`);
      if (r === s.id) errors.push(`${where}: es rival de sí misma`);
    }
    for (const [k, v] of Object.entries(s.visual)) if (k !== "silhouette") checkHex(where, k, v as string);
    if (s.economy.preferredResources.length === 0) errors.push(`${where}: sin recursos preferidos`);
    if (s.playable !== false) errors.push(`${where}: las especies alienígenas no pueden ser jugables`);
  }

  for (const f of factions) {
    const where = `facción ${f.id}`;
    if (!speciesIds.has(f.speciesId)) errors.push(`${where}: speciesId inexistente ${f.speciesId}`);
    if (species.find((s) => s.id === f.speciesId)?.extinct) errors.push(`${where}: pertenece a una especie desaparecida`);
    keys.push(f.nameKey, f.descriptionKey);
    if (!(f.regionShare >= 0)) errors.push(`${where}: regionShare negativo`);
    for (const [k, v] of Object.entries(f.traitModifiers)) {
      if (v === undefined || !Number.isFinite(v) || v < -1 || v > 1)
        errors.push(`${where}: modificador ${k} fuera de [-1,1] (${v})`);
    }
    for (const h of f.hostileTo) {
      if (!factionIds.has(h)) errors.push(`${where}: hostil a facción inexistente ${h}`);
      if (h === f.id) errors.push(`${where}: hostil a sí misma`);
    }
  }

  for (const sh of ships) {
    const where = `nave ${sh.id}`;
    keys.push(sh.nameKey, sh.descriptionKey);
    const nums: Array<[string, number]> = [
      ["metal", sh.cost.metal],
      ["volatiles", sh.cost.volatiles],
      ["crystal", sh.cost.crystal],
      ["hull", sh.hull],
      ["attack", sh.attack],
      ["battleShield", sh.battleShield],
      ["cargo", sh.cargo],
      ["upkeepVolatilesPerHour", sh.upkeepVolatilesPerHour],
    ];
    for (const [k, v] of nums) if (!Number.isFinite(v) || v < 0) errors.push(`${where}: ${k} negativo o inválido`);
    if (!(sh.buildTimeHours > 0)) errors.push(`${where}: buildTimeHours debe ser > 0`);
    if (!(sh.speedLyPerHour > 0)) errors.push(`${where}: speedLyPerHour debe ser > 0`);
    if (!(sh.scannerRangeLy > 0)) errors.push(`${where}: scannerRangeLy debe ser > 0`);
    errors.push(...validateCombat(where, sh.combat));
  }

  for (const sh of alienShips) {
    const where = `nave alienígena ${sh.id}`;
    if (!speciesIds.has(sh.speciesId)) errors.push(`${where}: speciesId inexistente ${sh.speciesId}`);
    if (sh.nameKey !== `ship.${sh.id}.name` || sh.descriptionKey !== `ship.${sh.id}.description`) errors.push(`${where}: claves i18n inesperadas`);
    keys.push(sh.nameKey, sh.descriptionKey);
    for (const [k, v] of [["hull", sh.hull], ["attack", sh.attack], ["battleShield", sh.battleShield], ["cargo", sh.cargo]] as const)
      if (!Number.isFinite(v) || v < 0) errors.push(`${where}: ${k} negativo o inválido`);
    if (!(sh.hull > 0) || !(sh.speedLyPerHour > 0) || !(sh.scannerRangeLy > 0)) errors.push(`${where}: casco, velocidad y escáner deben ser > 0`);
    if (!(sh.model.lengthM > 0) || !(sh.model.engines >= 0)) errors.push(`${where}: modelo inválido`);
    errors.push(...validateCombat(where, sh.combat));
  }

  // Claves i18n presentes y no vacías en ambos idiomas
  for (const key of keys) {
    if (!es[key]?.trim()) errors.push(`Falta la clave i18n "${key}" en es`);
    if (!en[key]?.trim()) errors.push(`Falta la clave i18n "${key}" en en`);
  }

  return errors;
}

/** Errores en el escudo y las armas de una nave (también se usa para la nave del Emperador). */
export function validateCombat(where: string, c: ShipCombat): string[] {
  const errors: string[] = [];
  if (!(c.shield >= 0) || !(c.shieldRegenPerSec >= 0) || !(c.shieldDelaySec >= 0)) errors.push(`${where}: escudo con valores negativos o inválidos`);
  for (const w of c.weapons) {
    if (!(w.damage > 0 && w.cooldownSec > 0 && w.rangeU > 0 && w.speedU > 0)) errors.push(`${where}: arma ${w.kind} con daño, cadencia, alcance o velocidad no positivos`);
    if ((w.ammo === null) !== (w.ammoRegenSec === null)) errors.push(`${where}: arma ${w.kind}: munición y recarga van juntas`);
    if (w.ammo !== null && !(w.ammo > 0 && (w.ammoRegenSec ?? 0) > 0)) errors.push(`${where}: arma ${w.kind}: munición y recarga deben ser > 0`);
  }
  if (new Set(c.weapons.map((w) => w.kind)).size !== c.weapons.length) errors.push(`${where}: dos armas del mismo tipo`);
  return errors;
}
