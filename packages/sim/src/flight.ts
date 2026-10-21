/**
 * Vuelo dentro de un sistema, en metros por segundo. Lo usan el cliente
 * (pilotaje) y el servidor (validar que nadie va más rápido de lo posible).
 */

import { FLIGHT_MODEL } from "@imperium/content";

/** Velocidad normal: para maniobrar y combatir (`FLIGHT_MODEL` en `@imperium/content`). */
export const PILOT_SPEED = FLIGHT_MODEL.maxSpeed;
/** Impulso (Mayús): multiplica la velocidad normal. */
export const PILOT_BOOST = FLIGHT_MODEL.boostFactor;

/**
 * Motor de pulso, al estilo del supercrucero de Elite: solo hacia delante y sin
 * disparar. Se puede encender siempre, también junto a un planeta. Su velocidad
 * máxima depende de la distancia al cuerpo más cercano (cerca, cientos de m/s;
 * en el espacio abierto, hasta `PULSE_MAX_SPEED`) y de si se va hacia él o se
 * aleja. Acelera y frena de forma suave, nunca a saltos.
 */
export const PULSE_MIN_SPEED = 300;
export const PULSE_MAX_SPEED = 2_000_000;
/**
 * Segundos "hasta la superficie" que deja el límite al ir de frente hacia un
 * cuerpo: la velocidad máxima es la distancia entre este tiempo. Así la nave
 * frena sola al acercarse, como una aproximación exponencial.
 */
export const PULSE_APPROACH_SEC = 3;
/** Al alejarse de un cuerpo (de espaldas a él), el límite se multiplica hasta por este valor. */
export const PULSE_RECEDE_FACTOR = 7;
/** Crecimiento máximo de la velocidad del pulso por segundo (proporcional: 0,55 = +55 % por segundo). */
export const PULSE_ACCEL_RATE = 0.55;
/** Aceleración mínima (m/s²) del pulso, para arrancar desde poca velocidad. */
export const PULSE_ACCEL_MIN = 400;
/** Rapidez con la que el pulso frena hasta su límite (1/s): suave pero firme. */
export const PULSE_BRAKE_RATE = 2;
export const PILOT_MAX_SPEED = PULSE_MAX_SPEED;

/**
 * Velocidad máxima del pulso con un cuerpo a `clearance` metros de su
 * superficie. `closing` es el coseno entre el rumbo y la dirección hacia el
 * cuerpo: 1 si se va de frente hacia él, -1 si se aleja de espaldas.
 */
export function pulseSpeedLimit(clearance: number, closing: number): number {
  const c = Math.min(1, Math.max(-1, closing));
  const factor = 1 + ((PULSE_RECEDE_FACTOR - 1) / 2) * (1 - c);
  const v = (Math.max(0, clearance) * factor) / PULSE_APPROACH_SEC;
  return Math.min(PULSE_MAX_SPEED, Math.max(PULSE_MIN_SPEED, v));
}

/** Nueva velocidad del pulso tras `dt` segundos: sube con aceleración limitada y baja de forma suave hacia el límite. */
export function stepPulseSpeed(current: number, limit: number, dt: number): number {
  if (current < limit) return Math.min(limit, current + Math.max(PULSE_ACCEL_MIN, current * PULSE_ACCEL_RATE) * dt);
  return limit + (current - limit) * Math.exp(-PULSE_BRAKE_RATE * dt);
}

/** Cuerpo esférico (estrella o planeta) para calcular el límite del pulso. */
export interface PulseBody {
  center: readonly number[];
  radius: number;
}

/**
 * Límite del pulso en `pos` con rumbo `heading` (unitario), según el cuerpo que
 * más lo restrinja. Con `heading` null se toma el caso más permisivo (alejándose):
 * es el que usa el servidor para validar.
 */
export function pulseLimitAt(pos: readonly number[], heading: readonly number[] | null, bodies: readonly PulseBody[]): number {
  let limit = PULSE_MAX_SPEED;
  for (const b of bodies) {
    const dx = b.center[0]! - pos[0]!;
    const dy = b.center[1]! - pos[1]!;
    const dz = b.center[2]! - pos[2]!;
    const d = Math.hypot(dx, dy, dz);
    const closing = heading && d > 0 ? (dx * heading[0]! + dy * heading[1]! + dz * heading[2]!) / d : -1;
    limit = Math.min(limit, pulseSpeedLimit(d - b.radius, closing));
  }
  return limit;
}

/**
 * ¿Es posible ir de `a` a `b` en `dtSeconds`? Con margen para la latencia y
 * los mensajes que llegan agrupados. `maxSpeed` es la velocidad más alta
 * posible en ese punto (por defecto, la del pulso en el espacio abierto).
 */
export function plausibleMove(a: readonly number[], b: readonly number[], dtSeconds: number, maxSpeed = PILOT_MAX_SPEED): boolean {
  const d = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
  return d <= maxSpeed * 1.3 * (Math.max(dtSeconds, 0) + 0.35) + 50;
}
