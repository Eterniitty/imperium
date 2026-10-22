/**
 * Disposición de un sistema estelar en metros de la simulación (escala física):
 * estrella, planetas con sus lunas, cinturones y borde. Las cifras salen de la
 * configuración centralizada `WORLD_SCALE` (`@imperium/content` bodies.ts) y de
 * lo que generó el universo; nada se fija aquí a mano.
 *
 * Jerarquía: nave (20–620 m; la insignia, 320 m) ≪ luna (4–35 km) < planeta (20–350 km) ≪
 * estrella (1600–14 000 km; enanas blancas y de neutrones, menos). Las órbitas se comprimen con la raíz de la
 * distancia real y nunca solapan las esferas de influencia de dos cuerpos.
 *
 * Es la misma en el cliente (dibujo y vuelo) y en el servidor (validación). Los
 * planetas y las lunas giran según la hora del servidor, así que todos los ven
 * en el mismo sitio. No cambia lo generado (no hace falta subir
 * `GENERATOR_VERSION`): es la capa de presentación y de física.
 */
import { WORLD_SCALE } from "@imperium/content";
import { hashString, Rng } from "@imperium/procgen";
import { GALAXY, type PlanetType, type StarClass, type StarSystemDetail, type StarSystemSummary } from "@imperium/shared";
import { moonRadiusEarth, rockyBody, starBody, type CelestialBody } from "./bodies";
import type { PulseBody } from "./flight";

export { planetRadiusM } from "./bodies";

const S = WORLD_SCALE;

export interface MoonLayout {
  index: number;
  type: PlanetType;
  body: CelestialBody;
  /** Radio de la órbita alrededor del planeta (m). */
  orbitRadius: number;
  angularSpeed: number;
  phase: number;
  /** Inclinación de la órbita respecto al plano del sistema (rad). */
  inclination: number;
}

export interface PlanetLayout {
  index: number;
  /** Radio de la órbita, en metros. */
  orbitRadius: number;
  /** Radio del planeta, en metros (= `body.radius`). */
  size: number;
  /** Velocidad angular en radianes por segundo. */
  angularSpeed: number;
  phase: number;
  body: CelestialBody;
  moons: MoonLayout[];
  /** Rotación sobre su eje (rad/s). */
  spin: number;
}

export interface SystemLayout {
  /** Radio de la estrella, en metros. */
  starRadius: number;
  star: CelestialBody;
  planets: PlanetLayout[];
  belts: Array<{ orbitRadius: number; halfWidth: number }>;
  /** Radio del sistema (m): más allá se sale al espacio interestelar. */
  boundary: number;
  /** Distancia mínima a la estrella de una nave aparcada (su esfera de influencia). */
  parkMinRadius: number;
  /** Clase de la estrella (calor, horizonte de sucesos); sin ella (espacio profundo), no hay estrella. */
  starClass?: StarClass;
  /** Ónfalo: el agujero negro supermasivo del centro de la galaxia. */
  supermassive?: boolean;
}

/** Número en [0, 1) estable para una clave. */
function unit(key: string): number {
  return hashString(key) / 4294967296;
}

/** Velocidad orbital (m/s) a `radius` metros de la estrella: Kepler (v ∝ r^-½), muy lenta. */
function orbitSpeed(radius: number): number {
  return S.orbitSpeedRefMs * Math.sqrt(S.orbitSpeedRefRadiusM / Math.max(radius, 1000));
}

/**
 * Periodo orbital (segundos) a `radius` metros de la estrella: ley de Kepler
 * (T ∝ r^1,5), común a planetas y naves aparcadas.
 */
export function orbitalPeriodS(radius: number): number {
  const r = Math.max(radius, 1000);
  return (2 * Math.PI * r) / orbitSpeed(r);
}

function moonsOf(systemId: string, planetIndex: number, type: PlanetType, radiusEarth: number, planetRadius: number, count: number, kinds: PlanetType[]): MoonLayout[] {
  const out: MoonLayout[] = [];
  let first = 0;
  let prev: MoonLayout | null = null;
  for (let i = 0; i < count; i++) {
    const key = `${systemId}:${planetIndex}:m${i}`;
    const re = moonRadiusEarth(type, radiusEarth, unit(`${key}:r`));
    const body = rockyBody(`p${planetIndex}m${i}`, "moon", `p${planetIndex}`, kinds[i]!, re);
    // Cada luna, más allá de la anterior: separación en radios del planeta más los radios de las dos lunas.
    const orbitRadius = prev
      ? prev.orbitRadius + prev.body.radius + body.radius + planetRadius * S.moonOrbitSpacingRadii * (0.85 + 0.3 * unit(`${key}:o`))
      : planetRadius * S.moonFirstOrbitRadii + body.radius;
    if (i === 0) first = orbitRadius;
    const v = S.moonOrbitSpeedMs * Math.sqrt(first / orbitRadius);
    out.push({
      index: i,
      type: kinds[i]!,
      body,
      orbitRadius,
      angularSpeed: v / orbitRadius,
      phase: unit(`${key}:p`) * Math.PI * 2,
      inclination: (unit(`${key}:i`) - 0.5) * 0.3,
    });
    prev = out[out.length - 1]!;
  }
  return out;
}

