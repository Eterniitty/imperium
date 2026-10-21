/**
 * Naves de las especies alienígenas: cascos con la silueta de cada especie
 * (aguja, disco, anillo, media luna, esquirla…), sus motores o núcleos de luz,
 * armas en las bocas de fuego de los datos y los detalles de su estilo.
 * Usa el mismo kit (`Parts`) que las naves humanas.
 */
import * as THREE from "three";
import { HULL_PROPORTIONS, TURRET_BARREL } from "@imperium/content";
import { Parts, type Slot } from "./kit";
import type { ShipLook } from "./look";

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
    parts.light(new THREE.Vector3(0, 0, 0.05), look.emissive);
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
      parts.light(new THREE.Vector3(side * (W * 0.5 + 0.3), -H * 0.05, 0.3), side > 0 ? 0x30ff70 : 0xff3030);
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
  switch (look.style) {
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
      parts.light(new THREE.Vector3(0, 0, -0.3), look.emissive);
      return;
    }
  }
}

/** Construye una nave alienígena completa. */
export function buildAlien(parts: Parts, look: ShipLook, rnd: () => number): void {
  const tail = buildHull(parts, look, rnd);
  buildEngines(parts, look, tail);
  buildExtras(parts, look, rnd);
  buildWeapons(parts, look);
  buildStyle(parts, look, rnd);
}
