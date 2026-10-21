/**
 * Espacio profundo: contenido de una región (capa determinista y secreta) y
 * reglas de la minería. Lo genera el servidor con una semilla derivada de
 * `DETAIL_SEED` (como el detalle de los sistemas) y se lo manda solo a quien
 * está allí; el cliente nunca lo genera.
 *
 * Regla del generador: solo enteros y `+ - * / sqrt` (nada de Math.sin/pow/log),
 * para que el resultado sea idéntico en cualquier motor. Es una capa nueva: no
 * cambia nada de lo ya generado (no hace falta subir `GENERATOR_VERSION`).
 */
import { ASTEROID_KINDS, DEEP_REGIONS, DEEP_SPACE, FLAGSHIP_HOLD, HOLD_STOCK_IDS, type AsteroidKind, type DeepRegionKind, type StockId } from "@imperium/content";
import { hashInts, Rng } from "@imperium/procgen";
import { parseDeepId, type DeepAsteroid } from "@imperium/shared";
import type { SystemLayout } from "./systemLayout";
import type { CelestialBody } from "./bodies";

/** Contenido de una región (sin el estado de la minería). */
export interface DeepRegion {
  regionId: string;
  kind: DeepRegionKind;
  asteroids: DeepAsteroid[];
}

/**
 * Genera el contenido de una región a partir de la semilla secreta. Null si el
 * id no es de una región. Los asteroides rodean el punto de llegada (el origen
 * de la región), con un hueco libre alrededor.
 */
export function generateDeepRegion(seed: number, regionId: string): DeepRegion | null {
  const cell = parseDeepId(regionId);
  if (!cell) return null;
  const rng = new Rng(hashInts(seed, cell.x, cell.y, cell.z));
  const kind = rng.weighted(Object.entries(DEEP_REGIONS).map(([k, d]) => [k as DeepRegionKind, d.weight] as const));
  const def = DEEP_REGIONS[kind];
  const count = def.asteroids[1] > 0 ? rng.int(def.asteroids[0], def.asteroids[1]) : 0;
  const asteroids: DeepAsteroid[] = [];
  if (count === 0) return { regionId, kind, asteroids };
  const fieldR = rng.range(def.fieldRadiusM[0], def.fieldRadiusM[1]);
  // El centro del campo se desplaza un poco: se llega a un lado del campo, no siempre al medio.
  const cx = rng.range(-0.3, 0.3) * fieldR;
  const cy = rng.range(-0.1, 0.1) * fieldR;
  const cz = rng.range(-0.3, 0.3) * fieldR;
  const mix = Object.entries(def.mix).map(([k, w]) => [k as AsteroidKind, w ?? 0] as const);
  const [rMin, rMax] = DEEP_SPACE.asteroidRadiusM;
  for (let i = 0; i < count; i++) {
    const type = rng.weighted(mix);
    // Muchos pequeños y pocos grandes (u² sesga hacia el mínimo).
    const u = rng.next();
    const r = Math.round(rMin + (rMax - rMin) * u * u);
    // Punto al azar dentro de una esfera (por rechazo: solo + - * /), achatada como un cinturón.
    let x = 0;
    let y = 0;
    let z = 0;
    for (let tries = 0; tries < 16; tries++) {
      x = rng.range(-1, 1);
      y = rng.range(-1, 1);
      z = rng.range(-1, 1);
      if (x * x + y * y + z * z <= 1) break;
    }
    let px = cx + x * fieldR;
    let py = cy + y * fieldR * 0.35;
    let pz = cz + z * fieldR;
    // Nadie aparece dentro de una roca: se empujan hacia fuera los del hueco de llegada.
    const d = Math.sqrt(px * px + py * py + pz * pz);
    const clear = DEEP_SPACE.clearRadiusM + r;
    if (d < clear) {
      const k = d > 1 ? clear / d : 0;
      if (k > 0) {
        px *= k;
        py *= k;
        pz *= k;
      } else {
        px = clear;
        py = 0;
        pz = 0;
      }
    }
    const amount = Math.max(1, Math.round(r * ASTEROID_KINDS[type].unitsPerRadiusM));
    asteroids.push({ i, p: [Math.round(px), Math.round(py), Math.round(pz)], r, kind: type, amount });
  }
  return { regionId, kind, asteroids };
}

