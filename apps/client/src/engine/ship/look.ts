/** Aspecto de una clase de nave: estilo de su facción, pistas de modelo, bocas de fuego y colores. */
import * as THREE from "three";
import { getAlienShipClass, getShipClass, getSpecies, type ShipClassId, type ShipHardpoints, type ShipModelHints } from "@imperium/content";
import type { ShipStyle } from "./materials";

export interface ShipLook {
  classId: string;
  style: ShipStyle;
  model: ShipModelHints;
  hardpoints: ShipHardpoints;
  primary: number;
  secondary: number;
  emissive: number;
}

/** Aspecto de una clase de nave (humana o alienígena), o null si no existe. */
export function lookOf(classId: string): ShipLook | null {
  const human = getShipClass(classId as ShipClassId);
  if (human) {
    return {
      classId,
      style: "human",
      model: human.model,
      hardpoints: human.combat.hardpoints ?? { cannon: [], missile: [] },
      primary: 0xb4bac2,
      secondary: 0x2a2f37,
      emissive: 0x8fdcff,
    };
  }
  const alien = getAlienShipClass(classId);
  const species = alien && getSpecies(alien.speciesId);
  if (!alien || !species) return null;
  const c = (hex: string) => new THREE.Color(hex).getHex();
  return {
    classId,
    style: species.visual.silhouette,
    model: alien.model,
    hardpoints: alien.combat.hardpoints ?? { cannon: [], missile: [] },
    primary: c(species.visual.primaryColor),
    secondary: c(species.visual.secondaryColor),
    emissive: c(species.visual.emissiveColor),
  };
}
