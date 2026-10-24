/**
 * Generador de las naves personalizables (`@imperium/content` shipStyles.ts),
 * con todo el detalle posible (petición del 24-10-2026: «exquisito a la vista»,
 * y todo lo que se mueva, animado).
 *
 * Se construye a partir de las SALAS del interior de su plantilla (el casco las
 * envuelve siempre: más adelante se podrá caminar por la nave) y de la
 * personalización del jugador:
 * - casco de superelipse (lomo redondeado, panza plana, arista lateral) con el
 *   perfil diseñado de la plantilla, comprobando que las salas caben;
 * - pintura con barniz, patrón elegido, juntas de paneles en relieve, remaches y
 *   suciedad (en el sombreador, en los ejes de la nave);
 * - franja dorsal elevada, cabina de cristal con marcos, rejillas, propulsores
 *   de maniobra, sensores, antenas y contorno de la rampa;
 * - góndolas torneadas con ventilador de álabes en la toma y tobera que brilla;
 * - alas biseladas con luces de navegación; tren de aterrizaje con compuertas.
 *
 * Animado (`animateCustomShip`): ventiladores que giran, toberas que laten,
 * luces de navegación, destellos y baliza, plato del radar y torreta que barren,
 * alas de abanico que se pliegan y despliegan y tren que sube y baja
 * (`setShipPose`).
 *
 * En metros, con la proa hacia −z.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SHIP_TEMPLATES, type ShipCustomization, type ShipRoom, type ShipTemplate } from "@imperium/content";

const PATTERN_ID: Record<ShipCustomization["pattern"], number> = { solid: 0, twoTone: 1, stripes: 2, bands: 3, worn: 4 };

/** Perfil del fuselaje en una estación z: semiancho (en la arista), techo y suelo. */
interface Station {
  z: number;
  half: number;
  top: number;
  /** Altura de la arista lateral (donde se unen lomo y panza). */
  chine: number;
  bottom: number;
}

export interface CustomShipInfo {
  length: number;
  rooms: ShipRoom[];
  stations: Station[];
  /** Altura del tren: a cuánto queda el centro de la nave sobre el suelo al estar posada. */
  gearHeight: number;
  /** Salas que no caben en el casco (debe estar vacío). */
  misfit: string[];
}

/** Postura de la nave: tren abajo y alas abiertas (0–1, se animan hacia el objetivo). */
export interface ShipPose {
  gearDown: boolean;
  wingsOpen: boolean;
}

/** Piezas animadas. */
interface ShipAnim {
  fans: THREE.Object3D[];
  strobes: THREE.Mesh[];
  beacons: THREE.Mesh[];
  navLights: THREE.Mesh[];
  dish: THREE.Object3D | null;
  turret: THREE.Object3D | null;
  /** Palas de las alas de abanico: ángulo plegado de cada una. */
  wingBlades: { pivot: THREE.Object3D; folded: number }[];
  gears: { pivot: THREE.Object3D; doors: THREE.Object3D[] }[];
  nozzles: THREE.ShaderMaterial[];
  nozzleLights: THREE.PointLight[];
  /** Fondos de tobera (discos con degradado). */
  discs: THREE.MeshBasicMaterial[];
  pose: ShipPose;
  gear: number;
  wings: number;
}

// ---------------------------------------------------------------------------
// Forma
// ---------------------------------------------------------------------------

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Exponentes de la superelipse de la sección: lomo redondeado y panza más plana. */
const N_TOP = 3;
const N_BOTTOM = 4;

/** Coloca las salas detrás del morro (en la plantilla, z = 0 es el frente de la cabina). */
function roomsFor(tpl: ShipTemplate, noseScale: number): { rooms: ShipRoom[]; noseLen: number } {
  const noseLen = tpl.noseM * noseScale;
  return { rooms: tpl.rooms.map((r) => ({ ...r, center: [r.center[0], r.center[1], r.center[2] + noseLen] as const })), noseLen };
}

/** Interpolación de Hermite de los puntos del perfil (suave y sin pasarse entre puntos). */
function hullKeyAt(keys: Station[], z: number): Station {
  const fields = ["half", "top", "chine", "bottom"] as const;
  let i = 0;
  while (i < keys.length - 2 && z > keys[i + 1]!.z) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const dz = b.z - a.z;
  const t = Math.min(1, Math.max(0, (z - a.z) / dz));
  const slope = (j: number, f: (typeof fields)[number]) => {
    const p = keys[Math.max(0, j - 1)]!;
    const n = keys[Math.min(keys.length - 1, j + 1)]!;
    return (n[f] - p[f]) / Math.max(1e-6, n.z - p.z);
  };
  const t2 = t * t;
  const t3 = t2 * t;
  const out: Station = { z, half: 0, top: 0, chine: 0, bottom: 0 };
  for (const f of fields) {
    out[f] = (2 * t3 - 3 * t2 + 1) * a[f] + (t3 - 2 * t2 + t) * dz * slope(i, f) + (-2 * t3 + 3 * t2) * b[f] + (t3 - t2) * dz * slope(i + 1, f);
  }
  return out;
}

/** Estaciones del casco: morro según la pieza elegida, cuerpo del perfil de la plantilla y tapa de popa. */
function hullStations(tpl: ShipTemplate, noseLen: number, nose: ShipCustomization["parts"]["nose"]): Station[] {
  const keys: Station[] = tpl.hull.map(([z, half, top, chine, bottom]) => ({ z: z + noseLen, half, top, chine, bottom }));
  const base = keys[0]!;
  const out: Station[] = [];
  const N = 36;
  for (let i = 0; i < N; i++) {
    const k = Math.max(0.012, i / N); // 0 en la punta
    const f = 1 - (1 - k) * (1 - k); // ojiva: sin escalón al llegar a la cabina
    let w: number;
    let up: number;
    let down: number;
    let chine = base.chine;
    if (nose === "needle") {
      w = Math.pow(f, 1.15);
      up = Math.pow(f, 1.6);
      down = Math.pow(f, 1.05);
      chine = base.chine - (1 - k) * 0.25;
    } else if (nose === "blunt") {
      const g = Math.sqrt(1 - Math.pow(1 - Math.min(1, k * 1.6), 2));
      w = 0.2 + 0.8 * Math.max(g, f);
      up = 0.15 + 0.85 * Math.max(g * 0.8, f);
      down = 0.2 + 0.8 * Math.max(g, f);
    } else {
      // Cincel: cuña de lomo recto y filo horizontal ancho.
      w = 0.16 + 0.84 * Math.pow(f, 0.85);
      up = Math.pow(k, 1.1);
      down = 0.22 + 0.78 * f;
      chine = base.chine - (1 - k) * 0.12;
    }
    out.push({
      z: k * noseLen,
      half: Math.max(0.03, base.half * w),
      top: chine + (base.top - chine) * Math.max(0.03, up),
      chine,
      bottom: chine - (chine - base.bottom) * Math.max(0.03, down),
    });
  }
  const last = keys[keys.length - 1]!;
  for (let z = base.z; z <= last.z + 1e-6; z += 0.25) out.push(hullKeyAt(keys, z));
  // Popa: el casco se recoge un poco hasta la placa de las toberas.
  for (let i = 1; i <= 4; i++) {
    const k = i / 4;
    out.push({ z: last.z + 0.6 * k, half: last.half * (1 - 0.12 * k), top: last.top - (last.top - last.chine) * 0.12 * k, chine: last.chine, bottom: last.bottom + (last.chine - last.bottom) * 0.12 * k });
  }
  return out;
}

function stationAt(stations: Station[], z: number): Station {
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i]!;
    const b = stations[i + 1]!;
    if (z >= a.z && z <= b.z) {
      const k = (z - a.z) / Math.max(1e-6, b.z - a.z);
      const mix = (p: number, q: number) => p + (q - p) * k;
      return { z, half: mix(a.half, b.half), top: mix(a.top, b.top), chine: mix(a.chine, b.chine), bottom: mix(a.bottom, b.bottom) };
    }
  }
  return { ...stations[z < stations[0]!.z ? 0 : stations.length - 1]!, z };
}

/** Altura del lomo en x. */
function topY(s: Station, x: number): number {
  const u = Math.min(1, Math.abs(x) / s.half);
  return s.chine + (s.top - s.chine) * Math.pow(1 - Math.pow(u, N_TOP), 1 / N_TOP);
}

/** Altura de la panza en x. */
function bottomY(s: Station, x: number): number {
  const u = Math.min(1, Math.abs(x) / s.half);
  return s.chine - (s.chine - s.bottom) * Math.pow(1 - Math.pow(u, N_BOTTOM), 1 / N_BOTTOM);
}

/** Distancia del costado al eje a la altura y. */
function sideX(s: Station, y: number): number {
  if (y >= s.chine) return s.half * Math.pow(1 - Math.pow(Math.min(1, (y - s.chine) / (s.top - s.chine)), N_TOP), 1 / N_TOP);
  return s.half * Math.pow(1 - Math.pow(Math.min(1, (s.chine - y) / (s.chine - s.bottom)), N_BOTTOM), 1 / N_BOTTOM);
}

/** Normal del casco en un punto de la sección (sin la pendiente a lo largo, que es pequeña). */
function surfaceNormal(s: Station, x: number, y: number): THREE.Vector3 {
  const above = y >= s.chine;
  const n = above ? N_TOP : N_BOTTOM;
  const V = above ? s.top - s.chine : s.chine - s.bottom;
  const ax = Math.min(1, Math.abs(x) / s.half);
  const ay = Math.min(1, Math.abs(y - s.chine) / V);
  const v = new THREE.Vector3(Math.sign(x) * Math.pow(ax, n - 1) / s.half, Math.sign(y - s.chine) * Math.pow(ay, n - 1) / V, 0);
  return v.lengthSq() < 1e-12 ? new THREE.Vector3(0, above ? 1 : -1, 0) : v.normalize();
}

