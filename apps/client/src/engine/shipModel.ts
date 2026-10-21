import * as THREE from "three";
import { FLAGSHIP_HARDPOINTS, FLAGSHIP_LENGTH_M } from "@imperium/content";
import type { ShipLook } from "./ship/look";
import { assembleShip, templateFor, type ShipRig } from "./ship/rig";

export type { Maneuver, ShipRig } from "./ship/rig";

/**
 * Metros por unidad del grupo de la insignia: el modelo mide
 * `FLAGSHIP_LENGTH_M / SHIP_SCALE` unidades y se escala ×`SHIP_SCALE` (las
 * distancias de los sistemas van en metros). La eslora está en `@imperium/content`.
 */
export const SHIP_SCALE = 10;

export { FLAGSHIP_LENGTH_M };

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
 * (`./ship/`): nave de mando y colonia de 320 m con proa acorazada, puente,
 * dos módulos de hábitat con cubiertas iluminadas y lanzadores de misiles en
 * su proa, hangar ventral, cañones en barquillas, tres toberas principales y
 * dos auxiliares, radiadores, propulsores de maniobra, antenas, plato y luces
 * de navegación. Mira hacia -Z (×`SHIP_SCALE` = `FLAGSHIP_LENGTH_M` metros).
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
