import * as THREE from "three";
import { FLAGSHIP_HARDPOINTS } from "@imperium/content";
import type { ShipLook } from "./ship/look";
import { assembleShip, templateFor, type ShipRig } from "./ship/rig";

export type { Maneuver, ShipRig } from "./ship/rig";

/** El modelo mide ~4,6 unidades de largo: a escala ×10, la nave mide unos 46 m (las distancias de los sistemas van en metros). */
export const SHIP_SCALE = 10;

/** Eslora de la nave insignia, en metros. */
export const FLAGSHIP_LENGTH_M = 46;

const FLAGSHIP_LOOK: ShipLook = {
  classId: "__flagship",
  style: "human",
  model: { lengthM: FLAGSHIP_LENGTH_M, hullShape: "needle", engines: 3 },
  hardpoints: FLAGSHIP_HARDPOINTS,
  primary: 0xb4bac2,
  secondary: 0x2a2f37,
  emissive: 0x8fdcff,
};

/**
 * Nave insignia del Emperador, generada por código con el kit de módulos
 * (`./ship/`): corbeta de mando con proa acorazada, puente en rendija,
 * barquillas laterales con lanzadores y motores auxiliares, tres toberas
 * principales, radiadores, propulsores de maniobra, antenas, plato y luces de
 * navegación. Mira hacia -Z y mide 4,6 unidades (×`SHIP_SCALE` = 46 m).
 * `accent`: morado la propia, otros colores las ajenas.
 */
export function createFlagship(accent: THREE.ColorRepresentation): THREE.Group {
  return assembleShip(templateFor(FLAGSHIP_LOOK, "flagship"), { accent: new THREE.Color(accent).getHex(), unit: SHIP_SCALE });
}

/** Control de animación, maniobra y bocas de fuego de una nave (insignia o de clase). */
export function shipRig(ship: THREE.Object3D): ShipRig {
  return ship.userData.rig as ShipRig;
}

/** Libera lo propio de una nave (lo compartido se conserva). */
export function disposeShip(ship: THREE.Object3D): void {
  (ship.userData.dispose as (() => void) | undefined)?.();
}