/** Sección del casco (superelipse unida en la arista, con un reborde fino en ella), de lomo a estribor. */
function sectionPoints(s: Station, sides: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const t = Math.PI / 2 - (i / sides) * Math.PI * 2;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const e = 2 / (sn >= 0 ? N_TOP : N_BOTTOM);
    const y = sn >= 0 ? s.chine + (s.top - s.chine) * Math.pow(sn, e) : s.chine - (s.chine - s.bottom) * Math.pow(-sn, e);
    const x = s.half * Math.sign(c) * Math.pow(Math.abs(c), e) * (1 + 0.03 * Math.pow(1 - Math.abs(sn), 14));
    pts.push(new THREE.Vector3(x, y, s.z));
  }
  return pts;
}

/**
 * Comprueba que las salas (con el grosor del casco) caben en el casco: devuelve
 * lo que se sale (vacío si todo cabe). El techo de la cabina no cuenta: lo
 * cubre la burbuja de cristal.
 */
export function shipRoomsFit(stations: Station[], rooms: ShipRoom[], hullM: number): string[] {
  const bad: string[] = [];
  for (const r of rooms) {
    const z0 = r.center[2] - r.size[2] / 2;
    const z1 = r.center[2] + r.size[2] / 2;
    for (let z = z0 + 0.01; z <= z1; z += 0.5) {
      const s = stationAt(stations, z);
      const x = Math.abs(r.center[0]) + r.size[0] / 2 + hullM;
      const yT = r.center[1] + r.size[1] / 2 + hullM;
      const yB = r.center[1] - r.size[1] / 2 - hullM;
      const top = Math.pow(x / s.half, N_TOP) + Math.pow(Math.max(0, yT - s.chine) / (s.top - s.chine), N_TOP);
      const bottom = Math.pow(x / s.half, N_BOTTOM) + Math.pow(Math.max(0, s.chine - yB) / (s.chine - s.bottom), N_BOTTOM);
      if (r.kind !== "cockpit" && top > 1) bad.push(`${r.id} techo z=${z.toFixed(1)} (${top.toFixed(2)})`);
      if (bottom > 1) bad.push(`${r.id} suelo z=${z.toFixed(1)} (${bottom.toFixed(2)})`);
    }
  }
  return bad;
}

/** Loft cerrado por las estaciones con la sección dada; tapas en los extremos y, si se pide, huecos. */
function loftWith(stations: Station[], sides: number, section: (s: Station) => THREE.Vector3[], capEnds = true, hole?: (p: THREE.Vector3) => boolean): THREE.BufferGeometry {
  const rings = stations.map(section);
  const pos: number[] = [];
  const index: number[] = [];
  for (const ring of rings) for (const p of ring) pos.push(p.x, p.y, p.z);
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (hole && hole(rings[r]![i]!) && hole(rings[r]![j]!) && hole(rings[r + 1]![i]!) && hole(rings[r + 1]![j]!)) continue;
      const a = r * sides + i;
      const b = r * sides + j;
      const c = (r + 1) * sides + i;
      const d = (r + 1) * sides + j;
      index.push(a, c, b, b, c, d);
    }
  }
  // Coordenadas de paneles: z y la distancia por la sección desde el lomo (igual a los dos lados).
  const panel: number[] = [];
  for (const ring of rings) {
    const cum = [0];
    for (let i = 1; i <= sides; i++) cum.push(cum[i - 1]! + ring[i % sides]!.distanceTo(ring[i - 1]!));
    const P = cum[sides]!;
    for (let i = 0; i < sides; i++) panel.push(ring[i]!.z, Math.min(cum[i]!, P - cum[i]!));
  }
  if (capEnds) {
    // Tapas con sus propios vértices (arista viva) y paneles en su plano.
    for (const [ring, flip] of [[rings[0]!, false], [rings[rings.length - 1]!, true]] as const) {
      const start = pos.length / 3;
      const c = ring.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / sides);
      pos.push(c.x, c.y, c.z);
      panel.push(c.x + 500, c.y);
      for (const p of ring) {
        pos.push(p.x, p.y, p.z);
        panel.push(p.x + 500, p.y);
      }
      for (let i = 0; i < sides; i++) {
        const a = start + 1 + i;
        const b = start + 1 + ((i + 1) % sides);
        if (flip) index.push(start, b, a);
        else index.push(start, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aPanel", new THREE.Float32BufferAttribute(panel, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Pieza torneada alrededor del eje z (perfil: [radio, z]), ya en su sitio. */
function lathe(profile: [number, number][], x: number, y: number, segments = 48): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    segments,
  );
  g.rotateX(Math.PI / 2);
  g.translate(x, y, 0);
  return g;
}

function boxAt(x: number, y: number, z: number, w: number, h: number, l: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function cylZ(x: number, y: number, z0: number, z1: number, r0: number, r1: number, seg = 20): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

function cylY(x: number, y0: number, y1: number, z: number, r: number, seg = 14): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Pieza hecha con su base en y = 0 (hacia +y), apoyada en el casco con su normal. */
function onSurface(g: THREE.BufferGeometry, pos: THREE.Vector3, normal: THREE.Vector3, sink = 0.02): THREE.BufferGeometry {
  g.translate(0, -sink, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, normal));
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

/** Pieza plana que mira hacia +z (círculos, aros), puesta de cara según la normal. */
function facing(g: THREE.BufferGeometry, pos: THREE.Vector3, normal: THREE.Vector3): THREE.BufferGeometry {
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(FORWARD, normal));
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

/** Refleja en x invirtiendo los triángulos (para que sigan mirando hacia fuera). */
function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.scale(-1, 1, 1);
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2]!, a[i + 1]!];
    idx.needsUpdate = true;
  } else {
    // Sin índice (extrusiones): se cambia el orden de los vértices de cada triángulo.
    for (const name of Object.keys(g.attributes)) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      const n = attr.itemSize;
      const arr = attr.array as Float32Array;
      for (let t = 0; t < attr.count; t += 3) {
        for (let k = 0; k < n; k++) {
          const i1 = (t + 1) * n + k;
          const i2 = (t + 2) * n + k;
          [arr[i1], arr[i2]] = [arr[i2]!, arr[i1]!];
        }
      }
      attr.needsUpdate = true;
    }
  }
  return g;
}

/** Ala biselada: planta en el plano xz (x hacia fuera desde la raíz, en 0), con su grosor. */
function wingShape(planform: [number, number][], thickness: number, side: number, dihedral = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(planform.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness * 0.4, bevelEnabled: true, bevelThickness: thickness * 0.3, bevelSize: thickness * 0.45, bevelSegments: 3, curveSegments: 6 });
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness * 0.2, 0);
  if (dihedral) g.rotateZ(dihedral);
  if (side < 0) mirrorX(g);
  g.computeVertexNormals();
  return g;
}

/** Une geometrías (solo posición y normales, que se conservan). */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (name !== "position" && name !== "normal") n.deleteAttribute(name);
    if (!n.getAttribute("normal")) n.computeVertexNormals();
    return n;
  });
  return mergeGeometries(clean);
}

// ---------------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------------

/** Relieve por sombreador: juntas de paneles escalonados, remaches y suciedad, en los ejes de la nave. */
const SEAM_GLSL = /* glsl */ `
  varying vec3 vShip;
  varying vec3 vShipNormal;
  #ifdef AEON_HULL_UV
  varying vec2 vPanel;
  #endif
  uniform float uPanelScale;
  float aeonHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float aeonNoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(aeonHash(i), aeonHash(i + vec3(1,0,0)), f.x), mix(aeonHash(i + vec3(0,1,0)), aeonHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(aeonHash(i + vec3(0,0,1)), aeonHash(i + vec3(1,0,1)), f.x), mix(aeonHash(i + vec3(0,1,1)), aeonHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  vec2 aeonCell;
  float aeonSeam(out float rivet) {
    #ifdef AEON_HULL_UV
    // Casco: paneles a lo largo (z) y alrededor de la sección (simétricos a babor y estribor).
    vec2 q = vPanel / uPanelScale;
    #else
    vec3 p = vShip / uPanelScale;
    vec3 n = abs(normalize(vShipNormal));
    vec2 q = n.y > max(n.x, n.z) ? p.xz : (n.x > n.z ? p.zy : p.xy);
    #endif
    q.x *= 0.45;
    float row = floor(q.y);
    q.x += row * 0.37;
    aeonCell = floor(q);
    vec2 f = abs(fract(q) - 0.5);
    float d = min((0.5 - f.x) / 0.45, 0.5 - f.y);
    // Remaches junto a las juntas transversales.
    float along = fract(q.x * 3.6) - 0.5;
    float across = (0.5 - f.x) / 0.45 - 0.07;
    rivet = 1.0 - smoothstep(0.015, 0.035, length(vec2(along / 3.6 * 0.45 * uPanelScale, across * 0.45 * uPanelScale)));
    return d;
  }
  vec3 aeonPerturb(vec3 surfPos, vec3 surfNorm, float h, float scale) {
    vec3 sx = dFdx(surfPos); vec3 sy = dFdy(surfPos);
    vec3 r1 = cross(sy, surfNorm); vec3 r2 = cross(surfNorm, sx);
    float det = dot(sx, r1);
    vec2 dh = vec2(dFdx(h), dFdy(h)) * scale;
    vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
    return normalize(abs(det) * surfNorm - grad);
  }
`;

interface PaintOptions {
  base: THREE.Color;
  pattern?: number;
  secondary?: THREE.Color;
  accent?: THREE.Color;
  length?: number;
  panelScale?: number;
  wear?: number;
  /** Paneles por las coordenadas del casco (atributo `aPanel` del loft) en vez de por los ejes. */
  hullUV?: boolean;
}

