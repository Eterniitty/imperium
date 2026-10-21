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

const FRAGMENT = /* glsl */ `
uniform vec3 uHitDir;
uniform float uHit;
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
  // Lado del golpe y lado de la estrella.
  float hitSide = smoothstep(0.2, 1.0, dot(vLocal, uHitDir));
  float heatSide = smoothstep(-0.2, 1.0, dot(vLocal, uHeatDir));
  // El calor «respira» despacio (menos de 1 Hz): ondula, no parpadea.
  float breathe = 0.85 + 0.15 * sin(uTime * 2.4 + dot(vLocal, vec3(3.0, 2.0, 1.0)));
  float hit = uHit * (0.25 + 0.75 * hitSide) * (0.35 + 0.65 * hex + rim);
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
  private hit = 0;
  /** Brillo al que sube tras un impacto (en unas centésimas: nunca de golpe). */
  private hitTarget = 0;
  private heat = 0;
  private heatTarget = 0;
  private readonly inv = new THREE.Quaternion();

  /** `lengthM`: eslora de la nave; la cúpula la envuelve con algo de holgura. */
  constructor(lengthM: number) {
    const material = new THREE.ShaderMaterial({
      ...withLogDepth({ vertexShader: VERTEX, fragmentShader: FRAGMENT }),
      uniforms: {
        uHitDir: { value: new THREE.Vector3(0, 0, -1) },
        uHit: { value: 0 },
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

  /** Impacto contra el escudo desde `fromWorld` (dirección en el mundo hacia el atacante), con fuerza 0–1. */
  impact(fromWorld: THREE.Vector3 | null, strength: number, reduce: boolean): void {
    if (fromWorld && fromWorld.lengthSq() > 0) {
      this.inv.copy(this.mesh.quaternion).invert();
      (this.mesh.material.uniforms.uHitDir!.value as THREE.Vector3).copy(fromWorld).normalize().applyQuaternion(this.inv);
    }
    // Cuenta como un destello pequeño (el gran destello es el del impacto en `Effects`).
    const peak = Math.min(1, 0.35 + strength) * flashGain(20) * (reduce ? 0.35 : 1);
    this.hitTarget = Math.max(this.hitTarget, peak);
  }

  /** Calor de una estrella: 0–1 y dirección en el mundo hacia ella (o 0: sin calor). */
  setHeat(k: number, towardStarWorld: THREE.Vector3 | null, reduce: boolean): void {
    this.heatTarget = Math.max(0, Math.min(1, k)) * (reduce ? 0.4 : 0.8);
    if (towardStarWorld && towardStarWorld.lengthSq() > 0) {
      this.inv.copy(this.mesh.quaternion).invert();
      (this.mesh.material.uniforms.uHeatDir!.value as THREE.Vector3).copy(towardStarWorld).normalize().applyQuaternion(this.inv);
    }
  }

  /** Sigue a la nave y apaga el brillo poco a poco. Sin escudo, no se ve. */
  update(dt: number, time: number, ship: THREE.Object3D, shieldLeft: boolean): void {
    this.mesh.position.copy(ship.getWorldPosition(this.mesh.position));
    ship.getWorldQuaternion(this.mesh.quaternion);
    if (this.hitTarget > this.hit) this.hit = Math.min(this.hitTarget, this.hit + dt * 12);
    else this.hitTarget = 0;
    this.hit = Math.max(0, this.hit - (this.hitTarget ? 0 : dt * 1.6));
    this.heat += (this.heatTarget - this.heat) * Math.min(1, dt * 2);
    const u = this.mesh.material.uniforms;
    u.uHit!.value = shieldLeft ? this.hit : 0;
    u.uHeat!.value = shieldLeft ? this.heat : 0;
    u.uTime!.value = time % 1000;
    this.mesh.visible = shieldLeft && (this.hit > 0.003 || this.heat > 0.003);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
