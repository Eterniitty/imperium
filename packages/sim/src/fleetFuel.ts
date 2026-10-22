/**
 * Combustible de las naves de flota (reglas puras; datos en `FLEET_FUEL` de
 * `@imperium/content`). El combustible de cada nave se mide en años luz de
 * alcance; `null` en la base de datos es «depósito lleno».
 */
import { anyFleetSpeedLyPerHour, FLEET_FUEL, fleetFuelMax, getShipClass, TRAVEL_SPEED_SCALE, type ShipClassId } from "@imperium/content";
import { designStats, type ShipDesign } from "./shipDesign";

export interface FuelShip {
  classId: string;
  hull?: number;
  fuel?: number | null;
  design?: ShipDesign | null;
}

/** Alcance con el depósito lleno: el de su clase, o el del diseño (sin motor cuántico, 0: no viaja entre estrellas). */
export function shipFuelMax(s: FuelShip): number {
  if (s.design) return designStats(s.design).jumpRangeLy ?? 0;
  return fleetFuelMax(s.classId);
}

/** Combustible actual (a.l.). */
export function shipFuel(s: FuelShip): number {
  const max = shipFuelMax(s);
  return s.fuel === null || s.fuel === undefined ? max : Math.min(max, Math.max(0, s.fuel));
}

/** Alcance de la flota: el de la nave con menos combustible. */
export function fleetRangeLy(ships: readonly FuelShip[]): number {
  return ships.length ? Math.min(...ships.map(shipFuel)) : 0;
}

/** Volátiles que cuesta llenar el depósito de una nave. */
export function refuelCost(s: FuelShip): number {
  const missing = shipFuelMax(s) - shipFuel(s);
  const hull = s.design ? designStats(s.design).hull : (getShipClass(s.classId as ShipClassId)?.hull ?? 100);
  return Math.ceil(missing * FLEET_FUEL.volatilesPerLy * (hull / 100));
}

/**
 * Velocidad entre estrellas de una flota (a.l./h, sin la tecnología): la de su
 * nave más lenta. Las del Astillero van a la de su motor cuántico (sin él no
 * viajan, pero el combustible ya lo impide); las de serie, a la de su clase.
 */
export function fleetTravelSpeed(ships: ReadonlyArray<{ classId: string; design?: ShipDesign | null }>): number {
  let speed = Infinity;
  for (const s of ships) {
    const v = s.design ? (designStats(s.design).riftLyPerHour ?? 0) * TRAVEL_SPEED_SCALE : anyFleetSpeedLyPerHour([s.classId]);
    speed = Math.min(speed, v > 0 ? v : Infinity);
  }
  return Number.isFinite(speed) ? speed : anyFleetSpeedLyPerHour(ships.map((s) => s.classId));
}
