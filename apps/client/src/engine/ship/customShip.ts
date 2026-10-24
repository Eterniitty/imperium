/**
 * Generador de las naves personalizables (`@imperium/content` shipStyles.ts),
 * con todo el detalle posible (petición del 24-10-2026: «exquisito a la vista»,
 * y todo lo que se mueva, animado).
 *
 * Se construye a partir de las SALAS del interior de su plantilla (el casco las
 * envuelve siempre: más adelante se podrá caminar por la nave) y de la
 * personalización del jugador:
 * - casco en rombo alargado con arista lateral (loft de secciones suaves);
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
  bottom: number;
}

export interface CustomShipInfo {
  length: number;
  rooms: ShipRoom[];
  stations: Station[];
  /** Altura del tren: a cuánto queda el centro de la nave sobre el suelo al estar posada. */
  gearHeight: number;
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
  pose: ShipPose;
  gear: number;
  wings: number;
}

// ---------------------------------------------------------------------------
// Forma
// ---------------------------------------------------------------------------

function roomsFor(tpl: ShipTemplate, noseScale: number): { rooms: ShipRoom[]; noseLen: number } {
  const firstZ = Math.min(...tpl.rooms.map((r) => r.center[2] - r.size[2] / 2));
  const noseLen = firstZ * noseScale + 3;
  const shift = noseLen - firstZ;
  return { rooms: tpl.rooms.map((r) => ({ ...r, center: [r.center[0], r.center[1], r.center[2] + shift] as const })), noseLen };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Perfil del fuselaje: lo que ocupan las salas en cada z más el casco, muy suavizado, con morro y cola. */
function fuselageStations(tpl: ShipTemplate, rooms: ShipRoom[], noseLen: number, nose: ShipCustomization["parts"]["nose"]): Station[] {
  const lastZ = Math.max(...rooms.map((r) => r.center[2] + r.size[2] / 2));
  const tail = lastZ + 3.2;
  const step = 0.25;
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
    // La sección en rombo pierde sitio en las esquinas: se agranda para que las salas quepan.
    raw.push({ z, half: (half + tpl.hullM) * 1.22, top: top + tpl.hullM + 0.5, bottom: bottom - tpl.hullM - 0.25 });
  }
  // Suavizado fuerte (máximo en ±3 m y luego media en ±2 m): un casco de una pieza, sin escalones.
  const maxed = raw.map((s) => {
    const near = raw.filter((o) => Math.abs(o.z - s.z) <= 3);
    return { z: s.z, half: Math.max(...near.map((o) => o.half)), top: Math.max(...near.map((o) => o.top)), bottom: Math.min(...near.map((o) => o.bottom)) };
  });
  const body = maxed.map((s) => {
    const near = maxed.filter((o) => Math.abs(o.z - s.z) <= 2);
    const avg = (f: (o: Station) => number) => near.reduce((a, o) => a + f(o), 0) / near.length;
    return { z: s.z, half: Math.max(s.half, avg((o) => o.half)), top: Math.max(s.top, avg((o) => o.top)), bottom: Math.min(s.bottom, avg((o) => o.bottom)) };
  });
  const first = body[0]!;
  const last = body[body.length - 1]!;
  const out: Station[] = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const k = i / N; // 0 en la punta
    const z = k * noseLen;
    let w: number;
    let up: number;
    let down: number;
    if (nose === "needle") {
      w = Math.pow(Math.sin((k * Math.PI) / 2), 1.6);
      up = Math.pow(k, 1.25);
      down = Math.pow(Math.sin((k * Math.PI) / 2), 1.2);
    } else if (nose === "blunt") {
      w = Math.sqrt(1 - Math.pow(1 - k, 2.4));
      up = w;
      down = w;
    } else {
      w = 0.3 + 0.7 * Math.pow(Math.sin((k * Math.PI) / 2), 0.8);
      up = Math.pow(k, 1.5);
      down = 0.65 + 0.35 * k;
    }
    const mid = first.bottom + (first.top - first.bottom) * 0.4;
    out.push({ z, half: Math.max(0.04, first.half * w), top: mid + (first.top - mid) * Math.max(0.04, up), bottom: mid - (mid - first.bottom) * Math.max(0.04, down) });
  }
  out.push(...body);
  for (let i = 1; i <= 10; i++) {
    const k = i / 10;
    const e = smoothstep(0, 1, k);
    out.push({ z: last.z + (tail - last.z) * k, half: last.half * (1 - 0.32 * e), top: last.top - (last.top - last.bottom) * 0.22 * e, bottom: last.bottom + (last.top - last.bottom) * 0.3 * e });
  }
  return out;
}