/** Material con juntas y relieve; con `pattern`, la pintura del jugador. */
function panelMaterial(kind: "paint" | "metal", o: PaintOptions): THREE.MeshPhysicalMaterial {
  const m =
    kind === "paint"
      ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.08, clearcoat: 0.8, clearcoatRoughness: 0.16 })
      : new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.85 });
  const uniforms = {
    uPrimary: { value: o.base },
    uSecondary: { value: o.secondary ?? o.base },
    uAccent: { value: o.accent ?? o.base },
    uPattern: { value: o.pattern ?? 0 },
    uLength: { value: o.length ?? 30 },
    uPanelScale: { value: o.panelScale ?? 1.1 },
    uWear: { value: o.wear ?? 0.25 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vShip;\nvarying vec3 vShipNormal;${o.hullUV ? "\nattribute vec2 aPanel;\nvarying vec2 vPanel;" : ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvShip = position;\nvShipNormal = normal;${o.hullUV ? "\nvPanel = aPanel;" : ""}`);
    if (o.hullUV) shader.fragmentShader = "#define AEON_HULL_UV\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        ${SEAM_GLSL}
        uniform vec3 uPrimary;
        uniform vec3 uSecondary;
        uniform vec3 uAccent;
        uniform int uPattern;
        uniform float uLength;
        uniform float uWear;
        float aeonSeamD;
        float aeonRivet;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        aeonSeamD = aeonSeam(aeonRivet);
        vec3 paint = uPrimary;
        float u = vShip.z / uLength;
        // Bitono: la parte de abajo desde la arista lateral.
        float belly = smoothstep(0.06, -0.06, normalize(vShipNormal).y);
        if (uPattern == 1) {
          paint = mix(uPrimary, uSecondary, belly);
        } else if (uPattern == 2) {
          float s = abs(vShip.x);
          paint = mix(uPrimary, uAccent, step(0.55, s) * step(s, 0.85) * step(0.2, normalize(vShipNormal).y));
          paint = mix(paint, uSecondary, belly);
        } else if (uPattern == 3) {
          float b = fract(u * 5.0);
          paint = mix(uPrimary, uSecondary, step(0.72, b));
          paint = mix(paint, uAccent, step(0.68, b) * step(b, 0.72));
        } else if (uPattern == 4) {
          float n = aeonNoise(vShip * 0.9) * 0.6 + aeonNoise(vShip * 3.1) * 0.4;
          paint = mix(uPrimary, uSecondary, smoothstep(0.6, 0.66, n));
        }
        float grime = aeonNoise(vShip * 1.7) * 0.5 + aeonNoise(vShip * 6.3) * 0.5;
        // Cada panel con un tono algo distinto (chapas cambiadas en distintas revisiones).
        paint *= 0.95 + 0.08 * aeonHash(vec3(aeonCell, 7.0));
        paint *= 1.0 - (1.0 - smoothstep(0.0, 0.03, aeonSeamD)) * 0.28;
        paint *= 1.0 - grime * uWear * 0.35 - belly * 0.08;
        paint *= 1.0 - aeonRivet * 0.3;
        diffuseColor.rgb *= paint;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (1.0 - smoothstep(0.0, 0.03, aeonSeamD)) * 0.3 + (aeonNoise(vShip * 4.0) - 0.5) * 0.12, 0.05, 1.0);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        float aeonH = smoothstep(0.0, 0.02, aeonSeamD) + aeonRivet * 0.25 + aeonNoise(vShip * 9.0) * 0.04;
        normal = aeonPerturb(-vViewPosition, normal, aeonH, 0.05);`,
      );
  };
  m.customProgramCacheKey = () => `aeon-panel-${kind}${o.hullUV ? "-hull" : ""}`;
  return m;
}

/** Fondo de la tobera: degradado del color de las luces, casi blanco en el centro. */
function glowDisc(color: string): THREE.MeshBasicMaterial {
  const map = canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.25, "#f2fbff");
    grad.addColorStop(0.6, color);
    grad.addColorStop(1, "#0a1a2a");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  return new THREE.MeshBasicMaterial({ map, toneMapped: false });
}

/** Interior de la tobera: brillo del color de las luces, más intenso en el centro, que late. */
function nozzleMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 1 } },
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uPower; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        vec3 hot = mix(uColor * 1.4, vec3(1.0, 0.95, 0.9) * 3.0, f * f);
        gl_FragColor = vec4(hot * (0.6 + 1.4 * f) * uPower, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// Texturas pintadas (marcas)
// ---------------------------------------------------------------------------

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function marksTexture(c: ShipCustomization, tpl: ShipTemplate): THREE.CanvasTexture {
  return canvasTexture(1024, 256, (g) => {
    g.fillStyle = c.colors.accent;
    g.font = "bold 150px 'Rajdhani', 'Arial Narrow', sans-serif";
    g.textBaseline = "middle";
    const number = c.marks.number || "00";
    g.fillText(number, 16, 120);
    const w = g.measureText(number).width;
    g.fillRect(32 + w, 60, 8, 120);
    g.font = "600 46px 'Rajdhani', 'Arial Narrow', sans-serif";
    g.fillStyle = "#1c1f26";
    g.fillText((c.marks.name || "AEONARCH").toUpperCase(), 64 + w, 100);
    g.font = "500 26px 'JetBrains Mono', monospace";
    g.fillStyle = "rgba(28,31,38,0.8)";
    g.fillText(`CN-${number} · ${tpl.lengthM} M · ${tpl.crew} PAX`, 66 + w, 152);
  });
}

/** Compuerta de la esclusa: contorno, asidero hundido, flecha y rótulo. */
function doorTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 410, (g) => {
    g.strokeStyle = "rgba(20,22,28,0.85)";
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(14, 14, 228, 382, 26);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(26, 26, 204, 358, 18);
    g.stroke();
    g.fillStyle = "rgba(20,22,28,0.85)";
    g.fillRect(170, 180, 40, 60);
    g.fillStyle = "#e0a82e";
    g.fillRect(176, 186, 28, 6);
    g.font = "bold 22px 'Rajdhani', 'Arial Narrow', sans-serif";
    g.fillStyle = "rgba(20,22,28,0.9)";
    g.fillText("ESCLUSA", 44, 70);
    g.fillText("AIRLOCK", 44, 96);
    g.beginPath();
    g.moveTo(44, 300);
    g.lineTo(120, 300);
    g.lineTo(120, 286);
    g.lineTo(146, 310);
    g.lineTo(120, 334);
    g.lineTo(120, 320);
    g.lineTo(44, 320);
    g.closePath();
    g.fill();
  });
}

/** Aviso pequeño estarcido. */
function stencilTexture(text: string): THREE.CanvasTexture {
  return canvasTexture(512, 80, (g) => {
    g.fillStyle = "rgba(20,22,28,0.85)";
    g.font = "600 44px 'Rajdhani', 'Arial Narrow', sans-serif";
    g.textBaseline = "middle";
    g.fillText(text, 8, 42);
  });
}

function warningTexture(text: string): THREE.CanvasTexture {
  return canvasTexture(512, 128, (g) => {
    for (let i = -2; i < 20; i++) {
      g.fillStyle = i % 2 ? "#e0a82e" : "#14151a";
      g.beginPath();
      g.moveTo(i * 32, 128);
      g.lineTo(i * 32 + 32, 96);
      g.lineTo(i * 32 + 64, 96);
      g.lineTo(i * 32 + 32, 128);
      g.fill();
    }
    g.fillStyle = "#14151a";
    g.font = "bold 40px 'Rajdhani', 'Arial Narrow', sans-serif";
    g.fillText(text, 12, 60);
  });
}

function emblemTexture(c: ShipCustomization): THREE.CanvasTexture | null {
  if (c.marks.emblem === "none") return null;
  return canvasTexture(256, 256, (g) => {
    g.translate(128, 128);
    g.fillStyle = c.colors.accent;
    g.strokeStyle = c.colors.accent;
    g.lineWidth = 10;
    if (c.marks.emblem === "aeon") {
      g.beginPath();
      g.arc(0, 0, 80, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(0, -112);
      for (const [x, y] of [[16, -16], [112, 0], [16, 16], [0, 112], [-16, 16], [-112, 0], [-16, -16]] as const) g.lineTo(x, y);
      g.closePath();
      g.fill();
    } else if (c.marks.emblem === "star") {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 44 : 110;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    } else if (c.marks.emblem === "wing") {
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(0, 20);
        g.lineTo(s * 115, -50);
        g.lineTo(s * 90, -10);
        g.lineTo(s * 60, 0);
        g.lineTo(s * 30, 40);
        g.closePath();
        g.fill();
      }
    } else {
      g.beginPath();
      g.moveTo(-90, 60);
      g.lineTo(-100, -40);
      g.lineTo(-45, 10);
      g.lineTo(0, -70);
      g.lineTo(45, 10);
      g.lineTo(100, -40);
      g.lineTo(90, 60);
      g.closePath();
      g.fill();
    }
  });
}

/** Calcomanía plana pegada al casco (un poco por fuera para no parpadear). */
function decal(texture: THREE.Texture, w: number, h: number, pos: THREE.Vector3, normal: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshPhysicalMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.4, clearcoat: 0.8 }),
  );
  const target = pos.clone().add(normal);
  mesh.position.copy(pos).addScaledVector(normal, 0.03);
  mesh.up.copy(up);
  mesh.lookAt(target.addScaledVector(normal, 0.03));
  return mesh;
}

// ---------------------------------------------------------------------------
// Nave
// ---------------------------------------------------------------------------

