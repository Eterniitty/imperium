/**
 * Generador de las naves personalizables (`@imperium/content` shipStyles.ts):
 * construye el modelo a partir de las SALAS del interior de su plantilla (el
 * casco las envuelve siempre, para poder caminar por ella más adelante) y de la
 * personalización del jugador: morro, alas, motores y extras; proporciones;
 * pintura con patrón; número, nombre y emblema pintados en el casco.
 *
 * En metros, con la proa hacia −z (como los demás modelos). Toda la geometría
 * va ya en los ejes de la nave, así el patrón de pintura se calcula con la
 * posición en la nave (un solo material para casco, alas y motores).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SHIP_TEMPLATES, type ShipCustomization, type ShipRoom, type ShipTemplate } from "@imperium/content";

const PATTERN_ID: Record<ShipCustomization["pattern"], number> = { solid: 0, twoTone: 1, stripes: 2, bands: 3, worn: 4 };

/** Perfil del fuselaje en una estación z: semiancho, techo y suelo (m). */
interface Station {
  z: number;
  half: number;
  top: number;
  bottom: number;
}

export interface CustomShipInfo {
  /** Eslora total (m). */
  length: number;
  /** Salas ya desplazadas a su sitio en el modelo (para la vista del interior). */
  rooms: ShipRoom[];
  /** Fuselaje: para colocar marcas y piezas. */
  stations: Station[];
}

/** Desplazamiento de las salas: el morro puede alargarse sin mover el interior respecto a la popa. */
function roomsFor(tpl: ShipTemplate, noseScale: number): { rooms: ShipRoom[]; noseLen: number } {
  const firstZ = Math.min(...tpl.rooms.map((r) => r.center[2] - r.size[2] / 2));
  const noseLen = firstZ * noseScale;
  const shift = noseLen - firstZ;
  return { rooms: tpl.rooms.map((r) => ({ ...r, center: [r.center[0], r.center[1], r.center[2] + shift] as const })), noseLen };
}

/** Perfil del fuselaje: lo que ocupan las salas en cada z, más el casco, suavizado; morro y cola según la pieza. */
function fuselageStations(tpl: ShipTemplate, rooms: ShipRoom[], noseLen: number, nose: ShipCustomization["parts"]["nose"]): Station[] {
  const lastZ = Math.max(...rooms.map((r) => r.center[2] + r.size[2] / 2));
  const tail = lastZ + 2.5;
  const step = 0.5;
  const raw: Station[] = [];
  for (let z = noseLen; z <= lastZ + 1e-6; z += step) {
    let half = 0;
    let top = -Infinity;
    let bottom = Infinity;
    for (const r of rooms) {
      if (z < r.center[2] - r.size[2] / 2 - 0.01 || z > r.center[2] + r.size[2] / 2 + 0.01) continue;
      half = Math.max(half, Math.abs(r.center[0]) + r.size[0] / 2);
      top = Math.max(top, r.center[1] + r.size[1] / 2);
      bottom = Math.min(bottom, r.center[1] - r.size[1] / 2);
    }
    if (half === 0) continue;
    raw.push({ z, half: half + tpl.hullM, top: top + tpl.hullM, bottom: bottom - tpl.hullM });
  }
  // Suavizado: el máximo en una ventana de ±2 m (sin escalones bruscos entre salas).
  const smooth = raw.map((s) => {
    const near = raw.filter((o) => Math.abs(o.z - s.z) <= 2);
    return { z: s.z, half: Math.max(...near.map((o) => o.half)), top: Math.max(...near.map((o) => o.top)), bottom: Math.min(...near.map((o) => o.bottom)) };
  });
  const first = smooth[0]!;
  const last = smooth[smooth.length - 1]!;
  const out: Station[] = [];
  // Morro: de la punta al principio de la cabina, con la forma elegida.
  const N = 12;
  for (let i = 0; i < N; i++) {
    const k = i / N; // 0 en la punta
    const z = k * noseLen;
    let shape: number;
    let topK: number;
    let bottomK: number;
    if (nose === "needle") {
      shape = Math.pow(k, 0.9);
      topK = Math.pow(k, 0.8);
      bottomK = Math.pow(k, 0.9);
    } else if (nose === "blunt") {
      shape = Math.sqrt(1 - (1 - k) * (1 - k));
      topK = shape;
      bottomK = shape;
    } else {
      // Cincel: ancho casi desde la punta, el techo baja en cuña y el suelo es plano.
      shape = 0.35 + 0.65 * Math.sqrt(k);
      topK = k;
      bottomK = 0.75 + 0.25 * k;
    }
    const mid = (first.top + first.bottom) / 2;
    out.push({
      z,
      half: Math.max(0.05, first.half * shape),
      top: mid + (first.top - mid) * Math.max(0.05, topK),
      bottom: mid + (first.bottom - mid) * Math.max(0.05, bottomK),
    });
  }
  out.push(...smooth);
  // Cola: se cierra un poco hacia los motores.
  for (let i = 1; i <= 4; i++) {
    const k = i / 4;
    out.push({ z: last.z + (tail - last.z) * k, half: last.half * (1 - 0.35 * k), top: last.top - (last.top - last.bottom) * 0.2 * k, bottom: last.bottom + (last.top - last.bottom) * 0.15 * k });
  }
  return out;
}

