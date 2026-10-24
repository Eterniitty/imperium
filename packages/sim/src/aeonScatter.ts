/**
 * Reparto de «cosas» por la superficie de los mundos (Era II): rocas, cristales,
 * agujas, árboles, arbustos y hongos (datos en packages/content AEON_PROPS).
 *
 * La superficie se divide en casillas del árbol de cada cara del cubo esferificado
 * (el mismo de los trozos de detalle del cliente) a un nivel fijo, de unos
 * AEON_SCATTER.tileM metros. Cada casilla decide con su propia semilla cuántas
 * cosas tiene, dónde, de qué tamaño y con qué giro, y solo se quedan las que caen
 * en tierra y en un bioma suyo. Así el servidor sabe dónde está cada roca sin
 * guardarla, y el cliente de Unreal la dibuja en el mismo sitio (port en
 * aeonarch-ue/Core/include/aeon/scatter.h, con vectores al bit).
 */
import { AEON_PROPS, AEON_SCATTER, type AeonProp, type AeonWorld } from "@imperium/content";
import { fbm3, hashInts, nearestBiome, Rng, terrainClimate, terrainDetail, terrainHeight } from "@imperium/procgen";
import { aeonTerrainParams } from "./aeonParcels";

export type Vec3d = [number, number, number];

/** Ejes de cada cara (normal, u, v): los mismos que el cliente (planet_mesh.h y planet_lod.h). */
const FACES: readonly (readonly [Vec3d, Vec3d, Vec3d])[] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];

/** Dirección unitaria del punto (u, v) ∈ [−1, 1]² de una cara (cubo esferificado). */
export function faceDirection(face: number, u: number, v: number): Vec3d {
  const [n, a, b] = FACES[face]!;
  const x = n[0] + a[0] * u + b[0] * v;
  const y = n[1] + a[1] * u + b[1] * v;
  const z = n[2] + a[2] * u + b[2] * v;
  const x2 = x * x, y2 = y * y, z2 = z * z;
  const sx = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
  const sy = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
  const sz = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
  const l = Math.sqrt(sx * sx + sy * sy + sz * sz);
  return [sx / l, sy / l, sz / l];
}

/** Nivel del árbol de casillas para un radio: la primera con lado ≤ tileM. */
export function scatterLevel(radiusM: number, tileM: number = AEON_SCATTER.tileM): number {
  let level = 0;
  while (level < 20 && (radiusM * 1.6) / 2 ** level > tileM) level++;
  return level;
}

export interface ScatterTile {
  face: number;
  level: number;
  x: number;
  y: number;
}

export interface PropInstance {
  /** Índice en AEON_PROPS[mundo]. */
  prop: number;
  /** Dirección unitaria en los ejes del mundo. */
  dir: Vec3d;
  /** Altura del suelo en ese punto, en metros sobre el radio (relieve grande + fino). */
  groundM: number;
  /** Tamaño en metros. */
  sizeM: number;
  /** Giro alrededor de la vertical, en vueltas. */
  yawTurns: number;
}

type ScatterWorld = Pick<AeonWorld, "id" | "radiusKm" | "terrain" | "sea" | "biomes">;

/** Las cosas de una casilla, en orden fijo (cosa a cosa, candidata a candidata). */
export function scatterTile(world: ScatterWorld, tile: ScatterTile, props: readonly AeonProp[] = AEON_PROPS[world.id] ?? []): PropInstance[] {
  const params = aeonTerrainParams(world);
  if (!params || props.length === 0) return [];
  const radiusM = world.radiusKm * 1000;
  const cells = 2 ** tile.level;
  const sideM = (radiusM * 1.6) / cells;
  const areaKm2 = (sideM * sideM) / 1_000_000;
  const clumpFreq = radiusM / AEON_SCATTER.clumpM;
  const out: PropInstance[] = [];
  for (let pi = 0; pi < props.length; pi++) {
    const prop = props[pi]!;
    const rng = new Rng(hashInts(params.seed, 4099 + pi, tile.face, tile.level, tile.x, tile.y));
    const expected = prop.densityPerKm2 * areaKm2;
    const whole = Math.floor(expected);
    const count = whole + (rng.next() < expected - whole ? 1 : 0);
    for (let k = 0; k < count; k++) {
      // Siempre se sacan los cuatro números, se quede o no: así el orden no depende del terreno.
      const u = -1 + (2 * (tile.x + rng.next())) / cells;
      const v = -1 + (2 * (tile.y + rng.next())) / cells;
      const t = rng.next();
      const yawTurns = rng.next();
      const dir = faceDirection(tile.face, u, v);
      const [x, y, z] = dir;
      if (prop.clump > 0) {
        const mask = fbm3(params.seed + 49157 + pi, x * clumpFreq, y * clumpFreq, z * clumpFreq, 3);
        if (mask < prop.clump) continue;
      }
      const h = terrainHeight(params, x, y, z);
      if (world.sea && h < 0) continue;
      const climate = terrainClimate(params, x, y, z, h);
      const biome = world.biomes[nearestBiome(climate, world.biomes)];
      if (!biome || !prop.biomes.includes(biome.id)) continue;
      const groundM = h + terrainDetail(params, radiusM, x, y, z);
      if (world.sea && groundM < 0) continue;
      const sizeM = prop.sizeM[0] + (prop.sizeM[1] - prop.sizeM[0]) * (t * t);
      out.push({ prop: pi, dir, groundM, sizeM, yawTurns });
    }
  }
  return out;
}