/** Juego de piezas por material: se unen y se añaden a un grupo (el casco o una articulación). */
class Parts {
  readonly paint: THREE.BufferGeometry[] = [];
  readonly accent: THREE.BufferGeometry[] = [];
  readonly dark: THREE.BufferGeometry[] = [];
  readonly metal: THREE.BufferGeometry[] = [];
  readonly black: THREE.BufferGeometry[] = [];
  build(into: THREE.Object3D, m: Record<"paint" | "accent" | "dark" | "metal" | "black", THREE.Material>): void {
    for (const key of ["paint", "accent", "dark", "metal", "black"] as const) {
      const list = this[key];
      if (!list.length) continue;
      const mesh = new THREE.Mesh(merge(list), m[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      into.add(mesh);
    }
  }
}

/**
 * Construye la nave personalizada. Devuelve el grupo (en metros, proa hacia −z,
 * centrado en la eslora; con `landed`, las patas tocan y = 0) y sus datos.
 * `interior`: el casco medio transparente y las salas como cajas de colores.
 */
export function createCustomShip(c: ShipCustomization, opts: { interior?: boolean; landed?: boolean; pose?: ShipPose } = {}): { group: THREE.Group; info: CustomShipInfo } {
  const tpl = SHIP_TEMPLATES[c.template] ?? SHIP_TEMPLATES.gunship!;
  const { rooms, noseLen } = roomsFor(tpl, c.proportions.nose);
  const stations = hullStations(tpl, noseLen, c.parts.nose);
  const length = stations[stations.length - 1]!.z;
  const at = (z: number) => stationAt(stations, z);
  const ship = new THREE.Group();
  const pose: ShipPose = opts.pose ?? { gearDown: true, wingsOpen: true };
  const anim: ShipAnim = { fans: [], strobes: [], beacons: [], navLights: [], dish: null, turret: null, wingBlades: [], gears: [], nozzles: [], nozzleLights: [], discs: [], pose, gear: pose.gearDown ? 1 : 0, wings: pose.wingsOpen ? 1 : 0 };

  // Puntos del casco: en el lomo, en un costado (a una altura) y en la panza.
  const topAt = (z: number, x: number) => {
    const s = at(z);
    const y = topY(s, x);
    return { p: new THREE.Vector3(x, y, z), n: surfaceNormal(s, x, y + 1e-4) };
  };
  const sideAt = (z: number, side: number, y: number) => {
    const s = at(z);
    const x = side * sideX(s, y);
    return { p: new THREE.Vector3(x, y, z), n: surfaceNormal(s, x, y) };
  };
  const bellyAt = (z: number, x: number) => {
    const s = at(z);
    const y = bottomY(s, x);
    return { p: new THREE.Vector3(x, y, z), n: surfaceNormal(s, x, y - 1e-4) };
  };

  const lights = new THREE.Color(c.colors.lights);
  const mats = {
    paint: panelMaterial("paint", { base: new THREE.Color(c.colors.primary), secondary: new THREE.Color(c.colors.secondary), accent: new THREE.Color(c.colors.accent), pattern: PATTERN_ID[c.pattern], length, panelScale: 2.2, wear: c.pattern === "worn" ? 0.6 : 0.25 }),
    hull: panelMaterial("paint", { base: new THREE.Color(c.colors.primary), secondary: new THREE.Color(c.colors.secondary), accent: new THREE.Color(c.colors.accent), pattern: PATTERN_ID[c.pattern], length, panelScale: 2.2, wear: c.pattern === "worn" ? 0.6 : 0.25, hullUV: true }),
    accent: panelMaterial("paint", { base: new THREE.Color(c.colors.accent), panelScale: 6, wear: 0.15 }),
    // Las piezas pequeñas, casi sin juntas (las juntas a su escala parecían remaches por todas partes).
    dark: panelMaterial("metal", { base: new THREE.Color(0x3a3e46), panelScale: 3, wear: 0.4 }),
    metal: panelMaterial("metal", { base: new THREE.Color(0x9aa0a8), panelScale: 3, wear: 0.3 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide }),
  };
  // El plato del radar y los pétalos de las toberas se ven por las dos caras.
  mats.metal.side = THREE.DoubleSide;
  // Cristal ahumado, casi negro por fuera, que deja ver la cabina encendida.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c141c, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, transparent: true, opacity: opts.interior ? 0.2 : 0.62, depthWrite: false, side: THREE.DoubleSide });
  if (opts.interior) {
    for (const m of [mats.paint, mats.hull, mats.accent, mats.dark, mats.metal]) {
      m.transparent = true;
      m.opacity = 0.22;
      m.depthWrite = false;
    }
  }
  const hull = new Parts();
  const cockpit = rooms.find((r) => r.kind === "cockpit") ?? rooms[0]!;

  // Cabina: la burbuja de cristal arranca en el morro y acaba redondeada detrás de los asientos.
  const cz0 = noseLen - 1.9;
  const cz1 = cockpit.center[2] + cockpit.size[2] / 2 + 0.3;
  const canopyK = (z: number) => (z - cz0) / (cz1 - cz0);
  const canopyHalf = (z: number) => {
    const k = canopyK(z);
    if (k <= 0 || k >= 1) return 0;
    const front = Math.pow(Math.sin(Math.min(1, k / 0.42) * (Math.PI / 2)), 0.75);
    const back = k > 0.8 ? Math.sqrt(Math.max(0, 1 - ((k - 0.8) / 0.2) ** 2)) : 1;
    return Math.min(1.4, at(z).half * 0.62) * front * back;
  };
  const canopyRise = (z: number) => {
    const k = canopyK(z);
    const front = Math.pow(Math.sin(Math.min(1, k / 0.55) * (Math.PI / 2)), 1.3);
    const back = k > 0.7 ? Math.sqrt(Math.max(0, 1 - ((k - 0.7) / 0.3) ** 2)) : 1;
    return 0.7 * front * back;
  };
  // Hueco del casco bajo el cristal (por él se ve la cabina).
  const underCanopy = (p: THREE.Vector3) => p.z > cz0 && p.z < cz1 && Math.abs(p.x) < canopyHalf(p.z) * 0.8 && p.y > at(p.z).chine + 0.15;

  // Casco.
  const hullMesh = new THREE.Mesh(loftWith(stations, 96, (s) => sectionPoints(s, 96), true, underCanopy), mats.hull);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  ship.add(hullMesh);
  // Forro interior del hueco de la cabina: oscuro, se ve desde dentro.
  {
    const inner = stations.filter((s) => s.z >= cz0 - 0.3 && s.z <= cz1 + 0.3).map((s) => ({ z: s.z, half: s.half - 0.12, top: s.top - 0.12, chine: s.chine, bottom: s.bottom + 0.12 }));
    const liner = new THREE.Mesh(loftWith(inner, 96, (s) => sectionPoints(s, 96), true, underCanopy), new THREE.MeshStandardMaterial({ color: 0x1d2027, roughness: 0.8, metalness: 0.3, side: THREE.BackSide }));
    ship.add(liner);
  }

  const canopyStations: Station[] = [];
  for (let i = 1; i < 32; i++) {
    const z = cz0 + ((cz1 - cz0) * i) / 32;
    canopyStations.push({ z, half: canopyHalf(z), top: topY(at(z), 0) + canopyRise(z), chine: 0, bottom: 0 });
  }
  const canopyBase = (s: Station) => topY(at(s.z), s.half) - 0.04;
  /** Arco del cristal de babor a estribor (exponente < 1: costados casi verticales y techo amplio). */
  const archPoint = (s: Station, i: number, n: number, grow = 1) => {
    const th = Math.PI - (i / n) * Math.PI;
    const base = canopyBase(s);
    return new THREE.Vector3(Math.cos(th) * s.half * grow, base + (s.top - base) * Math.pow(Math.sin(th), 0.45), s.z);
  };
  const canopy = new THREE.Mesh(
    loftWith(canopyStations, 40, (s) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 32; i++) pts.push(archPoint(s, i, 32));
      for (let i = 1; i <= 7; i++) pts.push(new THREE.Vector3(s.half - (i / 8) * 2 * s.half, canopyBase(s) - 0.1, s.z));
      return pts;
    }),
    glass,
  );
  ship.add(canopy);
  // Alféizar: banda oscura sobre el casco alrededor del cristal (tapa el borde del hueco).
  for (const side of [-1, 1]) {
    hull.dark.push(
      loftWith(canopyStations, 12, (s) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < 6; i++) {
          const x = side * s.half * (0.68 + (0.38 * i) / 5);
          pts.push(new THREE.Vector3(x, topY(at(s.z), x) + 0.025, s.z));
        }
        for (let i = 5; i >= 0; i--) {
          const x = side * s.half * (0.68 + (0.38 * i) / 5);
          pts.push(new THREE.Vector3(x, topY(at(s.z), x) - 0.05, s.z));
        }
        return side > 0 ? pts : pts.reverse();
      }),
    );
  }
  // Marcos de la cabina: lomo, tres arcos y los dos alféizares.
  const tube = (pts: THREE.Vector3[], r: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(12, pts.length * 2), r, 8, false);
  hull.dark.push(tube(canopyStations.slice(0, Math.round(canopyStations.length * 0.45)).map((s) => new THREE.Vector3(0, s.top + 0.02, s.z)), 0.035));
  for (const k of [0.45, 0.8]) {
    const s = canopyStations[Math.round(k * (canopyStations.length - 1))]!;
    const arch: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) arch.push(archPoint(s, i, 16, 1.02).add(new THREE.Vector3(0, 0.02, 0)));
    hull.dark.push(tube(arch, 0.04));
  }
  for (const side of [-1, 1]) hull.dark.push(tube(canopyStations.map((s) => new THREE.Vector3(side * s.half * 1.02, canopyBase(s) + 0.02, s.z)), 0.06));

  // Franja dorsal pintada en relieve, de detrás de la cabina a la popa.
  {
    const w = 0.42;
    const band = stations.filter((s) => s.z >= cz1 + 0.6 && s.z <= length - 1.6);
    hull.accent.push(
      loftWith(band, 20, (s) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < 10; i++) {
          const x = -w + (2 * w * i) / 9;
          pts.push(new THREE.Vector3(x, topY(s, x) + 0.025, s.z));
        }
        for (let i = 0; i < 10; i++) {
          const x = w - (2 * w * i) / 9;
          pts.push(new THREE.Vector3(x, topY(s, x) - 0.04, s.z));
        }
        return pts;
      }),
    );
  }

  // Panel antirreflejos negro mate delante del cristal y sonda en la punta del morro.
  hull.black.push(
    loftWith(
      stations.filter((s) => s.z >= cz0 - 4.5 && s.z <= cz0 + 0.5),
      12,
      (s) => {
        const k = Math.min(1, Math.max(0, (s.z - (cz0 - 4.5)) / 4.5));
        const w = Math.min(0.85, s.half * 0.55) * Math.sqrt(k);
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < 6; i++) {
          const x = -w + (2 * w * i) / 5;
          pts.push(new THREE.Vector3(x, topY(s, x) + 0.012, s.z));
        }
        for (let i = 5; i >= 0; i--) {
          const x = -w + (2 * w * i) / 5;
          pts.push(new THREE.Vector3(x, topY(s, x) - 0.03, s.z));
        }
        return pts;
      },
    ),
  );
  {
    const tip = stations[0]!;
    const y = (tip.top + tip.bottom) / 2;
    hull.metal.push(cylZ(0, y, -1.5, 0.4, 0.015, 0.06, 10));
    hull.dark.push(cylZ(0, y, -0.2, 0.25, 0.07, 0.07, 10));
  }
  // Luces de formación: tiras finas que brillan en la arista lateral.
  const strip = new THREE.MeshBasicMaterial({ color: lights.clone().multiplyScalar(1.6), toneMapped: false });
  for (const [z0, z1] of [
    [noseLen + 1.5, noseLen + 4.5],
    [noseLen + 5, noseLen + 10],
    [length - 5.5, length - 1.2],
  ] as const) {
    for (const side of [-1, 1]) {
      const geo = loftWith(
        stations.filter((s) => s.z >= z0 && s.z <= z1),
        4,
        (s) => {
          const x = side * (s.half * 1.03 + 0.012);
          const pts = [new THREE.Vector3(x, s.chine + 0.035, s.z), new THREE.Vector3(x + side * 0.02, s.chine + 0.035, s.z), new THREE.Vector3(x + side * 0.02, s.chine - 0.035, s.z), new THREE.Vector3(x, s.chine - 0.035, s.z)];
          return side > 0 ? pts : pts.reverse();
        },
      );
      ship.add(new THREE.Mesh(geo, strip));
    }
  }

  // Alas, de la arista hacia fuera. Las de abanico van en articulaciones (se pliegan y despliegan).
  const zR0 = noseLen + 11;
  const zR1 = noseLen + 26.5;
  const rootS = at((zR0 + zR1) / 2);
  const rootX = rootS.half * 0.9;
  // Con góndolas, el ala pasa por debajo de ellas.
  const wy = c.parts.engines === "nacelles" ? rootS.chine + 1.2 * c.proportions.engineSize * (0.35 - 1) - 0.32 : rootS.chine - 0.3;
  const span = 8.5 * c.proportions.wingSpan;
  const tipLights: THREE.Vector3[] = [];
  const placed = (g: THREE.BufferGeometry, side: number, y: number) => g.translate(side * rootX, y, 0);

  // Góndolas pegadas a los costados, sobre la raíz del ala.
  const es = c.proportions.engineSize;
  const podR = 1.2 * es;
  const podLen = 11;
  const podZ0 = noseLen + 18.5;
  const podX = Math.max(...stations.filter((s) => s.z >= podZ0 && s.z <= podZ0 + podLen).map((s) => s.half)) + podR + 0.2;
  const podY = rootS.chine + podR * 0.35;
  const nacelles = c.parts.engines === "nacelles";

  for (const side of [-1, 1]) {
    if (c.parts.wings === "swept") {
      // Flecha marcada: borde de ataque largo, puntas de 4 m y borde de salida algo adelantado.
      const lead = zR0 + span * 0.95;
      hull.paint.push(placed(wingShape([[0, zR0], [span, lead], [span, lead + 4], [0, zR1]], 0.62, side, 0.05), side, wy));
      hull.accent.push(placed(wingShape([[span - 1.1, lead - 0.15 - 1.1 * 0.95], [span + 0.02, lead - 0.05], [span + 0.02, lead + 4.05], [span - 1.1, lead + 3.95]], 0.65, side, 0.05), side, wy));
      tipLights.push(new THREE.Vector3(side * (rootX + span + 0.15), wy + span * 0.05 + 0.1, lead + 2));
    } else if (c.parts.wings === "delta") {
      hull.paint.push(placed(wingShape([[0, zR0 - 4], [span * 1.05, zR1 - 1.2], [span * 1.05, zR1], [0, zR1]], 0.55, side), side, wy));
      hull.accent.push(placed(wingShape([[span * 0.8, zR1 - 1.2 - (span * 0.25 * (zR1 - 1.2 - zR0 + 4)) / span], [span * 1.05 + 0.02, zR1 - 1.2], [span * 1.05 + 0.02, zR1], [span * 0.8, zR1]], 0.58, side), side, wy));
      tipLights.push(new THREE.Vector3(side * (rootX + span * 1.05 + 0.1), wy + 0.1, zR1 - 0.6));
    } else if (c.parts.wings === "fan") {
      // Tres palas por lado, cada una en su bisagra en el costado de la góndola: abiertas en abanico, plegadas hacia atrás.
      const hingeX = nacelles ? podX + podR * 0.8 : rootX;
      for (let k = 0; k < 3; k++) {
        const a = (k - 1) * 0.32;
        const L = span * 0.82 * (1.05 - Math.abs(k - 1) * 0.14);
        const hingeZ = zR0 + 3 + k * 1.6;
        const y = wy + 0.25 + (k - 1) * 0.42;
        const pivot = new THREE.Group();
        pivot.position.set(side * hingeX, y, hingeZ);
        const blade = new Parts();
        const tipX = Math.cos(a) * L;
        const tipZ = Math.sin(a) * L;
        blade.paint.push(wingShape([[0, -0.85], [tipX, tipZ - 0.6], [tipX + 0.35, tipZ], [tipX, tipZ + 0.6], [0, 0.85]], 0.28, side));
        blade.accent.push(wingShape([[tipX - 0.9, tipZ - 0.66], [tipX, tipZ - 0.6], [tipX + 0.37, tipZ], [tipX, tipZ + 0.6], [tipX - 0.9, tipZ + 0.66]], 0.3, side));
        blade.dark.push(cylY(0, -0.28, 0.28, 0, 0.3, 16));
        blade.build(pivot, mats);
        if (k === 1) anim.navLights.push(addLight(pivot, new THREE.Vector3(side * (tipX + 0.45), 0, tipZ), side < 0 ? 0xff2a2a : 0x2aff6a, 0.12, 6));
        ship.add(pivot);
        anim.wingBlades.push({ pivot, folded: side * (Math.PI / 2 - a - 0.12 + k * 0.07) });
      }
    } else {
      hull.paint.push(placed(wingShape([[0, zR0 + 2], [span * 0.5, zR0 + 3.6], [span * 0.5, zR0 + 7.4], [0, zR0 + 9]], 0.6, side), side, wy));
      tipLights.push(new THREE.Vector3(side * (rootX + span * 0.5 + 0.15), wy + 0.1, zR0 + 5.5));
    }
  }

  // Motores.
  const nozzleGlows: THREE.Vector3[] = [];
  const addPod = (x: number, y: number, z0: number, len: number, r: number, withFan: boolean) => {
    // Carenado: labio redondeado en la toma, vientre y cintura antes de la tobera.
    hull.paint.push(
      lathe(
        [
          [r * 0.8, z0 + 0.3],
          [r * 0.84, z0 + 0.06],
          [r * 0.92, z0],
          [r * 0.99, z0 + 0.1],
          [r * 1.02, z0 + 0.35],
          [r * 1.04, z0 + 0.3 * len],
          [r * 1.0, z0 + 0.66 * len],
          [r * 0.9, z0 + 0.84 * len],
          [r * 0.88, z0 + 0.86 * len],
          [r * 0.9, z0 + 0.96 * len],
          [r * 0.86, z0 + len],
        ],
        x,
        y,
        56,
      ),
    );
    // Aros de refuerzo, junta de la cintura y conducto oscuro de la toma.
    for (const k of [0.32, 0.6]) hull.metal.push(lathe([[r * 1.03, z0 + k * len - 0.06], [r * 1.06, z0 + k * len - 0.03], [r * 1.06, z0 + k * len + 0.03], [r * 1.03, z0 + k * len + 0.06]], x, y));
    hull.dark.push(lathe([[r * 0.88, z0 + 0.86 * len], [r * 0.93, z0 + 0.87 * len], [r * 0.93, z0 + 0.95 * len], [r * 0.9, z0 + 0.96 * len]], x, y));
    hull.black.push(lathe([[r * 0.8, z0 + 0.3], [r * 0.78, z0 + 1.6], [r * 0.5, z0 + 1.85], [0.01, z0 + 1.95]], x, y, 40));
    // Tobera: pétalos de metal y el interior que brilla.
    hull.metal.push(lathe([[r * 0.86, z0 + len], [r * 0.82, z0 + len + 0.35], [r * 0.74, z0 + len + 0.42], [r * 0.7, z0 + len + 0.1]], x, y, 40));
    if (withFan) {
      const fan = new THREE.Group();
      const fanParts = new Parts();
      const blades = 22;
      for (let i = 0; i < blades; i++) {
        const b = new THREE.BoxGeometry(0.04, r * 0.5, r * 0.2);
        b.translate(0, r * 0.47, 0);
        b.applyMatrix4(new THREE.Matrix4().makeRotationY(0.55));
        b.applyMatrix4(new THREE.Matrix4().makeRotationZ((i / blades) * Math.PI * 2));
        fanParts.metal.push(b);
      }
      const hub = new THREE.ConeGeometry(r * 0.24, r * 0.55, 32);
      hub.rotateX(-Math.PI / 2);
      hub.translate(0, 0, -r * 0.12);
      fanParts.dark.push(hub);
      fanParts.accent.push(new THREE.TorusGeometry(r * 0.13, 0.03, 8, 24).translate(0, 0, -r * 0.36));
      fanParts.build(fan, mats);
      fan.position.set(x, y, z0 + 1.1);
      ship.add(fan);
      anim.fans.push(fan);
    }
    const nozzle = nozzleMaterial(c.colors.lights);
    anim.nozzles.push(nozzle);
    const inner = new THREE.ConeGeometry(r * 0.72, 1.2, 32, 1, true);
    inner.rotateX(-Math.PI / 2);
    inner.translate(x, y, z0 + len - 0.4);
    ship.add(new THREE.Mesh(inner, nozzle));
    // Fondo de la tobera: cierra la góndola por detrás y brilla.
    const disc = glowDisc(c.colors.lights);
    anim.discs.push(disc);
    ship.add(new THREE.Mesh(new THREE.CircleGeometry(r * 0.72, 40).translate(x, y, z0 + len - 0.6), disc));
    nozzleGlows.push(new THREE.Vector3(x, y, z0 + len + 0.4));
  };
  const tailS = at(length - 0.7);
  if (nacelles) {
    for (const side of [-1, 1]) {
      addPod(side * podX, podY, podZ0, podLen, podR, true);
      // Pilón que une la góndola al costado del casco.
      const fairing: Station[] = [];
      for (let i = 0; i <= 16; i++) {
        const z = podZ0 + 1.6 + (podLen - 3.6) * (i / 16);
        const k = Math.sin((i / 16) * Math.PI);
        fairing.push({ z, half: 0, top: podY + 0.12 + 0.3 * Math.sqrt(k), chine: 0, bottom: podY - 0.12 - 0.3 * Math.sqrt(k) });
      }
      hull.paint.push(
        loftWith(fairing, 4, (s) => {
          const xs = side * (podX - podR * 0.8);
          const xTop = side * (sideX(at(s.z), s.top) - 0.1);
          const xBottom = side * (sideX(at(s.z), s.bottom) - 0.1);
          const pts = [new THREE.Vector3(xTop, s.top, s.z), new THREE.Vector3(xs, s.top, s.z), new THREE.Vector3(xs, s.bottom, s.z), new THREE.Vector3(xBottom, s.bottom, s.z)];
          return side > 0 ? pts : pts.reverse();
        }),
      );
    }
    // Placa de popa con la tobera auxiliar.
    hull.dark.push(lathe([[0.3, length - 0.05], [0.34, length + 0.2], [0.26, length + 0.24]], 0, tailS.chine + 0.15, 32));
    const apu = glowDisc(c.colors.lights);
    anim.discs.push(apu);
    ship.add(new THREE.Mesh(new THREE.CircleGeometry(0.26, 24).translate(0, tailS.chine + 0.15, length + 0.12), apu));
  } else if (c.parts.engines === "twin") {
    const r = 0.95 * es;
    const s = at(length - 4);
    for (const side of [-1, 1]) addPod(side * s.half * 0.48, s.chine + 0.2, length - 6, 7.2, r, true);
  } else {
    const r = 0.62 * es;
    const s = at(length - 4);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) addPod(sx * s.half * 0.42, s.chine + 0.15 + sy * 0.6, length - 4.2, 6, r, false);
  }

  // Rejillas y tomas de aire en el lomo, sobre la sala de máquinas: parches que siguen el casco con lamas encima.
  const engineering = rooms.find((r) => r.kind === "engineering");
  const patch = (z0: number, z1: number, x0: number, x1: number, lift: number, sink: number) =>
    loftWith(
      stations.filter((s) => s.z >= z0 && s.z <= z1),
      12,
      (s) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < 6; i++) {
          const x = x0 + ((x1 - x0) * i) / 5;
          pts.push(new THREE.Vector3(x, topY(at(s.z), x) + lift, s.z));
        }
        for (let i = 5; i >= 0; i--) {
          const x = x0 + ((x1 - x0) * i) / 5;
          pts.push(new THREE.Vector3(x, topY(at(s.z), x) - sink, s.z));
        }
        return pts;
      },
    );
  if (engineering) {
    const ez = engineering.center[2];
    for (const [z0, z1, xa, xb] of [
      [ez - 2.4, ez - 0.2, 0.6, 1.3],
      [ez - 2.4, ez - 0.2, -1.3, -0.6],
      [ez + 0.4, ez + 2.2, 1.55, 2.2],
      [ez + 0.4, ez + 2.2, -2.2, -1.55],
    ] as const) {
      const x0 = Math.min(xa, xb);
      const x1 = Math.max(xa, xb);
      hull.metal.push(patch(z0 - 0.08, z1 + 0.08, x0 - 0.08, x1 + 0.08, 0.02, 0.05));
      hull.black.push(patch(z0, z1, x0, x1, 0.03, 0.04));
      for (let z = z0 + 0.15; z < z1 - 0.05; z += 0.22) {
        const xm = (x0 + x1) / 2;
        const { p, n } = topAt(z, xm);
        hull.dark.push(onSurface(new THREE.BoxGeometry(x1 - x0, 0.06, 0.04).translate(0, 0.03, 0).rotateX(0.5), p, n, 0.0));
      }
    }
  }

  // Propulsores de maniobra (cuatro bocas) en el morro y la popa.
  for (const z of [noseLen + 0.6, length - 2.5]) {
    for (const side of [-1, 1]) {
      const { p, n } = sideAt(z, side, at(z).chine + 0.3);
      // Placa enrasada con cuatro bocas.
      hull.metal.push(onSurface(new THREE.BoxGeometry(0.46, 0.05, 0.58).translate(0, 0.025, 0), p, n, 0.03));
      for (const [dx, dz] of [[0.11, 0.14], [-0.11, 0.14], [0.11, -0.14], [-0.11, -0.14]] as const) {
        hull.black.push(onSurface(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 12).translate(dx, 0.04, dz), p, n, 0.02));
      }
    }
  }

  // Sensores: cúpula bajo el morro con su aro; antenas de cuchilla en el lomo.
  {
    const { p, n } = bellyAt(noseLen * 0.35, 0);
    hull.black.push(onSurface(new THREE.SphereGeometry(0.36, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), p, n, 0.02));
    hull.metal.push(onSurface(new THREE.TorusGeometry(0.38, 0.045, 8, 24).rotateX(Math.PI / 2), p, n, 0));
    for (const zz of [noseLen + 8, noseLen + 22]) {
      // Antena de cuchilla: aleta inclinada hacia atrás.
      const blade = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.3, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.42, 0.5), new THREE.Vector2(0.24, 0.52)]), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
      blade.rotateY(-Math.PI / 2);
      const { p: bp, n: bn } = topAt(zz, 1.6);
      hull.metal.push(onSurface(blade, bp, bn, 0.03));
    }
  }

  // Extras.
  if (c.parts.extras.includes("antenna")) {
    const az = noseLen + 18.5;
    const { p } = topAt(az, -0.95);
    hull.dark.push(cylY(p.x, p.y - 0.1, p.y + 2.6, az, 0.035, 8));
    hull.dark.push(cylY(p.x, p.y - 0.1, p.y + 0.4, az, 0.11, 12));
    anim.beacons.push(addLight(ship, new THREE.Vector3(p.x, p.y + 2.65, az), 0xff3a2a, 0.08));
    // Plato del radar, que gira.
    const dz = noseLen + 15;
    const { p: dp0 } = topAt(dz, 1.0);
    const dish = new THREE.Group();
    dish.position.set(dp0.x, dp0.y + 0.5, dz);
    const dp = new Parts();
    // Plato parabólico inclinado, con su bocina en el foco.
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const r = 0.05 + (i / 10) * 0.7;
      prof.push(new THREE.Vector2(r, r * r * 0.45));
    }
    const bowl = new THREE.LatheGeometry(prof, 32);
    const tilt = new THREE.Matrix4().makeRotationX(-1.0);
    bowl.applyMatrix4(tilt).translate(0, 0.25, 0);
    dp.metal.push(bowl);
    const feed = cylY(0, 0, 0.42, 0, 0.02, 6).applyMatrix4(tilt).translate(0, 0.25, 0);
    dp.dark.push(feed);
    dp.dark.push(new THREE.SphereGeometry(0.05, 10, 6).translate(0, 0.42, 0).applyMatrix4(tilt).translate(0, 0.25, 0));
    dp.build(dish, mats);
    ship.add(dish);
    hull.dark.push(cylY(dp0.x, dp0.y - 0.1, dp0.y + 0.5, dz, 0.08, 10));
    anim.dish = dish;
  }
  if (c.parts.extras.includes("turret")) {
    // Torreta bajo el morro: base, cúpula colgada y dos cañones que barren hacia delante.
    const tz = noseLen - 2.4;
    const { p, n } = bellyAt(tz, 0);
    hull.dark.push(onSurface(new THREE.CylinderGeometry(0.75, 0.85, 0.3, 32).translate(0, 0.15, 0), p, n, 0.12));
    const turret = new THREE.Group();
    turret.position.set(0, p.y - 0.2, tz);
    const tp = new Parts();
    const dome = new THREE.SphereGeometry(0.7, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    dome.scale(1, 0.75, 1.1);
    tp.paint.push(dome);
    for (const sx of [-0.24, 0.24]) {
      tp.metal.push(cylZ(sx, -0.3, -2.6, -0.3, 0.06, 0.08, 12));
      tp.dark.push(cylZ(sx, -0.3, -1.1, -0.3, 0.13, 0.13, 12));
      tp.black.push(cylZ(sx, -0.3, -2.64, -2.56, 0.045, 0.045, 8));
    }
    tp.build(turret, mats);
    ship.add(turret);
    anim.turret = turret;
  }
  if (c.parts.extras.includes("fin")) {
    const z0 = noseLen + 19.5;
    const L = 7.6;
    const y0 = topY(at(z0), 0);
    const drop = y0 - topY(at(z0 + L), 0);
    const fin = new THREE.Shape([new THREE.Vector2(0, -0.25), new THREE.Vector2(L, -0.25 - drop), new THREE.Vector2(L + 0.9, 2.9), new THREE.Vector2(L - 1.3, 3.1)]);
    const g = new THREE.ExtrudeGeometry(fin, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.06, y0, z0);
    hull.paint.push(g);
    const tip = new THREE.Shape([new THREE.Vector2(L - 0.9, 2.45), new THREE.Vector2(L + 0.82, 2.45), new THREE.Vector2(L + 0.9, 2.9), new THREE.Vector2(L - 1.3, 3.1)]);
    const tg = new THREE.ExtrudeGeometry(tip, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3 });
    tg.rotateY(-Math.PI / 2);
    tg.translate(0.07, y0, z0);
    hull.accent.push(tg);
    anim.strobes.push(addLight(ship, new THREE.Vector3(0, y0 + 3.2, z0 + L - 1.2), 0xffffff, 0.09));
  }
  if (c.parts.extras.includes("pods")) {
    // Lanzacohetes: bajo el ala si es ancha; si no, colgados del costado con su pilón.
    const onWing = c.parts.wings === "swept" || c.parts.wings === "delta";
    for (const side of [-1, 1]) {
      let x: number;
      let y: number;
      let z: number;
      if (onWing) {
        x = side * (rootX + span * 0.62);
        y = wy - 0.5;
        z = zR0 + span * 0.62 * 0.95 + 0.6;
        hull.dark.push(boxAt(x, y + 0.38, z + 1.8, 0.12, 0.3, 2.2));
      } else {
        z = noseLen + 10;
        const s = at(z + 1.8);
        y = s.chine - 0.75;
        const hx = sideX(s, y + 0.3);
        x = side * (hx + 0.55);
        hull.dark.push(boxAt(side * (hx + 0.2), y + 0.3, z + 1.8, 0.6, 0.12, 2.2));
      }
      hull.dark.push(cylZ(x, y, z, z + 3.6, 0.38, 0.38, 20));
      hull.metal.push(lathe([[0.3, z - 0.02], [0.38, z + 0.05]], x, y, 20));
      hull.black.push(new THREE.CircleGeometry(0.33, 20).rotateY(Math.PI).translate(x, y, z - 0.01));
      for (const [dx, dy] of [[0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]] as const) hull.metal.push(cylZ(x + dx, y + dy, z - 0.06, z, 0.1, 0.1, 10));
      hull.dark.push(lathe([[0.38, z + 3.6], [0.25, z + 4.0], [0.05, z + 4.15]], x, y, 20));
    }
  }

  // Tren de aterrizaje: cada pata en su bisagra (se recoge hacia delante) con dos compuertas.
  const lowest = Math.min(...stations.map((s) => s.bottom));
  const groundY = lowest - 1.5;
  const gearHeight = -groundY;
  for (const [gx, gz, big] of [
    [0, noseLen + 5.5, false],
    [-2.0, noseLen + 21.5, true],
    [2.0, noseLen + 21.5, true],
  ] as const) {
    const { p } = bellyAt(gz, gx);
    const yTop = p.y + 0.15;
    const legLen = yTop - groundY;
    const r = big ? 0.2 : 0.16;
    const pivot = new THREE.Group();
    pivot.position.set(gx, yTop, gz);
    const leg = new Parts();
    leg.dark.push(cylY(0, -legLen * 0.55, 0, 0, r, 16));
    leg.metal.push(cylY(0, -legLen + 0.3, -legLen * 0.5, 0, r * 0.62, 16));
    leg.dark.push(cylY(0, -legLen * 0.62, -legLen * 0.5, 0, r * 1.15, 16));
    // Bieleta de torsión y amortiguador trasero.
    leg.dark.push(boxAt(0, -legLen * 0.62, 0.22, 0.08, legLen * 0.3, 0.08, 0.5));
    leg.metal.push(cylY(0, -legLen * 0.3, -0.1, 0.42, 0.05, 8).rotateX(-0.35));
    // Pie.
    leg.dark.push(boxAt(0, -legLen + 0.16, 0, big ? 1.1 : 0.8, 0.22, big ? 1.5 : 1.1));
    leg.black.push(boxAt(0, -legLen + 0.025, 0, big ? 1.15 : 0.85, 0.05, big ? 1.55 : 1.15));
    leg.metal.push(cylY(0, -legLen + 0.26, -legLen + 0.42, 0, 0.18, 12));
    leg.build(pivot, mats);
    ship.add(pivot);
    const bayW = big ? 1.2 : 0.9;
    const bayL = legLen * 0.65;
    hull.black.push(onSurface(new THREE.BoxGeometry(bayW, 0.04, bayL).translate(0, 0, bayL / 2 - 0.4), p, new THREE.Vector3(0, -1, 0), 0.01));
    const doors: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const door = new THREE.Group();
      // Compuerta: cerrada queda plana sobre su mitad del hueco; abierta cuelga de la bisagra.
      door.position.set(gx + side * (bayW / 2), p.y - 0.02, gz + bayL / 2 - 0.4);
      const dp = new Parts();
      dp.dark.push(boxAt((-side * bayW) / 4, 0, 0, bayW / 2, 0.04, bayL));
      dp.build(door, mats);
      door.userData.side = side;
      ship.add(door);
      doors.push(door);
    }
    anim.gears.push({ pivot, doors });
  }

  // Rampa de la bodega (contorno en la panza).
  const cargo = rooms.find((r) => r.kind === "cargo");
  if (cargo) {
    const cz = cargo.center[2];
    for (const [w, l, x, z] of [[3.2, 0.06, 0, cz - 2.6], [3.2, 0.06, 0, cz + 2.6], [0.06, 5.2, -1.6, cz], [0.06, 5.2, 1.6, cz]] as const) {
      const { p, n } = bellyAt(z, x);
      hull.black.push(onSurface(new THREE.BoxGeometry(w, 0.03, l), p, n, 0.01));
    }
  }

  // Lo que se ve por las ventanas (aún no se camina por dentro, pero está en las salas reales).
  ship.add(cockpitInterior(cockpit, c));
  for (const room of rooms.filter((r) => r.kind === "quarters" || r.kind === "galley")) {
    const side = Math.sign(room.center[0]) || 1;
    for (const dz of [-1.3, 0, 1.3]) {
      const z = room.center[2] + dz;
      const { p, n } = sideAt(z, side, room.center[1] + 0.35);
      // Marco, cristal y la luz cálida de dentro.
      hull.metal.push(facing(new THREE.TorusGeometry(0.3, 0.055, 10, 28), p.clone().addScaledVector(n, 0.01), n));
      const inside = new THREE.Mesh(facing(new THREE.CircleGeometry(0.29, 28), p.clone().addScaledVector(n, -0.03), n), new THREE.MeshBasicMaterial({ color: room.kind === "quarters" ? 0xffc890 : 0xd8f0ff, toneMapped: false }));
      ship.add(inside);
      ship.add(new THREE.Mesh(facing(new THREE.CircleGeometry(0.3, 28), p.clone().addScaledVector(n, 0.02), n), glass));
    }
  }

  hull.build(ship, mats);
  canopy.castShadow = true;

  // Luces: navegación (roja a babor, verde a estribor), toberas y aterrizaje.
  for (const tip of tipLights) anim.navLights.push(addLight(ship, tip, tip.x < 0 ? 0xff2a2a : 0x2aff6a, 0.12, 6));
  for (const n of nozzleGlows) {
    const light = new THREE.PointLight(lights, 6, 10, 2);
    light.position.copy(n).add(new THREE.Vector3(0, 0, 0.8));
    ship.add(light);
    anim.nozzleLights.push(light);
  }
  for (const sx of [-0.5, 0.5]) {
    const { p } = bellyAt(noseLen + 1.2, sx);
    addLight(ship, p.clone().add(new THREE.Vector3(0, -0.04, 0)), 0xfff2d8, 0.08);
  }

  // Marcas: número y nombre en los costados de la bodega, avisos en las alas, emblema en el lomo.
  // Rótulos pintados: mallas que siguen la curva del casco (los planos flotaban en las curvas).
  const sideDecal = (texture: THREE.Texture, zc: number, yc: number, w: number, h: number, side: number) => {
    const N = 10;
    const pos: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const v = j / N;
        const z = side > 0 ? zc + (0.5 - u) * w : zc + (u - 0.5) * w;
        const y = yc + (v - 0.5) * h;
        pos.push(side * (sideX(at(z), y) * (1 + 0.03 * Math.pow(Math.max(0, 1 - Math.abs(y - at(z).chine) / 0.25), 2)) + 0.015), y, z);
        uv.push(u, v);
      }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) index.push(j * (N + 1) + i, j * (N + 1) + i + 1, (j + 1) * (N + 1) + i);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) index.push(j * (N + 1) + i + 1, (j + 1) * (N + 1) + i + 1, (j + 1) * (N + 1) + i);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.4, clearcoat: 0.8, side: THREE.DoubleSide }));
  };
  const topDecal = (texture: THREE.Texture, zc: number, xc: number, w: number, h: number) => {
    const N = 10;
    const pos: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = xc + (i / N - 0.5) * w;
        const z = zc - (j / N - 0.5) * h;
        pos.push(x, topY(at(z), x) + 0.015, z);
        uv.push(i / N, j / N);
      }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) index.push(j * (N + 1) + i, j * (N + 1) + i + 1, (j + 1) * (N + 1) + i, j * (N + 1) + i + 1, (j + 1) * (N + 1) + i + 1, (j + 1) * (N + 1) + i);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.4, clearcoat: 0.8, side: THREE.DoubleSide }));
  };
  const marks = marksTexture(c, tpl);
  for (const side of [-1, 1]) ship.add(sideDecal(marks, noseLen + 15.6, at(noseLen + 15.6).chine + 0.75, 3.2, 0.8, side));
  // Compuerta de la esclusa a babor, con su asidero y su rótulo.
  const airlock = rooms.find((r) => r.kind === "airlock");
  if (airlock) {
    const door = doorTexture();
    ship.add(sideDecal(door, airlock.center[2], airlock.center[1] - 0.05, 1.25, 2.0, -1));
  }
  // Avisos pequeños: toma de combustible, oxígeno y propulsores.
  for (const [text, z, dy, side] of [
    ["FUEL · COMBUSTIBLE", noseLen + 20.5, -0.55, 1],
    ["O2 · OXÍGENO", noseLen + 9.6, -0.6, -1],
    ["RCS · PELIGRO", noseLen + 1.6, 0.55, 1],
    ["RCS · PELIGRO", noseLen + 1.6, 0.55, -1],
  ] as const) {
    ship.add(sideDecal(stencilTexture(text), z, at(z).chine + dy, 1.4, 0.22, side));
  }
  const warn = warningTexture("NO PISAR · NO STEP");
  if (c.parts.wings === "swept" || c.parts.wings === "delta") {
    for (const side of [-1, 1]) ship.add(decal(warn, 1.5, 0.38, new THREE.Vector3(side * (rootX + span * 0.45), wy + 0.36 + span * 0.45 * 0.05, zR0 + span * 0.45 * 0.95 + 2.5), new THREE.Vector3(-side * 0.05, 1, 0).normalize(), new THREE.Vector3(0, 0, -1)));
  }
  const emblem = emblemTexture(c);
  if (emblem) {
    for (const side of [-1, 1]) {
      ship.add(topDecal(emblem, noseLen + 9, side * 1.6, 1.3, 1.3));
    }
  }

  if (opts.interior) {
    const colors: Record<ShipRoom["kind"], number> = { cockpit: 0x4fa8ff, corridor: 0xb4bac2, quarters: 0xc792ff, galley: 0x7fd88a, cargo: 0xe3b24e, engineering: 0xff7a4a, airlock: 0x6fe0d0 };
    for (const r of rooms) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(r.size[0], r.size[1], r.size[2]), new THREE.MeshStandardMaterial({ color: colors[r.kind], transparent: true, opacity: 0.6, emissive: colors[r.kind], emissiveIntensity: 0.3 }));
      m.position.set(r.center[0], r.center[1], r.center[2]);
      ship.add(m);
    }
  }

  ship.position.set(0, opts.landed ? gearHeight : 0, -length / 2);
  const group = new THREE.Group();
  group.name = "nave-personalizada";
  group.add(ship);
  group.userData.anim = anim;
  applyPose(anim);
  return { group, info: { length, rooms, stations, gearHeight, misfit: shipRoomsFit(stations, rooms, tpl.hullM) } };
}