/** Sección del fuselaje: rectángulo de esquinas redondeadas (superelipse) en el plano xy. */
function section(s: Station, sides: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const cy = (s.top + s.bottom) / 2;
  const hy = (s.top - s.bottom) / 2;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    // Exponente 2/3: casi rectangular, con las esquinas suaves.
    const ex = Math.sign(c) * Math.pow(Math.abs(c), 0.55);
    const ey = Math.sign(sn) * Math.pow(Math.abs(sn), 0.55);
    pts.push(new THREE.Vector3(ex * s.half, cy + ey * hy, s.z));
  }
  return pts;
}

/** Fuselaje cerrado (con tapas) que pasa por las estaciones. */
function loft(stations: Station[], sides = 28): THREE.BufferGeometry {
  const rings = stations.map((s) => section(s, sides));
  const positions: number[] = [];
  const index: number[] = [];
  for (const ring of rings) for (const p of ring) positions.push(p.x, p.y, p.z);
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < sides; i++) {
      const a = r * sides + i;
      const b = r * sides + ((i + 1) % sides);
      const c = (r + 1) * sides + i;
      const d = (r + 1) * sides + ((i + 1) % sides);
      index.push(a, c, b, b, c, d);
    }
  }
  // Tapas: un punto en el centro de la primera y la última sección.
  const capFirst = positions.length / 3;
  const f = stations[0]!;
  positions.push(0, (f.top + f.bottom) / 2, f.z);
  const capLast = capFirst + 1;
  const l = stations[stations.length - 1]!;
  positions.push(0, (l.top + l.bottom) / 2, l.z);
  const lastRing = (rings.length - 1) * sides;
  for (let i = 0; i < sides; i++) {
    index.push(capFirst, i, (i + 1) % sides);
    index.push(capLast, lastRing + ((i + 1) % sides), lastRing + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Perfil en un z cualquiera (interpolado). */
function stationAt(stations: Station[], z: number): Station {
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i]!;
    const b = stations[i + 1]!;
    if (z >= a.z && z <= b.z) {
      const k = (z - a.z) / Math.max(1e-6, b.z - a.z);
      return { z, half: a.half + (b.half - a.half) * k, top: a.top + (b.top - a.top) * k, bottom: a.bottom + (b.bottom - a.bottom) * k };
    }
  }
  return stations[z < stations[0]!.z ? 0 : stations.length - 1]!;
}

/** Ala: planta (en el plano xz, x hacia fuera desde la raíz) extruida con su grosor, ya colocada en la nave. */
function wing(planform: [number, number][], thickness: number, rootX: number, y: number, side: number, dihedral = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(planform.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.3, bevelSize: thickness * 0.3, bevelSegments: 1 });
  // La forma va en xy (x hacia fuera, y = z de la nave): se tumba en el plano xz.
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  if (dihedral) g.rotateZ(dihedral);
  if (side < 0) {
    g.scale(-1, 1, 1);
    // Al reflejar se invierte el sentido de los triángulos.
    const idx = g.getIndex();
    if (idx) {
      const a = idx.array as Uint16Array | Uint32Array;
      for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2]!, a[i + 1]!];
    }
  }
  g.translate(side * rootX, y, 0);
  g.computeVertexNormals();
  return g;
}

/** Cilindro a lo largo de z (de z0 a z1) con radios inicial y final. */
function tube(x: number, y: number, z0: number, z1: number, r0: number, r1: number, seg = 24): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

function box(x: number, y: number, z: number, w: number, h: number, l: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(x, y, z);
  return g;
}

