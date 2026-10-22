/**
 * Monta una nave a partir de su plantilla (geometrías fusionadas por material,
 * compartidas por todas las naves de la clase) y le da vida: llamas y brillo de
 * las toberas según el empuje, propulsores de maniobra (`setManeuver`), luces
 * de navegación, destellos y balizas, balanceo al flotar y bocas de fuego.
 *
 * Llamadas de dibujo de una nave completa: una por material usado (≤ 10),
 * dos para las llamas (instanciadas), una por halo de tobera y tres o cuatro
 * nubes de puntos (luces y propulsores).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HULL_PROPORTIONS, type ShipHardpoints } from "@imperium/content";
import type { WeaponKind } from "@imperium/shared";
import { glowTexture } from "../textures";
import { withLogDepth } from "../logDepth";
import { buildAlien } from "./alien";
import { buildHuman, type Recipe } from "./human";
import { hash, Parts, prep, seeded, SLOTS, type LightMode, type Slot } from "./kit";
import type { ShipLook } from "./look";
import { paletteFor, slotMaterials, type Palette } from "./materials";
import { TILE_M } from "./textures";

/** Maniobra pedida a los propulsores, cada eje de -1 a 1 (sentido del piloto). */
export interface Maneuver {
  /** Desplazamiento lateral: + a estribor (derecha). */
  x?: number;
  /** Desplazamiento vertical: + hacia arriba. */
  y?: number;
  /** Avance: + hacia el morro, - frenar o ir marcha atrás. */
  z?: number;
  /** Cabeceo: + morro arriba. */
  pitch?: number;
  /** Guiñada: + morro a la derecha. */
  yaw?: number;
  /** Alabeo: + a la derecha (el costado de estribor baja). */
  roll?: number;
}

/**
 * Control de una nave dibujada: brillo de los motores según el empuje,
 * propulsores de maniobra, luces que parpadean, balanceo cuando flota quieta
 * y posición de las bocas de fuego (las mismas que usa el servidor).
 */
export interface ShipRig {
  /** Empuje de 0 (al ralentí) a 1 (a fondo); con `pulse`, llama larga y azulada. */
  setThrust(k: number, pulse?: boolean): void;
  /** Enciende los propulsores de maniobra que producen ese movimiento (valores -1..1). */
  setManeuver(m: Maneuver): void;
  /**
   * Potencia de la nave de 0 (motores apagados: toberas frías, sin llamas y solo
   * las balizas) a 1 (encendidos; por defecto). Entre medias, el arranque: las
   * luces de estado se encienden y las toberas se calientan.
   */
  setPower(k: number): void;
  /**
   * Avanza las animaciones. `idle` (0–1) es cuánto está quieta: entonces se
   * balancea y deriva un poco, como si flotase. No cambia la posición real.
   */
  tick(timeSec: number, dt: number, idle: number): void;
  /** Posición en el mundo de la boca `index` del arma `kind`. */
  muzzle(kind: WeaponKind, index: number, out: THREE.Vector3): THREE.Vector3;
}

interface Thruster {
  p: THREE.Vector3;
  /** Fuerza (contraria al chorro) y par normalizado por eje. */
  force: THREE.Vector3;
  torque: THREE.Vector3;
}

interface Template {
  look: ShipLook;
  palette: Palette;
  full: Partial<Record<Slot, THREE.BufferGeometry>>;
  coarse: Partial<Record<Slot, THREE.BufferGeometry>>;
  minimal: THREE.BufferGeometry;
  engines: Parts["engines"];
  thrusters: Thruster[];
  lights: Record<LightMode, THREE.BufferGeometry | null>;
  rcsPositions: THREE.BufferAttribute | null;
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

function pointsGeometry(points: Array<{ p: THREE.Vector3; color: number }>): THREE.BufferGeometry | null {
  if (points.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap((l) => [l.p.x, l.p.y, l.p.z]), 3));
  const c = new THREE.Color();
  g.setAttribute("color", new THREE.Float32BufferAttribute(points.flatMap((l) => c.setHex(l.color).toArray()), 3));
  g.computeBoundingSphere();
  return g;
}

