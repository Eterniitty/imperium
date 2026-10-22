import * as THREE from "three";
import { withLogDepth } from "./logDepth";
import { Rng } from "@imperium/procgen";
import { GALAXY, type WorldPosition } from "@imperium/shared";

/**
 * Fondo lejano: una esfera con nebulosas de color, un campo de estrellas
 * remotas y galaxias lejanas. Sigue a la cámara, así que nunca se alcanza: da
 * sensación de inmensidad sin coste de simulación.
 *
 * Todo sale de una semilla (`setSeed`): cada sistema tiene su propio cielo y
 * es siempre el mismo al volver, sin guardar nada. La banda de la Vía Láctea
 * va siempre por el plano galáctico (y = 0), como en el cielo real.
 */

/** Paletas de nebulosa: emisión (rojo-magenta), reflexión (azul), oxígeno (verde-azulado), polvo (ámbar). */
const NEBULA_HUES: readonly [number, number, number][] = [
  [0.95, 0.78, 0.6],
  [0.6, 0.66, 0.55],
  [0.48, 0.72, 0.5],
  [0.08, 0.7, 0.55],
  [0.78, 0.6, 0.6],
  [0.55, 0.5, 0.65],
];

export class Backdrop {
  readonly object = new THREE.Group();
  private readonly radius: number;
  private stars: THREE.Points | null = null;
  private galaxies = new THREE.Group();
  private readonly skyMat: THREE.ShaderMaterial;
  private seed = NaN;