/** Material del casco con el patrón de pintura (en los ejes de la nave) y paneles marcados. */
function hullMaterial(c: ShipCustomization, length: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.6 });
  const uniforms = {
    uPrimary: { value: new THREE.Color(c.colors.primary) },
    uSecondary: { value: new THREE.Color(c.colors.secondary) },
    uAccent: { value: new THREE.Color(c.colors.accent) },
    uPattern: { value: PATTERN_ID[c.pattern] },
    uLength: { value: length },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vShip;\nvarying vec3 vShipNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvShip = position;\nvShipNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vShip;
        varying vec3 vShipNormal;
        uniform vec3 uPrimary;
        uniform vec3 uSecondary;
        uniform vec3 uAccent;
        uniform int uPattern;
        uniform float uLength;
        float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 paint = uPrimary;
        float u = vShip.z / uLength;
        if (uPattern == 1) {
          // Dos tonos: la panza en el secundario.
          paint = mix(uPrimary, uSecondary, smoothstep(0.1, -0.25, vShipNormal.y));
        } else if (uPattern == 2) {
          // Franjas de acento a lo largo, por el lomo.
          float s = abs(vShip.x);
          paint = mix(uPrimary, uAccent, step(0.35, s) * step(s, 0.75) * step(0.0, vShipNormal.y));
          paint = mix(paint, uSecondary, smoothstep(0.1, -0.25, vShipNormal.y));
        } else if (uPattern == 3) {
          // Bandas transversales en el secundario, con un filo de acento.
          float b = fract(u * 6.0);
          paint = mix(uPrimary, uSecondary, step(0.7, b));
          paint = mix(paint, uAccent, step(0.66, b) * step(b, 0.7));
        } else if (uPattern == 4) {
          // Gastado: manchas del secundario.
          float n = h3(floor(vShip * 1.5));
          paint = mix(uPrimary, uSecondary, step(0.78, n) * 0.6);
        }
        // Juntas de los paneles (más oscuras).
        vec3 cell = abs(fract(vShip * vec3(0.5, 0.5, 0.33)) - 0.5);
        float seam = step(0.47, max(cell.x, max(cell.y, cell.z)));
        paint *= 1.0 - seam * 0.25;
        diffuseColor.rgb *= paint;`,
      );
  };
  m.customProgramCacheKey = () => "aeon-custom-hull";
  return m;
}

/** Textura de las marcas: número y nombre en una banda, para los costados. */
function marksTexture(c: ShipCustomization): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = c.colors.accent;
  g.font = "bold 76px 'Rajdhani', 'Arial Narrow', sans-serif";
  g.textBaseline = "middle";
  g.fillText(c.marks.number, 12, 58);
  if (c.marks.name) {
    g.font = "600 30px 'Rajdhani', 'Arial Narrow', sans-serif";
    g.fillStyle = "#e8e2d4";
    g.fillText(c.marks.name.toUpperCase(), 190, 64);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Textura del emblema (para el lomo y las alas). */
function emblemTexture(c: ShipCustomization): THREE.CanvasTexture | null {
  if (c.marks.emblem === "none") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
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
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function decal(texture: THREE.Texture, w: number, h: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.5, metalness: 0.3 }),
  );
}

/**
 * Construye la nave personalizada. Devuelve el grupo (en metros, proa hacia −z)
 * y los datos del fuselaje y de las salas. `interior`: además, las salas como
 * cajas de colores y el casco medio transparente (vista del interior).
 */
export function createCustomShip(c: ShipCustomization, opts: { interior?: boolean } = {}): { group: THREE.Group; info: CustomShipInfo } {
  const tpl = SHIP_TEMPLATES[c.template] ?? SHIP_TEMPLATES.gunship!;
  const { rooms, noseLen } = roomsFor(tpl, c.proportions.nose);
  const stations = fuselageStations(tpl, rooms, noseLen, c.parts.nose);
  const length = stations[stations.length - 1]!.z;
  const group = new THREE.Group();
  group.name = "nave-personalizada";

  const hull: THREE.BufferGeometry[] = [loft(stations)];
  const glow: THREE.BufferGeometry[] = [];

  // Alas: la raíz en el costado del fuselaje, en la mitad trasera.
  const wingZ = length * 0.55;
  const root = stationAt(stations, wingZ + 4);
  const span = 8 * c.proportions.wingSpan;
  const wy = root.bottom + (root.top - root.bottom) * 0.35;
  const navTips: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const rootX = root.half - 0.3;
    if (c.parts.wings === "swept") {
      hull.push(wing([[0, wingZ], [span, wingZ + 5.5], [span, wingZ + 8.5], [0, wingZ + 11]], 0.45, rootX, wy, side, side * 0.05));
      navTips.push(new THREE.Vector3(side * (rootX + span), wy + span * 0.05, wingZ + 7));
    } else if (c.parts.wings === "delta") {
      hull.push(wing([[0, wingZ - 3], [span * 1.15, wingZ + 11], [0, wingZ + 12]], 0.5, rootX, wy, side));
      navTips.push(new THREE.Vector3(side * (rootX + span * 1.15), wy, wingZ + 11));
    } else if (c.parts.wings === "fan") {
      // Abanico de tres palas por lado (alas plegables abiertas).
      for (let k = 0; k < 3; k++) {
        const a = (k - 1) * 0.32;
        const L = span * (1.05 - Math.abs(k - 1) * 0.12);
        const tipX = Math.cos(a) * L;
        const tipZ = wingZ + 4 + Math.sin(a) * L;
        hull.push(wing([[0, wingZ + 3 + k * 1.2], [tipX, tipZ - 0.9], [tipX, tipZ + 0.9], [0, wingZ + 5 + k * 1.2]], 0.3, rootX, wy + (k - 1) * 0.5, side));
        if (k === 1) navTips.push(new THREE.Vector3(side * (rootX + tipX), wy, tipZ));
      }
    } else {
      hull.push(wing([[0, wingZ + 2], [span * 0.4, wingZ + 3.5], [span * 0.4, wingZ + 7], [0, wingZ + 9]], 0.6, rootX, wy, side));
      navTips.push(new THREE.Vector3(side * (rootX + span * 0.4), wy, wingZ + 5));
    }
  }

  // Motores.
  const tail = stationAt(stations, length - 3);
  const es = c.proportions.engineSize;
  const ty = (tail.top + tail.bottom) / 2;
  const nozzles: { x: number; y: number; z: number; r: number }[] = [];
  if (c.parts.engines === "nacelles") {
    // Dos góndolas grandes a los costados, con toma de aire delante (como la imagen de referencia).
    const r = 1.7 * es;
    const nx = stationAt(stations, length - 7).half + r + 0.4;
    for (const side of [-1, 1]) {
      hull.push(tube(side * nx, ty, length - 13, length - 1, r * 0.85, r));
      hull.push(tube(side * nx, ty, length - 14.2, length - 13, r * 1.12, r * 0.9));
      hull.push(box(side * (nx - r * 0.6), ty, length - 7, r * 0.8, 0.5, 6));
      nozzles.push({ x: side * nx, y: ty, z: length - 0.95, r: r * 0.8 });
    }
  } else if (c.parts.engines === "twin") {
    const r = 1.15 * es;
    for (const side of [-1, 1]) {
      hull.push(tube(side * tail.half * 0.45, ty, length - 4, length + 0.8, r * 1.1, r));
      nozzles.push({ x: side * tail.half * 0.45, y: ty, z: length + 0.85, r: r * 0.85 });
    }
  } else {
    const r = 0.8 * es;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = sx * tail.half * 0.45;
        const y = ty + sy * (tail.top - tail.bottom) * 0.22;
        hull.push(tube(x, y, length - 3, length + 0.8, r * 1.1, r));
        nozzles.push({ x, y, z: length + 0.85, r: r * 0.85 });
      }
    }
  }
  for (const n of nozzles) {
    const disc = new THREE.CircleGeometry(n.r, 24);
    disc.translate(n.x, n.y, n.z);
    glow.push(disc);
  }

  // Extras.
  const cockpit = rooms.find((r) => r.kind === "cockpit") ?? rooms[0]!;
  const spine = stationAt(stations, length * 0.6);
  if (c.parts.extras.includes("antenna")) {
    hull.push(tube(0.8, spine.top + 1.4, length * 0.6 - 0.1, length * 0.6 + 0.1, 0.06, 0.06, 6).rotateX(0));
    const mast = new THREE.CylinderGeometry(0.06, 0.08, 2.8, 6);
    mast.translate(0.8, spine.top + 1.4, length * 0.62);
    hull.push(mast);
    const dish = new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    dish.rotateX(Math.PI);
    dish.translate(-0.9, spine.top + 0.4, length * 0.66);
    hull.push(dish);
  }
  if (c.parts.extras.includes("turret")) {
    const z = cockpit.center[2] + cockpit.size[2] / 2 + 2.5;
    const top = stationAt(stations, z).top;
    const dome = new THREE.SphereGeometry(1.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(0, top - 0.1, z);
    hull.push(dome);
    for (const sx of [-0.35, 0.35]) hull.push(tube(sx, top + 0.45, z - 3.4, z, 0.12, 0.12, 8));
  }
  if (c.parts.extras.includes("fin")) {
    const z = length - 9;
    const top = stationAt(stations, z).top;
    const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(7, 0), new THREE.Vector2(7.5, 3.2), new THREE.Vector2(5.5, 3.4)]);
    const g = new THREE.ExtrudeGeometry(fin, { depth: 0.3, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.translate(0.15, top - 0.2, z);
    hull.push(g);
  }
  if (c.parts.extras.includes("pods")) {
    for (const side of [-1, 1]) {
      const x = side * (root.half + span * 0.45);
      hull.push(tube(x, wy - 0.7, wingZ + 2, wingZ + 7, 0.35, 0.45, 12));
    }
  }

  // Cubierta de la cabina: cristal oscuro sobre la cabina.
  const canopy = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const cz = cockpit.center[2] - cockpit.size[2] * 0.15;
  const cTop = stationAt(stations, cz).top;
  canopy.scale(cockpit.size[0] * 0.42, 0.9, cockpit.size[2] * 0.55);
  canopy.translate(0, cTop - 0.35, cz);

  const mainGeometry = mergeGeometries(hull.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    g.deleteAttribute("uv");
    return g;
  }));
  const hullMat = hullMaterial(c, length);
  if (opts.interior) {
    hullMat.transparent = true;
    hullMat.opacity = 0.25;
    hullMat.depthWrite = false;
  }
  group.add(new THREE.Mesh(mainGeometry, hullMat));
  group.add(new THREE.Mesh(canopy, new THREE.MeshStandardMaterial({ color: 0x0b1420, metalness: 0.9, roughness: 0.08, emissive: new THREE.Color(c.colors.lights), emissiveIntensity: 0.06 })));
  group.add(new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ color: new THREE.Color(c.colors.lights).multiplyScalar(2.2), toneMapped: false })));

  // Luces de navegación: roja a babor (−x) y verde a estribor, y luces del color elegido en la panza.
  for (const tip of navTips) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: tip.x < 0 ? 0xff3030 : 0x30ff60, toneMapped: false }));
    light.position.copy(tip);
    group.add(light);
  }

  // Marcas en los costados, junto a la cabina, y el emblema en el lomo.
  const markZ = cockpit.center[2] + cockpit.size[2] / 2 + 1.5;
  const ms = stationAt(stations, markZ);
  const marks = marksTexture(c);
  for (const side of [-1, 1]) {
    const plate = decal(marks, 5, 1.25);
    plate.position.set(side * (ms.half + 0.03), (ms.top + ms.bottom) / 2 + 0.2, markZ + 1.5);
    plate.rotation.y = side * Math.PI / 2;
    group.add(plate);
  }
  const emblem = emblemTexture(c);
  if (emblem) {
    const z = length * 0.62;
    const top = stationAt(stations, z).top;
    const badge = decal(emblem, 2.6, 2.6);
    badge.rotation.x = -Math.PI / 2;
    badge.position.set(0, top + 0.03, z);
    group.add(badge);
  }

  if (opts.interior) {
    const colors: Record<ShipRoom["kind"], number> = { cockpit: 0x4fa8ff, corridor: 0xb4bac2, quarters: 0xc792ff, galley: 0x7fd88a, cargo: 0xe3b24e, engineering: 0xff7a4a, airlock: 0x6fe0d0 };
    for (const r of rooms) {
      const g = new THREE.BoxGeometry(r.size[0], r.size[1], r.size[2]);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: colors[r.kind], transparent: true, opacity: 0.55, emissive: colors[r.kind], emissiveIntensity: 0.25 }));
      m.position.set(r.center[0], r.center[1], r.center[2]);
      group.add(m);
    }
  }

  // Centrar en la eslora (el grupo gira alrededor del centro de la nave).
  for (const child of group.children) child.position.z -= length / 2;
  return { group, info: { length, rooms, stations } };
}

/** Libera geometrías, materiales y texturas de una nave personalizada. */
export function disposeCustomShip(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
}