/** Pantalla de la consola: líneas de instrumentos en el color de las luces. */
function screenTexture(color: string, seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 128, (g) => {
    g.fillStyle = "#03070c";
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 2;
    g.globalAlpha = 0.9;
    g.strokeRect(6, 6, 244, 116);
    let r = seed;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    g.beginPath();
    for (let x = 12; x < 120; x += 4) g.lineTo(x, 70 + Math.sin(x * 0.15 + seed) * 20 * rnd());
    g.stroke();
    for (let i = 0; i < 6; i++) g.fillRect(136, 16 + i * 17, 20 + rnd() * 90, 8);
    g.beginPath();
    g.arc(60, 40, 22, 0, Math.PI * 2);
    g.stroke();
  });
}

/**
 * Interior de la cabina, para verlo por el cristal: suelo, dos asientos, consola
 * con pantallas que brillan y paneles laterales, dentro de la sala real.
 */
function cockpitInterior(room: ShipRoom, c: ShipCustomization): THREE.Group {
  const g = new THREE.Group();
  const [cx, cy, cz] = room.center;
  const [w, h, l] = room.size;
  const floorY = cy - h / 2;
  const fabric = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x5a606a, roughness: 0.5, metalness: 0.6 });
  const seatColor = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.colors.secondary).lerp(new THREE.Color(0x222222), 0.3), roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, l), fabric);
  floor.position.set(cx, floorY, cz);
  g.add(floor);
  for (const side of [-1, 1]) {
    const x = cx + side * w * 0.22;
    const seat = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.45, 0.6), seatColor);
    base.position.set(0, 0.5, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.16), seatColor);
    back.position.set(0, 1.0, 0.3);
    back.rotation.x = -0.18;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.14), seatColor);
    head.position.set(0, 1.55, 0.38);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 10), trim);
    post.position.set(0, 0.15, 0);
    for (const arm of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), trim);
      a.position.set(arm * 0.34, 0.8, 0.05);
      seat.add(a);
    }
    seat.add(base, back, head, post);
    seat.position.set(x, floorY, cz + l * 0.05);
    g.add(seat);
  }
  // Consola delantera con pantallas encendidas.
  const consoleZ = cz - l * 0.32;
  const desk = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.12, 0.9), trim);
  desk.position.set(cx, floorY + 1.05, consoleZ);
  desk.rotation.x = 0.35;
  g.add(desk);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 1.0, 0.6), fabric);
  body.position.set(cx, floorY + 0.5, consoleZ - 0.2);
  g.add(body);
  for (let i = 0; i < 3; i++) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.38), new THREE.MeshBasicMaterial({ map: screenTexture(c.colors.lights, i + 3), toneMapped: false }));
    screen.position.set(cx + (i - 1) * 0.85, floorY + 1.18, consoleZ + 0.02);
    screen.rotation.x = -Math.PI / 2 + 0.35 + 0.9;
    g.add(screen);
  }
  // Paneles laterales y una tira de luz en el techo.
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, l * 0.7), trim);
    panel.position.set(cx + side * (w / 2 - 0.2), floorY + 0.75, cz);
    g.add(panel);
    for (let i = 0; i < 4; i++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.12), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x7fd0ff : 0xffb347, toneMapped: false }));
      led.position.set(cx + side * (w / 2 - 0.36), floorY + 0.95, cz - l * 0.25 + i * 0.35);
      g.add(led);
    }
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, l * 0.8), new THREE.MeshBasicMaterial({ color: 0xfff1d8, toneMapped: false }));
  strip.position.set(cx, floorY + h, cz);
  g.add(strip);
  const light = new THREE.PointLight(0xfff1d8, 4, 5, 2);
  light.position.set(cx, floorY + h - 0.3, cz);
  g.add(light);
  return g;
}

