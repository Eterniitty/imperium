/**
 * Disposición de un sistema estelar en metros, a escala de las naves (estilo No
 * Man's Sky): la nave del Emperador mide unos 45 m, un planeta rocoso varios
 * kilómetros de radio, un gigante gaseoso decenas y una estrella cientos. Las
 * distancias entre planetas están comprimidas (cientos o miles de km, no
 * millones) para cruzarlas con el motor de pulso en menos de un minuto.
 *
 * Es la misma en el cliente (dibujo y vuelo) y en el servidor (validación). Los
 * planetas giran según la hora del servidor, así que todos los ven en el mismo sitio.
 */
import { hashString, Rng, STAR_CLASSES } from "@imperium/procgen";
import type { PlanetType, StarSystemDetail } from "@imperium/shared";
import type { PulseBody } from "./flight";

export interface PlanetLayout {
  index: number;
  /** Radio de la órbita, en metros. */
  orbitRadius: number;
  /** Radio del planeta, en metros. */
  size: number;
  /** Velocidad angular en radianes por segundo. */
  angularSpeed: number;
  phase: number;
}

export interface SystemLayout {
  /** Radio de la estrella, en metros. */
  starRadius: number;
  planets: PlanetLayout[];
  belts: Array<{ orbitRadius: number }>;
  /** Radio del sistema (m): más allá se sale al espacio interestelar. */
  boundary: number;
}

const KM = 1000;
/** Margen entre el último cuerpo y el borde del sistema. */
const BOUNDARY_MARGIN = 600 * KM;
/** Periodo orbital de referencia: un planeta a 1000 km da una vuelta en 3 días reales. */
const PERIOD_AT_1000_KM = 3 * 24 * 3600;

/** Radio de un planeta en metros. `radius` es el del generador (radios terrestres). */
export function planetRadiusM(type: PlanetType, radius: number): number {
  const base = type === "gas_giant" || type === "ice_giant" ? 4200 : 5000;
  return Math.max(1500, base * Math.pow(Math.max(radius, 0.2), 0.8));
}

export function systemLayout(detail: StarSystemDetail): SystemLayout {
  const { summary } = detail;
  const info = STAR_CLASSES[summary.starClass];
  const starRadius = summary.starClass === "BH" ? 60 * KM : 80 * KM + info.mapSize * 45 * KM;

  // Planetas y cinturones comparten huecos en orden de distancia. La distancia
  // crece con la raíz de la real (UA) y nunca deja a dos cuerpos demasiado cerca.
  const bodies = [
    ...detail.planets.map((p) => ({ kind: "planet" as const, orbit: p.orbitAu, planet: p })),
    ...detail.belts.map((b) => ({ kind: "belt" as const, orbit: b.orbitAu })),
  ].sort((a, b) => a.orbit - b.orbit);

  const planets: PlanetLayout[] = [];
  const belts: SystemLayout["belts"] = [];
  let prev = starRadius * 3;
  let prevSize = 0;
  for (const body of bodies) {
    const size = body.kind === "planet" ? planetRadiusM(body.planet.type, body.planet.radius) : 0;
    const wanted = starRadius * 4 + 700 * KM * Math.sqrt(Math.max(body.orbit, 0.01));
    const radius = Math.max(wanted, prev + prevSize * 8 + size * 8 + 60 * KM);
    if (body.kind === "belt") {
      belts.push({ orbitRadius: radius });
    } else {
      const period = PERIOD_AT_1000_KM * Math.pow(radius / (1000 * KM), 1.5);
      planets.push({ index: body.planet.index, orbitRadius: radius, size, angularSpeed: (2 * Math.PI) / period, phase: body.planet.phase });
    }
    prev = radius;
    prevSize = size;
  }
  return { starRadius, planets, belts, boundary: Math.max(prev, starRadius * 6) + BOUNDARY_MARGIN };
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

/** Estrella y planetas como esferas a la hora `serverTimeMs` (para el límite del pulso y la validación). */
export function bodiesAt(layout: SystemLayout, serverTimeMs: number): PulseBody[] {
  const out: PulseBody[] = [{ center: [0, 0, 0], radius: layout.starRadius }];
  for (const p of layout.planets) {
    const c = planetPosition(p, serverTimeMs);
    out.push({ center: [c.x, c.y, c.z], radius: p.size });
  }
  return out;
}
