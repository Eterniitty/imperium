import type { FactionDefinition, ShipClassDefinition, SpeciesDefinition } from "./types";
import { SPECIES } from "./species";
import { FACTIONS } from "./factions";
import { SHIP_CLASSES } from "./ships";
import { contentEn, contentEs, type ContentDictionary } from "./i18n";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface ContentBundle {
  species: readonly SpeciesDefinition[];
  factions: readonly FactionDefinition[];
  ships: readonly ShipClassDefinition[];
  es: ContentDictionary;
  en: ContentDictionary;
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

  // Ids únicos
  for (const id of duplicates(species.map((s) => s.id))) errors.push(`Id de especie duplicado: ${id}`);
  for (const id of duplicates(factions.map((f) => f.id))) errors.push(`Id de facción duplicado: ${id}`);
  for (const id of duplicates(ships.map((s) => s.id))) errors.push(`Id de nave duplicado: ${id}`);

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
    keys.push(s.nameKey, s.descriptionKey);

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
    keys.push(f.nameKey, f.descriptionKey);
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
      ["cargo", sh.cargo],
      ["upkeepVolatilesPerHour", sh.upkeepVolatilesPerHour],
    ];
    for (const [k, v] of nums) if (!Number.isFinite(v) || v < 0) errors.push(`${where}: ${k} negativo o inválido`);
    if (!(sh.buildTimeHours > 0)) errors.push(`${where}: buildTimeHours debe ser > 0`);
    if (!(sh.speedLyPerHour > 0)) errors.push(`${where}: speedLyPerHour debe ser > 0`);
    if (!(sh.scannerRangeLy > 0)) errors.push(`${where}: scannerRangeLy debe ser > 0`);
  }

  // Claves i18n presentes y no vacías en ambos idiomas
  for (const key of keys) {
    if (!es[key]?.trim()) errors.push(`Falta la clave i18n "${key}" en es`);
    if (!en[key]?.trim()) errors.push(`Falta la clave i18n "${key}" en en`);
  }

  return errors;
}
