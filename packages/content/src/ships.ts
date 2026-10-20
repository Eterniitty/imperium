import type { ShipClassDefinition, ShipClassId } from "./types";

/**
 * Clases de nave humanas del MVP. Ritmo de juego en horas: construir y viajar
 * llevan horas reales. Referencia: un sector mide 100 a.l.; un explorador lo
 * cruza en ~8 h, un carguero en ~25 h.
 */
export const SHIP_CLASSES: readonly ShipClassDefinition[] = [
  {
    id: "explorer",
    nameKey: "ship.explorer.name",
    descriptionKey: "ship.explorer.description",
    role: "exploration",
    cost: { metal: 120, volatiles: 80, crystal: 10 },
    buildTimeHours: 2,
    hull: 60,
    attack: 2,
    speedLyPerHour: 12,
    cargo: 20,
    scannerRangeLy: 25,
    upkeepVolatilesPerHour: 1,
    consumedOnUse: false,
  },
  {
    id: "freighter",
    nameKey: "ship.freighter.name",
    descriptionKey: "ship.freighter.description",
    role: "logistics",
    cost: { metal: 200, volatiles: 60, crystal: 0 },
    buildTimeHours: 3,
    hull: 50,
    attack: 0,
    speedLyPerHour: 4,
    cargo: 1000,
    scannerRangeLy: 5,
    upkeepVolatilesPerHour: 2,
    consumedOnUse: false,
  },
  {
    id: "colonizer",
    nameKey: "ship.colonizer.name",
    descriptionKey: "ship.colonizer.description",
    role: "colonization",
    cost: { metal: 600, volatiles: 300, crystal: 40 },
    buildTimeHours: 12,
    hull: 120,
    attack: 0,
    speedLyPerHour: 3,
    cargo: 300,
    scannerRangeLy: 8,
    upkeepVolatilesPerHour: 4,
    consumedOnUse: true,
  },
  {
    id: "frigate",
    nameKey: "ship.frigate.name",
    descriptionKey: "ship.frigate.description",
    role: "combat",
    cost: { metal: 400, volatiles: 150, crystal: 25 },
    buildTimeHours: 6,
    hull: 300,
    attack: 40,
    speedLyPerHour: 7,
    cargo: 40,
    scannerRangeLy: 12,
    upkeepVolatilesPerHour: 3,
    consumedOnUse: false,
  },
];

/** Busca una clase de nave por id. */
export function getShipClass(id: ShipClassId): ShipClassDefinition | undefined {
  return SHIP_CLASSES.find((s) => s.id === id);
}
