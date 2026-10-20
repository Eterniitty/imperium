import * as THREE from "three";
import { withLogDepth } from "./logDepth";
import { Rng } from "@imperium/procgen";

/**
 * Fondo lejano: una esfera con brumas nebulares y un campo de estrellas
 * remotas. Sigue a la cámara, así que nunca se alcanza: da sensación de
 * inmensidad sin coste de simulación.
 */
export class Backdrop {
  readonly object = new THREE.Group();

  constructor(radius = 9000, seed = 1337) {
    const rng = new Rng(seed);

    // Estrellas remotas.
    const count = 5000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Dirección uniforme sobre la esfera.
      const u = rng.range(-1, 1);
      const t = rng.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = s * Math.cos(t) * radius;
      pos[i * 3 + 1] = u * radius;
      pos[i * 3 + 2] = s * Math.sin(t) * radius;
      tint.setHSL(rng.pick([0.08, 0.12, 0.58, 0.62, 0.0]), rng.range(0.2, 0.6), rng.range(0.55, 0.95));
      const b = rng.range(0.25, 1);
      col[i * 3] = tint.r * b;
      col[i * 3 + 1] = tint.g * b;
      col[i * 3 + 2] = tint.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }),
    );
    stars.frustumCulled = false;
    stars.renderOrder = -9;

    // Brumas nebulares (solo visual: aquí sí se usan funciones trigonométricas).
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.05, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uSeed: { value: rng.range(0, 100) } },
        ...withLogDepth({
vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uSeed;
          varying vec3 vDir;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)) + uSeed) * 43758.5453); }
          float noise(vec3 p) {
            vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
          }
          float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
          void main() {
            vec3 d = normalize(vDir);
            float n = fbm(d * 2.2);
            float m = fbm(d * 4.5 + 7.0);
            float band = exp(-pow(d.y * 2.6 + (n - 0.5) * 1.4, 2.0));
            vec3 base = vec3(0.012, 0.016, 0.035);
            vec3 violet = vec3(0.16, 0.06, 0.22) * smoothstep(0.45, 0.85, n) * 0.6;
            vec3 teal = vec3(0.03, 0.12, 0.16) * smoothstep(0.5, 0.9, m) * 0.5;
            vec3 dust = vec3(0.10, 0.07, 0.05) * band * smoothstep(0.35, 0.75, m) * 0.45;
            gl_FragColor = vec4(base + violet + teal + dust, 1.0);
          }
        `
}),
      }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;

    this.object.add(sky, stars);
  }

  follow(camera: THREE.Camera): void {
    this.object.position.copy(camera.position);
  }
}
