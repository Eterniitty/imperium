/**
 * Generador paramétrico de naves (sin archivos): construye cualquier nave
 * humana, de los Carroñeros o de las especies alienígenas a partir de sus
 * pistas de modelo de `@imperium/content` (eslora, forma del casco, motores,
 * alas, torretas, contenedores, hangar…) y del estilo de su facción (humano o
 * la silueta de su especie, con sus colores). Las bocas de fuego son las de los
 * datos (`combat.hardpoints`, las mismas con las que dispara el servidor): los
 * cañones y lanzadores se dibujan justo ahí.
 *
 * Rendimiento: cada clase se genera una vez y sus piezas se fusionan en una
 * geometría por material (pocas llamadas de dibujo); las naves de la misma
 * clase comparten geometrías y materiales. Tres niveles de detalle (THREE.LOD)
 * según la distancia en esloras: completo, casco simplificado y una silueta
 * mínima con su halo.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  getAlienShipClass,
  getShipClass,
  getSpecies,
  HULL_PROPORTIONS,
  TURRET_BARREL,
  type ShipClassId,
  type ShipHardpoints,
  type ShipModelHints,
  type Silhouette,
} from "@imperium/content";
import type { WeaponKind } from "@imperium/shared";
import { panelTexture, type ShipRig } from "./shipModel";
import { glowTexture } from "./textures";

/** Estilo visual: el humano o la silueta de una especie. */
export type ShipStyle = "human" | Silhouette;

/** Todo lo que el generador necesita de una clase de nave. */
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
      primary: 0xdfe5ee,
      secondary: 0x343c4e,
      emissive: 0x7fdcff,
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

// --- Construcción de piezas (coordenadas normalizadas: eslora 1, morro en z = -0,5) ---

type Slot = "hull" | "dark" | "trim" | "glow" | "glass" | "aura";
const SLOTS: Slot[] = ["hull", "dark", "trim", "glow", "glass", "aura"];

/** Generador de números con semilla (mismo aspecto siempre para la misma clase). */
function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deja la geometría en el formato común para fusionar: sin índices, con posición, normal y uv. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position!.count * 2), 2));
  out.clearGroups();
  return out;
}

interface Placement {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number];
}

class Parts {
  readonly full: Record<Slot, THREE.BufferGeometry[]> = { hull: [], dark: [], trim: [], glow: [], glass: [], aura: [] };
  readonly coarse: Record<Slot, THREE.BufferGeometry[]> = { hull: [], dark: [], trim: [], glow: [], glass: [], aura: [] };
  /** Motores: posición de la tobera y radio (para las llamas y los halos). */
  readonly engines: Array<{ p: THREE.Vector3; r: number }> = [];
  /** Luces que parpadean (posición y color). */
  readonly lights: Array<{ p: THREE.Vector3; color: number }> = [];

  /** Añade una pieza; `coarse` la incluye también en el nivel de detalle medio. */
  add(slot: Slot, g: THREE.BufferGeometry, at: Placement = {}, coarse = false): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(at.p ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(at.r ?? [0, 0, 0]))),
      new THREE.Vector3(...(at.s ?? [1, 1, 1])),
    );
    const geo = prep(g).applyMatrix4(m);
    this.full[slot].push(geo);
    if (coarse) this.coarse[slot].push(geo);
  }

  /** Caja entre dos puntos (para pilones, vigas y radios). */
  beam(slot: Slot, a: THREE.Vector3, b: THREE.Vector3, thickness: number, coarse = false): void {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-5) return;
    const g = new THREE.BoxGeometry(thickness, thickness, len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.add(slot, g, { p: [mid.x, mid.y, mid.z], r: [e.x, e.y, e.z] }, coarse);
  }
}

/** Torno: perfil (radio hasta 0,5; avance de la popa -0,5 al morro +0,5) con el morro hacia -Z. */
function lathe(profile: Array<[number, number]>, segments = 18): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, f]) => new THREE.Vector2(r, f)),
    segments,
  );
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Tronco de pirámide de sección cuadrada (proas), apuntando a -Z, de largo `len`, con `tip` de la sección de la base. */
function prow(width: number, height: number, len: number, tip: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.7071 * tip, 0.7071, len, 4, 1);
  g.rotateY(Math.PI / 4);
  g.rotateX(-Math.PI / 2);
  g.scale(width, height, 1);
  return g;
}

