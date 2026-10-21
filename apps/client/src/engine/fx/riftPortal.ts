/**
 * Grieta del salto cuántico como objeto del mundo (no de la pantalla): un
 * desgarro en el espacio, delante de la nave y mirando al destino, que ven
 * todos los del sistema.
 *
 * - Carga (`charge`): una costura de luz que se alarga y se abre poco a poco,
 *   con grietas secundarias que se encienden, chispas que el desgarro absorbe y
 *   el fondo que se curva a su alrededor (lente).
 * - Salto (`burst`): se abre del todo, la nave entra y desaparece; destello y la
 *   grieta se cierra tras ella.
 * - Llegada (`arrive`): se abre otra en el destino, la nave sale de ella y se cierra.
 *
 * Dentro del desgarro se ve «el otro lado»: el fondo real refractado y
 * arremolinado (si hay captura de la escena) mezclado con el flujo cuántico.
 * La captura es un pase extra que solo se hace mientras hay
 * una grieta a la vista y la calidad no es baja: fuera del salto no cuesta nada.
 * Con «Reducir efectos visuales» no hay destellos, ni parpadeos rápidos, y hay
 * menos chispas.
 */
import * as THREE from "three";
import { FLAGSHIP_LENGTH_M, QUANTUM_CHARGE_SEC, QUANTUM_RIFT } from "@imperium/content";
import type { Quat, Vec3 } from "@imperium/shared";
import { withLogDepth } from "../logDepth";
import { glowTexture } from "../textures";

/** Alto de la grieta (m) y lado del plano que la contiene (con su halo y la lente). */
export const RIFT_HEIGHT = FLAGSHIP_LENGTH_M * QUANTUM_RIFT.heightLengths;
const PLANE = RIFT_HEIGHT * 1.9;
/** Medio alto del desgarro en coordenadas del plano (-1..1). */
const HALF = RIFT_HEIGHT / PLANE;

const VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform float uEnergy;
uniform float uFade;
uniform float uReduce;
uniform float uSeed;
uniform float uHasScene;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform vec2 uCenter;
varying vec2 vP;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
float tri(float x) { return abs(fract(x) - 0.5) * 2.0; }

// Columna vertebral quebrada del desgarro (como un rayo), en x según y.
float spine(float y) {
  return 0.05 * (tri(y * 2.3 + uSeed) - 0.5) + 0.03 * (tri(y * 5.7 + uSeed * 1.7) - 0.5) + 0.012 * (tri(y * 15.0 + uSeed * 3.1) - 0.5);
}

