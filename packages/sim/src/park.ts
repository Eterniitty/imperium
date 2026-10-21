/**
 * Nave aparcada: cuando nadie la pilota, la nave del Emperador no se queda
 * clavada en el espacio, sino que orbita la estrella con la misma ley que los
 * planetas (`orbitalPeriodS` en systemLayout.ts). Su posición se calcula a
 * partir de dónde estaba a una hora dada y de la hora del servidor, así que el
 * servidor (combate, visibilidad) y todos los clientes la ven en el mismo sitio.
 */
import { WORLD_SCALE } from "@imperium/content";
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
 * en el hueco entre la esfera de influencia del primer planeta y la del
 * siguiente cuerpo (o fuera de la de la estrella), siempre en el mismo lado.
 * Hora de referencia 0: desde entonces orbita como cualquier otra.
 */
export function defaultPark(layout: SystemLayout): ParkedOrbit {
  const first = layout.planets[0];
  const r = first ? first.orbitRadius + first.body.influenceRadius + WORLD_SCALE.orbitGapM / 2 : layout.parkMinRadius * 1.5;
  const d = Math.hypot(0.2, 0.15, 1);
  const k = r / d;
  return { p: [0.2 * k, 0.15 * k, 1 * k], at: 0 };
}

/**
 * Una nave no se queda aparcada dentro de la esfera de influencia de la
 * estrella: se lleva hacia fuera en la misma dirección. También corrige las
 * órbitas guardadas con la escala anterior (sistemas de pocos miles de km),
 * sin migrar la base de datos.
 */
export function sanitizePark(layout: SystemLayout, park: ParkedOrbit): ParkedOrbit {
  const [x, y, z] = park.p;
  const d = Math.hypot(x, y, z);
  const min = layout.parkMinRadius * 1.05;
  if (d >= min) return park;
  if (d < 1) return { p: [0, 0, min], at: park.at };
  const k = min / d;
  return { p: [x * k, y * k, z * k], at: park.at };
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
