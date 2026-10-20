import { hashInts, hashToUnit } from "./hash";

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ruido de valor 3D en [0, 1), continuo y determinista. */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);

  const v = (dx: number, dy: number, dz: number) =>
    hashToUnit(hashInts(seed, x0 + dx, y0 + dy, z0 + dz));

  const x00 = lerp(v(0, 0, 0), v(1, 0, 0), tx);
  const x10 = lerp(v(0, 1, 0), v(1, 1, 0), tx);
  const x01 = lerp(v(0, 0, 1), v(1, 0, 1), tx);
  const x11 = lerp(v(0, 1, 1), v(1, 1, 1), tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

/** Ruido fractal: varias octavas de ruido de valor. Resultado en [0, 1). */
export function fbm3(seed: number, x: number, y: number, z: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(seed + i * 1013, x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