export function systemLayout(detail: StarSystemDetail): SystemLayout {
  const { summary } = detail;
  const supermassive = isGalacticCore(summary);
  const star = starBody(summary.starClass, supermassive);
  const starRadius = star.radius;

  // Planetas y cinturones comparten huecos en orden de distancia. La distancia
  // crece con la raíz de la real (UA) y nunca solapa dos esferas de influencia.
  const bodies = [
    ...detail.planets.map((p) => ({ kind: "planet" as const, orbit: p.orbitAu, planet: p })),
    ...detail.belts.map((b) => ({ kind: "belt" as const, orbit: b.orbitAu })),
  ].sort((a, b) => a.orbit - b.orbit);

  const planets: PlanetLayout[] = [];
  const belts: SystemLayout["belts"] = [];
  let edge = star.influenceRadius;
  for (const item of bodies) {
    const wanted = star.influenceRadius + S.auM * Math.pow(Math.max(item.orbit, 0.01), S.orbitExponent);
    if (item.kind === "belt") {
      const radius = Math.max(wanted, edge + S.orbitGapM + S.beltHalfWidthM);
      belts.push({ orbitRadius: radius, halfWidth: S.beltHalfWidthM });
      edge = radius + S.beltHalfWidthM;
      continue;
    }
    const p = item.planet;
    const body = rockyBody(`p${p.index}`, "planet", "star", p.type, p.radius);
    const moons = moonsOf(summary.id, p.index, p.type, p.radius, body.radius, p.moons.length, p.moons.map((m) => m.type));
    const last = moons[moons.length - 1];
    if (last) body.influenceRadius = Math.max(body.influenceRadius, (last.orbitRadius + last.body.influenceRadius) * 1.2);
    const radius = Math.max(wanted, edge + S.orbitGapM + body.influenceRadius);
    const [h0, h1] = S.spinHours;
    const spinHours = h0 + (h1 - h0) * unit(`${summary.id}:${p.index}:spin`);
    planets.push({
      index: p.index,
      orbitRadius: radius,
      size: body.radius,
      angularSpeed: (2 * Math.PI) / orbitalPeriodS(radius),
      phase: p.phase,
      body,
      moons,
      spin: (2 * Math.PI) / (spinHours * 3600),
    });
    edge = radius + body.influenceRadius;
  }
  return { starRadius, star, planets, belts, boundary: Math.max(edge, starRadius * 6) + S.boundaryMarginM, parkMinRadius: star.influenceRadius, starClass: summary.starClass, ...(supermassive ? { supermassive: true } : {}) };
}

/** Ángulo orbital de un planeta a la hora `serverTimeMs` (milisegundos del servidor). */
export function planetAngle(p: PlanetLayout, serverTimeMs: number): number {
  // Se reduce primero el tiempo a una vuelta para no perder precisión con números enormes.
  const period = (2 * Math.PI) / p.angularSpeed;
  const t = (serverTimeMs / 1000) % period;
  return p.phase + p.angularSpeed * t;
}

/** Giro del planeta sobre su eje a la hora `serverTimeMs` (rad). */
export function planetSpinAngle(p: PlanetLayout, serverTimeMs: number): number {
  const period = (2 * Math.PI) / p.spin;
  return p.spin * ((serverTimeMs / 1000) % period);
}

/** Posición de un planeta (x, z en el plano orbital; y = 0) a la hora `serverTimeMs`. */
export function planetPosition(p: PlanetLayout, serverTimeMs: number): { x: number; y: number; z: number } {
  const a = planetAngle(p, serverTimeMs);
  return { x: Math.cos(a) * p.orbitRadius, y: 0, z: -Math.sin(a) * p.orbitRadius };
}

/** Posición de una luna respecto a su planeta (m) a la hora `serverTimeMs`. */
export function moonOffset(m: MoonLayout, serverTimeMs: number): { x: number; y: number; z: number } {
  const period = (2 * Math.PI) / m.angularSpeed;
  const a = m.phase + m.angularSpeed * ((serverTimeMs / 1000) % period);
  const x = Math.cos(a) * m.orbitRadius;
  const z0 = -Math.sin(a) * m.orbitRadius;
  return { x, y: -z0 * Math.sin(m.inclination), z: z0 * Math.cos(m.inclination) };
}

/** Semilla estable para los detalles visuales de un sistema (anillos…). */
export function systemVisualSeed(systemId: string): Rng {
  return new Rng(hashString(systemId));
}

/** Cuerpo físico en un instante: su esfera (para el pulso y las colisiones) y sus propiedades. */
export interface PlacedBody extends PulseBody {
  body: CelestialBody;
}

/** Estrella, planetas y lunas con su posición a la hora `serverTimeMs` (pulso, gravedad, colisiones, validación). */
export function bodiesAt(layout: SystemLayout, serverTimeMs: number): PlacedBody[] {
  const out: PlacedBody[] = [{ center: [0, 0, 0], radius: layout.starRadius, body: layout.star }];
  for (const p of layout.planets) {
    const c = planetPosition(p, serverTimeMs);
    out.push({ center: [c.x, c.y, c.z], radius: p.size, body: p.body });
    for (const m of p.moons) {
      const o = moonOffset(m, serverTimeMs);
      out.push({ center: [c.x + o.x, c.y + o.y, c.z + o.z], radius: m.body.radius, body: m.body });
    }
  }
  return out;
}

/** ¿Es Ónfalo, el agujero negro supermasivo del centro de la galaxia? */
export function isGalacticCore(summary: Pick<StarSystemSummary, "starClass" | "name" | "position">): boolean {
  const c = GALAXY.center;
  return summary.starClass === "BH" && summary.name === GALAXY.centerName && Math.abs(summary.position.x - c.x) < 1 && Math.abs(summary.position.z - c.z) < 1;
}
