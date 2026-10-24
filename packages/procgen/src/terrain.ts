/**
 * Terreno de los mundos de Aeon (Era II): altura y clima de un punto de la
 * superficie, deterministas, iguales en el servidor y en el cliente de Unreal
 * (port en aeonarch-ue/Core, comprobado al bit con vectores de prueba).
 *
 * Regla 3: solo enteros (en los hashes) y + - * / en double, más floor, abs,
 * min y max, que también son exactos. Nada de sin/pow/log.
 *
 * Es una capa nueva: no cambia el universo de la Era I ni GENERATOR_VERSION.
 */
import { fbm3 } from "./noise";

/** Parámetros del relieve de un mundo (datos en packages/content cuando exista aeon.ts). */
export interface TerrainParams {
  /** Semilla del mundo (en el servidor, derivada de DETAIL_SEED y del id del cuerpo). */
  seed: number;
  /** Altura máxima aproximada del relieve, en metros. */
  reliefM: number;
  /** Nivel del mar en [0, 1]: fracción del ruido de continentes que queda bajo el agua. */
  seaLevel: number;
  /** Frecuencia de los continentes (pocas manchas grandes: 1–3). */
  continentFreq: number;
  /** Frecuencia de las montañas (más alta: 6–16). */
  mountainFreq: number;
  /** Peso de las crestas afiladas frente a las colinas suaves, en [0, 1]. */
  ridge: number;
}

/** Clima de un punto: temperatura y humedad en [0, 1]. */
export interface Climate {
  temperature: number;
  humidity: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Altura del terreno en metros sobre el radio del mundo (negativa bajo el nivel
 * del mar) en la dirección (x, y, z), que debe ser un vector unitario.
 */
export function terrainHeight(p: TerrainParams, x: number, y: number, z: number): number {
  const cf = p.continentFreq;
  const continents = fbm3(p.seed, x * cf, y * cf, z * cf, 4);
  const mf = p.mountainFreq;
  const detail = fbm3(p.seed + 7919, x * mf, y * mf, z * mf, 5);
  // Crestas: el ruido doblado sobre su mitad deja filos donde cruza el 0,5.
  const fold = 1 - Math.abs(2 * detail - 1);
  const ridges = fold * fold;
  const land = continents - p.seaLevel;
  // Las montañas solo crecen tierra adentro (máscara que sube cerca de la costa).
  const mask = clamp01(land * 4);
  const mountains = mask * (p.ridge * ridges + (1 - p.ridge) * detail);
  return p.reliefM * (land + mountains * 0.5);
}

/**
 * Clima en (x, y, z) unitario, con la altura ya calculada: hace frío en los polos
 * (z = ±1) y en las alturas; la humedad es otro ruido.
 */
export function terrainClimate(p: TerrainParams, x: number, y: number, z: number, heightM: number): Climate {
  const variation = fbm3(p.seed + 104729, x * 3, y * 3, z * 3, 3);
  const altitude = Math.max(0, heightM) / p.reliefM;
  const temperature = clamp01(1 - Math.abs(z) - altitude * 0.5 + (variation - 0.5) * 0.3);
  const humidity = fbm3(p.seed + 1299709, x * 2, y * 2, z * 2, 4);
  return { temperature, humidity };
}

/** Clima de referencia de un bioma (temperatura y humedad en [0, 1]). */
export interface BiomeClimate {
  temperature: number;
  humidity: number;
}

/**
 * Índice del bioma de tierra de clima más parecido (distancia al cuadrado; en
 * empate, el de índice menor). -1 si la lista está vacía. Bajo el nivel del mar
 * (altura < 0) el juego usa el bioma de mar del mundo, no este.
 */
export function nearestBiome(climate: Climate, biomes: readonly BiomeClimate[]): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < biomes.length; i++) {
    const dt = climate.temperature - biomes[i]!.temperature;
    const dh = climate.humidity - biomes[i]!.humidity;
    const d = dt * dt + dh * dh;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
