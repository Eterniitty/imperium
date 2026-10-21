/**
 * Territorios alienígenas: capa determinista que reparte los sistemas de la
 * galaxia entre las especies (Fase 11). No altera el universo existente (no
 * cambia estrellas, planetas ni anomalías): es una capa más, calculada a
 * partir de la posición pública de cada sistema y de una semilla propia.
 *
 * Niebla de guerra: el servidor usa una semilla de territorio secreta
 * (derivada de `DETAIL_SEED`), así que con el cliente y la semilla pública del
 * universo no se puede saber dónde vive cada especie: el servidor solo cuenta
 * el territorio de los sistemas descubiertos.
 *
 * Cómo se reparte:
 * 1. La galaxia se divide en **regiones** cúbicas de `regionSizeSectors`
 *    sectores de lado. Cada región es de una especie o de nadie, elegida con
 *    pesos entre las especies que pueden vivir a esa distancia del Núcleo
 *    Humano (`minCoreRing`) y según la densidad de estrellas que prefieren.
 * 2. Dentro de una región, cada sistema es de la especie con probabilidad
 *    `systemShare` si su estrella es de las preferidas (un tercio si no). En
 *    los sectores más cercanos al Núcleo que su anillo mínimo, nunca.
 * 3. Aparte, las **ruinas precursoras** salpican estrellas exóticas lejos del Núcleo.
 *
 * Reglas del generador: solo enteros, hashes y `+ - * /`.
 */
import type { SectorCoord, StarClass, StarSystemSummary } from "@imperium/shared";
import { hashInts, hashToUnit } from "./hash";
import { sectorDensity } from "./sector";

/** Datos de una especie que necesita la capa de territorio (salen de `@imperium/content`). */
export interface TerritorySpeciesInput {
  speciesId: string;
  minCoreRing: number;
  regionWeight: number;
  systemShare: number;
  region: "dense" | "sparse" | "any";
  preferredStarClasses: readonly StarClass[];
  /** Facciones de la especie con territorio y su peso. */
  factions: ReadonlyArray<readonly [factionId: string, share: number]>;
}

export interface TerritoryRules {
  regionSizeSectors: number;
  emptyRegionWeight: number;
  species: readonly TerritorySpeciesInput[];
  /** Ruinas de una especie desaparecida (los Precursores). */
  relics: { speciesId: string; minCoreRing: number; share: number; starClasses: readonly StarClass[] } | null;
}

/** Dueño de un sistema o de una región. */
export interface TerritoryOwner {
  speciesId: string;
  factionId: string;
}

/** Coordenadas de una región. */
export type RegionCoord = SectorCoord;

/** Sales de los hashes (cada decisión usa la suya). */
const SALT_REGION = 0x7e221;
const SALT_FACTION = 0x7e222;
const SALT_SYSTEM = 0x7e223;
const SALT_RELIC = 0x7e224;

/**
 * Anillo de un sector: su distancia al Núcleo Humano, contada en sectores como
 * el mayor de |x|, |y|, |z|. El Núcleo son los anillos 0 y 1.
 */
export function coreRing(c: SectorCoord): number {
  return Math.max(Math.abs(c.x), Math.abs(c.y), Math.abs(c.z));
}

/** Región que contiene un sector. */
export function regionOf(c: SectorCoord, size: number): RegionCoord {
  return { x: Math.floor(c.x / size), y: Math.floor(c.y / size), z: Math.floor(c.z / size) };
}

/** Clave textual estable de una región: "rx:ry:rz". */
export function regionKey(r: RegionCoord): string {
  return `${r.x}:${r.y}:${r.z}`;
}

/** Sectores de una región. */
export function regionSectors(r: RegionCoord, size: number): SectorCoord[] {
  const out: SectorCoord[] = [];
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) out.push({ x: r.x * size + x, y: r.y * size + y, z: r.z * size + z });
  return out;
}