  constructor(radius = 9000, seed = 1337) {
    this.radius = radius;
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSeed: { value: 0 },
        uColA: { value: new THREE.Color() },
        uColB: { value: new THREE.Color() },
        uColC: { value: new THREE.Color() },
        uAmount: { value: 1 },
        uShift: { value: new THREE.Vector3() },
        uCenterDir: { value: new THREE.Vector3(1, 0, 0) },
        uCenterGlow: { value: 0.5 },
      },
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
          uniform vec3 uColA;
          uniform vec3 uColB;
          uniform vec3 uColC;
          uniform float uAmount;
          uniform vec3 uShift;
          uniform vec3 uCenterDir;
          uniform float uCenterGlow;
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
            // Vía Láctea: banda por el plano galáctico, con polvo oscuro que la recorta.
            float n = fbm(d * 2.2);
            float band = exp(-pow(d.y * 3.2 + (n - 0.5) * 1.2, 2.0));
            float lanes = smoothstep(0.42, 0.62, fbm(d * 7.0 + 3.0));
            // Hacia el centro de la galaxia la banda brilla más y se ve el bulbo dorado; hacia fuera, se apaga.
            float toward = max(dot(d, uCenterDir), 0.0);
            float side = 0.45 + 1.1 * pow(toward, 3.0) * uCenterGlow;
            vec3 milky = vec3(0.12, 0.11, 0.115) * band * side * (0.55 + 0.45 * fbm(d * 12.0)) * mix(1.0, 0.35, lanes * band);
            float bulge = pow(toward, 10.0) * uCenterGlow * (0.6 + 0.4 * n) * mix(1.0, 0.45, lanes);
            milky += vec3(0.3, 0.22, 0.12) * bulge;
            // Nebulosas: ruido deformado (filamentos), dos o tres colores y núcleos más brillantes.
            vec3 q = d * 1.6 + uShift;
            vec3 w = vec3(fbm(q + 1.7), fbm(q + 9.2), fbm(q + 4.4));
            float neb = fbm(q * 1.4 + w * 1.8);
            float mask = smoothstep(0.5, 0.78, neb) * uAmount;
            float core = smoothstep(0.66, 0.9, neb) * uAmount;
            float mixer = fbm(q * 2.6 + 11.0);
            vec3 tint = mix(uColA, uColB, smoothstep(0.35, 0.65, mixer));
            tint = mix(tint, uColC, smoothstep(0.6, 0.8, fbm(q * 3.3 + 5.0)) * 0.7);
            float fil = 0.6 + 0.4 * fbm(q * 9.0 + w * 3.0);
            vec3 nebula = tint * (mask * 0.38 + core * 0.5) * fil;
            vec3 base = vec3(0.01, 0.013, 0.028);
            gl_FragColor = vec4(base + milky + nebula, 1.0);
          }
        `,
      }),
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.05, 64, 32), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.galaxies.renderOrder = -9;
    this.object.add(sky, this.galaxies);
    this.setSeed(seed);
  }

  /** Cambia el cielo al de otra semilla (la de cada sistema). Con la misma semilla no hace nada. */
  setSeed(seed: number): void {
    if (seed === this.seed) return;
    this.seed = seed;
    const rng = new Rng(seed);
    const u = this.skyMat.uniforms;
    u.uSeed!.value = rng.range(0, 100);
    const hues = [...NEBULA_HUES].sort(() => rng.next() - 0.5);
    const color = (h: [number, number, number]) => new THREE.Color().setHSL((h[0] + rng.range(-0.03, 0.03) + 1) % 1, h[1], h[2]);
    (u.uColA!.value as THREE.Color).copy(color(hues[0]!));
    (u.uColB!.value as THREE.Color).copy(color(hues[1]!));
    (u.uColC!.value as THREE.Color).copy(color(hues[2]!));
    // Unos cielos con mucha nebulosa y otros casi limpios.
    u.uAmount!.value = rng.range(0.55, 1.35);
    (u.uShift!.value as THREE.Vector3).set(rng.range(-50, 50), rng.range(-50, 50), rng.range(-50, 50));
    this.buildStars(rng);
    this.buildGalaxies(rng);
  }

  /** Orienta la galaxia en el cielo según dónde está el sistema: el centro, más brillante cuanto más cerca. */
  setGalaxyPosition(p: WorldPosition): void {
    const dir = new THREE.Vector3(GALAXY.center.x - p.x, GALAXY.center.y - p.y, GALAXY.center.z - p.z);
    const dist = dir.length();
    if (dist < 1) dir.set(1, 0, 0);
    (this.skyMat.uniforms.uCenterDir!.value as THREE.Vector3).copy(dir.normalize());
    this.skyMat.uniforms.uCenterGlow!.value = THREE.MathUtils.clamp(1.6 - dist / GALAXY.radius, 0.3, 1.6);
  }

  private buildStars(rng: Rng): void {
    if (this.stars) {
      this.object.remove(this.stars);
      this.stars.geometry.dispose();
      (this.stars.material as THREE.Material).dispose();
    }
    const radius = this.radius;
    const count = 6000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Dirección uniforme sobre la esfera, con más estrellas cerca del plano galáctico.
      let y = rng.range(-1, 1);
      if (rng.chance(0.45)) y *= 0.18;
      const t = rng.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - y * y);
      pos[i * 3] = s * Math.cos(t) * radius;
      pos[i * 3 + 1] = y * radius;
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
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }));
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    this.stars = stars;
    this.object.add(stars);
  }

  /** Galaxias lejanas: espirales y elípticas, pequeñas casi todas y alguna grande, lejos de la banda. */
  private buildGalaxies(rng: Rng): void {
    for (const s of [...this.galaxies.children] as THREE.Sprite[]) {
      this.galaxies.remove(s);
      s.material.dispose();
    }
    const count = rng.int(5, 11);
    const dir = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // Fuera del plano galáctico (el polvo de la banda las taparía).
      do dir.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
      while (dir.lengthSq() > 1 || dir.lengthSq() < 0.05 || Math.abs(dir.clone().normalize().y) < 0.22);
      dir.normalize();
      const spiral = rng.chance(0.7);
      const big = i === 0 && rng.chance(0.6);
      // Tamaño aparente en radianes: la mayoría, menos de un grado; alguna, de varios.
      const angle = big ? rng.range(0.07, 0.13) : rng.range(0.008, 0.03);
      const mat = new THREE.SpriteMaterial({
        map: galaxyTexture(spiral ? (rng.chance(0.5) ? "spiral2" : "spiral3") : "elliptical"),
        color: new THREE.Color().setHSL(rng.pick([0.08, 0.1, 0.58, 0.62, 0.95]), rng.range(0.15, 0.45), big ? 0.75 : 0.65),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: big ? 0.75 : rng.range(0.45, 0.8),
        rotation: rng.range(0, Math.PI * 2),
      });
      const sprite = new THREE.Sprite(mat);
      const size = this.radius * angle;
      // Inclinación: de cara (redonda) a de canto (alargada).
      sprite.scale.set(size, size * rng.range(0.25, 1), 1);
      sprite.position.copy(dir).multiplyScalar(this.radius * 0.98);
      sprite.frustumCulled = false;
      sprite.renderOrder = -9;
      this.galaxies.add(sprite);
    }
  }

  follow(camera: THREE.Camera): void {
    this.object.position.copy(camera.position);
  }
}

const galaxyTextures = new Map<string, THREE.Texture>();

/** Textura de una galaxia (se hace una vez por tipo y se tiñe con el color del sprite). */
function galaxyTexture(kind: "spiral2" | "spiral3" | "elliptical"): THREE.Texture {
  const cached = galaxyTextures.get(kind);
  if (cached) return cached;
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const g = canvas.getContext("2d")!;
  const c = S / 2;
  const rng = new Rng(kind.length * 7919);
  g.globalCompositeOperation = "lighter";
  if (kind === "elliptical") {
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, "rgba(255,240,220,0.95)");
    grad.addColorStop(0.15, "rgba(255,225,190,0.55)");
    grad.addColorStop(0.5, "rgba(220,190,160,0.15)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  } else {
    const arms = kind === "spiral2" ? 2 : 3;
    // Brazos: espirales logarítmicas hechas de muchas manchas suaves.
    for (let a = 0; a < arms; a++) {
      const off = (a / arms) * Math.PI * 2;
      for (let k = 0; k < 900; k++) {
        const th = rng.range(0, 3.2 * Math.PI);
        const r = 6 * Math.exp(0.28 * th) + rng.range(-5, 5);
        if (r > c * 0.95) continue;
        const ang = th + off + rng.range(-0.25, 0.25);
        const x = c + Math.cos(ang) * r;
        const y = c + Math.sin(ang) * r;
        const fade = 1 - r / c;
        const blue = rng.chance(0.3);
        g.fillStyle = blue ? `rgba(170,200,255,${0.18 * fade})` : `rgba(230,220,255,${0.12 * fade})`;
        g.beginPath();
        g.arc(x, y, rng.range(1.5, 4.5), 0, Math.PI * 2);
        g.fill();
      }
    }
    const grad = g.createRadialGradient(c, c, 0, c, c, c * 0.35);
    grad.addColorStop(0, "rgba(255,240,215,1)");
    grad.addColorStop(0.4, "rgba(255,220,180,0.4)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  galaxyTextures.set(kind, tex);
  return tex;
}
