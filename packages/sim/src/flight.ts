/**
 * Vuelo dentro de un sistema, en metros por segundo. Lo usan el cliente
 * (pilotaje) y el servidor (validar que nadie va más rápido de lo posible).
 */

/** Velocidad normal: para maniobrar y combatir. */
export const PILOT_SPEED = 250;
/** Impulso (Mayús): multiplica la velocidad normal. */
export const PILOT_BOOST = 4;
/**
 * Motor de pulso: para cruzar el sistema entre planetas (como en No Man's Sky).
 * Solo hacia delante, sin disparar, y se apaga cerca de planetas y estrellas.
 */
export const PULSE_SPEED = 30_000;
/** Distancia (en radios del cuerpo) a la que el pulso se apaga solo al acercarse. */
export const PULSE_SAFE_RADII = 4;
export const PILOT_MAX_SPEED = PULSE_SPEED;

/**
 * ¿Es posible ir de `a` a `b` en `dtSeconds`? Con margen para la latencia y
 * los mensajes que llegan agrupados.
 */
export function plausibleMove(a: readonly number[], b: readonly number[], dtSeconds: number): boolean {
  const d = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
  return d <= PILOT_MAX_SPEED * 1.3 * (Math.max(dtSeconds, 0) + 0.35) + 50;
}
