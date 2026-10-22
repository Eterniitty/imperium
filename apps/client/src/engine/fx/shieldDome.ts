/**
 * Cúpula del escudo: una burbuja de hexágonos alrededor de una nave que solo
 * se ve cuando el escudo trabaja. Un impacto la enciende por el lado del golpe
 * y se apaga poco a poco; el calor de una estrella la mantiene encendida, en
 * naranja, por el lado de la estrella. Sin destellos: sube con el limitador de
 * destellos y nunca parpadea; con «reducir efectos», más tenue.
 */
import * as THREE from "three";
import { withLogDepth } from "../logDepth";
import { flashGain } from "./flashLimiter";

const VERTEX = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vLocal = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

/** Impactos que conviven a la vez en la cúpula (los más viejos dejan sitio a los nuevos). */
const MAX_IMPACTS = 6;
/** Segundos que tarda la onda de un impacto en recorrer la burbuja y apagarse. */
const IMPACT_LIFE = 1.6;

const FRAGMENT = /* glsl */ `
#define MAX_IMPACTS ${MAX_IMPACTS}
uniform vec4 uImpacts[MAX_IMPACTS]; // xyz: dirección del impacto (local); w: edad (s), < 0 = libre
uniform float uStrength[MAX_IMPACTS];
uniform vec3 uHeatDir;
uniform float uHeat;
uniform float uTime;
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vViewDir;

// Rejilla de hexágonos sobre la esfera (coordenadas esféricas): 1 en los bordes.
float hexEdge(vec3 p) {
  vec2 uv = vec2(atan(p.z, p.x) * 6.0, asin(clamp(p.y, -1.0, 1.0)) * 7.0);
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  float d = max(q.x * 0.866 + q.y * 0.5, q.y);
  return smoothstep(0.38, 0.47, d);
}

void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.2);
  float hex = hexEdge(vLocal);
  // Cada impacto: un destello en el punto del golpe y una onda que nace allí y recorre toda la burbuja,
  // encendiendo los hexágonos a su paso, cada vez más débil.
  float wave = 0.0;
  for (int i = 0; i < MAX_IMPACTS; i++) {
    vec4 im = uImpacts[i];
    if (im.w < 0.0 || im.w > ${IMPACT_LIFE.toFixed(2)}) continue;
    float ang = acos(clamp(dot(vLocal, normalize(im.xyz)), -1.0, 1.0));
    float front = im.w * 2.6;                      // radianes recorridos (la onda da la vuelta en ~1,2 s)
    float ring = exp(-pow((ang - front) * 5.0, 2.0)); // el frente de la onda
    float fade = 1.0 - im.w / ${IMPACT_LIFE.toFixed(2)};
    float core = exp(-ang * 7.0) * exp(-im.w * 5.0);  // el destello del golpe
    wave += uStrength[i] * (ring * fade * fade * (0.3 + 0.9 * hex) + core * 1.4);
  }
  float heatSide = smoothstep(-0.2, 1.0, dot(vLocal, uHeatDir));
  // El calor «respira» despacio (menos de 1 Hz): ondula, no parpadea.
  float breathe = 0.85 + 0.15 * sin(uTime * 2.4 + dot(vLocal, vec3(3.0, 2.0, 1.0)));
  float hit = wave * (0.5 + 0.5 * rim + 0.4 * hex);
  float heat = uHeat * heatSide * breathe * (0.3 + 0.7 * hex + rim * 0.8);
  vec3 shield = vec3(0.45, 0.85, 1.0);
  vec3 warm = vec3(1.0, 0.62, 0.25);
  vec3 color = shield * hit + warm * heat;
  float alpha = clamp(hit + heat, 0.0, 1.0) * 0.75;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

export class ShieldDome {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** Impactos vivos: dirección local, edad y fuerza (ver `FRAGMENT`). */
  private impacts: Array<{ dir: THREE.Vector3; age: number; strength: number }> = [];
  private heat = 0;
  private heatTarget = 0;
  private readonly inv = new THREE.Quaternion();

  /** `lengthM`: eslora de la nave; la cúpula la envuelve con algo de holgura. */
  constructor(lengthM: number) {
    const material = new THREE.ShaderMaterial({
      ...withLogDepth({ vertexShader: VERTEX, fragmentShader: FRAGMENT }),
      uniforms: {
        uImpacts: { value: Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector4(0, 0, -1, -1)) },
        uStrength: { value: new Array<number>(MAX_IMPACTS).fill(0) },
        uHeatDir: { value: new THREE.Vector3(0, 0, 1) },
        uHeat: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material);
    // Ovalada como la nave: larga en Z (el morro mira a -Z), más baja que ancha.
    this.mesh.scale.set(lengthM * 0.42, lengthM * 0.28, lengthM * 0.66);
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /**
   * Impacto contra el escudo desde `fromWorld` (dirección en el mundo hacia el
   * atacante, o null: por delante), con fuerza 0–1: la onda nace en ese punto
   * de la burbuja y la recorre entera.
   */
  impact(fromWorld: THREE.Vector3 | null, strength: number, reduce: boolean): void {
    this.inv.copy(this.mesh.quaternion).invert();
    const dir = fromWorld && fromWorld.lengthSq() > 0 ? fromWorld.clone().normalize().applyQuaternion(this.inv) : new THREE.Vector3(0, 0, -1);
    // Cuenta como un destello pequeño (el gran destello es el del impacto en `Effects`).
    const s = Math.min(1, 0.35 + strength) * flashGain(20) * (reduce ? 0.35 : 1);
    if (this.impacts.length >= MAX_IMPACTS) this.impacts.shift();
    this.impacts.push({ dir, age: 0, strength: s });
  }

  /** Calor de una estrella: 0–1 y dirección en el mundo hacia ella (o 0: sin calor). */
  setHeat(k: number, towardStarWorld: THREE.Vector3 | null, reduce: boolean): void {
    this.heatTarget = Math.max(0, Math.min(1, k)) * (reduce ? 0.4 : 0.8);
    if (towardStarWorld && towardStarWorld.lengthSq() > 0) {
      this.inv.copy(this.mesh.quaternion).invert();
      (this.mesh.material.uniforms.uHeatDir!.value as THREE.Vector3).copy(towardStarWorld).normalize().applyQuaternion(this.inv);
    }
  }

  /** Sigue a la nave y hace avanzar las ondas de los impactos. Sin escudo, no se ve. */
  update(dt: number, time: number, ship: THREE.Object3D, shieldLeft: boolean): void {
    this.mesh.position.copy(ship.getWorldPosition(this.mesh.position));
    ship.getWorldQuaternion(this.mesh.quaternion);
    for (const im of this.impacts) im.age += dt;
    this.impacts = this.impacts.filter((im) => im.age < IMPACT_LIFE);
    this.heat += (this.heatTarget - this.heat) * Math.min(1, dt * 2);
    const u = this.mesh.material.uniforms;
    const slots = u.uImpacts!.value as THREE.Vector4[];
    const strengths = u.uStrength!.value as number[];
    for (let i = 0; i < MAX_IMPACTS; i++) {
      const im = this.impacts[i];
      if (im && shieldLeft) {
        slots[i]!.set(im.dir.x, im.dir.y, im.dir.z, im.age);
        strengths[i] = im.strength;
      } else {
        slots[i]!.w = -1;
        strengths[i] = 0;
      }
    }
    u.uHeat!.value = shieldLeft ? this.heat : 0;
    u.uTime!.value = time % 1000;
    this.mesh.visible = shieldLeft && (this.impacts.length > 0 || this.heat > 0.003);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