/** Casco principal según su forma. Devuelve la «cola» (z de la popa) para poner los motores. */
function buildHull(parts: Parts, look: ShipLook, rnd: () => number): number {
  const { width: W, height: H } = HULL_PROPORTIONS[look.model.hullShape];
  const organic = look.style === "organic";
  const deform = (g: THREE.BufferGeometry) => {
    if (!organic) return g;
    // Bultos orgánicos: desplaza los vértices con ondas fijas por clase.
    const pos = g.attributes.position!;
    const k1 = 6 + rnd() * 6;
    const k2 = 4 + rnd() * 5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const f = 1 + 0.12 * Math.sin(z * k1 * Math.PI + x * 9) * Math.cos(y * k2 * 7 + z * 5);
      pos.setXYZ(i, x * f, y * f, z);
    }
    g.computeVertexNormals();
    return g;
  };
  switch (look.model.hullShape) {
    case "needle":
      parts.add("hull", deform(lathe([[0, -0.5], [0.32, -0.48], [0.45, -0.35], [0.5, -0.1], [0.42, 0.15], [0.25, 0.35], [0.08, 0.48], [0, 0.5]])), { s: [W, H, 1] }, true);
      return 0.49;
    case "spindle":
      parts.add("hull", deform(lathe([[0, -0.5], [0.2, -0.42], [0.42, -0.22], [0.5, 0], [0.42, 0.22], [0.2, 0.42], [0, 0.5]])), { s: [W, H, 1] }, true);
      return 0.44;
    case "pod":
      parts.add("hull", deform(lathe([[0, -0.5], [0.3, -0.48], [0.45, -0.42], [0.5, -0.3], [0.5, 0.3], [0.45, 0.42], [0.3, 0.48], [0, 0.5]])), { s: [W, H, 1] }, true);
      return 0.49;
    case "wedge": {
      const shape = new THREE.Shape();
      const w = W / 2;
      shape.moveTo(0, -0.5);
      shape.lineTo(w * 0.35, -0.2);
      shape.lineTo(w, 0.38);
      shape.lineTo(w * 0.8, 0.5);
      shape.lineTo(-w * 0.8, 0.5);
      shape.lineTo(-w, 0.38);
      shape.lineTo(-w * 0.35, -0.2);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: H * 0.7, bevelEnabled: true, bevelThickness: H * 0.15, bevelSize: 0.01, bevelSegments: 1 });
      g.rotateX(Math.PI / 2);
      g.translate(0, H * 0.35, 0);
      parts.add("hull", deform(g), {}, true);
      // Lomo elevado en el centro.
      parts.add("hull", prow(W * 0.3, H * 0.5, 0.6, 0.3), { p: [0, H * 0.45, 0.1] }, true);
      return 0.5;
    }
    case "brick":
      parts.add("hull", new THREE.BoxGeometry(W, H, 0.82), { p: [0, 0, 0.09] }, true);
      parts.add("hull", prow(W, H, 0.18, 0.55), { p: [0, 0, -0.41] }, true);
      return 0.5;
    case "monolith":
      parts.add("hull", new THREE.BoxGeometry(W, H, 0.76), { p: [0, 0, 0.12] }, true);
      parts.add("hull", prow(W, H, 0.26, 0.12), { p: [0, 0, -0.39] }, true);
      // Puente de mando escalonado en la popa.
      parts.add("hull", new THREE.BoxGeometry(W * 0.5, H * 0.5, 0.18), { p: [0, H * 0.7, 0.32] }, true);
      parts.add("hull", new THREE.BoxGeometry(W * 0.32, H * 0.4, 0.1), { p: [0, H * 1.1, 0.34] }, true);
      return 0.5;
    case "disc": {
      parts.add("hull", deform(new THREE.CylinderGeometry(0.5, 0.46, H * 0.5, 40)), {}, true);
      const dome = new THREE.SphereGeometry(0.3, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      parts.add("hull", dome, { s: [1, H * 2.2, 1], p: [0, H * 0.2, 0] }, true);
      parts.add("dark", new THREE.CylinderGeometry(0.38, 0.3, H * 0.3, 32), { p: [0, -H * 0.35, 0] }, true);
      return 0.42;
    }
    case "ring": {
      const torus = new THREE.TorusGeometry(0.43, 0.05, 12, 56);
      parts.add("hull", torus, { r: [Math.PI / 2, 0, 0], s: [1, 1, H * 4] }, true);
      parts.add("hull", lathe([[0, -0.5], [0.3, -0.3], [0.5, 0], [0.3, 0.3], [0, 0.5]]), { s: [0.22, 0.22, 0.4] }, true);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        parts.beam("dark", new THREE.Vector3(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08), new THREE.Vector3(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4), 0.025, true);
      }
      return 0.2;
    }
    case "crescent": {
      const arc = new THREE.TorusGeometry(0.4, 0.07, 10, 40, Math.PI * 1.3);
      arc.rotateX(Math.PI / 2);
      arc.rotateY(-0.85 * Math.PI);
      parts.add("hull", deform(arc), { s: [1, H * 4, 1] }, true);
      parts.add("hull", lathe([[0, -0.5], [0.35, -0.3], [0.5, 0], [0.3, 0.35], [0, 0.5]]), { s: [0.16, 0.12, 0.35], p: [0, 0, -0.35] }, true);
      return 0.1;
    }
    case "shard": {
      parts.add("hull", new THREE.OctahedronGeometry(0.5, 0), { s: [W, H, 1] }, true);
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const s = 0.25 + rnd() * 0.3;
        parts.add("hull", new THREE.OctahedronGeometry(0.5, 0), { p: [Math.cos(a) * W * 0.35, Math.sin(a) * H * 0.35, (rnd() - 0.5) * 0.5], s: [W * s * 0.6, H * s * 0.6, s], r: [0, 0, a] });
      }
      return 0.45;
    }
  }
}

