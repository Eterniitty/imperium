/**
 * Kit de módulos reutilizables para construir naves por código. Todas las
 * piezas se acumulan en `Parts` por material («ranura») y luego se fusionan en
 * una geometría por material: pocas llamadas de dibujo aunque la nave tenga
 * cientos de piezas. Coordenadas normalizadas: eslora 1, morro en z = -0,5,
 * popa en z = +0,5, x a estribor (derecha), y arriba.
 *
 * Módulos: casco por secciones (`loft`), motores principales con tobera
 * (`mainEngine`), bloques de propulsores de maniobra (`rcsBlock`), radiadores,
 * antenas, platos, cúpulas de sensores, torretas, cañones fijos, lanzadores,
 * contenedores de carga, franjas de ventanas, tuberías y placas sueltas.
 */
import * as THREE from "three";

/** Materiales de una nave (cada uno se dibuja con una sola llamada). */
export type Slot = "hull" | "plate" | "dark" | "metal" | "trim" | "glass" | "radiator" | "engine" | "glow" | "aura";
export const SLOTS: Slot[] = ["hull", "plate", "dark", "metal", "trim", "glass", "radiator", "engine", "glow", "aura"];

/** Luces: fijas (navegación y estado), destello blanco o baliza roja lenta. */
export type LightMode = "steady" | "strobe" | "beacon";

export type V3 = [number, number, number];

export interface Placement {
  p?: V3;
  r?: V3;
  s?: V3;
}

/** Generador de números con semilla (mismo aspecto siempre para la misma clase). */
export function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deja la geometría en el formato común para fusionar: sin índices, con posición, normal y uv. */
export function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position!.count * 2), 2));
  out.clearGroups();
  return out;
}

/** Coordenadas de textura proyectadas por la cara dominante (placas del mismo tamaño en todas partes). */
function boxUV(g: THREE.BufferGeometry, scale: number): void {
  const pos = g.attributes.position!;
  const nor = g.attributes.normal!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ax >= ay && ax >= az) uv.setXY(i, z * scale, y * scale);
    else if (ay >= az) uv.setXY(i, x * scale, z * scale);
    else uv.setXY(i, x * scale, y * scale);
  }
  uv.needsUpdate = true;
}

export class Parts {
  readonly full: Record<Slot, THREE.BufferGeometry[]> = emptySlots();
  readonly coarse: Record<Slot, THREE.BufferGeometry[]> = emptySlots();
  /** Toberas principales: centro de la salida y radio (llamas y halos). */
  readonly engines: Array<{ p: THREE.Vector3; r: number }> = [];
  /** Propulsores de maniobra: boquilla y dirección del chorro. */
  readonly thrusters: Array<{ p: THREE.Vector3; d: THREE.Vector3 }> = [];
  readonly lights: Array<{ p: THREE.Vector3; color: number; mode: LightMode }> = [];
  /** Exageración de los detalles pequeños en naves grandes (si no, no se verían). */
  readonly detail: number;

  /** `L`: eslora en metros; `uvScale`: mosaicos de textura por eslora. */
  constructor(
    readonly L: number,
    readonly uvScale: number,
  ) {
    this.detail = Math.max(1, Math.sqrt(L / 45));
  }

  /** Metros (de un detalle) → unidades normalizadas. */
  m(meters: number): number {
    return (meters / this.L) * this.detail;
  }

  /** Añade una pieza; `coarse` la incluye también en el nivel de detalle medio. */
  add(slot: Slot, g: THREE.BufferGeometry, at: Placement = {}, coarse = false): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(at.p ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(at.r ?? [0, 0, 0]))),
      new THREE.Vector3(...(at.s ?? [1, 1, 1])),
    );
    const geo = prep(g).applyMatrix4(m);
    boxUV(geo, this.uvScale);
    this.full[slot].push(geo);
    if (coarse) this.coarse[slot].push(geo);
  }

  /** Viga entre dos puntos (cuadrada o redonda: pilones, tubos, cañones). */
  beam(slot: Slot, a: THREE.Vector3, b: THREE.Vector3, thickness: number, coarse = false, round = false): void {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-6) return;
    const g = round ? new THREE.CylinderGeometry(thickness / 2, thickness / 2, len, 8) : new THREE.BoxGeometry(thickness, len, thickness);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.add(slot, g, { p: [mid.x, mid.y, mid.z], r: [e.x, e.y, e.z] }, coarse);
  }

  light(p: V3 | THREE.Vector3, color: number, mode: LightMode = "steady"): void {
    this.lights.push({ p: Array.isArray(p) ? new THREE.Vector3(...p) : p.clone(), color, mode });
  }
}

