/**
 * Gravedad de la simulación (versión controlada para el MVP). Antes de esto no
 * había gravedad en el juego: la nave aparcada orbita la estrella sobre raíles
 * (park.ts) y los planetas y lunas, también (systemLayout.ts).
 *
 * Cuatro cosas distintas, que no hay que mezclar:
 * - **Atracción** (`gravityAt`): aceleración μ·r/(r² + ε²)^{3/2} hacia el
 *   centro de cada cuerpo, solo dentro de su **esfera de influencia** (con una
 *   transición suave en el último 25 %) y suavizada cerca del centro (ε) para
 *   no tener singularidad. Fuera de toda esfera (espacio profundo) no hay
 *   gravedad: no se cae hacia un planeta desde cualquier distancia. Dentro de la
 *   esfera de un planeta solo atraen él y sus lunas cercanas; dentro de la de la
 *   estrella, solo ella (las esferas no se solapan por construcción).
 * - **Gravedad superficial** (`CelestialBody.surfaceGravity`): μ / R², la que
 *   notará un aterrizaje futuro; recortada a `WORLD_SCALE.maxSimGravity`.
 * - **Estabilidad orbital**: las órbitas de planetas, lunas y naves aparcadas
 *   son analíticas (sobre raíles, ley de Kepler), no integradas: no se
 *   desestabilizan nunca. La nave pilotada sí se integra (semi-implícito, en
 *   subpasos fijos) y puede orbitar si lleva la velocidad adecuada.
 * - **Asistencia gravitatoria** (efecto honda): no se modela; con planetas que
 *   se mueven a decenas de m/s su efecto sería despreciable. La asistencia de
 *   vuelo de la nave compensa la atracción con los propulsores solo en parte.
 *
 * El pulso (supercrucero) ignora la gravedad: su «pozo» es el límite de
 * velocidad según la distancia a los cuerpos (flight.ts).
 */
import type { CelestialBody } from "./bodies";

export type GravityRegion = "deep" | "approach" | "surface";

/** Cuerpo con su centro en un instante (lo que devuelve `bodiesAt`). */
export interface GravitySource {
  center: readonly number[];
  body: CelestialBody;
}

export interface GravitySample {
  /** Aceleración (m/s², mundo). */
  acc: [number, number, number];
  /** Módulo de la aceleración (m/s²). */
  g: number;
  /** Cuerpo dominante (el de menor esfera de influencia que contiene el punto) o null en espacio profundo. */
  dominant: CelestialBody | null;
  region: GravityRegion;
  /** Altura sobre la superficie del cuerpo dominante (m), o null. */
  altitude: number | null;
}

/** Suavizado cerca del centro, en radios del cuerpo (siempre dentro del cuerpo: solo evita la singularidad). */
export const GRAVITY_SOFTENING_RADII = 0.1;
/** Fracción exterior de la esfera de influencia en la que la atracción se desvanece suavemente. */
export const GRAVITY_FADE = 0.25;

/** Factor (0–1) de la atracción a distancia `d` de un cuerpo con esfera `soi`. */
function fade(d: number, soi: number): number {
  if (d >= soi) return 0;
  const x = Math.min(1, (soi - d) / (soi * GRAVITY_FADE));
  return x * x * (3 - 2 * x);
}

export function gravityAt(pos: readonly number[], bodies: readonly GravitySource[]): GravitySample {
  const acc: [number, number, number] = [0, 0, 0];
  let dominant: CelestialBody | null = null;
  let domDist = 0;
  for (const s of bodies) {
    const b = s.body;
    const dx = s.center[0]! - pos[0]!;
    const dy = s.center[1]! - pos[1]!;
    const dz = s.center[2]! - pos[2]!;
    const d2 = dx * dx + dy * dy + dz * dz;
    const d = Math.sqrt(d2);
    if (d >= b.influenceRadius) continue;
    if (!dominant || b.influenceRadius < dominant.influenceRadius) {
      dominant = b;
      domDist = d;
    }
    const eps = b.radius * GRAVITY_SOFTENING_RADII;
    const r2 = d2 + eps * eps;
    const k = (b.mu * fade(d, b.influenceRadius)) / (r2 * Math.sqrt(r2));
    acc[0] += dx * k;
    acc[1] += dy * k;
    acc[2] += dz * k;
  }
  const altitude = dominant ? domDist - dominant.radius : null;
  const region: GravityRegion = !dominant ? "deep" : altitude! < dominant.surfaceAltitude ? "surface" : "approach";
  return { acc, g: Math.hypot(acc[0], acc[1], acc[2]), dominant, region, altitude };
}

/**
 * Cota de la velocidad que puede ganar una nave cayendo hasta `pos` desde el
 * borde de las esferas de influencia que lo contienen (conservación de la
 * energía): la usa el servidor para no rechazar a quien cae sin asistencia.
 */
export function gravitySpeedBound(pos: readonly number[], bodies: readonly GravitySource[]): number {
  let total = 0;
  for (const s of bodies) {
    const b = s.body;
    const d = Math.hypot(s.center[0]! - pos[0]!, s.center[1]! - pos[1]!, s.center[2]! - pos[2]!);
    if (d >= b.influenceRadius) continue;
    const r = Math.max(d, b.radius);
    total += Math.sqrt(Math.max(0, 2 * b.mu * (1 / r - 1 / b.influenceRadius)));
  }
  return total;
}

/** Velocidad de una órbita circular (m/s) a `r` metros del centro de un cuerpo (con el suavizado, sin la atenuación del borde). */
export function circularOrbitSpeed(body: CelestialBody, r: number): number {
  const eps = body.radius * GRAVITY_SOFTENING_RADII;
  const r2 = r * r + eps * eps;
  return Math.sqrt((body.mu * r * r) / (r2 * Math.sqrt(r2)));
}