/** Motores en la popa: toberas (o fuentes de luz en las especies sin motores visibles). */
function buildEngines(parts: Parts, look: ShipLook, tail: number): void {
  const { width: W, height: H } = HULL_PROPORTIONS[look.model.hullShape];
  const n = look.model.engines;
  if (n === 0) {
    // Sin motores: un núcleo de luz.
    parts.add("glow", new THREE.SphereGeometry(0.035, 12, 8), { p: [0, 0, 0.05] }, true);
    parts.lights.push({ p: new THREE.Vector3(0, 0, 0.05), color: look.emissive });
    return;
  }
  const flat = look.model.hullShape === "wedge" || look.model.hullShape === "disc" || look.model.hullShape === "crescent";
  const r = Math.max(0.015, Math.min(W, H) * (n === 1 ? 0.32 : 0.22) * (n > 3 ? 0.75 : 1));
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    if (n > 1) {
      if (flat || n <= 3) {
        x = (i / (n - 1) - 0.5) * W * (flat ? 0.7 : 0.6);
      } else {
        const a = (i / n) * Math.PI * 2;
        x = Math.cos(a) * W * 0.24;
        y = Math.sin(a) * H * 0.24;
      }
    }
    const z = tail;
    if (look.style === "organic") {
      parts.add("glow", new THREE.SphereGeometry(r, 10, 8), { p: [x, y, z], s: [1, 1, 1.4] }, true);
    } else {
      parts.add("dark", new THREE.CylinderGeometry(r * 1.05, r * 1.25, 0.06, 14), { p: [x, y, z - 0.01], r: [Math.PI / 2, 0, 0] }, true);
      parts.add("glow", new THREE.CircleGeometry(r * 0.85, 14), { p: [x, y, z + 0.021] });
    }
    parts.engines.push({ p: new THREE.Vector3(x, y, z + 0.025), r });
  }
}

