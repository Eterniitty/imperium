import type { StarSystemSummary } from "@imperium/shared";
import { generateSector } from "@imperium/procgen";

/**
 * Sistemas recorriendo sectores en anillos hacia fuera (desde el anillo `from`).
 * Con la galaxia de ~30 000 estrellas (`GENERATOR_VERSION` 3) la mayoría de los
 * sectores están vacíos, así que las pruebas no pueden fijarse en uno concreto.
 */
export function* systemsOutward(seed: number, from = 1, to = 40): Generator<StarSystemSummary> {
  for (let r = from; r <= to; r++)
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
        for (let y = -1; y <= 1; y++) yield* generateSector(seed, { x, y, z }).systems;
      }
}

/** El primer sistema hacia fuera que cumple `pred` (falla si no hay ninguno). */
export function findSystem(seed: number, pred: (s: StarSystemSummary) => boolean, from = 1, to = 40): StarSystemSummary {
  for (const s of systemsOutward(seed, from, to)) if (pred(s)) return s;
  throw new Error("No se encontró ningún sistema que cumpla la condición");
}

/** Los `n` primeros sistemas hacia fuera que cumplen `pred`. */
export function findSystems(seed: number, n: number, pred: (s: StarSystemSummary) => boolean = () => true, from = 1, to = 40): StarSystemSummary[] {
  const out: StarSystemSummary[] = [];
  for (const s of systemsOutward(seed, from, to)) {
    if (pred(s)) out.push(s);
    if (out.length >= n) break;
  }
  return out;
}
