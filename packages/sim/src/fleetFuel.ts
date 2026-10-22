/**
 * Combustible de las naves de flota (reglas puras; datos en `FLEET_FUEL` de
 * `@imperium/content`). El combustible de cada nave se mide en años luz de
 * alcance; `null` en la base de datos es «depósito lleno».
 */
import { FLEET_FUEL, fleetFuelMax, getShipClass, type ShipClassId } from "@imperium/content";
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