function emptySlots(): Record<Slot, THREE.BufferGeometry[]> {
  return { hull: [], plate: [], dark: [], metal: [], trim: [], glass: [], radiator: [], engine: [], glow: [], aura: [] };
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// --- Primitivas ---

/** Sección de casco: anchura `w`, altura `h`, centro en `y`, chaflán `c` (fracción del lado menor), `t` anchura de arriba / abajo. */
export interface Ring {
  z: number;
  w: number;
  h: number;
  y?: number;
  c?: number;
  t?: number;
}

/** Casco facetado que une secciones octogonales (rectángulos achaflanados) de proa a popa (z creciente). */
export function loft(rings: Ring[], caps = true): THREE.BufferGeometry {
  const pts = rings.map((r) => {
    const a = r.w / 2;
    const b = r.h / 2;
    const at = a * (r.t ?? 1);
    const c = Math.min((r.c ?? 0.28) * Math.min(r.w, r.h), at * 0.9, b * 0.9);
    const y0 = r.y ?? 0;
    return (
      [
        [a, -b + c],
        [at, b - c],
        [at - c, b],
        [-at + c, b],
        [-at, b - c],
        [-a, -b + c],
        [-a + c, -b],
        [a - c, -b],
      ] as const
    ).map(([x, y]) => v(x, y + y0, r.z));
  });
  const out: number[] = [];
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => out.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i]!;
    const B = pts[i + 1]!;
    for (let j = 0; j < 8; j++) {
      const k = (j + 1) % 8;
      tri(A[j]!, A[k]!, B[j]!);
      tri(A[k]!, B[k]!, B[j]!);
    }
  }
  if (caps) {
    const F = pts[0]!;
    const Bk = pts[pts.length - 1]!;
    const cf = F.reduce((s, p) => s.add(p), v(0, 0, 0)).multiplyScalar(1 / 8);
    const cb = Bk.reduce((s, p) => s.add(p), v(0, 0, 0)).multiplyScalar(1 / 8);
    for (let j = 0; j < 8; j++) {
      const k = (j + 1) % 8;
      tri(cf, F[k]!, F[j]!);
      tri(cb, Bk[j]!, Bk[k]!);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

/** Caja achaflanada centrada (módulos, carcasas, contenedores). */
export function block(w: number, h: number, len: number, c = 0.22, taper = 1): THREE.BufferGeometry {
  return loft([
    { z: -len / 2, w: w * taper, h: h * taper, c },
    { z: len / 2, w, h, c },
  ]);
}

/** Cilindro a lo largo de Z. */
export function tube(r0: number, r1: number, len: number, seg = 12, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  // +Y → +Z: r0 queda hacia el morro (-Z) y r1 hacia la popa.
  g.rotateX(Math.PI / 2);
  return g;
}

/** Tobera abierta: garganta en z = 0, salida en z = +len. */
export function bell(rThroat: number, rExit: number, len: number): THREE.BufferGeometry {
  const g = tube(rThroat, rExit, len, 18, true);
  g.translate(0, 0, len / 2);
  return g;
}

/** Línea de piezas a ambos lados (estribor y babor). */
export function sym(fn: (side: 1 | -1) => void): void {
  fn(1);
  fn(-1);
}

// --- Módulos ---

/**
 * Motor principal: carcasa, tobera metálica con aros de refuerzo y garganta
 * encendida (material «engine», cuyo brillo sigue al empuje). `z` es la
 * garganta; la tobera sale hacia la popa hasta `z + len`.
 */
export function mainEngine(parts: Parts, x: number, y: number, z: number, r: number, len: number): void {
  parts.add("dark", tube(r * 0.78, r * 0.86, len * 0.55, 12), { p: [x, y, z - len * 0.2] }, true);
  parts.add("metal", bell(r * 0.6, r, len), { p: [x, y, z] }, true);
  parts.add("plate", new THREE.TorusGeometry(r * 0.83, r * 0.07, 6, 18), { p: [x, y, z + len * 0.45] });
  parts.add("plate", new THREE.TorusGeometry(r * 1.0, r * 0.05, 6, 18), { p: [x, y, z + len * 0.98] });
  parts.add("engine", new THREE.CircleGeometry(r * 0.78, 18), { p: [x, y, z + len * 0.5] }, true);
  parts.add("engine", new THREE.CircleGeometry(r * 0.62, 18), { p: [x, y, z + len * 0.12] });
  parts.engines.push({ p: v(x, y, z + len), r });
}

/**
 * Bloque de propulsores de maniobra con boquillas en las direcciones dadas
 * (dirección del chorro). Cada boquilla se registra para `setManeuver`.
 */
export function rcsBlock(parts: Parts, p: THREE.Vector3, dirs: THREE.Vector3[], size: number): void {
  parts.add("dark", block(size, size * 0.8, size * 1.1, 0.3), { p: [p.x, p.y, p.z] });
  parts.add("trim", new THREE.BoxGeometry(size * 1.02, size * 0.12, size * 0.3), { p: [p.x, p.y + size * 0.2, p.z] });
  for (const d of dirs) {
    const n = d.clone().normalize();
    const len = size * 0.35;
    const at = p.clone().addScaledVector(n, size * 0.45 + len / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const e = new THREE.Euler().setFromQuaternion(q);
    parts.add("metal", new THREE.CylinderGeometry(size * 0.2, size * 0.13, len, 8, 1, true), { p: [at.x, at.y, at.z], r: [e.x, e.y, e.z] });
    parts.thrusters.push({ p: p.clone().addScaledVector(n, size * 0.45 + len + size * 0.15), d: n });
  }
}

/**
 * Radiador: panel con aletas sujeto al casco. `root` es el borde interior;
 * se extiende `span` hacia el lado `side` con un ángulo `tilt` sobre la
 * horizontal (positivo hacia arriba) y una cuerda `chord` a lo largo de Z.
 */
export function radiator(parts: Parts, root: THREE.Vector3, span: number, chord: number, tilt: number, side: 1 | -1, coarse = true): THREE.Vector3 {
  const dir = v(side * Math.cos(tilt), Math.sin(tilt), 0);
  const center = root.clone().addScaledVector(dir, span / 2);
  const tip = root.clone().addScaledVector(dir, span);
  const thick = Math.max(0.0025, parts.m(0.25));
  parts.add("radiator", new THREE.BoxGeometry(span, thick, chord), { p: [center.x, center.y, center.z], r: [0, 0, side * tilt] }, coarse);
  // Marco: largueros delante y detrás y puntal hasta el casco.
  for (const dz of [-chord / 2, chord / 2]) parts.beam("dark", root.clone().setZ(root.z + dz), tip.clone().setZ(tip.z + dz), thick * 2.2);
  parts.beam("dark", tip.clone().setZ(tip.z - chord / 2), tip.clone().setZ(tip.z + chord / 2), thick * 2.2);
  parts.beam("plate", root.clone().add(v(-side * thick * 3, 0, 0)), center, thick * 3.5);
  return tip;
}

/** Radiador vertical (aleta dorsal o ventral). */
export function radiatorFin(parts: Parts, root: THREE.Vector3, span: number, chord: number, up: 1 | -1): THREE.Vector3 {
  const thick = Math.max(0.0025, parts.m(0.25));
  const center = root.clone().add(v(0, (up * span) / 2, 0));
  parts.add("radiator", new THREE.BoxGeometry(thick, span, chord), { p: [center.x, center.y, center.z] }, true);
  const tip = root.clone().add(v(0, up * span, 0));
  for (const dz of [-chord / 2, chord / 2]) parts.beam("dark", root.clone().setZ(root.z + dz), tip.clone().setZ(tip.z + dz), thick * 2.2);
  parts.beam("dark", tip.clone().setZ(tip.z - chord / 2), tip.clone().setZ(tip.z + chord / 2), thick * 2.2);
  return tip;
}

/** Antena: mástil con travesaños y baliza roja en la punta. */
export function antenna(parts: Parts, base: THREE.Vector3, height: number, lean = 0): THREE.Vector3 {
  const tip = base.clone().add(v(0, height, lean));
  const t = Math.max(0.0015, parts.m(0.12));
  parts.beam("metal", base, tip, t, false, true);
  for (const k of [0.45, 0.75]) {
    const c = base.clone().lerp(tip, k);
    parts.beam("metal", c.clone().add(v(-height * 0.12, 0, 0)), c.clone().add(v(height * 0.12, 0, 0)), t * 0.8);
  }
  parts.light(tip, 0xff3326, "beacon");
  return tip;
}

/** Plato de comunicaciones o sensores apuntando a `dir`. */
export function dish(parts: Parts, center: THREE.Vector3, radius: number, dir: THREE.Vector3): void {
  const n = dir.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), n);
  const e = new THREE.Euler().setFromQuaternion(q);
  const R = radius / Math.sin(Math.PI * 0.3);
  const cap = new THREE.SphereGeometry(R, 18, 4, 0, Math.PI * 2, Math.PI * 0.7, Math.PI * 0.3);
  cap.translate(0, R, 0);
  parts.add("metal", cap, { p: [center.x, center.y, center.z], r: [e.x, e.y, e.z] }, true);
  parts.beam("metal", center, center.clone().addScaledVector(n, radius * 0.6), Math.max(0.002, radius * 0.06));
  parts.light(center.clone().addScaledVector(n, radius * 0.62), 0xffb347, "steady");
}

/** Cúpula de sensores (cristal oscuro) con su base. */
export function sensorDome(parts: Parts, at: THREE.Vector3, r: number, down = false): void {
  const g = new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  parts.add("glass", g, { p: [at.x, at.y, at.z], r: [down ? Math.PI : 0, 0, 0] });
  parts.add("dark", tube(r * 1.15, r * 1.15, r * 0.3, 14), { p: [at.x, at.y, at.z], r: [Math.PI / 2, 0, 0] });
}

/** Franja de ventanas iluminadas. */
export function windows(parts: Parts, at: THREE.Vector3, w: number, h: number, d: number, rot: V3 = [0, 0, 0]): void {
  parts.add("glass", new THREE.BoxGeometry(w, h, d), { p: [at.x, at.y, at.z], r: rot });
}

/**
 * Torreta dorsal: pedestal desde el casco, carcasa achaflanada y dos cañones
 * que acaban en la boca de fuego `tip` (la de los datos).
 */
export function turret(parts: Parts, tip: THREE.Vector3, hullTop: number, size: number, barrel: number): void {
  const cz = tip.z + barrel;
  const top = tip.y;
  if (top - size * 0.4 > hullTop) parts.add("dark", new THREE.CylinderGeometry(size * 0.75, size * 0.95, top - hullTop, 12), { p: [tip.x, (top + hullTop) / 2 - size * 0.2, cz] });
  parts.add("dark", new THREE.CylinderGeometry(size * 1.05, size * 1.1, size * 0.25, 14), { p: [tip.x, top - size * 0.35, cz] }, true);
  parts.add(
    "plate",
    loft([
      { z: -size * 1.0, w: size * 1.4, h: size * 0.5, y: 0.05 * size, t: 0.7 },
      { z: -size * 0.55, w: size * 1.8, h: size * 0.75, t: 0.75 },
      { z: size * 1.0, w: size * 1.9, h: size * 0.8, t: 0.8 },
    ]),
    { p: [tip.x, top, cz + size * 0.1] },
    true,
  );
  for (const dx of [-0.42, 0.42]) {
    const a = v(tip.x + dx * size, top, cz - size * 0.9);
    const b = v(tip.x + dx * size, top, tip.z);
    parts.beam("metal", a, b, size * 0.2, false, true);
    parts.add("dark", tube(size * 0.15, size * 0.15, size * 0.35, 8), { p: [b.x, b.y, b.z + size * 0.18] });
  }
  parts.add("trim", new THREE.BoxGeometry(size * 1.92, size * 0.08, size * 0.25), { p: [tip.x, top + size * 0.2, cz + size * 0.7] });
}

/**
 * Cañón fijo en una barquilla: carcasa, cañón hasta la boca `tip` y puntal
 * hasta el costado del casco (`hullX`, anchura del casco a esa altura).
 */
export function gunPod(parts: Parts, tip: THREE.Vector3, hullX: number, len: number, size: number): void {
  const back = tip.z + len;
  parts.beam("metal", tip, v(tip.x, tip.y, back - len * 0.3), size * 0.32, false, true);
  parts.add("dark", tube(size * 0.26, size * 0.26, size * 0.6, 8), { p: [tip.x, tip.y, tip.z + size * 0.3] });
  parts.add("plate", block(size * 1.1, size * 1.0, len * 0.55, 0.3, 0.75), { p: [tip.x, tip.y, back - len * 0.22] }, true);
  parts.add("trim", new THREE.BoxGeometry(size * 1.12, size * 0.14, len * 0.12), { p: [tip.x, tip.y + size * 0.36, back - len * 0.4] });
  if (Math.abs(tip.x) - size * 0.5 > Math.abs(hullX)) {
    const s = Math.sign(tip.x);
    parts.beam("dark", v(hullX * 0.98, tip.y, back - len * 0.22), v(tip.x - s * size * 0.5, tip.y, back - len * 0.22), size * 0.6);
  }
}

/** Lanzador de misiles: cajón con cuatro tubos; `at` es el centro de su cara delantera. */
export function launcher(parts: Parts, at: THREE.Vector3, hullX: number, size: number): void {
  const len = size * 2.4;
  parts.add("plate", block(size * 1.5, size * 1.2, len, 0.25), { p: [at.x, at.y, at.z + len / 2] }, true);
  for (const dx of [-0.35, 0.35]) {
    for (const dy of [-0.27, 0.27]) {
      parts.add("dark", new THREE.CircleGeometry(size * 0.22, 10), { p: [at.x + dx * size, at.y + dy * size, at.z - 0.0005], r: [0, Math.PI, 0] });
    }
  }
  parts.add("trim", new THREE.BoxGeometry(size * 1.52, size * 0.12, size * 0.4), { p: [at.x, at.y + size * 0.3, at.z + size * 0.4] });
  if (Math.abs(at.x) - size * 0.75 > Math.abs(hullX)) {
    const s = Math.sign(at.x);
    parts.beam("dark", v(hullX * 0.98, at.y, at.z + len / 2), v(at.x - s * size * 0.75, at.y, at.z + len / 2), size * 0.5);
  }
}

/** Contenedor de carga con costillas y franja de color. */
export function cargoPod(parts: Parts, c: THREE.Vector3, w: number, h: number, len: number, slot: Slot): void {
  parts.add(slot, block(w, h, len, 0.12), { p: [c.x, c.y, c.z] }, true);
  const ribs = Math.max(2, Math.round(len / parts.m(3.5)));
  for (let i = 0; i <= ribs; i++) {
    const z = c.z - len / 2 + (len * i) / ribs;
    parts.add("dark", new THREE.BoxGeometry(w * 1.04, h * 1.04, Math.min(len * 0.04, parts.m(0.35))), { p: [c.x, c.y, z] });
  }
  parts.add("trim", new THREE.BoxGeometry(w * 1.05, h * 0.12, len * 0.18), { p: [c.x, c.y + h * 0.18, c.z - len * 0.3] });
}

/** Tubería a lo largo del casco. */
export function pipe(parts: Parts, a: THREE.Vector3, b: THREE.Vector3, r: number): void {
  parts.beam("metal", a, b, r * 2, false, true);
}
