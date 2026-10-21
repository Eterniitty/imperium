import { randomInt } from "node:crypto";
import { generateSector } from "@imperium/procgen";
import {
  deepLocation,
  distance,
  parseSystemId,
  worldToSector,
  type StarClass,
  type StarSystemSummary,
  type SystemLocation,
  type Travel,
  type WorldPosition,
} from "@imperium/shared";
import { settle } from "@imperium/sim";

/**
 * Núcleo Humano: los sectores alrededor del origen. Los Emperadores nuevos
 * aparecen aquí, y es también la red de seguridad cuando uno muere sin Cunas.
 */
export const HUMAN_CORE_RADIUS = 1;

/** Estrellas parecidas al Sol: las que la humanidad colonizó primero. */
const SPAWN_STAR_CLASSES: ReadonlySet<StarClass> = new Set(["F", "G", "K"]);

/** Sistemas candidatos a lugar de aparición, en orden estable. */
export function spawnCandidates(universeSeed: number): StarSystemSummary[] {
  const out: StarSystemSummary[] = [];
  const r = HUMAN_CORE_RADIUS;
  for (let x = -r; x <= r; x++)
    for (let y = -r; y <= r; y++)
      for (let z = -r; z <= r; z++)
        for (const s of generateSector(universeSeed, { x, y, z }).systems) {
          if (SPAWN_STAR_CLASSES.has(s.starClass)) out.push(s);
        }
  return out;
}

/** Elige al azar un sistema del Núcleo Humano. `pick(n)` devuelve un entero en [0, n). */
export function pickSpawnSystem(universeSeed: number, pick: (n: number) => number = randomInt): StarSystemSummary {
  const candidates = spawnCandidates(universeSeed);
  const chosen = candidates[pick(candidates.length)];
  if (!chosen) throw new Error("El Núcleo Humano no tiene sistemas donde aparecer");
  return chosen;
}

/** Alta con compañero: entre cuántos sistemas iniciales más cercanos al compañero se elige. */
export const COMPANION_SPAWN_CHOICES = 3;

/**
 * Alta con compañero: un sistema inicial (mismas reglas que `pickSpawnSystem`)
 * de los más cercanos a `near`, al azar entre los `COMPANION_SPAWN_CHOICES`
 * primeros. Si el compañero está fuera del Núcleo, el del Núcleo más próximo.
 */
export function pickSpawnNear(universeSeed: number, near: WorldPosition, pick: (n: number) => number = randomInt): StarSystemSummary {
  const sorted = spawnCandidates(universeSeed)
    .map((s) => ({ s, d: distance(near, s.position) }))
    .sort((a, b) => a.d - b.d || (a.s.id < b.s.id ? -1 : 1));
  const choices = sorted.slice(0, COMPANION_SPAWN_CHOICES);
  const chosen = choices[pick(choices.length)];
  if (!chosen) throw new Error("El Núcleo Humano no tiene sistemas donde aparecer");
  return chosen.s;
}

/** Busca un sistema por su identificador. Devuelve null si no existe en el universo. */
export function findSystem(universeSeed: number, systemId: string): StarSystemSummary | null {
  let parsed: ReturnType<typeof parseSystemId>;
  try {
    parsed = parseSystemId(systemId);
  } catch {
    return null;
  }
  const system = generateSector(universeSeed, parsed.sector).systems[parsed.index];
  // El identificador debe ser exactamente el canónico (sin ceros a la izquierda, "-0", etc.).
  return system && system.id === systemId ? system : null;
}

/**
 * Sistemas a `rangeLy` años luz o menos de `center` (incluido el propio, si
 * está en el centro). Recorre solo los sectores que corta la esfera.
 */
export function systemsInRange(universeSeed: number, center: WorldPosition, rangeLy: number): StarSystemSummary[] {
  const min = worldToSector({ x: center.x - rangeLy, y: center.y - rangeLy, z: center.z - rangeLy });
  const max = worldToSector({ x: center.x + rangeLy, y: center.y + rangeLy, z: center.z + rangeLy });
  const out: StarSystemSummary[] = [];
  for (let x = min.x; x <= max.x; x++)
    for (let y = min.y; y <= max.y; y++)
      for (let z = min.z; z <= max.z; z++)
        for (const s of generateSector(universeSeed, { x, y, z }).systems) {
          if (distance(center, s.position) <= rangeLy) out.push(s);
        }
  return out;
}

export function toLocation(s: StarSystemSummary): SystemLocation {
  return { systemId: s.id, systemName: s.name, position: s.position };
}

/** Forma comparable de un nombre: dos nombres con la misma clave no pueden convivir. */
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("und").replace(/[’]/g, "'");
}

/** Columnas de ubicación y viaje, iguales en Emperadores y flotas. */
export interface PlaceRow {
  id: string;
  systemId: string;
  destSystemId: string | null;
  departAt: Date | null;
  arriveAt: Date | null;
}

/** Ubicación y viaje de una fila, con el viaje ya resuelto si terminó a la hora `now`. */
export function placeFromRow(universeSeed: number, row: PlaceRow, now: number): { location: SystemLocation; travel: Travel | null } {
  const system = findSystem(universeSeed, row.systemId);
  // Un Emperador puede estar en una región de espacio profundo (salió del túnel a mitad de viaje).
  const here = system ? toLocation(system) : deepLocation(row.systemId);
  // Solo pasaría si cambiase la semilla o el generador con datos ya creados.
  if (!here) throw new Error(`${row.id} está en un sistema inexistente: ${row.systemId}`);
  let travel: Travel | null = null;
  if (row.destSystemId && row.departAt && row.arriveAt) {
    const dest = findSystem(universeSeed, row.destSystemId);
    if (!dest) throw new Error(`${row.id} viaja a un sistema inexistente: ${row.destSystemId}`);
    travel = { to: toLocation(dest), departAt: row.departAt.getTime(), arriveAt: row.arriveAt.getTime() };
  }
  return settle({ location: here, travel }, now);
}

/** ¿Está el sistema en el Núcleo Humano? (los sectores alrededor del origen). */
export function inHumanCore(systemId: string): boolean {
  let sector: { x: number; y: number; z: number };
  try {
    sector = parseSystemId(systemId).sector;
  } catch {
    return false;
  }
  const r = HUMAN_CORE_RADIUS;
  return Math.abs(sector.x) <= r && Math.abs(sector.y) <= r && Math.abs(sector.z) <= r;
}
