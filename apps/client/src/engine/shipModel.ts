import * as THREE from "three";
import { FLAGSHIP_HARDPOINTS, type Offset3 } from "@imperium/content";
import type { WeaponKind } from "@imperium/shared";
import { glowTexture } from "./textures";

/** El modelo mide ~4,6 unidades de largo: a escala ×10, la nave mide unos 46 m (las distancias de los sistemas van en metros). */
export const SHIP_SCALE = 10;

/**
 * Control de una nave dibujada: brillo de los motores según el empuje, luces de
 * navegación que parpadean, balanceo cuando flota quieta y posición de las
 * bocas de fuego (las mismas que usa el servidor, de `@imperium/content`).
 */
export interface ShipRig {
  /** Empuje de 0 (al ralentí) a 1 (a fondo); con `pulse`, llama larga y azulada. */
  setThrust(k: number, pulse?: boolean): void;
  /**
   * Avanza las animaciones. `idle` (0–1) es cuánto está quieta: entonces se
   * balancea y deriva un poco, como si flotase. No cambia la posición real.
   */
  tick(timeSec: number, dt: number, idle: number): void;
  /** Posición en el mundo de la boca `index` del arma `kind`. */
  muzzle(kind: WeaponKind, index: number, out: THREE.Vector3): THREE.Vector3;
}

const M = 1 / SHIP_SCALE;
const off = (o: Offset3) => new THREE.Vector3(o[0] * M, o[1] * M, o[2] * M);

// --- Texturas y geometrías compartidas por todas las naves (se crean una vez) ---