function stationAt(stations: Station[], z: number): Station {
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i]!;
    const b = stations[i + 1]!;
    if (z >= a.z && z <= b.z) {
      const k = (z - a.z) / Math.max(1e-6, b.z - a.z);
      return { z, half: a.half + (b.half - a.half) * k, top: a.top + (b.top - a.top) * k, bottom: a.bottom + (b.bottom - a.bottom) * k };
    }
  }
  return { ...stations[z < stations[0]!.z ? 0 : stations.length - 1]!, z };
}

/** Altura de la arista lateral en una estación (40 % desde la panza). */
const chineY = (s: Station) => s.bottom + (s.top - s.bottom) * 0.4;

/** Sección del casco: rombo alargado con lomo redondeado, arista lateral marcada y panza casi plana. */
function sectionPoints(s: Station, sides: number): THREE.Vector3[] {
  const h = s.top - s.bottom;
  const cy = chineY(s);
  const right: [number, number][] = [
    [0, s.top],
    [0.42 * s.half, s.top - 0.04 * h],
    [0.8 * s.half, cy + 0.32 * h],
    [0.97 * s.half, cy + 0.06 * h],
    [s.half, cy],
    [0.95 * s.half, cy - 0.06 * h],
    [0.72 * s.half, s.bottom + 0.1 * h],
    [0.3 * s.half, s.bottom],
  ];
  const ctrl: THREE.Vector3[] = [];
  for (const [x, y] of right) ctrl.push(new THREE.Vector3(x, y, s.z));
  ctrl.push(new THREE.Vector3(0, s.bottom - 0.01 * h, s.z));
  for (let i = right.length - 1; i >= 1; i--) ctrl.push(new THREE.Vector3(-right[i]![0], right[i]![1], s.z));
  const curve = new THREE.CatmullRomCurve3(ctrl, true, "centripetal");
  return curve.getSpacedPoints(sides).slice(0, sides);
}

