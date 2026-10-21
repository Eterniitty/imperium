/**
 * Nave aparcada: cuando nadie la pilota, la nave del Emperador no se queda
 * clavada en el espacio, sino que orbita la estrella con la misma ley que los
 * planetas (`orbitalPeriodS` en systemLayout.ts). Su posición se calcula a
 * partir de dónde estaba a una hora dada y de la hora del servidor, así que el
 * servidor (combate, visibilidad) y todos los clientes la ven en el mismo sitio.
 */
import { orbitalPeriodS, type SystemLayout } from "./systemLayout";

export type Vec3Like = readonly [number, number, number];

/** Dónde estaba la nave aparcada (metros) a la hora `at` (milisegundos del servidor). */
export interface ParkedOrbit {
  p: Vec3Like;
  at: number;
}

/**
 * Posición de la nave aparcada a la hora `t`. Gira alrededor del eje vertical
 * de la estrella (en el mismo sentido que los planetas) conservando su altura.
 */
export function parkedPosition(park: ParkedOrbit, t: number): [number, number, number] {
  const [x, y, z] = park.p;
  const r = Math.hypot(x, z);
  if (r < 1) return [x, y, z];
  // La velocidad depende de la distancia a la estrella (no solo de la proyección en el plano).
  const period = orbitalPeriodS(Math.hypot(x, y, z));
  // Se reduce a una vuelta antes de multiplicar para no perder precisión con tiempos enormes.
  const dt = ((t - park.at) / 1000) % period;
  const a = Math.atan2(-z, x) + (2 * Math.PI * dt) / period;
  return [Math.cos(a) * r, y, -Math.sin(a) * r];
}

/** Velocidad orbital (m/s) de una nave aparcada a la hora `t` (para interpolar en los clientes). */
export function parkedVelocity(park: ParkedOrbit, t: number): [number, number, number] {
  const [x, y, z] = parkedPosition(park, t);
  if (Math.hypot(x, z) < 1) return [0, 0, 0];
  const w = (2 * Math.PI) / orbitalPeriodS(Math.hypot(x, y, z));
  // Derivada de (cos a·r, y, −sin a·r) respecto al tiempo con a' = w.
  return [z * w, 0, -x * w];
}

/**
 * Dónde aparca una nave que no ha volado nunca en el sistema (o que renace):
 * junto a la órbita del primer planeta (o cerca de la estrella), siempre en el
 * mismo lado. Hora de referencia 0: desde entonces orbita como cualquier otra.
 */
export function defaultPark(layout: SystemLayout): ParkedOrbit {
  const first = layout.planets[0]?.orbitRadius ?? layout.starRadius * 5;
  const d = Math.hypot(0.2, 0.15, 1);
  const k = (first * 1.15) / d;
  return { p: [0.2 * k, 0.15 * k, 1 * k], at: 0 };
}

/** Fracción del radio del sistema a la que aparece una nave que llega de un salto. */
export const ARRIVAL_EDGE = 0.97;

/**
 * Dónde aparece una nave que llega de un salto: en el borde del sistema de
 * destino, del lado por el que llega (`fromDir`: dirección desde la estrella de
 * destino hacia la de origen, en coordenadas de la galaxia; no hace falta que
 * sea unitaria). Orbita desde la hora de llegada.
 */
export function arrivalPark(layout: SystemLayout, fromDir: Vec3Like, arriveAt: number): ParkedOrbit {
  const l = Math.hypot(fromDir[0], fromDir[1], fromDir[2]);
  const d: Vec3Like = l > 0 ? [fromDir[0] / l, fromDir[1] / l, fromDir[2] / l] : [0, 0, 1];
  const r = layout.boundary * ARRIVAL_EDGE;
  return { p: [d[0] * r, d[1] * r, d[2] * r], at: arriveAt };
}