/** Lucecita: esfera brillante y, si se pide, una luz puntual de alcance corto. */
function addLight(parent: THREE.Object3D, pos: THREE.Vector3, color: number, r: number, range = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), toneMapped: false }));
  mesh.position.copy(pos);
  parent.add(mesh);
  if (range > 0) {
    const light = new THREE.PointLight(color, 3, range, 2);
    light.position.copy(pos);
    parent.add(light);
  }
  return mesh;
}

/** Coloca las piezas articuladas según el avance del tren y de las alas (0–1). */
function applyPose(a: ShipAnim): void {
  const g = smoothstep(0, 1, a.gear);
  for (const gear of a.gears) {
    // La pata baja en la segunda mitad; las compuertas se abren en la primera.
    gear.pivot.rotation.x = -(1 - smoothstep(0.35, 1, a.gear)) * (Math.PI / 2);
    gear.pivot.visible = a.gear > 0.02;
    for (const door of gear.doors) door.rotation.z = (door.userData.side as number) * smoothstep(0, 0.4, g) * (Math.PI / 2 + 0.25);
  }
  const w = smoothstep(0, 1, a.wings);
  for (const blade of a.wingBlades) blade.pivot.rotation.y = (1 - w) * blade.folded;
}

/** Pide una postura (el tren y las alas se mueven hacia ella con `animateCustomShip`). */
export function setShipPose(group: THREE.Object3D, pose: Partial<ShipPose>): void {
  const anim = group.userData.anim as ShipAnim | undefined;
  if (anim) Object.assign(anim.pose, pose);
}