/** Loft cerrado por las estaciones con la sección dada; tapas en los extremos. */
function loftWith(stations: Station[], sides: number, section: (s: Station) => THREE.Vector3[], capEnds = true): THREE.BufferGeometry {
  const rings = stations.map(section);
  const pos: number[] = [];
  const index: number[] = [];
  for (const ring of rings) for (const p of ring) pos.push(p.x, p.y, p.z);
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < sides; i++) {
      const a = r * sides + i;
      const b = r * sides + ((i + 1) % sides);
      const c = (r + 1) * sides + i;
      const d = (r + 1) * sides + ((i + 1) % sides);
      index.push(a, c, b, b, c, d);
    }
  }
  if (capEnds) {
    const capFirst = pos.length / 3;
    const f = rings[0]!.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / sides);
    pos.push(f.x, f.y, f.z);
    const l = rings[rings.length - 1]!.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / sides);
    pos.push(l.x, l.y, l.z);
    const lastRing = (rings.length - 1) * sides;
    for (let i = 0; i < sides; i++) {
      index.push(capFirst, i, (i + 1) % sides);
      index.push(capFirst + 1, lastRing + ((i + 1) % sides), lastRing + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
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

/** Refleja en x invirtiendo los triángulos (para que sigan mirando hacia fuera). */
function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.scale(-1, 1, 1);
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2]!, a[i + 1]!];
    idx.needsUpdate = true;
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
  uniform float uPanelScale;
  float aeonHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float aeonNoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(aeonHash(i), aeonHash(i + vec3(1,0,0)), f.x), mix(aeonHash(i + vec3(0,1,0)), aeonHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(aeonHash(i + vec3(0,0,1)), aeonHash(i + vec3(1,0,1)), f.x), mix(aeonHash(i + vec3(0,1,1)), aeonHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  vec2 aeonCell;
  float aeonSeam(out float rivet) {
    vec3 p = vShip / uPanelScale;
    vec3 n = abs(normalize(vShipNormal));
    vec2 q = n.y > max(n.x, n.z) ? p.xz : (n.x > n.z ? p.zy : p.xy);
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
      .replace("#include <common>", "#include <common>\nvarying vec3 vShip;\nvarying vec3 vShipNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvShip = position;\nvShipNormal = normal;");
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
        float belly = smoothstep(0.15, -0.35, normalize(vShipNormal).y);
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
  m.customProgramCacheKey = () => `aeon-panel-${kind}`;
  return m;
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

function marksTexture(c: ShipCustomization): THREE.CanvasTexture {
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
    g.fillText(`CN-${number} · 35 M · 2 PAX`, 66 + w, 152);
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
  const stations = fuselageStations(tpl, rooms, noseLen, c.parts.nose);
  const length = stations[stations.length - 1]!.z;
  const ship = new THREE.Group();
  const pose: ShipPose = opts.pose ?? { gearDown: true, wingsOpen: true };
  const anim: ShipAnim = { fans: [], strobes: [], beacons: [], navLights: [], dish: null, turret: null, wingBlades: [], gears: [], nozzles: [], nozzleLights: [], pose, gear: pose.gearDown ? 1 : 0, wings: pose.wingsOpen ? 1 : 0 };

  const lights = new THREE.Color(c.colors.lights);
  const mats = {
    paint: panelMaterial("paint", { base: new THREE.Color(c.colors.primary), secondary: new THREE.Color(c.colors.secondary), accent: new THREE.Color(c.colors.accent), pattern: PATTERN_ID[c.pattern], length, panelScale: 2.2, wear: c.pattern === "worn" ? 0.6 : 0.25 }),
    accent: panelMaterial("paint", { base: new THREE.Color(c.colors.accent), panelScale: 1.6, wear: 0.15 }),
    dark: panelMaterial("metal", { base: new THREE.Color(0x3a3e46), panelScale: 0.5, wear: 0.4 }),
    metal: panelMaterial("metal", { base: new THREE.Color(0x9aa0a8), panelScale: 0.4, wear: 0.3 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.55, metalness: 0.6 }),
  };
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x223448, roughness: 0.03, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, transparent: true, opacity: opts.interior ? 0.2 : 0.38, depthWrite: false, side: THREE.DoubleSide });
  if (opts.interior) {
    for (const m of [mats.paint, mats.accent, mats.dark, mats.metal]) {
      m.transparent = true;
      m.opacity = 0.22;
      m.depthWrite = false;
    }
  }
  const hull = new Parts();

  // Casco.
  hull.paint.push(loftWith(stations, 72, (s) => sectionPoints(s, 72)));

  // Franja dorsal elevada (de la cabina a la cola).
  const cockpit = rooms.find((r) => r.kind === "cockpit") ?? rooms[0]!;
  const stripeZ0 = cockpit.center[2] + cockpit.size[2] / 2 + 0.6;
  const stripeZ1 = length - 3.5;
  hull.accent.push(
    loftWith(
      stations.filter((s) => s.z >= stripeZ0 && s.z <= stripeZ1),
      12,
      (s) => {
        const w = Math.min(1.25, s.half * 0.26);
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * w, s.top + 0.04 + Math.max(0, Math.sin(a)) * 0.16 - Math.max(0, -Math.sin(a)) * 0.12, s.z));
        }
        return pts;
      },
    ),
  );

  // Cabina: burbuja de cristal con marcos.
  const cz0 = cockpit.center[2] - cockpit.size[2] / 2 - 1.2;
  const cz1 = cockpit.center[2] + cockpit.size[2] / 2 - 0.2;
  const canopyStations: Station[] = [];
  for (let i = 0; i <= 24; i++) {
    const k = i / 24;
    const z = cz0 + (cz1 - cz0) * k;
    const s = stationAt(stations, z);
    const rise = Math.sin(Math.pow(k, 0.7) * Math.PI) * 0.95;
    canopyStations.push({ z, half: s.half * 0.52 * Math.sin(Math.pow(k, 0.6) * Math.PI * 0.5 + 0.25), top: s.top + rise, bottom: s.top - 0.25 });
  }
  const canopy = new THREE.Mesh(
    loftWith(canopyStations, 32, (s) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const sn = Math.sin(a);
        pts.push(new THREE.Vector3(Math.cos(a) * s.half, sn >= 0 ? s.bottom + (s.top - s.bottom) * Math.pow(sn, 0.7) : s.bottom + sn * 0.05, s.z));
      }
      return pts;
    }),
    glass,
  );
  ship.add(canopy);
  const tube = (pts: THREE.Vector3[], r: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 6, false);
  hull.dark.push(tube(canopyStations.map((s) => new THREE.Vector3(0, s.top + 0.02, s.z)), 0.07));
  for (const k of [0.3, 0.55, 0.8]) {
    const s = canopyStations[Math.round(k * 24)]!;
    const arch: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI;
      arch.push(new THREE.Vector3(Math.cos(a) * s.half * 1.01, s.bottom + (s.top - s.bottom) * Math.pow(Math.sin(a), 0.7) + 0.02, s.z));
    }
    hull.dark.push(tube(arch, 0.055));
  }
  for (const side of [-1, 1]) hull.dark.push(tube(canopyStations.map((s) => new THREE.Vector3(side * s.half, s.bottom + 0.05, s.z)), 0.07));

  // Alas. Las de abanico van en articulaciones (se pliegan y despliegan).
  const wingZ = length * 0.5;
  const root = stationAt(stations, wingZ + 3);
  const span = 7.5 * c.proportions.wingSpan;
  const wy = chineY(root) - 0.15;
  const rootX = root.half * 0.85;
  const tipLights: THREE.Vector3[] = [];
  const podMounts: { x: number; z: number; y: number }[] = [];
  const placed = (g: THREE.BufferGeometry, side: number, y: number) => g.translate(side * rootX, y, 0);
  for (const side of [-1, 1]) {
    if (c.parts.wings === "swept") {
      hull.paint.push(placed(wingShape([[0, wingZ - 1], [span, wingZ + 5], [span, wingZ + 8], [0, wingZ + 10.5]], 0.55, side, side * 0.04), side, wy));
      hull.accent.push(placed(wingShape([[span - 1.2, wingZ + 5.2], [span, wingZ + 5.4], [span, wingZ + 7.9], [span - 1.2, wingZ + 7.5]], 0.62, side, side * 0.04), side, wy + 0.01));
      tipLights.push(new THREE.Vector3(side * (rootX + span + 0.1), wy + span * 0.04, wingZ + 6.5));
      podMounts.push({ x: side * (rootX + span * 0.5), z: wingZ + 3.5, y: wy + span * 0.02 });
    } else if (c.parts.wings === "delta") {
      hull.paint.push(placed(wingShape([[0, wingZ - 5], [span * 1.15, wingZ + 9], [span * 1.1, wingZ + 10.5], [0, wingZ + 10.5]], 0.6, side), side, wy));
      tipLights.push(new THREE.Vector3(side * (rootX + span * 1.15), wy, wingZ + 9.5));
      podMounts.push({ x: side * (rootX + span * 0.45), z: wingZ + 3, y: wy });
    } else if (c.parts.wings === "fan") {
      // Tres palas por lado, cada una en su bisagra: abiertas en abanico, plegadas hacia atrás.
      for (let k = 0; k < 3; k++) {
        const a = (k - 1) * 0.3;
        const L = span * 1.1 * (1.05 - Math.abs(k - 1) * 0.12);
        const hingeZ = wingZ + 2.7 + k * 1.3;
        const y = wy + (k - 1) * 0.55;
        const pivot = new THREE.Group();
        pivot.position.set(side * rootX, y, hingeZ);
        const blade = new Parts();
        const tipX = Math.cos(a) * L;
        const tipZ = Math.sin(a) * L;
        blade.paint.push(wingShape([[0, -0.9], [tipX, tipZ - 0.75], [tipX + 0.4, tipZ], [tipX, tipZ + 0.75], [0, 0.9]], 0.32, side));
        blade.accent.push(boxAt(side * (tipX + 0.05), 0, tipZ, 0.35, 0.36, 1.2));
        blade.dark.push(cylY(0, -0.3, 0.3, 0, 0.35, 16));
        blade.build(pivot, mats);
        if (k === 1) anim.navLights.push(addLight(pivot, new THREE.Vector3(side * (tipX + 0.5), 0, tipZ), side < 0 ? 0xff2a2a : 0x2aff6a, 0.14, 6));
        ship.add(pivot);
        anim.wingBlades.push({ pivot, folded: side * (Math.PI / 2 - a - 0.15 + k * 0.08) });
      }
      podMounts.push({ x: side * (rootX + 1.6), z: wingZ + 3.5, y: wy - 0.6 });
    } else {
      hull.paint.push(placed(wingShape([[0, wingZ + 1], [span * 0.45, wingZ + 2.5], [span * 0.45, wingZ + 7], [0, wingZ + 9]], 0.7, side), side, wy));
      tipLights.push(new THREE.Vector3(side * (rootX + span * 0.45 + 0.1), wy, wingZ + 5));
      podMounts.push({ x: side * (rootX + span * 0.45), z: wingZ + 4.5, y: wy });
    }
  }

  // Motores.
  const es = c.proportions.engineSize;
  const nozzleGlows: THREE.Vector3[] = [];
  const addPod = (x: number, y: number, z0: number, len: number, r: number, withFan: boolean) => {
    hull.paint.push(
      lathe(
        [
          [r * 0.78, z0],
          [r * 0.9, z0 - 0.02 * len],
          [r * 1.0, z0 + 0.04 * len],
          [r * 1.04, z0 + 0.14 * len],
          [r * 1.02, z0 + 0.55 * len],
          [r * 0.9, z0 + 0.78 * len],
          [r * 0.84, z0 + 0.86 * len],
          [r * 0.9, z0 + 0.97 * len],
          [r * 0.86, z0 + len],
          [r * 0.72, z0 + len - 0.02],
        ],
        x,
        y,
      ),
    );
    hull.metal.push(lathe([[r * 1.045, z0 + 0.3 * len], [r * 1.07, z0 + 0.31 * len], [r * 1.07, z0 + 0.34 * len], [r * 1.045, z0 + 0.35 * len]], x, y));
    hull.dark.push(lathe([[r * 0.86, z0 + 0.78 * len], [r * 0.92, z0 + 0.8 * len], [r * 0.92, z0 + 0.95 * len], [r * 0.88, z0 + 0.97 * len]], x, y));
    hull.black.push(lathe([[r * 0.77, z0 + 0.02], [r * 0.75, z0 + 0.25 * len], [r * 0.2, z0 + 0.3 * len]], x, y, 32));
    if (withFan) {
      const fan = new THREE.Group();
      const fanParts = new Parts();
      const blades = 18;
      for (let i = 0; i < blades; i++) {
        const b = new THREE.BoxGeometry(0.05, r * 0.52, r * 0.22);
        b.translate(0, r * 0.45, 0);
        b.applyMatrix4(new THREE.Matrix4().makeRotationY(0.5));
        b.applyMatrix4(new THREE.Matrix4().makeRotationZ((i / blades) * Math.PI * 2));
        fanParts.metal.push(b);
      }
      const hub = new THREE.ConeGeometry(r * 0.24, r * 0.5, 24);
      hub.rotateX(-Math.PI / 2);
      hub.translate(0, 0, -r * 0.1);
      fanParts.dark.push(hub);
      fanParts.accent.push(new THREE.TorusGeometry(r * 0.12, 0.03, 8, 24).translate(0, 0, -r * 0.33));
      fanParts.build(fan, mats);
      fan.position.set(x, y, z0 + 0.12 * len);
      ship.add(fan);
      anim.fans.push(fan);
    }
    const nozzle = nozzleMaterial(c.colors.lights);
    anim.nozzles.push(nozzle);
    const inner = new THREE.ConeGeometry(r * 0.72, len * 0.16, 32, 1, true);
    inner.rotateX(-Math.PI / 2);
    inner.translate(x, y, z0 + len - len * 0.08);
    ship.add(new THREE.Mesh(inner, nozzle));
    nozzleGlows.push(new THREE.Vector3(x, y, z0 + len));
  };
  const tail = stationAt(stations, length - 3);
  const ty = chineY(tail) + 0.2;
  if (c.parts.engines === "nacelles") {
    const r = 1.35 * es;
    const len = 9.5;
    for (const m of podMounts) {
      const py = m.y - r * 0.15;
      const z0 = m.z - 3.5;
      addPod(m.x, py, z0, len, r, true);
      hull.dark.push(boxAt(m.x, py + r * 0.85, z0 + len * 0.45, 0.35, r * 0.6, len * 0.45));
    }
  } else if (c.parts.engines === "twin") {
    const r = 1.05 * es;
    for (const side of [-1, 1]) addPod(side * tail.half * 0.42, ty, length - 6.5, 7.6, r, true);
  } else {
    const r = 0.75 * es;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) addPod(sx * tail.half * 0.45, ty + sy * (tail.top - tail.bottom) * 0.2, length - 5.5, 6.6, r, false);
  }

  // Rejillas a los costados de la sala de máquinas y tomas en el lomo.
  const engineering = rooms.find((r) => r.kind === "engineering");
  if (engineering) {
    const ez = engineering.center[2];
    const s = stationAt(stations, ez);
    for (const side of [-1, 1]) {
      const x = side * s.half * 0.93;
      const y = chineY(s) + 0.5;
      hull.black.push(boxAt(x, y, ez, 0.1, 0.9, 3.2, 0, 0, side * 0.35));
      for (let i = 0; i < 9; i++) hull.dark.push(boxAt(x + side * 0.03, y, ez - 1.4 + i * 0.35, 0.08, 0.85, 0.08, 0, 0, side * 0.35));
    }
    const top = stationAt(stations, ez - 1).top;
    for (const sx of [-1, 1]) {
      hull.black.push(boxAt(sx * 0.95, top - 0.02, ez - 1, 0.7, 0.12, 2.2));
      for (let i = 0; i < 6; i++) hull.dark.push(boxAt(sx * 0.95, top + 0.02, ez - 1.9 + i * 0.36, 0.72, 0.08, 0.06));
    }
  }

  // Propulsores de maniobra (cuatro bocas) en el morro y la cola.
  for (const z of [noseLen + 1.5, length - 4.5]) {
    const s = stationAt(stations, z);
    for (const side of [-1, 1]) {
      const x = side * s.half * 0.97;
      const y = chineY(s) + 0.35;
      hull.dark.push(boxAt(x, y, z, 0.25, 0.55, 0.7));
      for (const [dy, dz] of [[0.13, 0.18], [-0.13, 0.18], [0.13, -0.18], [-0.13, -0.18]] as const) {
        const nz = new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8);
        nz.rotateZ(Math.PI / 2);
        nz.translate(x + side * 0.13, y + dy, z + dz);
        hull.black.push(nz);
      }
    }
  }

  // Sensores: cúpula bajo el morro con su aro; antenas de cuchilla en el lomo.
  {
    const z = noseLen * 0.55;
    const s = stationAt(stations, z);
    const dome = new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    dome.translate(0, s.bottom + 0.05, z);
    hull.black.push(dome);
    const lip = new THREE.TorusGeometry(0.44, 0.05, 8, 24);
    lip.rotateX(Math.PI / 2);
    lip.translate(0, s.bottom + 0.05, z);
    hull.metal.push(lip);
    for (const zz of [length * 0.35, length * 0.7]) {
      const t = stationAt(stations, zz);
      const blade = new THREE.BoxGeometry(0.05, 0.55, 0.5);
      blade.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, 0, 0.6, 0));
      blade.translate(1.2, t.top + 0.2, zz);
      hull.dark.push(blade);
    }
  }

  // Extras.
  const spineZ = length * 0.62;
  const spine = stationAt(stations, spineZ);
  if (c.parts.extras.includes("antenna")) {
    hull.dark.push(cylY(-1.1, spine.top - 0.1, spine.top + 3.2, spineZ + 1, 0.04, 8));
    hull.dark.push(cylY(-1.1, spine.top - 0.1, spine.top + 0.5, spineZ + 1, 0.12, 10));
    anim.beacons.push(addLight(ship, new THREE.Vector3(-1.1, spine.top + 3.25, spineZ + 1), 0xff3a2a, 0.09));
    // Plato del radar, que gira.
    const dish = new THREE.Group();
    dish.position.set(1.2, spine.top + 0.55, spineZ - 1.5);
    const dp = new Parts();
    const bowl = new THREE.SphereGeometry(0.7, 24, 8, 0, Math.PI * 2, 0, Math.PI / 3);
    bowl.rotateX(Math.PI * 0.6);
    bowl.translate(0, 0.25, 0);
    dp.metal.push(bowl);
    dp.dark.push(cylY(0, 0.1, 0.55, 0.25, 0.03, 6).rotateX(0.9));
    dp.build(dish, mats);
    ship.add(dish);
    hull.dark.push(cylY(1.2, spine.top - 0.1, spine.top + 0.55, spineZ - 1.5, 0.09, 8));
    anim.dish = dish;
  }
  if (c.parts.extras.includes("turret")) {
    const z = cockpit.center[2] + cockpit.size[2] / 2 + 3;
    const top = stationAt(stations, z).top;
    hull.dark.push(cylY(0, top - 0.2, top + 0.25, z, 1.15, 32));
    // Torreta: cúpula y cañones que barren.
    const turret = new THREE.Group();
    turret.position.set(0, top + 0.25, z);
    const tp = new Parts();
    const dome = new THREE.SphereGeometry(1.0, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.6, 1.15);
    tp.paint.push(dome);
    for (const sx of [-0.32, 0.32]) {
      tp.metal.push(cylZ(sx, 0.3, -3.6, -0.4, 0.08, 0.1, 12));
      tp.dark.push(cylZ(sx, 0.3, -1.4, -0.4, 0.16, 0.16, 12));
      tp.black.push(cylZ(sx, 0.3, -3.65, -3.55, 0.06, 0.06, 8));
    }
    tp.build(turret, mats);
    ship.add(turret);
    anim.turret = turret;
  }
  if (c.parts.extras.includes("fin")) {
    const z = length - 9.5;
    const top = stationAt(stations, z).top;
    const fin = new THREE.Shape([new THREE.Vector2(0, -0.2), new THREE.Vector2(7.5, -0.2), new THREE.Vector2(8.4, 3.6), new THREE.Vector2(6.2, 3.8)]);
    const g = new THREE.ExtrudeGeometry(fin, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 3 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.06, top - 0.1, z);
    hull.paint.push(g);
    hull.accent.push(boxAt(0, top + 3.55, z + 7.2, 0.4, 0.35, 2.2, -0.12));
    anim.strobes.push(addLight(ship, new THREE.Vector3(0, top + 3.85, z + 8.2), 0xffffff, 0.1));
  }
  if (c.parts.extras.includes("pods")) {
    for (const m of podMounts) {
      const x = m.x + Math.sign(m.x) * 2.4;
      const y = m.y - 0.75;
      hull.dark.push(cylZ(x, y, m.z, m.z + 4.2, 0.42, 0.42, 16));
      for (const [dx, dy] of [[0.17, 0.17], [-0.17, 0.17], [0.17, -0.17], [-0.17, -0.17]] as const) hull.black.push(cylZ(x + dx, y + dy, m.z - 0.05, m.z + 0.05, 0.11, 0.11, 10));
      hull.dark.push(boxAt(x, y + 0.5, m.z + 2.1, 0.15, 0.4, 2.6));
    }
  }

  // Tren de aterrizaje: cada pata en su bisagra (se recoge hacia delante) con dos compuertas.
  const gearHeight = 2.3;
  for (const [gx, gz] of [
    [0, noseLen + 3],
    [-root.half * 0.55, length * 0.62],
    [root.half * 0.55, length * 0.62],
  ] as const) {
    const s = stationAt(stations, gz);
    const yTop = s.bottom + 0.2;
    const legLen = yTop + gearHeight;
    const pivot = new THREE.Group();
    pivot.position.set(gx, yTop, gz);
    const leg = new Parts();
    leg.dark.push(cylY(0, -legLen + 0.35, 0, 0, 0.16, 14));
    leg.metal.push(cylY(0, -legLen + 0.35, -legLen + 1.2, 0, 0.11, 14));
    leg.dark.push(boxAt(0, -legLen + 0.12, 0, 0.9, 0.24, 1.3));
    leg.black.push(boxAt(0, -legLen + 0.01, 0, 0.95, 0.04, 1.35));
    leg.dark.push(boxAt(0, -legLen / 2 + 0.3, 0.5, 0.1, legLen * 0.6, 0.1, 0.45));
    leg.build(pivot, mats);
    ship.add(pivot);
    hull.black.push(boxAt(gx, s.bottom + 0.02, gz, 1.1, 0.05, 1.7));
    const doors: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const door = new THREE.Group();
      door.position.set(gx + side * 0.55, s.bottom + 0.02, gz);
      const dp = new Parts();
      dp.accent.push(boxAt(0, -0.5, 0, 0.04, 1.0, 1.6));
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
    const y = stationAt(stations, cargo.center[2]).bottom + 0.005;
    for (const [w, l, x, z] of [[3.2, 0.06, 0, cargo.center[2] - 2.6], [3.2, 0.06, 0, cargo.center[2] + 2.6], [0.06, 5.2, -1.6, cargo.center[2]], [0.06, 5.2, 1.6, cargo.center[2]]] as const) hull.black.push(boxAt(x, y, z, w, 0.03, l));
  }

  // Lo que se ve por las ventanas (aún no se camina por dentro, pero está en las salas reales).
  ship.add(cockpitInterior(cockpit, c, stationAt(stations, cockpit.center[2]).top));
  for (const room of rooms.filter((r) => r.kind === "quarters" || r.kind === "galley")) {
    const side = Math.sign(room.center[0]) || 1;
    const s = stationAt(stations, room.center[2]);
    const x = side * s.half * 0.97;
    const y = chineY(s) + 0.75;
    for (const dz of [-1.4, 0, 1.4]) {
      const z = room.center[2] + dz;
      // Marco, cristal y la luz cálida de dentro.
      const ring = new THREE.TorusGeometry(0.32, 0.06, 8, 24);
      ring.rotateY(Math.PI / 2);
      ring.rotateZ(side * 0.35);
      ring.translate(x, y, z);
      hull.metal.push(ring);
      const inside = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), new THREE.MeshBasicMaterial({ color: room.kind === "quarters" ? 0xffc890 : 0xd8f0ff, toneMapped: false }));
      inside.position.set(x - side * 0.05, y, z);
      inside.rotation.set(0, side * Math.PI / 2, side * 0.35);
      ship.add(inside);
      const pane = new THREE.Mesh(new THREE.CircleGeometry(0.31, 24), glass);
      pane.position.set(x + side * 0.02, y, z);
      pane.rotation.set(0, side * Math.PI / 2, side * 0.35);
      ship.add(pane);
    }
  }

  hull.build(ship, mats);
  canopy.castShadow = true;

  // Luces: navegación (roja a babor, verde a estribor), toberas y aterrizaje.
  for (const tip of tipLights) anim.navLights.push(addLight(ship, tip, tip.x < 0 ? 0xff2a2a : 0x2aff6a, 0.14, 6));
  for (const n of nozzleGlows) {
    const light = new THREE.PointLight(lights, 6, 10, 2);
    light.position.copy(n).add(new THREE.Vector3(0, 0, 0.8));
    ship.add(light);
    anim.nozzleLights.push(light);
  }
  {
    const s = stationAt(stations, noseLen + 1);
    addLight(ship, new THREE.Vector3(0.5, s.bottom + 0.05, noseLen + 1), 0xfff2d8, 0.09);
    addLight(ship, new THREE.Vector3(-0.5, s.bottom + 0.05, noseLen + 1), 0xfff2d8, 0.09);
  }

  // Marcas: número y nombre junto a la cabina, avisos en las alas, emblema en el lomo.
  const markZ = cockpit.center[2] + cockpit.size[2] / 2 + 3;
  const ms = stationAt(stations, markZ);
  const marks = marksTexture(c);
  for (const side of [-1, 1]) ship.add(decal(marks, 5.2, 1.3, new THREE.Vector3(side * ms.half * 0.86, chineY(ms) + 0.62, markZ + 1.4), new THREE.Vector3(side, 0.32, 0).normalize()));
  const warn = warningTexture("NO PISAR · NO STEP");
  if (c.parts.wings !== "fan") for (const m of podMounts) ship.add(decal(warn, 1.6, 0.4, new THREE.Vector3(m.x - Math.sign(m.x) * 1.6, m.y + 0.32, m.z - 3), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)));
  const emblem = emblemTexture(c);
  if (emblem) {
    const z = length * 0.42;
    const s = stationAt(stations, z);
    for (const side of [-1, 1]) ship.add(decal(emblem, 1.6, 1.6, new THREE.Vector3(side * s.half * 0.55, s.top - 0.3, z), new THREE.Vector3(side * 0.45, 1, 0).normalize(), new THREE.Vector3(0, 0, -1)));
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
  return { group, info: { length, rooms, stations, gearHeight } };
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
function cockpitInterior(room: ShipRoom, c: ShipCustomization, roof: number): THREE.Group {
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
  strip.position.set(cx, Math.min(roof - 0.2, floorY + h), cz);
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
    for (const door of gear.doors) door.rotation.z = (door.userData.side as number) * smoothstep(0, 0.4, g) * 1.1;
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
