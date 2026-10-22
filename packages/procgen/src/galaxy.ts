/**
 * Forma de la galaxia (`GALAXY` en `@imperium/shared`): densidad de estrellas
 * en cada punto, de 0 (fuera del disco) a 1 (bulbo y brazos). Determinista: solo
 * `+ - * / sqrt` (regla 3); el ángulo, el logaritmo y el coseno de los brazos
 * espirales son aproximaciones aritméticas, de sobra para dar forma.
 */
import { GALAXY, SECTOR_SIZE, type SectorCoord } from "@imperium/shared";

const PI = 3.141592653589793;

/** atan2 aproximado (error < 0,005 rad). */
export function approxAtan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const a = ax > ay ? ay / ax : ax / ay;
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = PI / 2 - r;
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}

/** Logaritmo natural aproximado (x > 0): reducción a [1, 2) y serie de atanh. */
export function approxLn(x: number): number {
  let k = 0;
  while (x >= 2) {
    x /= 2;
    k++;
  }
  while (x < 1) {
    x *= 2;
    k--;
  }
  const t = (x - 1) / (x + 1);
  const t2 = t * t;
  const series = 2 * t * (1 + t2 * (1 / 3 + t2 * (1 / 5 + t2 * (1 / 7 + t2 / 9))));
  return k * 0.6931471805599453 + series;
}

/** Coseno aproximado: reducción a [-π, π] y polinomio de Taylor (error < 0,001). */
export function approxCos(x: number): number {
  const twoPi = 2 * PI;
  x = x - twoPi * Math.floor(x / twoPi + 0.5);
  // Simetría: cos(x) = -cos(π - |x|) para |x| > π/2.
  let sign = 1;
  if (x < 0) x = -x;
  if (x > PI / 2) {
    x = PI - x;
    sign = -1;
  }
  const x2 = x * x;
  return sign * (1 - x2 / 2 + (x2 * x2) / 24 - (x2 * x2 * x2) / 720 + (x2 * x2 * x2 * x2) / 40320);
}

function smoothstep(a: number, b: number, v: number): number {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Radio (desde el centro, en el plano) donde está el Núcleo Humano: ahí pasa un brazo. */
const CORE_R = Math.sqrt(GALAXY.center.x * GALAXY.center.x + GALAXY.center.z * GALAXY.center.z);
const CORE_THETA = approxAtan2(-GALAXY.center.z, -GALAXY.center.x);

/** Densidad de la galaxia en un punto (años luz), de 0 a 1. */
export function galaxyDensityAt(x: number, y: number, z: number): number {
  const dx = x - GALAXY.center.x;
  const dy = y - GALAXY.center.y;
  const dz = z - GALAXY.center.z;
  const r = Math.sqrt(dx * dx + dz * dz);
  const R = GALAXY.radius;
  // Bulbo: esfera densa alrededor del agujero negro.
  const d3 = Math.sqrt(r * r + dy * dy) / GALAXY.bulgeRadius;
  const bulge = 1 / ((1 + d3 * d3) * (1 + d3 * d3));
  if (r > R) return bulge > 1 ? 1 : bulge;
  // Disco: cae hacia el borde y se apaga del todo en el radio.
  const q = r / GALAXY.diskScale;
  const disk = (1 / (1 + q * q)) * (1 - smoothstep(R * 0.82, R, r));
  // Grosor que se ensancha hacia fuera.
  const h = GALAXY.scaleHeight * (1 + (0.6 * r) / R);
  const v = dy / h;
  const thin = 1 / ((1 + v * v) * (1 + v * v));
  // Brazos: espirales logarítmicas, una de ellas por el Núcleo Humano.
  let arm = 1;
  if (r > 1) {
    const theta = approxAtan2(dz, dx);
    const phase = GALAXY.arms * (theta - CORE_THETA - GALAXY.armWind * approxLn(r / CORE_R));
    const c = (1 + approxCos(phase)) / 2;
    const c2 = c * c;
    // Los brazos se marcan fuera del bulbo; dentro, todo es denso.
    const armness = smoothstep(GALAXY.bulgeRadius * 0.8, GALAXY.bulgeRadius * 2.2, r);
    arm = 1 - armness + armness * (GALAXY.interArm + (1 - GALAXY.interArm) * c2 * c2);
  }
  const total = disk * thin * arm * 1.45 + bulge;
  return total > 1 ? 1 : total < 0 ? 0 : total;
}

/** Densidad de la galaxia en el centro de un sector. */
export function galaxyDensity(c: SectorCoord): number {
  const h = SECTOR_SIZE / 2;
  return galaxyDensityAt(c.x * SECTOR_SIZE + h, c.y * SECTOR_SIZE + h, c.z * SECTOR_SIZE + h);
}

/** Sector del agujero negro supermasivo. */
export const GALAXY_CENTER_SECTOR: SectorCoord = {
  x: Math.floor(GALAXY.center.x / SECTOR_SIZE),
  y: Math.floor(GALAXY.center.y / SECTOR_SIZE),
  z: Math.floor(GALAXY.center.z / SECTOR_SIZE),
};