// Distancia a un segmento.
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 p = vP;
  float calm = 1.0 - 0.8 * uReduce;
  float grow = 0.3 + 0.7 * smoothstep(0.0, 0.7, max(uEnergy, uOpen));
  float hh = ${HALF.toFixed(4)} * grow;
  float yy = p.y / hh;
  float env = clamp(1.0 - yy * yy, 0.0, 1.0);
  float sx = spine(p.y);
  // Ancho: se abre con uOpen; respira un poco; una costura mínima mientras carga.
  float breathe = 0.8 + 0.2 * sin(p.y * 11.0 + uTime * 2.3) * calm;
  float w = (uOpen * 0.2 * breathe + 0.004 * uEnergy) * pow(env, 0.55);
  float dx = abs(p.x - sx) - w;
  // Fuera de las puntas, distancia a la punta.
  float tipD = max(0.0, abs(p.y) - hh);
  float d = env > 0.0 ? dx : length(vec2(p.x - sx, tipD));
  vec2 screen = gl_FragCoord.xy / uResolution;
  vec2 toC = screen - uCenter;

  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // --- El otro lado: dentro del desgarro ---
  if (d < 0.0 && env > 0.0) {
    float across = (p.x - sx) / max(w, 1e-4);
    float depth = clamp(-d / max(w, 1e-4), 0.0, 1.0);
    // Flujo cuántico: bandas que corren hacia el fondo y se arremolinan.
    vec2 q = vec2(across * 1.4, p.y * 3.0 - uTime * 0.9 * calm);
    float flow = fbm(q * 2.0 + vec2(fbm(q + uTime * 0.2), 0.0));
    float streak = pow(max(0.0, sin(across * 6.0 + flow * 6.0 + uTime * 3.0 * calm)), 8.0);
    vec3 quantum = mix(vec3(0.015, 0.01, 0.07), vec3(0.22, 0.32, 1.0), flow * flow) + vec3(0.7, 0.55, 1.2) * streak * 0.45;
    vec3 other = quantum;
    if (uHasScene > 0.5) {
      // El fondo real, como visto a través de una lente que lo retuerce.
      vec2 swirl = vec2(-across * 0.05 * uOpen, sin(p.y * 6.0 + uTime) * 0.01) + toC * (-0.4 * depth);
      vec3 bg = texture2D(uScene, clamp(screen + swirl, 0.001, 0.999)).rgb;
      other = mix(bg * vec3(0.6, 0.7, 1.4) + vec3(0.01, 0.0, 0.05), quantum, 0.6);
    }
    col = other * (0.45 + 0.55 * depth);
    alpha = smoothstep(0.0, 0.25, depth) * 0.96;
  } else if (uHasScene > 0.5) {
    // --- Lente: el fondo se curva hacia la grieta ---
    float r = length(vec2(p.x - sx, max(0.0, abs(p.y) - hh * 0.6)));
    float lens = (uOpen * 0.8 + uEnergy * 0.25) * exp(-r * 3.5) * smoothstep(1.0, 0.75, length(p));
    if (lens > 0.002) {
      vec2 off = -normalize(toC + 1e-5) * lens * 0.06;
      vec3 bg = vec3(texture2D(uScene, clamp(screen + off * 1.12, 0.001, 0.999)).r, texture2D(uScene, clamp(screen + off, 0.001, 0.999)).g, texture2D(uScene, clamp(screen + off * 0.88, 0.001, 0.999)).b);
      col = bg;
      alpha = smoothstep(0.0, 0.35, lens);
    }
  }

  // --- Bordes de luz ---
  float e = abs(d);
  float crackle = 0.75 + 0.25 * noise(vec2(p.y * 70.0, uTime * 9.0 * calm + uSeed));
  float core = exp(-e * 260.0) * (0.5 + 1.1 * max(uEnergy, uOpen)) * crackle;
  float halo = exp(-e * 34.0) * (0.1 + 0.28 * max(uEnergy, uOpen)) * (d < 0.0 ? 0.5 : 1.0);
  vec3 glow = vec3(0.85, 0.92, 1.0) * core * 1.8 + mix(vec3(0.35, 0.5, 1.0), vec3(0.75, 0.4, 1.0), 0.5 + 0.5 * sin(p.y * 4.0 + uTime)) * halo;

  // --- Grietas secundarias que se encienden con la carga ---
  float branches = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float on = smoothstep(fi / 7.0, fi / 7.0 + 0.15, uEnergy);
    if (on <= 0.0) continue;
    float by = (hash(fi + uSeed) - 0.5) * 1.6 * hh;
    float side = mod(fi, 2.0) * 2.0 - 1.0;
    vec2 a = vec2(spine(by), by);
    vec2 b = a + vec2(side * (0.12 + 0.18 * hash(fi * 3.1 + uSeed)), (hash(fi * 5.7) - 0.5) * 0.25) * on;
    vec2 c = b + vec2(side * (0.06 + 0.12 * hash(fi * 7.3)), (hash(fi * 9.1) - 0.5) * 0.2) * on;
    float bd = min(seg(p, a, b), seg(p, b, c) + 0.002);
    float flick = 0.6 + 0.4 * sin(uTime * (7.0 + fi) * calm + fi);
    branches += exp(-bd * 300.0) * on * flick + exp(-bd * 40.0) * 0.12 * on;
  }
  glow += vec3(0.6, 0.75, 1.0) * branches * (0.6 + uEnergy) * smoothstep(-0.005, 0.01, d);

  // Resplandor general (se ve de lejos) que sube con la energía.
  float r0 = length(vec2((p.x - sx) * 1.6, p.y * 0.8));
  glow += vec3(0.4, 0.5, 1.0) * exp(-r0 * 4.0) * (0.08 * uEnergy + 0.08 * uOpen);

  glow *= smoothstep(1.0, 0.8, length(p));
  col *= uFade;
  alpha *= uFade;
  glow *= uFade;
  // Alfa premultiplicado: lo de dentro y la lente tapan lo de detrás; la luz se suma.
  gl_FragColor = vec4(col * alpha + glow, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const shader = withLogDepth({ vertexShader: VERTEX, fragmentShader: FRAGMENT });
const geometry = new THREE.PlaneGeometry(PLANE, PLANE);

/** Chispas que el desgarro absorbe (y que salen despedidas al saltar). */
class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  constructor(private n: number) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ map: glowTexture(), size: RIFT_HEIGHT * 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
  }

  /** Atrae chispas desde alrededor hacia la costura (`rate`: chispas por segundo). */
  update(dt: number, rate: number, open: number): void {
    const H = RIFT_HEIGHT;
    let spawn = rate * dt;
    for (let i = 0; i < this.n; i++) {
      let a = this.age[i]!;
      if (a >= this.life[i]! && spawn > Math.random()) {
        spawn -= 1;
        // Nace en un anillo alrededor y cae hacia la costura, girando.
        const ang = Math.random() * Math.PI * 2;
        const r = H * (0.45 + Math.random() * 0.4);
        const x = Math.cos(ang) * r * 0.7;
        const y = Math.sin(ang) * r * 0.6;
        this.pos.set([x, y, (Math.random() - 0.5) * H * 0.2], i * 3);
        const k = 0.9 + Math.random() * 0.8;
        this.vel.set([-x * k, -y * k * 0.6 + (Math.random() - 0.5) * H * 0.1, -this.pos[i * 3 + 2]! * 1.5], i * 3);
        this.age[i] = a = 0;
        this.life[i] = 0.9 + Math.random() * 0.6;
      }
      const alive = a < this.life[i]!;
      if (alive) {
        this.age[i] = a += dt;
        for (let c = 0; c < 3; c++) this.pos[i * 3 + c]! += this.vel[i * 3 + c]! * dt;
        // Se acelera al acercarse (cae en el desgarro).
        const x = this.pos[i * 3]!;
        this.vel[i * 3]! -= x * dt * 2.5 * (0.3 + open);
      }
      const k = alive ? Math.sin(Math.PI * Math.min(1, a / this.life[i]!)) : 0;
      this.col.set([0.55 * k, 0.7 * k, 1.0 * k], i * 3);
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.color!.needsUpdate = true;
  }

  /** Al saltar: todas salen despedidas hacia fuera. */
  burst(): void {
    const H = RIFT_HEIGHT;
    for (let i = 0; i < this.n; i++) {
      const ang = Math.random() * Math.PI * 2;
      this.pos.set([(Math.random() - 0.5) * H * 0.1, (Math.random() - 0.5) * H * 0.8, 0], i * 3);
      const s = H * (0.6 + Math.random() * 1.4);
      this.vel.set([Math.cos(ang) * s, Math.sin(ang) * s * 0.7, (Math.random() - 0.2) * s], i * 3);
      this.age[i] = 0;
      this.life[i] = 0.6 + Math.random() * 0.7;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

type Mode = "charge" | "open" | "closing" | "arrive";

/** Una grieta en el espacio. Su grupo se coloca en el centro, orientado como la nave (el morro, -Z, hacia el destino). */
export class RiftPortal {
  readonly object = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private sparks: Sparks;
  private flare: THREE.Sprite;
  private open = 0;
  private energy = 0;
  private fade = 0;
  private mode: Mode = "charge";
  private t = 0;
  /** Carga empujada desde fuera (la propia); si es null, la carga avanza sola con el tiempo (la de otra nave). */
  private chargeK: number | null = null;
  private reduce = false;

  constructor(at: THREE.Vector3, q: THREE.Quaternion, seed: number, reduce: boolean) {
    this.reduce = reduce;
    this.material = new THREE.ShaderMaterial({
      ...shader,
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: 0 },
        uEnergy: { value: 0 },
        uFade: { value: 0 },
        uReduce: { value: reduce ? 1 : 0 },
        uSeed: { value: seed % 97 },
        uHasScene: { value: 0 },
        uScene: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      },
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.sparks = new Sparks(reduce ? 50 : 160);
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fb8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flare.renderOrder = 6;
    this.object.add(mesh, this.sparks.points, this.flare);
    this.object.position.copy(at);
    this.object.quaternion.copy(q);
  }

  /** Carga (0–1) de la grieta propia; sin llamarla, la de otra nave carga sola en `QUANTUM_CHARGE_SEC`. */
  setCharge(k: number): void {
    this.chargeK = k;
  }

  /** Se abre del todo: la nave entra. */
  burst(): void {
    if (this.mode === "open") return;
    this.mode = "open";
    this.t = 0;
    this.energy = 1;
    this.sparks.burst();
  }

  /** Se cierra y desaparece. */
  close(): void {
    if (this.mode !== "closing") {
      this.mode = "closing";
      this.t = 0;
    }
  }

  /** Grieta de llegada: se abre deprisa, deja salir a la nave y se cierra sola. */
  arrive(): void {
    this.mode = "arrive";
    this.t = 0;
    this.energy = 0.8;
  }

  get closing(): boolean {
    return this.mode === "closing";
  }

  /** Brillo actual (0–1), para la luz que ilumina la nave. */
  get intensity(): number {
    return Math.min(1, this.fade * (0.3 * this.energy + this.open));
  }

  /** Avanza la animación; devuelve false cuando ya se ha cerrado. */
  update(dt: number, time: number): boolean {
    this.t += dt;
    let target = 0;
    let rate = 1.5;
    let sparkRate = 0;
    switch (this.mode) {
      case "charge": {
        const k = this.chargeK ?? Math.min(1, this.t / QUANTUM_CHARGE_SEC);
        this.energy = k;
        target = 0.06 + 0.3 * k * k;
        rate = 2;
        sparkRate = 20 + 90 * k;
        this.fade = Math.min(1, this.fade + dt * 2);
        // La de otra nave: si no salta ni cancela en un buen rato, se cierra sola.
        if (this.chargeK === null && this.t > QUANTUM_CHARGE_SEC + 15) this.close();
        break;
      }
      case "open":
        target = 1;
        rate = 5;
        this.fade = 1;
        break;
      case "arrive":
        this.fade = Math.min(1, this.fade + dt * 4);
        target = this.t < QUANTUM_RIFT.arriveSec ? 1 : 0;
        rate = 3;
        sparkRate = this.t < QUANTUM_RIFT.arriveSec * 0.6 ? 60 : 0;
        if (this.t >= QUANTUM_RIFT.arriveSec) this.close();
        break;
      case "closing":
        target = 0;
        rate = 2.2;
        this.energy = Math.max(0, this.energy - dt * 0.8);
        if (this.open < 0.08) this.fade = Math.max(0, this.fade - dt * 2.5);
        break;
    }
    this.open += (target - this.open) * Math.min(1, dt * rate);
    this.sparks.update(dt, this.reduce ? sparkRate * 0.3 : sparkRate, this.open);
    const u = this.material.uniforms;
    u.uTime!.value = time % 1000;
    u.uOpen!.value = this.open;
    u.uEnergy!.value = this.energy;
    u.uFade!.value = this.fade;
    const pulse = this.reduce ? 1 : 0.9 + 0.1 * Math.sin(time * 13);
    this.flare.scale.setScalar(RIFT_HEIGHT * (0.5 + 0.8 * this.open + 0.5 * this.energy) * pulse);
    this.flare.material.opacity = this.fade * (0.06 + 0.14 * this.energy + 0.08 * this.open);
    return !(this.mode === "closing" && this.fade <= 0.001);
  }

  dispose(): void {
    this.material.dispose();
    this.sparks.dispose();
    this.flare.material.dispose();
  }
}

/** Nave tragada por una grieta (o que sale de ella): animación de posición. */
interface Swallow {
  ship: THREE.Object3D;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  distance: number;
  t: number;
  /** Al acabar, quitarla y liberarla (las de otros); la propia solo se oculta. */
  done: (ship: THREE.Object3D) => void;
}

const tmpV = new THREE.Vector3();

/**
 * Las grietas de un sistema: la propia y las de otras naves. Dibuja, anima a
 * las naves que entran y hace la captura del fondo para la refracción.
 */
export class RiftField {
  readonly group = new THREE.Group();
  private rifts = new Map<string, RiftPortal>();
  private swallows: Swallow[] = [];
  private target: THREE.WebGLRenderTarget | null = null;
  private size = new THREE.Vector2();
  /** Luz de la grieta más cercana sobre las naves (siempre en la escena: añadirla y quitarla obligaría a recompilar). */
  readonly light = new THREE.PointLight(0x9fb8ff, 0, RIFT_HEIGHT * 8, 2);

  constructor() {
    this.group.add(this.light);
  }

  get active(): boolean {
    return this.rifts.size > 0;
  }

  /** Abre (o devuelve) la grieta de `key` en `at`, orientada con `q`. */
  open(key: string, at: Vec3 | THREE.Vector3, q: Quat | THREE.Quaternion, reduce: boolean): RiftPortal {
    let r = this.rifts.get(key);
    if (r && !r.closing) return r;
    if (r) this.drop(key, r);
    const pos = Array.isArray(at) ? new THREE.Vector3(...at) : at.clone();
    const quat = Array.isArray(q) ? new THREE.Quaternion(...q).normalize() : q.clone();
    let seed = 0;
    for (const c of key) seed = (seed * 31 + c.charCodeAt(0)) % 9973;
    r = new RiftPortal(pos, quat, seed + Math.floor(Math.random() * 50), reduce);
    this.rifts.set(key, r);
    this.group.add(r.object);
    return r;
  }

  get(key: string): RiftPortal | undefined {
    return this.rifts.get(key);
  }

  close(key: string): void {
    this.rifts.get(key)?.close();
  }

  /** Centro de la grieta delante de una nave en `p` con orientación `q`. */
  static ahead(p: THREE.Vector3, q: THREE.Quaternion, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, -FLAGSHIP_LENGTH_M * QUANTUM_RIFT.aheadLengths).applyQuaternion(q).add(p);
  }

  /**
   * La nave entra en la grieta `key`: acelera hacia ella y la cruza en
   * `QUANTUM_RIFT.departSec`; al acabar, `done` (ocultarla o liberarla) y la grieta se cierra.
   */
  swallow(key: string, ship: THREE.Object3D, done: (ship: THREE.Object3D) => void): void {
    const r = this.rifts.get(key);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion).normalize();
    const to = r ? r.object.position.clone().sub(ship.position).dot(dir) : FLAGSHIP_LENGTH_M * QUANTUM_RIFT.aheadLengths;
    r?.burst();
    this.swallows.push({ ship, from: ship.position.clone(), dir, distance: Math.max(0, to) + FLAGSHIP_LENGTH_M * 1.6, t: 0, done });
  }

  /** ¿Está tragándose a esta nave? */
  swallowing(ship: THREE.Object3D): boolean {
    return this.swallows.some((s) => s.ship === ship);
  }

  update(dt: number, time: number, viewer: THREE.Vector3 | null): void {
    this.swallows = this.swallows.filter((s) => {
      s.t += dt;
      const k = Math.min(1, s.t / QUANTUM_RIFT.departSec);
      // Arranca despacio y se lanza: la nave «cae» en la grieta.
      s.ship.position.copy(s.from).addScaledVector(s.dir, s.distance * k * k * k);
      if (k < 1) return true;
      s.done(s.ship);
      for (const [key, r] of this.rifts) if (r.object.position.distanceTo(s.ship.position) < RIFT_HEIGHT * 3) this.rifts.get(key)?.close();
      return false;
    });
    let best: RiftPortal | null = null;
    let bestD = Infinity;
    for (const [key, r] of this.rifts) {
      if (!r.update(dt, time)) {
        this.drop(key, r);
        continue;
      }
      const d = viewer ? r.object.position.distanceTo(viewer) : 0;
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best) {
      this.light.position.copy(best.object.position).add(tmpV.set(0, 0, RIFT_HEIGHT * 0.3).applyQuaternion(best.object.quaternion));
      // Intensidad física (decaimiento cuadrático): ilumina la nave a unas esloras.
      this.light.intensity = best.intensity * (RIFT_HEIGHT * 2) ** 2 * 4;
    } else {
      this.light.intensity = 0;
    }
  }

  /**
   * Captura la escena sin las grietas (para la refracción). Solo si hay alguna
   * a la vista y la calidad no es baja; si no, las grietas se dibujan sin fondo.
   */
  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, low: boolean): void {
    if (this.rifts.size === 0) {
      this.releaseTarget();
      return;
    }
    renderer.getDrawingBufferSize(this.size);
    const cam = camera as THREE.PerspectiveCamera;
    let visible = false;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const sphere = new THREE.Sphere();
    for (const r of this.rifts.values()) {
      sphere.set(r.object.position, PLANE);
      const inView = frustum.intersectsSphere(sphere);
      visible ||= inView;
      const u = r.material.uniforms;
      u.uResolution!.value.copy(this.size);
      const c = tmpV.copy(r.object.position).project(cam);
      u.uCenter!.value.set(c.x * 0.5 + 0.5, c.y * 0.5 + 0.5);
    }
    if (!visible || low) {
      for (const r of this.rifts.values()) r.material.uniforms.uHasScene!.value = 0;
      return;
    }
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    }
    this.group.visible = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    this.group.visible = true;
    for (const r of this.rifts.values()) {
      r.material.uniforms.uScene!.value = this.target.texture;
      r.material.uniforms.uHasScene!.value = 1;
    }
  }

  /** Posición en pantalla (0–1) de la grieta `key`, o null. */
  screenOf(key: string, camera: THREE.Camera): THREE.Vector2 | null {
    const r = this.rifts.get(key);
    if (!r) return null;
    const c = tmpV.copy(r.object.position).project(camera);
    return c.z < 1 ? new THREE.Vector2(c.x * 0.5 + 0.5, c.y * 0.5 + 0.5) : null;
  }

  private drop(key: string, r: RiftPortal): void {
    this.group.remove(r.object);
    r.dispose();
    if (this.rifts.get(key) === r) this.rifts.delete(key);
  }

  private releaseTarget(): void {
    this.target?.dispose();
    this.target = null;
  }

  clear(): void {
    for (const s of this.swallows) s.done(s.ship);
    this.swallows = [];
    for (const [key, r] of [...this.rifts]) this.drop(key, r);
    this.light.intensity = 0;
    this.releaseTarget();
  }

  dispose(): void {
    this.clear();
  }
}