/** Cañones y lanzadores en las bocas de fuego de los datos (metros → eslora 1). */
function buildWeapons(parts: Parts, look: ShipLook): void {
  const L = look.model.lengthM;
  const { height: H } = HULL_PROPORTIONS[look.model.hullShape];
  const turrets = (look.model.turrets ?? 0) > 0;
  const thick = Math.max(0.006, 0.35 / L);
  for (const o of look.hardpoints.cannon) {
    const tip = new THREE.Vector3(o[0] / L, o[1] / L, o[2] / L);
    if (turrets) {
      const center = tip.clone().setZ(tip.z + TURRET_BARREL);
      parts.add("dark", new THREE.CylinderGeometry(0.028, 0.034, 0.025, 12), { p: [center.x, H / 2 + 0.012, center.z] });
      parts.add("hull", new THREE.SphereGeometry(0.024, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), { p: [center.x, H / 2 + 0.024, center.z], s: [1, 0.7, 1.2] });
      for (const dx of [-0.008, 0.008]) parts.beam("dark", new THREE.Vector3(center.x + dx, tip.y, center.z - 0.012), new THREE.Vector3(tip.x + dx, tip.y, tip.z), thick);
    } else {
      parts.beam("dark", tip.clone().setZ(tip.z + 0.14), tip, thick);
      parts.add("dark", new THREE.BoxGeometry(thick * 2.6, thick * 2.2, 0.08), { p: [tip.x, tip.y, tip.z + 0.15] });
      // Pilón hasta el casco.
      parts.beam("dark", new THREE.Vector3(tip.x * 0.4, tip.y, tip.z + 0.15), new THREE.Vector3(tip.x, tip.y, tip.z + 0.15), thick * 1.4);
    }
    parts.add("trim", new THREE.SphereGeometry(thick * 1.2, 6, 4), { p: [tip.x, tip.y, tip.z] });
  }
  for (const o of look.hardpoints.missile) {
    const at = new THREE.Vector3(o[0] / L, o[1] / L, o[2] / L);
    parts.add("dark", new THREE.BoxGeometry(thick * 5, thick * 3, 0.1), { p: [at.x, at.y, at.z + 0.05] });
    parts.beam("dark", new THREE.Vector3(at.x * 0.5, at.y * 0.5, at.z + 0.05), new THREE.Vector3(at.x, at.y, at.z + 0.05), thick * 1.6);
    for (const dx of [-thick * 1.2, thick * 1.2]) parts.add("glow", new THREE.SphereGeometry(thick * 0.9, 6, 4), { p: [at.x + dx, at.y, at.z] });
  }
}

/** Alas, contenedores, hangar, anillo habitable y antena. */
function buildExtras(parts: Parts, look: ShipLook, rnd: () => number): void {
  const { width: W, height: H } = HULL_PROPORTIONS[look.model.hullShape];
  const m = look.model;
  if (m.wings) {
    for (const side of [1, -1]) {
      // La forma se dibuja ya en su lado (escalar por -1 daría la vuelta a las caras).
      const shape = new THREE.Shape();
      const root = W * 0.35;
      shape.moveTo(side * root, -0.12);
      shape.lineTo(side * (W * 0.5 + 0.3), 0.22);
      shape.lineTo(side * (W * 0.5 + 0.3), 0.36);
      shape.lineTo(side * root, 0.36);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      parts.add("hull", g, { p: [0, -H * 0.05, 0] }, true);
      parts.add("trim", new THREE.BoxGeometry(0.16, 0.004, 0.025), { p: [side * (W * 0.5 + 0.16), -H * 0.05 + 0.002, 0.24], r: [0, side * -0.45, 0] });
      parts.lights.push({ p: new THREE.Vector3(side * (W * 0.5 + 0.3), -H * 0.05, 0.3), color: side > 0 ? 0x30ff70 : 0xff3030 });
    }
  }
  if (m.pods) {
    const perSide = Math.ceil(m.pods / 2);
    const len = 0.78 / perSide;
    for (let i = 0; i < m.pods; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(i / 2);
      const z = -0.32 + len * (row + 0.5);
      const slot: Slot = rnd() < 0.5 ? "dark" : "hull";
      parts.add(slot, new THREE.BoxGeometry(W * 0.42, H * 0.7, len * 0.9), { p: [side * W * 0.62, 0, z] }, true);
    }
    parts.beam("dark", new THREE.Vector3(0, 0, -0.35), new THREE.Vector3(0, 0, 0.45), Math.min(W, H) * 0.3, true);
  }
  if (m.hangar) {
    parts.add("dark", new THREE.BoxGeometry(W * 0.62, H * 0.4, 0.02), { p: [0, -H * 0.12, -0.5] });
    parts.add("glow", new THREE.BoxGeometry(W * 0.5, H * 0.04, 0.025), { p: [0, -H * 0.3, -0.5] });
    if (look.model.hullShape === "brick" && look.model.lengthM > 150) {
      // Cubierta de vuelo con su franja.
      parts.add("dark", new THREE.BoxGeometry(W * 1.15, 0.012, 0.9), { p: [W * 0.08, H / 2 + 0.006, 0.02] }, true);
      parts.add("trim", new THREE.BoxGeometry(0.012, 0.004, 0.8), { p: [W * 0.08, H / 2 + 0.014, 0.02] });
    }
  }
  if (m.habitat) {
    const R = Math.max(W, H) * 0.5 + 0.13;
    parts.add("hull", new THREE.TorusGeometry(R, 0.035, 10, 40), { p: [0, 0, 0.05] }, true);
    parts.add("glass", new THREE.TorusGeometry(R, 0.012, 6, 40), { p: [0, 0, 0.05], s: [1.0, 1.0, 1.6] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      parts.beam("dark", new THREE.Vector3(Math.cos(a) * W * 0.4, Math.sin(a) * H * 0.4, 0.05), new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0.05), 0.014);
    }
  }
  if (m.dish) {
    parts.beam("dark", new THREE.Vector3(0, H * 0.4, 0.05), new THREE.Vector3(0, H * 0.4 + 0.1, 0.05), 0.012);
    parts.add("hull", new THREE.SphereGeometry(0.09, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3), { p: [0, H * 0.4 + 0.14, 0.05], r: [-Math.PI / 2 - 0.3, 0, 0] });
  }
}

