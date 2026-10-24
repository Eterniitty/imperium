/**
 * Entorno del vuelo cerca de los mundos de Aeon (Era II, estilizado): la nave
 * que entra en la zona de influencia de un mundo o una luna se mueve con él (y,
 * dentro de la atmósfera, gira con él), cae hacia su centro, frena con el aire y
 * se posa en el suelo. Así se puede aterrizar sin que el planeta se escape.
 *
 * Se aplica después de flightStep, en el mismo paso. Lo calculan igual el
 * servidor y el cliente de Unreal (port en aeonarch-ue/Core/include/aeon/environment.h,
 * con vectores al bit). Posiciones en metros respecto a la estrella, tiempo en ms.
 * El suelo es el relieve del servidor (escala de relieve 1), el mismo que se dibuja.
 */
import { AEON_ENVIRONMENT, AEON_WORLDS, type AeonWorld } from "@imperium/content";
import { cosSinTurns, terrainHeight, type TerrainParams } from "@imperium/procgen";
import type { FlightState, Vec3 } from "./aeonFlight";
import { aeonTerrainParams, moonTerrainParams } from "./aeonParcels";
import { moonOffsetKm, spinTurns, worldPositionKm } from "./aeonOrbits";

export interface EnvBody {
  id: string;
  kind: "rocky" | "gas" | "moon";
  /** Índice del planeta de una luna (−1 en los mundos). */
  parent: number;
  radiusM: number;
  atmosphereM: number;
  gravity: number;
  orbitKm: number;
  orbitPeriodH: number;
  /** Día en minutos (0: acoplado); las lunas no giran (null). */
  dayLengthMin: number | null;
  terrain: TerrainParams | null;
  hasSea: boolean;
}

export type EnvParams = typeof AEON_ENVIRONMENT;

/** Los cuerpos del sistema en orden fijo: cada mundo seguido de sus lunas. */
export function envBodies(worlds: readonly AeonWorld[] = AEON_WORLDS, p: EnvParams = AEON_ENVIRONMENT): EnvBody[] {
  const out: EnvBody[] = [];
  for (const w of worlds) {
    const index = out.length;
    out.push({
      id: w.id,
      kind: w.kind,
      parent: -1,
      radiusM: w.radiusKm * 1000,
      atmosphereM: w.atmosphereKm * 1000,
      gravity: w.kind === "gas" ? p.gravityGas : p.gravityRocky,
      orbitKm: w.orbitKm,
      orbitPeriodH: w.orbitPeriodH,
      dayLengthMin: w.dayLengthMin,
      terrain: aeonTerrainParams(w),
      hasSea: !!w.sea,
    });
    for (const m of w.moons) {
      out.push({
        id: m.id,
        kind: "moon",
        parent: index,
        radiusM: m.radiusKm * 1000,
        atmosphereM: 0,
        gravity: p.gravityMoon,
        orbitKm: m.orbitKm,
        orbitPeriodH: m.orbitPeriodH,
        dayLengthMin: null,
        terrain: moonTerrainParams(m),
        hasSea: false,
      });
    }
  }
  return out;
}

/** Centro del cuerpo en metros respecto a la estrella. */
export function bodyCenterM(bodies: readonly EnvBody[], index: number, tMs: number): Vec3 {
  const b = bodies[index]!;
  if (b.parent < 0) {
    const [x, y, z] = worldPositionKm(b, tMs);
    return [x * 1000, y * 1000, z * 1000];
  }
  const c = bodyCenterM(bodies, b.parent, tMs);
  const [x, y, z] = moonOffsetKm(b, tMs);
  return [c[0] + x * 1000, c[1] + y * 1000, c[2] + z * 1000];
}

/** Giro del cuerpo sobre su eje z, en vueltas (0 en las lunas). */
export function bodySpinTurns(b: EnvBody, tMs: number): number {
  return b.dayLengthMin === null ? 0 : spinTurns({ id: b.id, orbitPeriodH: b.orbitPeriodH, dayLengthMin: b.dayLengthMin }, tMs);
}

/** Radio del suelo en la dirección unitaria d (en los ejes del propio cuerpo), sin la distancia de seguridad. */
export function groundRadiusM(b: EnvBody, d: Vec3, p: EnvParams = AEON_ENVIRONMENT): number {
  if (b.kind === "gas") return b.radiusM * (1 - p.gasFloorDepth);
  if (!b.terrain) return b.radiusM;
  const h = terrainHeight(b.terrain, d[0], d[1], d[2]);
  return b.radiusM + (b.hasSea && h < 0 ? 0 : h);
}