function buildTemplate(look: ShipLook, recipe?: Recipe): Template {
  const rnd = seeded(hash(look.classId));
  const L = look.model.lengthM;
  const parts = new Parts(L, L / TILE_M);
  if (look.style === "human" || look.style === "brutalist_scrap") buildHuman(parts, look, rnd, recipe);
  else buildAlien(parts, look, rnd);
  const { width: W, height: H } = HULL_PROPORTIONS[look.model.hullShape];
  const minimal = prep(new THREE.OctahedronGeometry(0.5, 0)).applyMatrix4(new THREE.Matrix4().makeScale(W, H, 1));
  minimal.computeBoundingSphere();

  // Par de cada propulsor, normalizado por eje para que los tres giros respondan igual.
  const raw = parts.thrusters.map((t) => {
    const force = t.d.clone().negate();
    return { p: t.p, force, torque: t.p.clone().cross(force) };
  });
  const max = new THREE.Vector3(1e-6, 1e-6, 1e-6);
  for (const t of raw) max.set(Math.max(max.x, Math.abs(t.torque.x)), Math.max(max.y, Math.abs(t.torque.y)), Math.max(max.z, Math.abs(t.torque.z)));
  const thrusters = raw.map((t) => {
    const n = new THREE.Vector3(t.torque.x / max.x, t.torque.y / max.y, t.torque.z / max.z);
    // Solo cuentan los pares claros (si no, se encenderían casi todos).
    n.set(Math.abs(n.x) > 0.3 ? n.x : 0, Math.abs(n.y) > 0.3 ? n.y : 0, Math.abs(n.z) > 0.3 ? n.z : 0);
    return { p: t.p, force: t.force, torque: n };
  });
  const lightsBy = (mode: LightMode) => pointsGeometry(parts.lights.filter((l) => l.mode === mode));
  return {
    look,
    palette: paletteFor(look.style, look.primary, look.secondary, look.emissive),
    full: merged(parts.full),
    coarse: merged(parts.coarse),
    minimal,
    engines: parts.engines,
    thrusters,
    lights: { steady: lightsBy("steady"), strobe: lightsBy("strobe"), beacon: lightsBy("beacon") },
    rcsPositions: thrusters.length ? new THREE.Float32BufferAttribute(thrusters.flatMap((t) => [t.p.x, t.p.y, t.p.z]), 3) : null,
  };
}

/** Plantilla de una clase (se genera una vez). */
export function templateFor(look: ShipLook, recipe?: Recipe): Template {
  let t = templates.get(look.classId);
  if (!t) {
    t = buildTemplate(look, recipe);
    templates.set(look.classId, t);
  }
  return t;
}

// --- Recursos compartidos de los efectos ---