/** Detalles propios del estilo de la facción. */
function buildStyle(parts: Parts, look: ShipLook, rnd: () => number): void {
  const { width: W, height: H } = HULL_PROPORTIONS[look.model.hullShape];
  const L = look.model.lengthM;
  switch (look.style) {
    case "human": {
      // Lomo, franjas del color de acento, puente acristalado y luz de cola.
      parts.add("dark", new THREE.BoxGeometry(W * 0.22, H * 0.18, 0.5), { p: [0, H * 0.48, 0.12] });
      for (const side of [1, -1]) parts.add("trim", new THREE.BoxGeometry(0.004, H * 0.12, 0.3), { p: [side * W * 0.5, 0, -0.05] });
      if (L < 90) parts.add("glass", new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), { p: [0, H * 0.42, -0.24], s: [W * 0.22, H * 0.35, 0.14] }, true);
      else parts.add("glass", new THREE.BoxGeometry(W * 0.34, H * 0.08, 0.03), { p: [0, H * 0.78, 0.25] });
      parts.lights.push({ p: new THREE.Vector3(0, H * 0.6, 0.42), color: 0xffffff });
      for (let i = 0; i < Math.min(6, Math.floor(L / 25)); i++) {
        parts.add("dark", new THREE.BoxGeometry(W * (0.1 + rnd() * 0.15), H * 0.06, 0.04 + rnd() * 0.08), { p: [(rnd() - 0.5) * W * 0.5, H * 0.5, -0.2 + rnd() * 0.55] });
      }
      return;
    }
    case "brutalist_scrap": {
      // Chatarra: placas atornilladas sin simetría, púas en el morro y algún contenedor suelto.
      const plates = 5 + Math.floor(rnd() * 5);
      for (let i = 0; i < plates; i++) {
        const side = rnd() < 0.5 ? 1 : -1;
        parts.add(rnd() < 0.6 ? "dark" : "hull", new THREE.BoxGeometry(W * (0.15 + rnd() * 0.3), H * (0.1 + rnd() * 0.3), 0.05 + rnd() * 0.2), {
          p: [side * W * (0.3 + rnd() * 0.25), (rnd() - 0.4) * H * 0.7, -0.35 + rnd() * 0.75],
          r: [0, 0, (rnd() - 0.5) * 0.6],
        }, i < 3);
      }
      for (const side of [1, -1]) parts.add("dark", new THREE.ConeGeometry(0.02, 0.16, 5), { p: [side * W * 0.22, -H * 0.15, -0.5], r: [-Math.PI / 2, 0, 0] });
      parts.add("dark", new THREE.ConeGeometry(0.015, 0.1, 4), { p: [W * 0.1, H * 0.35, -0.38], r: [-Math.PI / 2 - 0.4, 0, 0] });
      if (rnd() < 0.7) parts.add("hull", new THREE.CylinderGeometry(H * 0.25, H * 0.25, 0.3, 8), { p: [-W * 0.55, 0, 0.15], r: [Math.PI / 2, 0, 0] }, true);
      parts.lights.push({ p: new THREE.Vector3(0, H * 0.45, -0.2), color: look.emissive });
      return;
    }
    case "organic": {
      // Costillas y pústulas que brillan.
      for (let i = 0; i < 5; i++) {
        const z = -0.3 + i * 0.15;
        parts.add("dark", new THREE.TorusGeometry(Math.max(W, H) * 0.42, 0.012, 6, 20), { p: [0, 0, z], s: [W / Math.max(W, H), H / Math.max(W, H), 1] });
      }
      for (let i = 0; i < 7; i++) {
        const a = rnd() * Math.PI * 2;
        parts.add("glow", new THREE.SphereGeometry(0.018, 8, 6), { p: [Math.cos(a) * W * 0.45, Math.sin(a) * H * 0.45, -0.3 + rnd() * 0.6] });
      }
      return;
    }
    case "crystalline": {
      // Agujas de cristal que salen del casco y un núcleo encendido dentro.
      for (let i = 0; i < 7; i++) {
        const a = rnd() * Math.PI * 2;
        const len = 0.15 + rnd() * 0.25;
        parts.add("hull", new THREE.OctahedronGeometry(0.5, 0), {
          p: [Math.cos(a) * W * 0.45, Math.sin(a) * H * 0.45, -0.3 + rnd() * 0.6],
          s: [0.04, 0.04, len],
          r: [Math.sin(a) * 0.6, Math.cos(a) * 0.6, 0],
        });
      }
      parts.add("glow", new THREE.OctahedronGeometry(0.08, 0), { s: [W * 1.5, H * 1.5, 1.5] }, true);
      parts.add("aura", new THREE.OctahedronGeometry(0.5, 0), { s: [W * 1.25, H * 1.25, 1.15] });
      return;
    }
    case "geometric": {
      // Anillos perfectos con bandas de luz y aletas simétricas.
      const R = Math.max(W, H) * 0.56;
      for (const z of [-0.12, 0.2]) {
        parts.add("dark", new THREE.TorusGeometry(R, 0.014, 8, 40), { p: [0, 0, z], s: [W / Math.max(W, H), H / Math.max(W, H), 1] }, true);
        parts.add("glow", new THREE.TorusGeometry(R * 1.01, 0.004, 4, 40), { p: [0, 0, z + 0.012], s: [W / Math.max(W, H), H / Math.max(W, H), 1] });
      }
      return;
    }
    case "angular": {
      // Aleta dorsal alta, cuchillas laterales y filos del color de la especie.
      const fin = new THREE.Shape();
      fin.moveTo(0, 0);
      fin.lineTo(0.32, 0);
      fin.lineTo(0.38, H * 1.4 + 0.05);
      fin.lineTo(0.26, H * 1.4 + 0.05);
      fin.closePath();
      const g = new THREE.ExtrudeGeometry(fin, { depth: 0.01, bevelEnabled: false });
      g.rotateY(-Math.PI / 2);
      parts.add("dark", g, { p: [0.005, H * 0.35, 0.05] }, true);
      for (const side of [1, -1]) {
        parts.add("hull", prow(0.02, H * 0.3, 0.45, 0.05), { p: [side * W * 0.62, 0, 0.0], r: [0, side * 0.12, 0] }, true);
        parts.add("trim", new THREE.BoxGeometry(0.006, 0.006, 0.4), { p: [side * W * 0.5, H * 0.3, -0.05] });
      }
      return;
    }
    case "ethereal": {
      // Casco oscuro dentro de un halo que dobla la luz y segmentos que flotan sueltos.
      parts.add("aura", new THREE.SphereGeometry(0.5, 20, 12), { s: [W * 1.35, H * 1.8, 1.08] });
      for (let i = 0; i < 3; i++) {
        // Anillos casi tumbados alrededor del casco, cada uno algo inclinado.
        parts.add("dark", new THREE.TorusGeometry(Math.max(W, 0.3) * 0.35 + i * 0.05, 0.008, 6, 30), { p: [0, (i - 1) * H * 0.6, 0.05], r: [Math.PI / 2 + (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5, 0] });
      }
      parts.lights.push({ p: new THREE.Vector3(0, 0, -0.3), color: look.emissive });
      return;
    }
  }
}