/** Anillo más lejano de una región (el de su esquina más alejada del origen). */
export function regionMaxRing(r: RegionCoord, size: number): number {
  const axis = (v: number) => Math.max(Math.abs(v * size), Math.abs(v * size + size - 1));
  return Math.max(axis(r.x), axis(r.y), axis(r.z));
}

/** Peso de una especie en una región según la densidad de estrellas que prefiere. */
function densityFactor(pref: TerritorySpeciesInput["region"], density: number): number {
  if (pref === "dense") return 0.4 + 1.2 * density;
  if (pref === "sparse") return 1.6 - 1.2 * density;
  return 1;
}

/**
 * Especie y facción dueñas de una región, o null si es de nadie. Determinista
 * para la misma semilla de territorio, semilla del universo y reglas.
 */
export function regionOwner(territorySeed: number, universeSeed: number, r: RegionCoord, rules: TerritoryRules): TerritoryOwner | null {
  const size = rules.regionSizeSectors;
  const ring = regionMaxRing(r, size);
  const density = sectorDensity(universeSeed, { x: r.x * size, y: r.y * size, z: r.z * size });
  const entries: Array<readonly [TerritorySpeciesInput | null, number]> = [[null, rules.emptyRegionWeight]];
  for (const s of rules.species) {
    if (s.regionWeight <= 0 || s.minCoreRing > ring || s.factions.length === 0) continue;
    entries.push([s, s.regionWeight * densityFactor(s.region, density)]);
  }
  let total = 0;
  for (const [, w] of entries) total += w;
  let roll = hashToUnit(hashInts(territorySeed, SALT_REGION, r.x, r.y, r.z)) * total;
  let chosen: TerritorySpeciesInput | null = null;
  for (const [s, w] of entries) {
    roll -= w;
    if (roll < 0) {
      chosen = s;
      break;
    }
  }
  if (!chosen) return null;
  let fTotal = 0;
  for (const [, w] of chosen.factions) fTotal += w;
  let fRoll = hashToUnit(hashInts(territorySeed, SALT_FACTION, r.x, r.y, r.z)) * fTotal;
  let factionId = chosen.factions[chosen.factions.length - 1]![0];
  for (const [id, w] of chosen.factions) {
    fRoll -= w;
    if (fRoll < 0) {
      factionId = id;
      break;
    }
  }
  return { speciesId: chosen.speciesId, factionId };
}

/**
 * Dueño de un sistema según la capa base (sin la expansión, que guarda el
 * servidor). Nunca en el Núcleo Humano ni más cerca que el anillo mínimo de la especie.
 */
export function baseSystemTerritory(
  territorySeed: number,
  universeSeed: number,
  summary: Pick<StarSystemSummary, "sector" | "index" | "starClass">,
  rules: TerritoryRules,
  /** Dueño ya calculado de su región (para no repetirlo en bucles). */
  owner?: TerritoryOwner | null,
): TerritoryOwner | null {
  const ring = coreRing(summary.sector);
  if (ring < 2) return null;
  const o = owner !== undefined ? owner : regionOwner(territorySeed, universeSeed, regionOf(summary.sector, rules.regionSizeSectors), rules);
  if (!o) return null;
  const species = rules.species.find((s) => s.speciesId === o.speciesId);
  if (!species || ring < species.minCoreRing) return null;
  const share = species.preferredStarClasses.includes(summary.starClass) ? species.systemShare : species.systemShare / 3;
  const { sector: c, index } = summary;
  return hashToUnit(hashInts(territorySeed, SALT_SYSTEM, c.x, c.y, c.z, index)) < share ? o : null;
}

/** ¿Hay ruinas de la especie desaparecida (Precursores) en este sistema? */
export function isRelicSite(territorySeed: number, summary: Pick<StarSystemSummary, "sector" | "index" | "starClass">, rules: TerritoryRules): boolean {
  const relics = rules.relics;
  if (!relics || coreRing(summary.sector) < relics.minCoreRing || !relics.starClasses.includes(summary.starClass)) return false;
  const { sector: c, index } = summary;
  return hashToUnit(hashInts(territorySeed, SALT_RELIC, c.x, c.y, c.z, index)) < relics.share;
}
