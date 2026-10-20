import { randomInt } from "node:crypto";
import { generateSector } from "@imperium/procgen";
import { parseSystemId, type EmperorLocation, type StarClass, type StarSystemSummary } from "@imperium/shared";

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

export function toLocation(s: StarSystemSummary): EmperorLocation {
  return { systemId: s.id, systemName: s.name, position: s.position };
}

/** Forma comparable de un nombre: dos nombres con la misma clave no pueden convivir. */
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("und").replace(/[’]/g, "'");
}