// --- Materiales y caché ---

const materialCache = new Map<string, Record<Slot, THREE.Material>>();

function materialsFor(look: ShipLook, accent: number): Record<Slot, THREE.Material> {
  const key = `${look.style}|${look.primary}|${look.secondary}|${look.emissive}|${accent}`;
  let m = materialCache.get(key);
  if (m) return m;
  const textured = look.style === "human" || look.style === "brutalist_scrap";
  const crystal = look.style === "crystalline";
  const hull = new THREE.MeshStandardMaterial({
    color: look.primary,
    map: textured ? panelTexture() : null,
    metalness: look.style === "organic" ? 0.1 : look.style === "brutalist_scrap" ? 0.45 : 0.6,
    roughness: look.style === "organic" ? 0.75 : look.style === "brutalist_scrap" ? 0.8 : look.style === "geometric" ? 0.18 : 0.38,
    emissive: crystal ? look.emissive : 0x000000,
    emissiveIntensity: crystal ? 0.25 : 0,
    transparent: crystal,
    opacity: crystal ? 0.82 : 1,
  });
  m = {
    hull,
    dark: new THREE.MeshStandardMaterial({ color: look.secondary, metalness: 0.7, roughness: 0.5 }),
    trim: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.4 }),
    glow: new THREE.MeshBasicMaterial({ color: look.emissive }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2a44, emissive: 0x2a5d8a, emissiveIntensity: 0.4, metalness: 0.95, roughness: 0.08 }),
    aura: new THREE.MeshBasicMaterial({ color: look.emissive, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
  };
  materialCache.set(key, m);
  return m;
}

