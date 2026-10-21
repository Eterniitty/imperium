/**
 * Dónde esperan las flotas propias paradas en un sistema: el cliente las dibuja
 * ahí y el servidor lo usa para comprobar el acople en una nave nodriza. Junto
 * a la colonia propia de menor índice (fuera de su planeta) o, sin colonia, en
 * la órbita de aparcamiento por defecto; cada flota, a un lado de ese punto.
 */
import { defaultPark, parkedPosition } from "./park";
import { planetPosition, type SystemLayout } from "./systemLayout";

export function fleetRallyPoint(layout: SystemLayout, colonyPlanetIndex: number | null, now: number): [number, number, number] {
  const planet = colonyPlanetIndex === null ? undefined : layout.planets.find((p) => p.index === colonyPlanetIndex);
  if (planet) {
    const c = planetPosition(planet, now);
    const d = Math.hypot(c.x, c.z) || 1;
    const off = planet.size * 2.5 + 6000;
    return [c.x - (c.x / d) * off, c.y + planet.size * 0.6, c.z - (c.z / d) * off];
  }
  const p = parkedPosition(defaultPark(layout), now);
  return [p[0], p[1], p[2]];
}

/** Posición de la flota `i` (0, 1… por número de flota) alrededor del punto de reunión. */
export function fleetSlotPosition(rally: readonly number[], i: number): [number, number, number] {
  const a = i * 1.1;
  return [rally[0]! + Math.cos(a) * 1500 * (i + 1), rally[1]! + 300 * i, rally[2]! + Math.sin(a) * 1500 * (i + 1)];
}
