/**
 * Disposición de un sistema estelar en "unidades de sistema" (us): las
 * distancias están comprimidas para que el sistema se pueda recorrer volando en
 * minutos. Es la misma en el cliente (dibujo y vuelo) y en el servidor
 * (validación). Los planetas giran según la hora del servidor, así que todos
 * los jugadores los ven en el mismo sitio.
 */
import { hashString, Rng, STAR_CLASSES } from "@imperium/procgen";
import type { StarSystemDetail } from "@imperium/shared";

export interface PlanetLayout {
  index: number;
  orbitRadius: number;
  size: number;
  /** Velocidad angular en radianes por segundo. */
  angularSpeed: number;
  phase: number;
}

export interface SystemLayout {
  starRadius: number;
  planets: PlanetLayout[];
  belts: Array<{ orbitRadius: number }>;
  /** Radio del sistema: más allá se sale al espacio interestelar. */
  boundary: number;
}

/** Margen entre el último cuerpo y el borde del sistema. */
const BOUNDARY_MARGIN = 140;

export function systemLayout(detail: StarSystemDetail): SystemLayout {
  const { summary } = detail;
  const info = STAR_CLASSES[summary.starClass];
  const starRadius = summary.starClass === "BH" ? 3.5 : 2.5 + info.mapSize * 2.2;

  // Planetas y cinturones comparten huecos en orden de distancia.
  const bodies = [
    ...detail.planets.map((p) => ({ kind: "planet" as const, orbit: p.orbitAu, planet: p })),
    ...detail.belts.map((b) => ({ kind: "belt" as const, orbit: b.orbitAu })),
  ].sort((a, b) => a.orbit - b.orbit);

  const planets: PlanetLayout[] = [];
  const belts: SystemLayout["belts"] = [];
  let radius = starRadius * 3 + 8;
  for (const body of bodies) {
    if (body.kind === "belt") {
      belts.push({ orbitRadius: radius });
      radius += 9;
      continue;
    }
    const p = body.planet;
    const size = Math.min(6, 1 + p.radius * 0.5);
    planets.push({
      index: p.index,
      orbitRadius: radius,
      size,
      // Más lentos cuanto más lejos (forma de la tercera ley de Kepler).
      angularSpeed: (0.4 / Math.sqrt(radius * radius * radius)) * 6,
      phase: p.phase,
    });
    radius += size * 2 + 7;
  }
  return { starRadius, planets, belts, boundary: Math.max(40, radius) + BOUNDARY_MARGIN };
}

/** Ángulo orbital de un planeta a la hora `serverTimeMs` (milisegundos del servidor). */
export function planetAngle(p: PlanetLayout, serverTimeMs: number): number {
  // Se reduce primero el tiempo a una vuelta para no perder precisión con números enormes.
  const period = (2 * Math.PI) / p.angularSpeed;
  const t = (serverTimeMs / 1000) % period;
  return p.phase + p.angularSpeed * t;
}

/** Posición de un planeta (x, z en el plano orbital; y = 0) a la hora `serverTimeMs`. */
export function planetPosition(p: PlanetLayout, serverTimeMs: number): { x: number; y: number; z: number } {
  const a = planetAngle(p, serverTimeMs);
  return { x: Math.cos(a) * p.orbitRadius, y: 0, z: -Math.sin(a) * p.orbitRadius };
}

/** Semilla estable para los detalles visuales de un sistema (anillos, lunas…). */
export function systemVisualSeed(systemId: string): Rng {
  return new Rng(hashString(systemId));
}