interface Template {
  look: ShipLook;
  full: Partial<Record<Slot, THREE.BufferGeometry>>;
  coarse: Partial<Record<Slot, THREE.BufferGeometry>>;
  minimal: THREE.BufferGeometry;
  engines: Parts["engines"];
  lights: Parts["lights"];
}

const templates = new Map<string, Template>();

function merged(list: Record<Slot, THREE.BufferGeometry[]>): Partial<Record<Slot, THREE.BufferGeometry>> {
  const out: Partial<Record<Slot, THREE.BufferGeometry>> = {};
  for (const s of SLOTS) {
    if (list[s].length === 0) continue;
    const g = mergeGeometries(list[s], false);
    if (g) {
      g.computeBoundingSphere();
      out[s] = g;
    }
  }
  return out;
}

function template(look: ShipLook): Template {
  let t = templates.get(look.classId);
  if (t) return t;
  const rnd = seeded(hash(look.classId));
  const parts = new Parts();
  const tail = buildHull(parts, look, rnd);
  buildEngines(parts, look, tail);
  buildExtras(parts, look, rnd);
  buildWeapons(parts, look);
  buildStyle(parts, look, rnd);
  const { width: W, height: H } = HULL_PROPORTIONS[look.model.hullShape];
  const minimal = prep(new THREE.OctahedronGeometry(0.5, 0)).applyMatrix4(new THREE.Matrix4().makeScale(W, H, 1));
  minimal.computeBoundingSphere();
  t = { look, full: merged(parts.full), coarse: merged(parts.coarse), minimal, engines: parts.engines, lights: parts.lights };
  templates.set(look.classId, t);
  return t;
}

let flameGeo: THREE.BufferGeometry | null = null;
function flameGeometry(): THREE.BufferGeometry {
  if (flameGeo) return flameGeo;
  const g = new THREE.ConeGeometry(1, 1, 12, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  flameGeo = g;
  return g;
}
const flameMaterials = new Map<number, THREE.MeshBasicMaterial>();
function flameMaterial(color: number): THREE.MeshBasicMaterial {
  let m = flameMaterials.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    flameMaterials.set(color, m);
  }
  return m;
}
const spriteMaterials = new Map<number, THREE.SpriteMaterial>();
function spriteMaterial(color: number): THREE.SpriteMaterial {
  let m = spriteMaterials.get(color);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    spriteMaterials.set(color, m);
  }
  return m;
}

/** Distancias de cambio de nivel de detalle, en esloras. */
export const SHIP_LOD = { coarse: 30, minimal: 160 } as const;

export interface ShipModelOptions {
  /** Color de acento (franjas y bocas) de las naves humanas; por defecto, azul. */
  accent?: THREE.ColorRepresentation;
  /** Sin niveles de detalle (miniaturas): siempre el completo. */
  noLod?: boolean;
}

/**
 * Crea el modelo de una clase de nave, a escala real (metros), mirando hacia
 * -Z, con su `ShipRig` (empuje, balanceo y bocas de fuego) en `userData.rig`.
 * Null si la clase no existe.
 */
