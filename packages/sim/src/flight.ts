/**
 * Vuelo dentro de un sistema, en unidades de sistema (us) por segundo. Lo usan
 * el cliente (pilotaje) y el servidor (validar que nadie va más rápido).
 */
export const PILOT_SPEED = 18;
export const PILOT_BOOST = 5;
export const PILOT_MAX_SPEED = PILOT_SPEED * PILOT_BOOST;

/**
 * ¿Es posible ir de `a` a `b` en `dtSeconds`? Con margen para la latencia y
 * los mensajes que llegan agrupados.
 */
export function plausibleMove(a: readonly number[], b: readonly number[], dtSeconds: number): boolean {
  const d = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
  return d <= PILOT_MAX_SPEED * 1.3 * (Math.max(dtSeconds, 0) + 0.35) + 2;
}
