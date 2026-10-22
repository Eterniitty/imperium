import * as THREE from "three";
import { GALAXY, type WorldPosition } from "@imperium/shared";
import { galaxyDensityAt, Rng } from "@imperium/procgen";
import { labelTexture } from "./textures";

/** Puntos con que se dibuja la galaxia entera vista de lejos (no son estrellas reales: dan la forma). */
const POINTS = 30_000;

/**
 * La galaxia vista de lejos en el mapa: una nube de puntos con la misma forma
 * que el generador (`galaxyDensityAt`: disco, brazos y bulbo) y el resplandor
 * del agujero negro del centro. Se enciende al alejar la cámara, donde los
 * sectores cargados ya no alcanzan.
 */
export class GalaxyCloud {
  readonly object = new THREE.Group();
  private readonly material: THREE.PointsMaterial;
  private readonly glow: THREE.Sprite;
  private readonly label: THREE.Sprite;

  constructor() {
    const rng = new Rng(0x6a1a);
    const pos = new Float32Array(POINTS * 3);
    const col = new Float32Array(POINTS * 3);
    const c = new THREE.Color();
    const R = GALAXY.radius;
    let n = 0;
    for (let tries = 0; n < POINTS && tries < POINTS * 40; tries++) {
      const x = rng.range(-R, R);
      const z = rng.range(-R, R);
      const y = rng.bell() * GALAXY.scaleHeight * 1.6;
      const d = galaxyDensityAt(GALAXY.center.x + x, GALAXY.center.y + y, GALAXY.center.z + z);
      if (rng.next() > d * d) continue;
      pos[n * 3] = x;
      pos[n * 3 + 1] = y;
      pos[n * 3 + 2] = z;
      // Bulbo dorado y viejo; brazos blanco-azulados, con algún punto rosado (nebulosas de los brazos).
      const r = Math.hypot(x, z) / R;
      if (r < 0.13) c.setHSL(0.1, 0.55, 0.62);
      else if (rng.chance(0.06)) c.setHSL(0.95, 0.55, 0.6);
      else c.setHSL(0.6 - r * 0.05, 0.35 + r * 0.25, 0.45 + rng.range(0, 0.2));
      col[n * 3] = c.r;
      col[n * 3 + 1] = c.g;
      col[n * 3 + 2] = c.b;
      n++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, n * 3), 3));
    this.material = new THREE.PointsMaterial({
      size: 1.5,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    const points = new THREE.Points(geo, this.material);
    points.frustumCulled = false;

    // Resplandor del centro (el agujero negro no se ve: se ve el bulbo que lo rodea).
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const g = canvas.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,230,180,0.9)");
    grad.addColorStop(0.3, "rgba(255,200,140,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.glow.scale.setScalar(GALAXY.bulgeRadius * 3);
    // Rótulo del centro: Ónfalo, el objetivo final.
    const { texture, aspect } = labelTexture(`◉ ${GALAXY.centerName}`, "#ffd27a");
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false, transparent: true }));
    label.scale.set(0.03 * aspect, 0.03, 1);
    label.center.set(0.5, -0.6);
    this.label = label;
    this.object.add(points, this.glow, label);
    this.object.visible = false;
  }

  /** Coloca la galaxia respecto al origen flotante y la enciende según lo lejos que esté la cámara de su foco. */
  update(origin: WorldPosition, cameraDistance: number): void {
    const a = THREE.MathUtils.smoothstep(cameraDistance, 400, 2500);
    this.object.visible = a > 0.01;
    if (!this.object.visible) return;
    this.object.position.set(GALAXY.center.x - origin.x, GALAXY.center.y - origin.y, GALAXY.center.z - origin.z);
    // Mezcla aditiva de 30 000 puntos: con poca opacidad, para que el bulbo no se queme y se vean los brazos.
    this.material.opacity = a * 0.3;
    (this.glow.material as THREE.SpriteMaterial).opacity = a * 0.55;
    (this.label.material as THREE.SpriteMaterial).opacity = a;
  }
}
