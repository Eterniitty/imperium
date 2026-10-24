/**
 * Parcelas de los mundos de Aeon (Era II) en el servidor: la malla de cada
 * mundo, el bioma y la producción de cada parcela y la tierra sagrada
 * (mecanicas-era2.md §6). Lo público (malla, relieve, bioma) lo calcula igual el
 * cliente de Unreal con aeonarch-ue/Core; la tierra sagrada sale de la semilla
 * SECRETA del servidor (DETAIL_SEED) para que no se pueda adivinar sin explorar.
 */
import type { AeonBiome, AeonMoon, AeonResource, AeonWorld } from "@imperium/content";
import { buildParcelGrid, hashInts, hashString, nearestBiome, Rng, terrainClimate, terrainHeight, type ParcelGrid, type TerrainParams } from "@imperium/procgen";

/** Semilla PÚBLICA del relieve de un mundo o una luna: la usa también el cliente para dibujarlo. */
export function aeonTerrainSeed(id: string): number {
  return hashString(id);
}

/** Relieve de un mundo con su semilla pública (null si no tiene suelo: gigantes gaseosos). */
export function aeonTerrainParams(world: Pick<AeonWorld, "id" | "terrain">): TerrainParams | null {
  return world.terrain ? { seed: aeonTerrainSeed(world.id), ...world.terrain } : null;
}

const grids = new Map<number, ParcelGrid>();

/** Malla de parcelas de frecuencia f (se construye una vez y se reutiliza). */
export function parcelGrid(frequency: number): ParcelGrid {
  let grid = grids.get(frequency);
  if (!grid) {
    grid = buildParcelGrid(frequency);
    grids.set(frequency, grid);
  }
  return grid;
}

export interface ParcelInfo {
  index: number;
  /** Altura del centro en metros (negativa bajo el mar). */
  heightM: number;
  biome: AeonBiome;
  /** ¿Bajo el nivel del mar? (Se puede reclamar, pero produce lo del mar.) */
  submerged: boolean;
}

/** Bioma y altura de una parcela de un mundo con suelo. */
export function worldParcel(world: AeonWorld, index: number): ParcelInfo | null {
  const params = aeonTerrainParams(world);
  if (!params || world.parcelFrequency === null) return null;
  const grid = parcelGrid(world.parcelFrequency);
  const center = grid.centers[index];
  if (!center) return null;
  const [x, y, z] = center;
  const heightM = terrainHeight(params, x, y, z);
  if (heightM < 0 && world.sea) return { index, heightM, biome: world.sea, submerged: true };
  const climate = terrainClimate(params, x, y, z, heightM);
  const biome = world.biomes[nearestBiome(climate, world.biomes)] ?? world.biomes[0]!;
  return { index, heightM, biome, submerged: false };
}

/** Relieve genérico de las lunas (roca, sin mar), con semilla pública. */
export function moonTerrainParams(moon: Pick<AeonMoon, "id">): TerrainParams {
  return { seed: aeonTerrainSeed(moon.id), reliefM: 250, seaLevel: 0, continentFreq: 2, mountainFreq: 12, ridge: 0.5 };
}

/**
 * Parcelas de tierra sagrada de un mundo: `count` índices distintos elegidos con
 * la semilla secreta, solo en tierra firme. Ordenados de menor a mayor.
 */
export function sacredParcels(world: AeonWorld, secretSeed: number, count: number): number[] {
  if (world.parcelFrequency === null) return [];
  const total = parcelGrid(world.parcelFrequency).centers.length;
  const rng = new Rng(hashInts(secretSeed >>> 0, hashString("tierra sagrada/" + world.id)));
  const chosen = new Set<number>();
  // Intentos acotados: si casi todo es mar, puede haber menos de `count`.
  for (let tries = 0; chosen.size < count && tries < count * 50; tries++) {
    const index = rng.int(0, total - 1);
    const parcel = worldParcel(world, index);
    if (parcel && !parcel.submerged) chosen.add(index);
  }
  return [...chosen].sort((a, b) => a - b);
}

/** Producción por hora de una parcela (de su bioma), más la esencia si es sagrada. */
export function parcelYields(parcel: ParcelInfo, sacred: boolean): Partial<Record<AeonResource, number>> {
  const yields: Partial<Record<AeonResource, number>> = { ...parcel.biome.yields };
  if (sacred) yields.essence = (yields.essence ?? 0) + 1;
  return yields;
}
