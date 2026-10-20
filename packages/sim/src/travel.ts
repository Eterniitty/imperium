/**
 * Reglas del viaje de un Emperador entre sistemas. Funciones puras: las usan el
 * servidor (fuente de verdad) y el cliente (para dibujar el movimiento sin
 * recibir posiciones a cada fotograma).
 *
 * No hay un bucle que mueva a nadie: el viaje se guarda como origen, destino y
 * horas de salida y llegada, y la posición se calcula al consultarla.
 */
import { distance, type Emperor, type WorldPosition } from "@imperium/shared";

const HOUR_MS = 3_600_000;

/** Duración mínima de un viaje: evita viajes instantáneos entre sistemas casi pegados. */
export const MIN_TRAVEL_MS = 1_000;

/** Milisegundos que se tarda en recorrer la distancia entre dos puntos a `speedLyPerHour`. */
export function travelDurationMs(from: WorldPosition, to: WorldPosition, speedLyPerHour: number): number {
  return Math.max(MIN_TRAVEL_MS, Math.ceil((distance(from, to) / speedLyPerHour) * HOUR_MS));
}

/** ¿Está viajando en el instante `now` (milisegundos)? */
export function isTravelling(e: Pick<Emperor, "travel">, now: number): boolean {
  return e.travel !== null && e.travel.arriveAt > now;
}

/** Posición en el instante `now`: interpolación lineal entre origen y destino. */
export function positionAt(e: Pick<Emperor, "location" | "travel">, now: number): WorldPosition {
  const t = e.travel;
  if (!t) return e.location.position;
  if (now >= t.arriveAt) return t.to.position;
  if (now <= t.departAt) return e.location.position;
  const k = (now - t.departAt) / (t.arriveAt - t.departAt);
  const a = e.location.position;
  const b = t.to.position;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

/** Si el viaje ya terminó, el Emperador pasa a estar en el destino y sin viaje. */
export function settle<T extends Pick<Emperor, "location" | "travel">>(e: T, now: number): T {
  if (!e.travel || e.travel.arriveAt > now) return e;
  return { ...e, location: e.travel.to, travel: null };
}
