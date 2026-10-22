/**
 * Ratón atrapado al pilotar con ratón: el navegador bloquea el puntero (no se
 * sale de la ventana ni del círculo de mando) y el cursor pasa a ser virtual.
 * Mientras dura, `lockedPointer` guarda dónde está ese cursor (píxeles de la
 * ventana) para que clics, selección y disparos usen su posición. Esc lo suelta.
 */
export const lockedPointer = { active: false, x: 0, y: 0 };

/** Dónde está el puntero de un evento: el cursor virtual si está bloqueado. */
export function pointerXY(e: { clientX: number; clientY: number }): { x: number; y: number } {
  return lockedPointer.active ? { x: lockedPointer.x, y: lockedPointer.y } : { x: e.clientX, y: e.clientY };
}
