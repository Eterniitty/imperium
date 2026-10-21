/**
 * Limitador global de destellos (fotosensibilidad; la pauta WCAG 2.3.1 pide no
 * pasar de tres destellos por segundo). Cada destello grande pide aquí su
 * intensidad: los que nacen casi a la vez (una explosión son varios sprites)
 * cuentan como uno; a partir del tercero en un segundo, los siguientes salen
 * muy atenuados. Vale para todos los efectos de la escena (combate, grietas).
 */
const WINDOW_MS = 1000;
const MAX_PER_WINDOW = 3;
/** Destellos que nacen dentro de este margen forman un solo destello. */
const GROUP_MS = 120;
/** Intensidad de los que pasan del tope. */
const DIMMED = 0.18;
/** Por debajo de este tamaño (m) un destello es un chispazo pequeño y no cuenta (bocas de fuego). */
export const FLASH_MIN_SIZE = 30;
/** Tiempo de subida (s): ningún destello pasa de apagado a lleno de golpe. */
export const FLASH_ATTACK_SEC = 0.06;

let events: number[] = [];
let groupAt = -Infinity;
let groupGain = 1;

/** Intensidad (0–1) para un destello que nace ahora. */
export function flashGain(size: number, now = performance.now()): number {
  if (size < FLASH_MIN_SIZE) return 1;
  if (now - groupAt < GROUP_MS) return groupGain;
  events = events.filter((t) => now - t < WINDOW_MS);
  groupAt = now;
  if (events.length >= MAX_PER_WINDOW) return (groupGain = DIMMED);
  events.push(now);
  return (groupGain = 1);
}

/** Envolvente de un destello: sube en `FLASH_ATTACK_SEC` (o antes si dura muy poco) y se apaga con `fall`. */
export function flashEnvelope(age: number, life: number, fall: number): number {
  return Math.min(1, age / Math.min(FLASH_ATTACK_SEC, life * 0.3)) * fall;
}