/** Lo minado de un asteroide y desde cuándo se regenera (milisegundos del servidor). */
export interface AsteroidDepletion {
  mined: number;
  at: number;
}

/** Unidades que quedan en un asteroide a la hora `now`: se regenera de forma lineal en `DEEP_SPACE.regenHours`. */
export function asteroidLeft(amount: number, dep: AsteroidDepletion | null | undefined, now: number): number {
  if (!dep) return amount;
  const regen = (amount * Math.max(0, now - dep.at)) / (DEEP_SPACE.regenHours * 3_600_000);
  return Math.max(0, Math.min(amount, amount - dep.mined + regen));
}

/** Bodega de la nave del Emperador: unidades de cada recurso minado. */
export type Hold = Partial<Record<StockId, number>>;

/** Unidades ocupadas en la bodega. */
export function holdUsed(hold: Hold): number {
  let n = 0;
  for (const r of HOLD_STOCK_IDS) n += hold[r] ?? 0;
  return n;
}

/** Bodega limpia: solo recursos válidos, cantidades finitas y positivas. */
export function sanitizeHold(raw: unknown): Hold {
  const out: Hold = {};
  if (!raw || typeof raw !== "object") return out;
  for (const r of HOLD_STOCK_IDS) {
    const v = (raw as Record<string, unknown>)[r];
    if (typeof v === "number" && Number.isFinite(v) && v > 1e-9) out[r] = v;
  }
  return out;
}

/** Reparte `units` minadas de un asteroide de tipo `kind` según sus rendimientos. */
export function miningYield(kind: AsteroidKind, units: number): Hold {
  const out: Hold = {};
  for (const [r, f] of Object.entries(ASTEROID_KINDS[kind].yields)) out[r as StockId] = units * (f ?? 0);
  return out;
}

/** Suma lo minado a la bodega sin pasar de su capacidad (devuelve la bodega nueva y lo que cupo). */
export function addToHold(hold: Hold, add: Hold, capacity: number = FLAGSHIP_HOLD.capacity): { hold: Hold; added: number } {
  const free = Math.max(0, capacity - holdUsed(hold));
  let total = 0;
  for (const r of HOLD_STOCK_IDS) total += add[r] ?? 0;
  const k = total > free ? free / total : 1;
  const out: Hold = { ...hold };
  for (const r of HOLD_STOCK_IDS) {
    const v = (add[r] ?? 0) * k;
    if (v > 0) out[r] = (out[r] ?? 0) + v;
  }
  return { hold: out, added: total * k };
}

/** Cuerpo vacío (sin masa ni tamaño) de las regiones de espacio profundo: no hay estrella. */
const NO_BODY: CelestialBody = {
  id: "star",
  kind: "star",
  parent: null,
  radius: 0,
  mu: 0,
  surfaceGravityG: 0,
  surfaceGravity: 0,
  massEarth: 0,
  influenceRadius: 0,
  approachAltitude: 0,
  surfaceAltitude: 0,
  atmosphere: null,
  surface: "plasma",
  entry: "none",
  landable: false,
  resources: [],
};

/**
 * Disposición de una región de espacio profundo para el vuelo y la validación:
 * ni estrella ni planetas (sin gravedad), un borde muy lejano y la nave
 * aparcada quieta en el punto de llegada.
 */
export function deepLayout(): SystemLayout {
  return { starRadius: 0, star: NO_BODY, planets: [], belts: [], boundary: DEEP_SPACE.boundaryM, parkMinRadius: 0 };
}
