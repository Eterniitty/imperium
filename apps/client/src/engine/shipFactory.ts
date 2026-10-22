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
import { getHull, getPart, type PartKind, type ShipArchetype } from "@imperium/content";
import type { ShipDesignSnapshot } from "@imperium/shared";
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

/**
 * Aspecto de una nave del Astillero (fase E5): el de la clase base de su casco
 * con lo que dicen sus piezas: motores (propulsión y cuántico), torretas (sus
 * armas, en cascos grandes), contenedores (bodegas), hangar, anillo de hábitat
 * y plato de sensores. Null si el casco no existe.
 */
export function designLook(design: Pick<ShipDesignSnapshot, "hullId" | "parts">): ShipLook | null {
  const hull = getHull(design.hullId);
  const base = hull ? lookOf(hull.baseClass) : null;
  if (!hull || !base) return null;
  const parts = Object.values(design.parts).map((id) => getPart(id)).filter((p) => p !== undefined);
  const count = (k: PartKind) => parts.filter((p) => p.kind === k).length;
  const has = (id: string) => parts.some((p) => p.id === id);
  const big = hull.class === "L" || hull.class === "XL";
  const key = Object.entries(design.parts)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([slot, part]) => `${slot}=${part}`)
    .join(",");
  return {
    ...base,
    classId: `design:${hull.id}:${key}`,
    model: {
      ...base.model,
      engines: Math.max(1, count("thruster") + (count("quantum") > 0 ? 1 : 0)),
      ...(big ? { turrets: count("weapon") } : {}),
      pods: count("cargo") * 2 || undefined,
      hangar: count("hangar") > 0 || undefined,
      habitat: has("life_m") || undefined,
      dish: has("sensor_m") || undefined,
    },
  };
}

/** Modelo 3D de una nave del Astillero (ver `designLook`). */
export function createDesignModel(design: Pick<ShipDesignSnapshot, "hullId" | "parts">, opts: ShipModelOptions = {}): THREE.Group | null {
  const look = designLook(design);
  return look ? create(look, opts) : null;
}