/** Cuerpo cuya zona de influencia contiene la posición; si hay varios, el más pequeño (la luna antes que su planeta). −1 si ninguno. */
export function dominantBody(bodies: readonly EnvBody[], pos: Vec3, tMs: number, p: EnvParams = AEON_ENVIRONMENT): number {
  let best = -1;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!;
    const c = bodyCenterM(bodies, i, tMs);
    const dx = pos[0] - c[0], dy = pos[1] - c[1], dz = pos[2] - c[2];
    const reach = b.radiusM * p.influenceRadii;
    if (dx * dx + dy * dy + dz * dz < reach * reach && (best < 0 || b.radiusM < bodies[best]!.radiusM)) best = i;
  }
  return best;
}

/**
 * Tope del crucero a una altura sobre el suelo (el altitudeM del último paso):
 * frena solo al acercarse a un mundo. 0 (sin tope) en el espacio abierto.
 */
export function cruiseCapFor(altitudeM: number, maxSpeed: number, p: EnvParams = AEON_ENVIRONMENT): number {
  if (!(altitudeM < Infinity)) return 0;
  const cap = altitudeM * p.cruisePerAltitude;
  return cap > maxSpeed ? cap : maxSpeed;
}

export interface EnvResult {
  state: FlightState;
  /** Cuerpo dominante (−1: espacio abierto). */
  body: number;
  /** Altura sobre el suelo, en metros (Infinity sin cuerpo). */
  altitudeM: number;
  /** Densidad del aire, 0..1. */
  density: number;
  /** ¿Posada en el suelo en este paso? */
  landed: boolean;
}

const rotZ = (v: Vec3, c: number, s: number): Vec3 => [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];

/**
 * Entorno del paso de tMs a tMs + dt·1000 (después de flightStep): arrastre con
 * el cuerpo, gravedad, aire y suelo.
 */
export function environmentStep(
  bodies: readonly EnvBody[],
  state: FlightState,
  tMs: number,
  dt: number,
  p: EnvParams = AEON_ENVIRONMENT,
): EnvResult {
  const body = dominantBody(bodies, state.pos, tMs, p);
  if (body < 0) return { state, body, altitudeM: Infinity, density: 0, landed: false };
  const b = bodies[body]!;
  const t1 = tMs + dt * 1000;
  const c0 = bodyCenterM(bodies, body, tMs);
  const c1 = bodyCenterM(bodies, body, t1);
  let offset: Vec3 = [state.pos[0] - c0[0], state.pos[1] - c0[1], state.pos[2] - c0[2]];
  let vel: Vec3 = state.vel;
  const r = Math.sqrt(offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2]);
  const top = b.radiusM + b.atmosphereM;
  const spin1 = bodySpinTurns(b, t1);

  // Dentro de la atmósfera, la nave gira con el cuerpo (el aire va con el suelo).
  if (b.atmosphereM > 0 && r < top && b.dayLengthMin !== null) {
    const [c, s] = cosSinTurns(spin1 - bodySpinTurns(b, tMs));
    offset = rotZ(offset, c, s);
    vel = rotZ(vel, c, s);
  }

  // Gravedad hacia el centro, que baja con el cuadrado de la distancia.
  if (r > 0) {
    const a = (b.gravity * ((b.radiusM * b.radiusM) / (r * r)) * dt) / r;
    vel = [vel[0] - offset[0] * a, vel[1] - offset[1] * a, vel[2] - offset[2] * a];
  }

  // Aire: densidad 1 en la superficie y 0 en lo alto de la atmósfera.
  let density = 0;
  if (b.atmosphereM > 0 && r < top) density = r <= b.radiusM ? 1 : 1 - (r - b.radiusM) / b.atmosphereM;
  if (density > 0) {
    const keep = 1 - Math.min(1, dt * p.drag * density);
    vel = [vel[0] * keep, vel[1] * keep, vel[2] * keep];
  }

  // Suelo: el relieve está en los ejes del cuerpo (girado spin1 alrededor de z).
  let landed = false;
  let altitudeM = Infinity;
  if (r > 0) {
    const [c, s] = cosSinTurns(-spin1);
    const d: Vec3 = [offset[0] / r, offset[1] / r, offset[2] / r];
    const local = rotZ(d, c, s);
    const ground = groundRadiusM(b, local, p);
    altitudeM = r - ground;
    const floor = ground + p.clearanceM;
    if (r < floor) {
      offset = [d[0] * floor, d[1] * floor, d[2] * floor];
      altitudeM = p.clearanceM;
      const radial = vel[0] * d[0] + vel[1] * d[1] + vel[2] * d[2];
      if (radial < 0) vel = [vel[0] - d[0] * radial, vel[1] - d[1] * radial, vel[2] - d[2] * radial];
      landed = true;
    }
  }

  const pos: Vec3 = [c1[0] + offset[0], c1[1] + offset[1], c1[2] + offset[2]];
  return { state: { ...state, pos, vel }, body, altitudeM, density, landed };
}
