/**
 * Recursos de la nave del Emperador (energía, combustible, munición): reglas
 * puras. Los valores están en `@imperium/content` (FLAGSHIP_SUPPLIES); el
 * servidor es quien los aplica.
 */
import { FLAGSHIP_SUPPLIES as S } from "@imperium/content";

/** Combustible tras `elapsedSec` segundos: por debajo de la reserva de emergencia, se regenera muy despacio. */
export function regenFuel(fuel: number, elapsedSec: number): number {
  if (fuel >= S.emergencyFuelMax || elapsedSec <= 0) return fuel;
  return Math.min(S.emergencyFuelMax, fuel + (S.emergencyFuelPerHour * elapsedSec) / 3600);
}

/** Combustible que cuesta un salto cuántico de `ly` años luz. */
export function quantumFuelCost(ly: number): number {
  return Math.ceil(ly * S.quantumFuelPerLy);
}

/** Alcance del salto cuántico (años luz) con `fuel` unidades de combustible. */
export function quantumRangeLy(fuel: number): number {
  return Math.max(0, fuel) / S.quantumFuelPerLy;
}

/**
 * Munición tras `elapsedSec` segundos de fabricación a bordo: una unidad cada
 * `regenSec`, solo hasta `regenMax`. Devuelve también los segundos sobrantes
 * (la parte de la siguiente unidad ya fabricada) para no perderlos.
 */
export function regenAmmo(ammo: number, elapsedSec: number, regenSec: number, regenMax: number): { ammo: number; carrySec: number } {
  if (ammo >= regenMax || elapsedSec <= 0) return { ammo, carrySec: 0 };
  const gained = Math.floor(elapsedSec / regenSec);
  const next = Math.min(regenMax, ammo + gained);
  return { ammo: next, carrySec: next >= regenMax ? 0 : elapsedSec - gained * regenSec };
}