let panelTex: THREE.Texture | null = null;
/** Paneles del casco: placas con juntas y algún tono distinto, dibujadas por código. */
function panelTexture(): THREE.Texture {
  if (panelTex) return panelTex;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c8cfdb";
  ctx.fillRect(0, 0, size, size);
  // Semilla fija: todas las naves tienen las mismas placas.
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const w = 16 + Math.floor(rnd() * 5) * 16;
    const h = 16 + Math.floor(rnd() * 3) * 16;
    const x = Math.floor(rnd() * 16) * 16;
    const y = Math.floor(rnd() * 16) * 16;
    const shade = 185 + Math.floor(rnd() * 45);
    ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 12})`;
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = "rgba(40,48,64,0.55)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= size; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }
  for (let i = 0; i <= size; i += 48) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  // Remaches y marcas pequeñas.
  ctx.fillStyle = "rgba(30,36,50,0.5)";
  for (let i = 0; i < 160; i++) ctx.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 2, 2);
  panelTex = new THREE.CanvasTexture(canvas);
  panelTex.colorSpace = THREE.SRGBColorSpace;
  panelTex.wrapS = panelTex.wrapT = THREE.RepeatWrapping;
  panelTex.anisotropy = 4;
  return panelTex;
}

interface Geometries {
  fuselage: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  canopyFrame: THREE.BufferGeometry;
  spine: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  wingStripe: THREE.BufferGeometry;
  fin: THREE.BufferGeometry;
  nacelle: THREE.BufferGeometry;
  nozzle: THREE.BufferGeometry;
  nozzleInner: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
  barrel: THREE.BufferGeometry;
  gunHousing: THREE.BufferGeometry;
  pylon: THREE.BufferGeometry;
  missile: THREE.BufferGeometry;
  light: THREE.BufferGeometry;
  greeble: THREE.BufferGeometry;
  antenna: THREE.BufferGeometry;
  intake: THREE.BufferGeometry;
}

let geos: Geometries | null = null;

function geometries(): Geometries {
  if (geos) return geos;
  // Fuselaje: perfil de revolución (radio, avance) de la cola al morro, achatado en vertical.
  const profile = [
    [0.0, -2.0],
    [0.36, -1.98],
    [0.5, -1.7],
    [0.6, -1.1],
    [0.62, -0.2],
    [0.56, 0.7],
    [0.44, 1.5],
    [0.28, 2.15],
    [0.12, 2.5],
    [0.0, 2.62],
  ].map(([r, f]) => new THREE.Vector2(r, f));
  const fuselage = new THREE.LatheGeometry(profile, 16);
  // El eje del torno es +Y: se gira para que el morro quede en -Z y se aplana.
  fuselage.rotateX(-Math.PI / 2);
  fuselage.scale(1, 0.62, 1);

  const canopy = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.27, 0.2, 0.62);
  const canopyFrame = new THREE.TorusGeometry(1, 0.06, 6, 24, Math.PI);
  canopyFrame.scale(0.27, 0.21, 1);

  const spine = new THREE.BoxGeometry(0.3, 0.16, 1.7);
  spine.translate(0, 0, 0);

  // Ala en flecha con borde de ataque largo; perfil dibujado en XY (y = avance hacia la cola).
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -0.7);
  wingShape.lineTo(1.75, 0.55);
  wingShape.lineTo(1.95, 0.6);
  wingShape.lineTo(1.95, 1.15);
  wingShape.lineTo(0, 1.45);
  wingShape.closePath();
  const wing = new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 1 });
  wing.rotateX(Math.PI / 2);
  const stripeShape = new THREE.Shape();
  stripeShape.moveTo(1.0, 0.0);
  stripeShape.lineTo(1.9, 0.62);
  stripeShape.lineTo(1.9, 0.78);
  stripeShape.lineTo(1.0, 0.18);
  stripeShape.closePath();
  const wingStripe = new THREE.ExtrudeGeometry(stripeShape, { depth: 0.012, bevelEnabled: false });
  wingStripe.rotateX(Math.PI / 2);

  // Aleta de cola trapezoidal (en el plano YZ).
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.95, 0);
  finShape.lineTo(1.25, 0.75);
  finShape.lineTo(0.9, 0.78);
  finShape.closePath();
  const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1 });
  fin.translate(0, 0, -0.025);
  fin.rotateY(-Math.PI / 2);

  const nacelle = new THREE.CylinderGeometry(0.2, 0.24, 1.9, 14);
  nacelle.rotateX(Math.PI / 2);
  const nozzle = new THREE.CylinderGeometry(0.23, 0.17, 0.32, 16, 1, true);
  nozzle.rotateX(Math.PI / 2);
  const nozzleInner = new THREE.CircleGeometry(0.17, 16);
  const flame = new THREE.ConeGeometry(0.15, 1, 14, 1, true);
  // Cono que sale hacia +Z desde la tobera; su base (ancha) en el origen.
  flame.rotateX(Math.PI / 2);
  flame.translate(0, 0, 0.5);

  const barrel = new THREE.CylinderGeometry(0.035, 0.045, 1.0, 8);
  barrel.rotateX(Math.PI / 2);
  const gunHousing = new THREE.BoxGeometry(0.16, 0.13, 1.2);
  const pylon = new THREE.BoxGeometry(0.05, 0.12, 0.7);
  const missile = new THREE.CylinderGeometry(0.05, 0.05, 0.62, 8);
  missile.rotateX(Math.PI / 2);
  const light = new THREE.SphereGeometry(0.045, 8, 6);
  const greeble = new THREE.BoxGeometry(1, 1, 1);
  const antenna = new THREE.CylinderGeometry(0.008, 0.012, 0.55, 5);
  const intake = new THREE.BoxGeometry(0.22, 0.18, 0.5);

  geos = { fuselage, canopy, canopyFrame, spine, wing, wingStripe, fin, nacelle, nozzle, nozzleInner, flame, barrel, gunHousing, pylon, missile, light, greeble, antenna, intake };
  return geos;
}

interface Materials {
  hull: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  nozzleGlow: THREE.MeshBasicMaterial;
  flame: THREE.MeshBasicMaterial;
  flameCore: THREE.MeshBasicMaterial;
  red: THREE.MeshBasicMaterial;
  green: THREE.MeshBasicMaterial;
  white: THREE.MeshBasicMaterial;
}

/** Materiales por color de acento (se comparten entre naves del mismo color). */
const materialCache = new Map<number, Materials>();

function materials(accent: THREE.ColorRepresentation): Materials {
  const color = new THREE.Color(accent);
  const key = color.getHex();
  let m = materialCache.get(key);
  if (m) return m;
  m = {
    hull: new THREE.MeshStandardMaterial({ color: 0xdfe5ee, map: panelTexture(), metalness: 0.55, roughness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x343c4e, metalness: 0.7, roughness: 0.48 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x7c8598, metalness: 0.9, roughness: 0.28 }),
    accent: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2a44, emissive: 0x2a5d8a, emissiveIntensity: 0.35, metalness: 0.95, roughness: 0.08, transparent: true, opacity: 0.88 }),
    nozzleGlow: new THREE.MeshBasicMaterial({ color: 0x9fe9ff }),
    flame: new THREE.MeshBasicMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    flameCore: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    red: new THREE.MeshBasicMaterial({ color: 0xff3030 }),
    green: new THREE.MeshBasicMaterial({ color: 0x30ff70 }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
  materialCache.set(key, m);
  return m;
}

function glowSprite(color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * Nave insignia del Emperador, generada por código (sin archivos): fuselaje con
 * paneles, cabina acristalada, alas en flecha con franjas del color de acento,
 * aletas de cola, dos góndolas de motor y una tobera central con llama que
 * responde al empuje, luces de navegación (roja a babor, verde a estribor y
 * destello blanco en la cola) y los cañones y lanzadores en sus puntos de anclaje.
 * Mira hacia -Z y mide unas 4,6 unidades. `accent`: morado la propia, otros colores las ajenas.
 */
export function createFlagship(accent: THREE.ColorRepresentation): THREE.Group {
  const g = geometries();
  const mat = materials(accent);
  const ship = new THREE.Group();
  // Todo cuelga de `body`, que se balancea al flotar sin mover la posición real de la nave.
  const body = new THREE.Group();
  ship.add(body);

  body.add(mesh(g.fuselage, mat.hull));
  const spine = mesh(g.spine, mat.dark, 0, 0.36, 0.55);
  const canopy = mesh(g.canopy, mat.glass, 0, 0.3, -0.95);
  const frame = mesh(g.canopyFrame, mat.dark, 0, 0.3, -0.95);
  frame.rotation.y = Math.PI / 2;
  body.add(spine, canopy, frame);

  // Tomas de aire a los lados de la cabina.
  for (const side of [1, -1]) body.add(mesh(g.intake, mat.dark, side * 0.5, 0.05, -0.55));

  // Alas, con su franja de color y una góndola en la punta.
  for (const side of [1, -1]) {
    const wing = mesh(g.wing, mat.hull, side * 0.4, -0.08, 0.05);
    wing.scale.x = side;
    const stripe = mesh(g.wingStripe, mat.accent, side * 0.4, -0.02, 0.05);
    stripe.scale.x = side;
    const tipPod = mesh(g.missile, mat.dark, side * 2.36, -0.08, 0.92);
    tipPod.scale.set(1.4, 1.4, 1.6);
    body.add(wing, stripe, tipPod);
  }

  // Aletas de cola inclinadas hacia fuera.
  for (const side of [1, -1]) {
    const fin = mesh(g.fin, mat.hull, side * 0.3, 0.18, 0.95);
    fin.rotation.z = -side * 0.42;
    body.add(fin);
  }

  // Motores: dos góndolas y una tobera central, con brillo y llama.
  const flames: THREE.Mesh[] = [];
  const glows: THREE.Sprite[] = [];
  const engines: Array<[number, number, number]> = [
    [0.66, -0.06, 1.2],
    [-0.66, -0.06, 1.2],
    [0, 0.02, 1.6],
  ];
  for (const [x, y, z] of engines) {
    const central = x === 0;
    if (!central) body.add(mesh(g.nacelle, mat.dark, x, y, z - 0.55));
    const nz = z + 0.42;
    const nozzle = mesh(g.nozzle, mat.metal, x, y, nz);
    const inner = mesh(g.nozzleInner, mat.nozzleGlow, x, y, nz + 0.1);
    const flame = mesh(g.flame, mat.flame, x, y, nz + 0.12);
    const core = mesh(g.flame, mat.flameCore, 0, 0, 0.02);
    core.scale.set(0.45, 0.45, 0.55);
    flame.add(core);
    const glow = glowSprite(0x7fdcff, central ? 0.9 : 0.75);
    glow.position.set(x, y, nz + 0.2);
    flames.push(flame);
    glows.push(glow);
    body.add(nozzle, inner, flame, glow);
  }

  // Cañones en las raíces de las alas: carcasa y cañón que termina en la boca.
  for (const o of FLAGSHIP_HARDPOINTS.cannon) {
    const p = off(o);
    const housing = mesh(g.gunHousing, mat.dark, p.x, p.y + 0.02, p.z + 1.3);
    const barrel = mesh(g.barrel, mat.metal, p.x, p.y, p.z + 0.5);
    const tip = mesh(g.light, mat.accent, p.x, p.y, p.z + 0.02);
    tip.scale.setScalar(0.8);
    body.add(housing, barrel, tip);
  }
  // Lanzadores bajo las alas: pilón y dos misiles visibles.
  for (const o of FLAGSHIP_HARDPOINTS.missile) {
    const p = off(o);
    body.add(mesh(g.pylon, mat.dark, p.x, p.y + 0.12, p.z + 0.05));
    for (const dx of [-0.07, 0.07]) {
      const missile = mesh(g.missile, mat.hull, p.x + dx, p.y, p.z + 0.05);
      const head = mesh(g.light, mat.red, p.x + dx, p.y, p.z - 0.27);
      head.scale.setScalar(0.9);
      body.add(missile, head);
    }
  }

  // Detalles: placas, antena y luces de navegación.
  const greebles: Array<[number, number, number, number, number, number]> = [
    [0.18, 0.43, 0.2, 0.12, 0.05, 0.3],
    [-0.16, 0.43, 0.9, 0.1, 0.05, 0.4],
    [0, 0.4, 1.35, 0.2, 0.06, 0.25],
    [0.38, 0.22, 0.3, 0.06, 0.08, 0.5],
    [-0.38, 0.22, 0.3, 0.06, 0.08, 0.5],
    [0, -0.36, 0.1, 0.3, 0.06, 1.2],
  ];
  for (const [x, y, z, sx, sy, sz] of greebles) {
    const b = mesh(g.greeble, mat.dark, x, y, z);
    b.scale.set(sx, sy, sz);
    body.add(b);
  }
  const antenna = mesh(g.antenna, mat.metal, 0.08, 0.66, 1.1);
  antenna.rotation.x = 0.4;
  body.add(antenna);

  const port = mesh(g.light, mat.red, -2.36, -0.08, 0.55);
  const starboard = mesh(g.light, mat.green, 2.36, -0.08, 0.55);
  const portGlow = glowSprite(0xff3030, 0.5);
  portGlow.position.copy(port.position);
  const starGlow = glowSprite(0x30ff70, 0.5);
  starGlow.position.copy(starboard.position);
  const strobe = mesh(g.light, mat.white, 0, 0.62, 1.65);
  const strobeGlow = glowSprite(0xffffff, 0.9);
  strobeGlow.position.copy(strobe.position);
  body.add(port, starboard, portGlow, starGlow, strobe, strobeGlow);

  let thrust = 0;
  let pulse = false;
  const rig: ShipRig = {
    setThrust(k, p = false) {
      thrust = Math.max(0, Math.min(1, k));
      pulse = p;
    },
    tick(t, _dt, idle) {
      // Llama: crece con el empuje y parpadea un poco; con el pulso, larga y azulada.
      const flicker = 0.9 + 0.1 * Math.sin(t * 37) * Math.sin(t * 23);
      const len = (pulse ? 3.2 : 0.25 + thrust * 1.5) * flicker;
      for (const f of flames) {
        f.scale.set(1, 1, len);
        f.visible = len > 0.05;
      }
      mat.flame.color.setHex(pulse ? 0x9fb8ff : 0x7fdcff);
      for (const s of glows) s.scale.setScalar((0.55 + thrust * 0.6 + (pulse ? 0.6 : 0)) * flicker);
      // Destello blanco cada 1,2 s; luces de posición fijas.
      const on = t % 1.2 < 0.08;
      strobe.visible = on;
      strobeGlow.visible = on;
      // Flotar: balanceo y deriva suaves, más cuanto más quieta está.
      body.position.set(Math.sin(t * 0.31) * 0.06 * idle, Math.sin(t * 0.47) * 0.09 * idle, 0);
      body.rotation.set(Math.sin(t * 0.37) * 0.025 * idle, 0, Math.sin(t * 0.29 + 1) * 0.04 * idle);
    },
    muzzle(kind, index, out) {
      const list = FLAGSHIP_HARDPOINTS[kind];
      const o = list[index % Math.max(1, list.length)];
      out.copy(o ? off(o) : new THREE.Vector3());
      ship.updateMatrixWorld();
      return body.localToWorld(out);
    },
  };
  ship.userData.rig = rig;
  // Los materiales y geometrías se comparten: solo hay que liberar los halos (materiales propios).
  ship.userData.dispose = () => {
    ship.traverse((o) => {
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
  };
  return ship;
}

/** Control de animación y bocas de fuego de una nave creada con `createFlagship`. */
export function shipRig(ship: THREE.Object3D): ShipRig {
  return ship.userData.rig as ShipRig;
}

/** Libera lo propio de una nave creada con `createFlagship` (lo compartido se conserva). */
export function disposeShip(ship: THREE.Object3D): void {
  (ship.userData.dispose as (() => void) | undefined)?.();
}
