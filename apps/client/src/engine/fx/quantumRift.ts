/**
 * Toque local (solo en la pantalla del piloto) del salto cuántico. La grieta
 * de verdad está en el mundo (`riftPortal.ts`) y la ven todos; esto solo
 * acompaña, con suavidad, y solo trabaja mientras dura (un pase de
 * posprocesado propio; el resto del tiempo el motor dibuja como siempre):
 *
 * 1. Carga (`telemetry.quantumCharge`): aberración cromática y una lente leve
 *    hacia la grieta (`center`, su posición en pantalla), cada vez más fuertes.
 * 2. Salto (`jump`): la última imagen del sistema se estira hacia la grieta y
 *    se funde con el túnel, con un destello breve.
 * 3. Llegada (`arrive`): una onda cromática que se apaga.
 *
 * Con «reducir efectos» (accesibilidad) no hay destellos y todo es más tenue.
 * En calidad baja, menos muestras.
 */
import * as THREE from "three";

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tFrozen;
uniform float uTime;
uniform float uCharge;
uniform float uBreak;
uniform float uArrive;
uniform float uReduce;
uniform float uLow;
uniform float uAspect;
uniform vec2 uCenter;
varying vec2 vUv;

vec3 sampleCA(sampler2D tex, vec2 uv, vec2 off) {
  return vec3(texture2D(tex, uv + off).r, texture2D(tex, uv).g, texture2D(tex, uv - off).b);
}

void main() {
  vec2 asp = vec2(uAspect, 1.0);
  vec2 uv = vUv;
  vec2 p = (uv - uCenter) * asp;
  float r = length(p);
  vec2 dir = r > 1e-4 ? p / r : vec2(0.0);
  float soft = 1.0 - 0.6 * uReduce;
  float charge = uCharge * uCharge;
  float ripple = uArrive > 0.0 ? (1.0 - uArrive) * (0.5 + 0.5 * sin(r * 40.0 - uArrive * 30.0)) : 0.0;

  // Lente leve hacia la grieta.
  uv -= dir / asp * charge * 0.012 * soft / (r * 6.0 + 0.5);
  vec2 ca = dir / asp * (0.0008 + 0.005 * charge + 0.004 * ripple) * soft * (0.4 + r);
  vec3 col = sampleCA(tScene, uv, ca);
  // Viñeta azulada que se cierra al cargar.
  col *= 1.0 - charge * 0.35 * smoothstep(0.35, 1.1, r) * soft;
  col += vec3(0.05, 0.08, 0.2) * charge * smoothstep(0.5, 1.2, r) * soft;

  // Salto: la imagen del sistema se estira hacia la grieta y se funde con el túnel.
  if (uBreak > 0.0 && uBreak < 1.0) {
    float samples = uLow > 0.5 ? 4.0 : 10.0;
    vec3 frozen = vec3(0.0);
    float pull = 0.15 + uBreak * 0.6;
    for (float i = 0.0; i < 10.0; i++) {
      if (i >= samples) break;
      vec2 s = vUv + (uCenter - vUv) * pull * (i / samples);
      frozen += texture2D(tFrozen, s).rgb;
    }
    frozen /= samples;
    float k = smoothstep(0.1, 0.85, uBreak);
    col = mix(frozen, col, k);
    col += vec3(0.75, 0.85, 1.0) * exp(-uBreak * 9.0) * 0.7 * (1.0 - uReduce);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Duraciones de la rotura y de la llegada, en segundos. */
const BREAK_SEC = 1.0;
const ARRIVE_SEC = 1.6;

export class QuantumRift {
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  /** Índice del objetivo donde se dibuja; el otro guarda la imagen congelada al saltar. */
  private current = 0;
  private material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      tScene: { value: null },
      tFrozen: { value: null },
      uTime: { value: 0 },
      uCharge: { value: 0 },
      uBreak: { value: 0 },
      uArrive: { value: 0 },
      uReduce: { value: 0 },
      uLow: { value: 0 },
      uAspect: { value: 1 },
      uCenter: { value: new THREE.Vector2(0.5, 0.52) },
    },
    depthTest: false,
    depthWrite: false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private time = 0;
  private breakT = -1;
  private arriveT = -1;
  private size = new THREE.Vector2();
  /** Posición en pantalla (0–1) de la grieta propia, o null (centro de la pantalla). */
  center: THREE.Vector2 | null = null;

  constructor() {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Salto: congela la imagen de `scene` (el sistema) y la funde con lo que se dibuje después (el túnel). */
  jump(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.ensureTargets(renderer);
    renderer.setRenderTarget(this.targets![this.current]!);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    this.breakT = 0;
    this.arriveT = -1;
    // Lo último dibujado queda congelado; los fotogramas nuevos van al otro objetivo.
    this.current = 1 - this.current;
  }

  private ensureTargets(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.size);
    if (!this.targets || this.targets[0].width !== this.size.x || this.targets[0].height !== this.size.y) {
      this.targets?.[0].dispose();
      this.targets?.[1].dispose();
      const make = () => new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, depthBuffer: true });
      this.targets = [make(), make()];
    }
  }

  /** Llegada: la grieta se abre en el destino y se cierra tras la nave. */
  arrive(): void {
    this.arriveT = 0;
    this.breakT = -1;
  }

  /** Si el efecto está en marcha. */
  active(charge: number | null): boolean {
    return (charge !== null && charge > 0) || this.breakT >= 0 || this.arriveT >= 0;
  }

  /**
   * Dibuja la escena con el efecto si está en marcha y devuelve true; si no,
   * no hace nada y devuelve false (el motor dibuja como siempre).
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, dt: number, charge: number | null, opts: { reduce: boolean; low: boolean }): boolean {
    if (!this.active(charge)) {
      // Libera la memoria de vídeo cuando no hace falta.
      if (this.targets) {
        this.targets[0].dispose();
        this.targets[1].dispose();
        this.targets = null;
      }
      return false;
    }
    this.time += dt;
    if (this.breakT >= 0) {
      this.breakT += dt / BREAK_SEC;
      if (this.breakT >= 1) this.breakT = -1;
    }
    if (this.arriveT >= 0) {
      this.arriveT += dt / ARRIVE_SEC;
      if (this.arriveT >= 1) this.arriveT = -1;
    }
    this.ensureTargets(renderer);
    const target = this.targets![this.current]!;
    const u = this.material.uniforms;
    u.tScene!.value = target.texture;
    u.tFrozen!.value = this.targets![1 - this.current]!.texture;
    u.uTime!.value = this.time;
    u.uCharge!.value = charge ?? 0;
    u.uBreak!.value = Math.max(0, this.breakT);
    u.uArrive!.value = Math.max(0, this.arriveT);
    u.uReduce!.value = opts.reduce ? 1 : 0;
    u.uLow!.value = opts.low ? 1 : 0;
    u.uAspect!.value = this.size.x / Math.max(1, this.size.y);
    // Al saltar se conserva el centro de la grieta en la que entró la nave.
    if (this.center && this.breakT < 0) (u.uCenter!.value as THREE.Vector2).copy(this.center);
    else if (!this.center && this.breakT < 0) (u.uCenter!.value as THREE.Vector2).set(0.5, 0.5);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    return true;
  }

  dispose(): void {
    this.targets?.[0].dispose();
    this.targets?.[1].dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