/** Anima todo lo que se mueve (llamar cada fotograma). */
export function animateCustomShip(group: THREE.Object3D, t: number, dt: number, thrust = 0.15): void {
  const anim = group.userData.anim as ShipAnim | undefined;
  if (!anim) return;
  // Tren y alas, hacia su objetivo (unos 3 s y 2 s).
  const toward = (v: number, target: number, rate: number) => (v < target ? Math.min(target, v + dt * rate) : Math.max(target, v - dt * rate));
  anim.gear = toward(anim.gear, anim.pose.gearDown ? 1 : 0, 1 / 3);
  anim.wings = toward(anim.wings, anim.pose.wingsOpen ? 1 : 0, 1 / 2);
  applyPose(anim);
  for (const fan of anim.fans) fan.rotation.z = t * (2.5 + thrust * 30);
  const pulse = 0.82 + 0.1 * Math.sin(t * 9) + 0.05 * Math.sin(t * 23) + thrust * 1.5;
  for (const n of anim.nozzles) n.uniforms.uPower!.value = pulse;
  for (const l of anim.nozzleLights) l.intensity = 6 * pulse;
  for (const d of anim.discs) d.color.setScalar(Math.min(1.6, 0.8 * pulse));
  const strobe = (t * 1.1) % 1 < 0.05;
  for (const s of anim.strobes) s.visible = strobe;
  const blink = (t * 0.8) % 1 < 0.5 ? 1 : 0.35;
  for (const l of anim.navLights) l.scale.setScalar(blink);
  const beacon = 0.5 + 0.5 * Math.sin(t * 3);
  for (const b of anim.beacons) (b.material as THREE.MeshBasicMaterial).color.setRGB(3 * beacon, 0.4 * beacon, 0.3 * beacon);
  if (anim.dish) anim.dish.rotation.y = t * 0.7;
  if (anim.turret) anim.turret.rotation.y = Math.sin(t * 0.35) * 0.9;
}

/** Libera geometrías, materiales y texturas de una nave personalizada. */
export function disposeCustomShip(group: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (seen.has(m)) continue;
        seen.add(m);
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
}
