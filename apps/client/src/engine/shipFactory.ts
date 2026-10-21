/**
 * Generador paramétrico de naves (sin archivos): construye cualquier nave
 * humana, de los Carroñeros o de las especies alienígenas a partir de sus
 * pistas de modelo de `@imperium/content` (eslora, receta, motores, torretas,
 * contenedores, hangar…) y del estilo de su facción. Las bocas de fuego son las
 * de los datos (`combat.hardpoints`, las mismas con las que dispara el
 * servidor): los cañones y lanzadores se dibujan justo ahí.
 *
 * El kit de módulos y las recetas están en `./ship/` (kit.ts, human.ts,
 * alien.ts); materiales y texturas procedurales compartidos en materials.ts y
 * textures.ts; el montaje y la animación (`ShipRig`) en rig.ts.
 *
 * Rendimiento: cada clase se genera una vez y sus piezas se fusionan en una
 * geometría por material (pocas llamadas de dibujo); las naves de la misma
 * clase comparten geometrías y materiales. Tres niveles de detalle (THREE.LOD)
 * según la distancia en esloras: completo, casco simplificado y una silueta
 * mínima con su halo.
 */
import * as THREE from "three";
import type { ShipArchetype } from "@imperium/content";
import { lookOf, type ShipLook } from "./ship/look";
import { assembleShip, templateFor } from "./ship/rig";

export { lookOf, type ShipLook } from "./ship/look";
export type { ShipStyle } from "./ship/materials";
export { SHIP_LOD } from "./ship/rig";

export interface ShipModelOptions {
  /** Color de acento (franjas y bocas) de las naves humanas; por defecto, azul. */
  accent?: THREE.ColorRepresentation;
  /** Sin niveles de detalle (miniaturas): siempre el completo. */
  noLod?: boolean;
}

function create(look: ShipLook, opts: ShipModelOptions, recipe?: ShipArchetype): THREE.Group {
  const accent = new THREE.Color(opts.accent ?? (look.style === "human" ? 0x4fa8ff : look.emissive)).getHex();
  return assembleShip(templateFor(look, recipe), { accent, noLod: opts.noLod });
}

/**
 * Crea el modelo de una clase de nave, a escala real (metros), mirando hacia
 * -Z, con su `ShipRig` (empuje, maniobra, balanceo y bocas de fuego) en
 * `userData.rig`. Null si la clase no existe.
 */
export function createShipModel(classId: string, opts: ShipModelOptions = {}): THREE.Group | null {
  const look = lookOf(classId);
  return look ? create(look, opts) : null;
}

/**
 * Nave humana de una familia de diseño sin clase propia todavía (p. ej. los
 * mineros), para vistas previas y futuras clases. Sin armas.
 */
export function createArchetypeModel(archetype: ShipArchetype, lengthM: number, opts: ShipModelOptions & { engines?: number; pods?: number } = {}): THREE.Group {
  const look: ShipLook = {
    classId: `archetype:${archetype}:${lengthM}`,
    style: "human",
    model: { archetype, lengthM, hullShape: archetype === "transport" || archetype === "miner" ? "pod" : "needle", engines: opts.engines ?? 2, pods: opts.pods },
    hardpoints: { cannon: [], missile: [] },
    primary: 0xb4bac2,
    secondary: 0x2a2f37,
    emissive: 0x8fdcff,
  };
  return create(look, opts, archetype);
}

/** Eslora (m) de una clase de nave, o null si no existe. */
export function shipLength(classId: string): number | null {
  return lookOf(classId)?.model.lengthM ?? null;
}