let flameGeo: THREE.BufferGeometry | null = null;
function flameGeometry(): THREE.BufferGeometry {
  if (!flameGeo) {
    // Penacho: se ensancha al salir de la tobera y se afila hacia el final.
    const g = new THREE.LatheGeometry(
      [
        [0.85, 0],
        [1, 0.08],
        [0.8, 0.35],
        [0.4, 0.72],
        [0, 1],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      14,
    );
    g.rotateX(Math.PI / 2);
    flameGeo = g;
  }
  return flameGeo;
}
const basicCache = new Map<string, THREE.Material>();

/**
 * Llama de plasma de los motores (shader propio): núcleo blanco-azulado muy
 * caliente, bordes ionizados del color del motor, turbulencia que fluye hacia
 * atrás y diamantes de choque junto a la tobera. Brillo aditivo. La longitud
 * la da la escala de cada instancia (empuje, marcha y pulso); el tiempo es común.
 */
const PLASMA_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vRim;
void main() {
  vUv = uv;
  vec4 local = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  #endif
  vec4 mv = modelViewMatrix * local;
  vec3 n = normalize(normalMatrix * mat3(${"instanceMatrix"}) * normal);
  vRim = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;
const PLASMA_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uCore;
varying vec2 vUv;
varying float vRim;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float v = vUv.y;                       // 0 en la tobera, 1 en la punta
  float around = vUv.x * 6.2831853;
  // Turbulencia que fluye hacia atrás (dos capas de ruido).
  vec2 q = vec2(around * 1.6, v * 7.0 - uTime * 9.0);
  float turb = noise(q) * 0.65 + noise(q * 2.3 + 4.1) * 0.35;
  // Diamantes de choque: bandas brillantes cerca de la tobera que se apagan hacia la punta.
  float diamonds = pow(0.5 + 0.5 * cos(v * 38.0 - uTime * 4.0), 6.0) * smoothstep(0.65, 0.0, v);
  // Cuerpo: denso en el eje (frente a la cámara) y fino en los bordes; se apaga hacia la punta.
  float body = pow(vRim, 1.4) * (1.0 - smoothstep(0.15, 1.0, v));
  float edge = (1.0 - vRim) * smoothstep(0.0, 0.25, v) * (1.0 - v) * turb;
  float heat = body * (0.55 + 0.6 * turb) + diamonds * 0.9 * body;
  vec3 hot = vec3(0.82, 0.92, 1.0);      // plasma blanco-azulado
  vec3 color = mix(uColor, hot, clamp(heat * (0.6 + uCore), 0.0, 1.0)) * (heat * 1.6 + edge * 0.9);
  float alpha = clamp(heat + edge * 0.6, 0.0, 1.0) * (uCore > 0.5 ? 0.85 : 0.55);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(color, alpha);
}
`;
/** Hora común de todas las llamas de plasma (la pone cada nave al avanzar). */
const plasmaTime = { value: 0 };
function flameMaterial(color: number, core: boolean): THREE.Material {
  const key = `plasma|${color}|${core}`;
  let m = basicCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      ...withLogDepth({ vertexShader: PLASMA_VERTEX, fragmentShader: PLASMA_FRAGMENT }),
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: plasmaTime, uCore: { value: core ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    basicCache.set(key, m);
  }
  return m;
}
const spriteCache = new Map<number, THREE.SpriteMaterial>();
function spriteMaterial(color: number): THREE.SpriteMaterial {
  let m = spriteCache.get(color);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    spriteCache.set(color, m);
  }
  return m;
}
const pointCache = new Map<number, THREE.PointsMaterial>();
/** Puntos de luz con color por vértice; `size` en metros. */
function pointMaterial(size: number): THREE.PointsMaterial {
  const key = Math.round(size * 100);
  let m = pointCache.get(key);
  if (!m) {
    m = new THREE.PointsMaterial({ size, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    pointCache.set(key, m);
  }
  return m;
}

/** Distancias de cambio de nivel de detalle, en esloras. */
export const SHIP_LOD = { coarse: 30, minimal: 160 } as const;

export interface AssembleOptions {
  /** Color de acento (franjas y bocas). */
  accent: number;
  /** Sin niveles de detalle (miniaturas): siempre el completo. */
  noLod?: boolean;
  /** Metros por unidad del grupo devuelto (la insignia usa `SHIP_SCALE`; el resto, 1). */
  unit?: number;
  /** Bocas de fuego en metros (por defecto, las de la clase). */
  hardpoints?: ShipHardpoints;
}

/** Crea el objeto 3D de una nave a partir de su plantilla, con su `ShipRig` en `userData.rig`. */
export function assembleShip(t: Template, opts: AssembleOptions): THREE.Group {
  const look = t.look;
  const L = look.model.lengthM;
  const unit = opts.unit ?? 1;
  const mats = slotMaterials(look.style, t.palette, opts.accent);
  // Brillo de las toberas: propio de cada nave, sigue al empuje.
  const engineMat = (mats.engine as THREE.MeshBasicMaterial).clone();
  const engineBase = new THREE.Color(t.palette.engine);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(L / unit);
  root.add(body);

  const level = (geos: Partial<Record<Slot, THREE.BufferGeometry>>): THREE.Group => {
    const g = new THREE.Group();
    for (const s of SLOTS) {
      const geo = geos[s];
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, s === "engine" ? engineMat : mats[s]);
      if (s === "aura") mesh.renderOrder = 2;
      g.add(mesh);
    }
    return g;
  };

  const flameColor = t.palette.engine;
  const full = level(t.full);
  const n = t.engines.length;
  const flames = n ? new THREE.InstancedMesh(flameGeometry(), flameMaterial(flameColor, false), n) : null;
  const cores = n ? new THREE.InstancedMesh(flameGeometry(), flameMaterial(flameColor, true), n) : null;
  for (const f of [flames, cores]) {
    if (!f) continue;
    f.frustumCulled = false;
    f.renderOrder = 3;
    full.add(f);
  }
  // Puntos de luz (tamaño en metros del mundo; no heredan la escala).
  const lightSize = Math.max(0.8, Math.min(L * 0.03, 2 + L * 0.012)) * Math.max(1, Math.sqrt(L / 45) * 0.6);
  const lightPoints: Partial<Record<LightMode, THREE.Points>> = {};
  for (const mode of ["steady", "strobe", "beacon"] as const) {
    const g = t.lights[mode];
    if (!g) continue;
    const p = new THREE.Points(g, pointMaterial(lightSize * (mode === "strobe" ? 1.6 : 1)));
    p.renderOrder = 3;
    lightPoints[mode] = p;
    full.add(p);
  }
  // Propulsores de maniobra: una nube de puntos con color propio de cada nave.
  let rcsGeo: THREE.BufferGeometry | null = null;
  let rcsColor: THREE.BufferAttribute | null = null;
  if (t.rcsPositions) {
    rcsGeo = new THREE.BufferGeometry();
    rcsGeo.setAttribute("position", t.rcsPositions);
    rcsColor = new THREE.Float32BufferAttribute(new Float32Array(t.thrusters.length * 3), 3);
    rcsGeo.setAttribute("color", rcsColor);
    rcsGeo.computeBoundingSphere();
    const pts = new THREE.Points(rcsGeo, pointMaterial(lightSize * 3.5));
    pts.renderOrder = 3;
    full.add(pts);
  }

  const coarse = level(t.coarse);
  const glows: THREE.Sprite[] = [];
  for (const lv of [full, coarse]) {
    for (const e of t.engines) {
      const s = new THREE.Sprite(spriteMaterial(flameColor));
      s.position.copy(e.p).setZ(e.p.z + e.r * 0.6);
      s.userData.base = e.r * 2.8;
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
    lod.addLevel(coarse, (L / unit) * SHIP_LOD.coarse);
    lod.addLevel(minimal, (L / unit) * SHIP_LOD.minimal);
    body.add(lod);
  }

  let thrust = 0;
  let pulse = false;
  let power = 1;
  const want = new THREE.Vector3();
  const spin = new THREE.Vector3();
  const rcsLevel = new Float32Array(t.thrusters.length);
  const phase = (hash(look.classId) % 1000) / 160;
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const rcsTint = new THREE.Color(0xd8ecff);
  const hardpoints = opts.hardpoints ?? look.hardpoints;
  const updateFlames = (len: number, coreLen: number) => {
    t.engines.forEach((e, i) => {
      flames!.setMatrixAt(i, mtx.compose(e.p, q, sc.set(e.r * 0.85, e.r * 0.85, len * e.r * 4)));
      cores!.setMatrixAt(i, mtx.compose(e.p, q, sc.set(e.r * 0.42, e.r * 0.42, coreLen * e.r * 4)));
    });
    flames!.instanceMatrix.needsUpdate = true;
    cores!.instanceMatrix.needsUpdate = true;
  };
  const rig: ShipRig = {
    setThrust(k, p = false) {
      thrust = Math.max(0, Math.min(1, k));
      pulse = p;
    },
    setPower(k) {
      power = Math.max(0, Math.min(1, k));
    },
    setManeuver(m) {
      const c = (x: number | undefined) => Math.max(-1, Math.min(1, x ?? 0));
      // Ejes locales: x estribor, y arriba, -z morro. Giros: cabeceo +X, guiñada a la derecha -Y, alabeo a la derecha -Z.
      want.set(c(m.x), c(m.y), -c(m.z));
      spin.set(c(m.pitch), -c(m.yaw), -c(m.roll));
    },
    tick(time, dt, idle) {
      plasmaTime.value = time % 1000;
      const flicker = 0.9 + 0.1 * Math.sin(time * 37 + phase) * Math.sin(time * 23);
      // Llamas desde el 70 % del arranque (el encendido); antes, solo se calientan las toberas.
      const lit = Math.max(0, Math.min(1, (power - 0.7) / 0.3));
      if (flames) {
        const len = (pulse ? 4.5 : 0.3 + thrust * 1.9) * flicker * lit;
        updateFlames(len, len * 0.55);
        flames.visible = cores!.visible = len > 0.05;
      }
      engineMat.color.copy(engineBase).multiplyScalar((0.35 + thrust * 0.65 + (pulse ? 0.3 : 0)) * Math.min(1, power * 1.2) + 0.03);
      for (const s of glows) {
        s.visible = lit > 0;
        s.scale.setScalar(s.userData.base * (0.45 + thrust * 0.7 + (pulse ? 0.6 : 0)) * flicker * lit);
      }
      // Propulsores: encendido suave hacia lo pedido.
      if (rcsColor) {
        const k = dt > 0 ? Math.min(1, dt * 14) : 1;
        // Sin motores no hay propulsores de maniobra.
        if (power < 1) {
          want.set(0, 0, 0);
          spin.set(0, 0, 0);
        }
        t.thrusters.forEach((th, i) => {
          const target = Math.min(1, Math.max(0, th.force.dot(want)) + Math.max(0, th.torque.dot(spin)));
          rcsLevel[i]! += (target - rcsLevel[i]!) * k;
          const lv = rcsLevel[i]! * (0.8 + 0.2 * Math.sin(time * 53 + i * 1.7));
          rcsColor!.setXYZ(i, rcsTint.r * lv, rcsTint.g * lv, rcsTint.b * lv);
        });
        rcsColor.needsUpdate = true;
      }
      // Destellos blancos breves; balizas rojas lentas.
      // Luces de estado: se encienden durante el arranque (las fijas primero, los destellos al final).
      if (lightPoints.steady) lightPoints.steady.visible = power >= 0.25 || (power > 0.1 && Math.sin(time * 15) > 0);
      if (lightPoints.strobe) lightPoints.strobe.visible = power >= 0.85 && ((time + phase) % 1.6 < 0.07 || ((time + phase) % 1.6 > 0.2 && (time + phase) % 1.6 < 0.26));
      if (lightPoints.beacon) lightPoints.beacon.visible = (time + phase * 0.5) % 2.0 < 1.0;
      body.position.set(Math.sin(time * 0.31 + phase) * (L / unit) * 0.0012 * idle, Math.sin(time * 0.47 + phase) * (L / unit) * 0.004 * idle, 0);
      body.rotation.set(Math.sin(time * 0.37 + phase) * 0.02 * idle, 0, Math.sin(time * 0.29 + 1 + phase) * 0.03 * idle);
    },
    muzzle(kind, index, out) {
      const list = hardpoints[kind];
      const o = list[index % Math.max(1, list.length)];
      out.set((o?.[0] ?? 0) / unit, (o?.[1] ?? 0) / unit, (o?.[2] ?? 0) / unit);
      root.updateMatrixWorld();
      return root.localToWorld(out);
    },
  };
  if (flames) updateFlames(0.35, 0.2);
  root.userData.rig = rig;
  root.userData.lengthM = L;
  root.userData.dispose = () => {
    engineMat.dispose();
    rcsGeo?.dispose();
    flames?.dispose();
    cores?.dispose();
  };
  return root;
}