export function createShipModel(classId: string, opts: ShipModelOptions = {}): THREE.Group | null {
  const look = lookOf(classId);
  if (!look) return null;
  const t = template(look);
  const accent = new THREE.Color(opts.accent ?? (look.style === "human" ? 0x4fa8ff : look.emissive)).getHex();
  const mats = materialsFor(look, accent);
  const L = look.model.lengthM;
  const root = new THREE.Group();
  // `body` lleva la escala (eslora) y se balancea al flotar sin mover la posición real.
  const body = new THREE.Group();
  body.scale.setScalar(L);
  root.add(body);

  const level = (geos: Partial<Record<Slot, THREE.BufferGeometry>>): THREE.Group => {
    const g = new THREE.Group();
    for (const s of SLOTS) {
      const geo = geos[s];
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mats[s]);
      if (s === "aura") mesh.renderOrder = 2;
      g.add(mesh);
    }
    return g;
  };

  const flames: THREE.Mesh[] = [];
  const glows: THREE.Sprite[] = [];
  const flameColor = look.style === "human" ? 0x7fdcff : look.emissive;
  const full = level(t.full);
  for (const e of t.engines) {
    const f = new THREE.Mesh(flameGeometry(), flameMaterial(flameColor));
    f.position.copy(e.p);
    f.scale.set(e.r * 0.8, e.r * 0.8, 0.1);
    flames.push(f);
    full.add(f);
  }
  const blinkers: THREE.Sprite[] = [];
  for (const l of t.lights) {
    const s = new THREE.Sprite(spriteMaterial(l.color));
    s.position.copy(l.p);
    s.scale.setScalar(Math.max(0.03, 6 / L));
    blinkers.push(s);
    full.add(s);
  }
  const coarse = level(t.coarse);
  for (const lv of [full, coarse]) {
    for (const e of t.engines) {
      const s = new THREE.Sprite(spriteMaterial(flameColor));
      s.position.copy(e.p).setZ(e.p.z + e.r);
      s.userData.base = e.r * 4;
      s.scale.setScalar(e.r * 4);
      glows.push(s);
      lv.add(s);
    }
  }
  const minimal = new THREE.Group();
  minimal.add(new THREE.Mesh(t.minimal, mats.hull));
  const blip = new THREE.Sprite(spriteMaterial(look.emissive));
  blip.scale.setScalar(0.6);
  minimal.add(blip);

  if (opts.noLod) {
    body.add(full);
  } else {
    const lod = new THREE.LOD();
    lod.addLevel(full, 0);
    lod.addLevel(coarse, L * SHIP_LOD.coarse);
    lod.addLevel(minimal, L * SHIP_LOD.minimal);
    body.add(lod);
  }

  let thrust = 0;
  let pulse = false;
  const phase = (hash(classId) % 1000) / 160;
  const rig: ShipRig = {
    setThrust(k, p = false) {
      thrust = Math.max(0, Math.min(1, k));
      pulse = p;
    },
    tick(time, _dt, idle) {
      const flicker = 0.9 + 0.1 * Math.sin(time * 37 + phase) * Math.sin(time * 23);
      const len = (pulse ? 2.5 : 0.08 + thrust * 0.6) * flicker;
      for (const f of flames) {
        f.scale.z = len;
        f.visible = len > 0.02;
      }
      for (const s of glows) s.scale.setScalar(s.userData.base * (0.7 + thrust * 0.5 + (pulse ? 0.5 : 0)) * flicker);
      const on = (time + phase) % 1.4 < 0.1;
      for (const b of blinkers) b.visible = on;
      body.position.set(0, Math.sin(time * 0.47 + phase) * L * 0.004 * idle, 0);
      body.rotation.set(Math.sin(time * 0.37 + phase) * 0.02 * idle, 0, Math.sin(time * 0.29 + 1 + phase) * 0.03 * idle);
    },
    muzzle(kind: WeaponKind, index, out) {
      const list = look.hardpoints[kind];
      const o = list[index % Math.max(1, list.length)];
      out.set(o?.[0] ?? 0, o?.[1] ?? 0, o?.[2] ?? 0);
      root.updateMatrixWorld();
      return root.localToWorld(out);
    },
  };
  root.userData.rig = rig;
  root.userData.lengthM = L;
  root.userData.dispose = () => {};
  return root;
}

/** Eslora (m) de una clase de nave, o null si no existe. */
export function shipLength(classId: string): number | null {
  return lookOf(classId)?.model.lengthM ?? null;
}
