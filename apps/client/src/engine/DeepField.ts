import * as THREE from "three";
import { ASTEROID_KINDS, type AsteroidKind } from "@imperium/content";
import type { DeepRegionView } from "@imperium/shared";
import { glowTexture } from "./textures";

/** Color del láser de minería. */
const BEAM_COLOR = 0x7dffc4;
const KINDS: readonly AsteroidKind[] = ["ice", "metal", "rare", "exotic"];

/** Hash entero sencillo (solo para el aspecto: no afecta al juego). */
function hash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Roca irregular de radio ~1: icosaedro con los vértices desplazados (una variante por semilla). */
function rockGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // Los vértices repetidos (misma posición) se desplazan igual: la roca no se abre.
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = Math.round(v.x * 97) * 73856093 ^ Math.round(v.y * 97) * 19349663 ^ Math.round(v.z * 97) * 83492791;
    const bump = 0.78 + 0.34 * hash(k + seed * 7919);
    v.multiplyScalar(bump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

interface Beam {
  line: THREE.Mesh;
  glow: THREE.Sprite;
}

/**
 * Campo de asteroides de una región de espacio profundo: un `InstancedMesh`
 * por tipo de asteroide (pocas llamadas de dibujo aunque haya decenas), que
 * encogen y se apagan al agotarse; los láseres de minería (propio y ajenos)
 * y la puntería del morro. Todo es visual: lo que queda de cada asteroide y
 * si un pulso de minería vale lo decide el servidor.
 */
export class DeepField {
  readonly group = new THREE.Group();
  private region: DeepRegionView | null = null;
  private meshes = new Map<AsteroidKind, { mesh: THREE.InstancedMesh; indices: number[] }>();
  /** Tipo y posición en su `InstancedMesh` de cada asteroide (por índice). */
  private slots: Array<{ kind: AsteroidKind; slot: number; axis: THREE.Vector3; spin: number; shape: THREE.Vector3 }> = [];
  private shown: number[] = [];
  private time = 0;
  private beams = new Map<string, Beam>();
  private beamMat = new THREE.MeshBasicMaterial({ color: BEAM_COLOR, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private rocks = [rockGeometry(1), rockGeometry(2)];

  /** Luz lejana de las estrellas (en el espacio profundo no hay ninguna cerca); solo mientras se ve una región. */
  readonly light = new THREE.DirectionalLight(0xdfe6ff, 1.6);

  constructor() {
    this.light.position.set(0.4, 0.6, 0.7);
    this.light.visible = false;
    this.group.add(this.light);
  }

  get regionId(): string | null {
    return this.region?.regionId ?? null;
  }

  /** Dibuja (o actualiza) la región: al cambiar de región se rehace; si no, solo lo que queda de cada asteroide. */
  set(region: DeepRegionView | null): void {
    if (region?.regionId !== this.region?.regionId) this.build(region);
    else this.region = region;
    this.applyLeft();
  }

  private build(region: DeepRegionView | null): void {
    this.clearRocks();
    this.region = region;
    if (!region) return;
    const byKind = new Map<AsteroidKind, number[]>();
    for (const a of region.asteroids) {
      const list = byKind.get(a.kind) ?? [];
      list.push(a.i);
      byKind.set(a.kind, list);
    }
    for (const kind of KINDS) {
      const indices = byKind.get(kind);
      if (!indices?.length) continue;
      const def = ASTEROID_KINDS[kind];
      const mat = new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: kind === "ice" ? 0.45 : 0.9,
        metalness: kind === "metal" || kind === "rare" ? 0.55 : 0.05,
        flatShading: true,
        emissive: kind === "exotic" ? new THREE.Color(0x6a2cff) : new THREE.Color(0),
        emissiveIntensity: kind === "exotic" ? 0.6 : 0,
      });
      const mesh = new THREE.InstancedMesh(this.rocks[KINDS.indexOf(kind) % 2]!, mat, indices.length);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(indices.length * 3), 3);
      mesh.frustumCulled = false;
      indices.forEach((i, slot) => {
        const h1 = hash(i * 3 + 1);
        const h2 = hash(i * 3 + 2);
        const h3 = hash(i * 3 + 3);
        this.slots[i] = {
          kind,
          slot,
          axis: new THREE.Vector3(h1 - 0.5, h2 - 0.5, h3 - 0.5).normalize(),
          spin: (h1 - 0.5) * 0.04,
          shape: new THREE.Vector3(0.8 + 0.4 * h2, 0.7 + 0.3 * h3, 0.85 + 0.35 * h1),
        };
      });
      this.meshes.set(kind, { mesh, indices });
      this.group.add(mesh);
    }
    this.shown = region.asteroids.map(() => -1);
  }

  /** Radio con el que se ve un asteroide según lo que le queda (agotado, a algo más de la mitad). */
  private visibleRadius(i: number): number {
    const a = this.region!.asteroids[i]!;
    const left = this.region!.left[i] ?? a.amount;
    return a.r * (0.55 + 0.45 * Math.max(0, Math.min(1, left / a.amount)));
  }

  private applyLeft(): void {
    const region = this.region;
    if (!region) return;
    const color = new THREE.Color();
    for (const a of region.asteroids) {
      const left = region.left[a.i] ?? a.amount;
      const k = Math.round(Math.max(0, Math.min(1, left / a.amount)) * 50);
      if (this.shown[a.i] === k) continue;
      this.shown[a.i] = k;
      const s = this.slots[a.i]!;
      const entry = this.meshes.get(s.kind)!;
      // Agotado se ve apagado y gris.
      color.setRGB(1, 1, 1).lerp(new THREE.Color(0.35, 0.35, 0.38), 1 - k / 50);
      entry.mesh.setColorAt(s.slot, color);
      entry.mesh.instanceColor!.needsUpdate = true;
    }
  }

  /** Giro lento de las rocas. */
  update(dt: number): void {
    const region = this.region;
    if (!region) return;
    this.time += dt;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const a of region.asteroids) {
      const s = this.slots[a.i]!;
      q.setFromAxisAngle(s.axis, s.spin * this.time + a.i);
      sc.copy(s.shape).multiplyScalar(this.visibleRadius(a.i));
      m.compose(p.set(a.p[0], a.p[1], a.p[2]), q, sc);
      this.meshes.get(s.kind)!.mesh.setMatrixAt(s.slot, m);
    }
    for (const { mesh } of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Asteroide al que apunta el morro: el primero que corta el rayo o, si
   * ninguno, el más alineado dentro de un cono estrecho. Distancia a su superficie.
   */
  aim(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): { index: number; distance: number } | null {
    const region = this.region;
    if (!region) return null;
    let best: { index: number; distance: number; score: number } | null = null;
    const to = new THREE.Vector3();
    for (const a of region.asteroids) {
      to.set(a.p[0] - origin.x, a.p[1] - origin.y, a.p[2] - origin.z);
      const d = to.length();
      const surface = Math.max(0, d - a.r);
      if (surface > maxDistance) continue;
      const along = to.dot(dir);
      if (along <= 0 && d > a.r) continue;
      const off = Math.sqrt(Math.max(0, d * d - along * along));
      // Corta el rayo (con un poco de margen) o queda cerca del centro de la mira.
      const hit = off <= a.r * 1.1;
      const angle = Math.atan2(Math.max(0, off - a.r), Math.max(1, along));
      if (!hit && angle > 0.06) continue;
      const score = (hit ? 0 : 1e9) + surface;
      if (!best || score < best.score) best = { index: a.i, distance: surface, score };
    }
    return best ? { index: best.index, distance: best.distance } : null;
  }

  /** Empuja la nave fuera de las rocas (y le quita la velocidad hacia dentro). */
  collide(pos: THREE.Vector3, velocity: THREE.Vector3, margin: number): void {
    const region = this.region;
    if (!region) return;
    const n = new THREE.Vector3();
    for (const a of region.asteroids) {
      const r = this.visibleRadius(a.i) * 0.85 + margin;
      n.set(pos.x - a.p[0], pos.y - a.p[1], pos.z - a.p[2]);
      const d = n.length();
      if (d >= r || d === 0) continue;
      n.divideScalar(d);
      pos.set(a.p[0] + n.x * r, a.p[1] + n.y * r, a.p[2] + n.z * r);
      const inward = velocity.dot(n);
      if (inward < 0) velocity.addScaledVector(n, -inward);
    }
  }

  /**
   * Láseres de minería encendidos: `from` es de dónde sale cada uno (la nave)
   * y `asteroid` a cuál apunta. Los que no estén en la lista se apagan.
   */
  setBeams(list: Array<{ id: string; from: THREE.Vector3; asteroid: number }>): void {
    const region = this.region;
    const alive = new Set<string>();
    if (region) {
      for (const b of list) {
        const a = region.asteroids[b.asteroid];
        if (!a) continue;
        alive.add(b.id);
        let beam = this.beams.get(b.id);
        if (!beam) {
          const line = new THREE.Mesh(this.beamGeo, this.beamMat);
          line.frustumCulled = false;
          const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: BEAM_COLOR, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
          this.group.add(line, glow);
          beam = { line, glow };
          this.beams.set(b.id, beam);
        }
        // Del morro a la superficie del asteroide, en la línea hacia su centro.
        const center = new THREE.Vector3(a.p[0], a.p[1], a.p[2]);
        const dir = center.clone().sub(b.from);
        const len = dir.length();
        const surface = Math.max(1, len - this.visibleRadius(a.i) * 0.9);
        dir.divideScalar(Math.max(1, len));
        const flicker = 0.8 + 0.2 * Math.sin(this.time * 40 + b.asteroid);
        beam.line.position.copy(b.from);
        beam.line.lookAt(center);
        beam.line.scale.set(1.6 * flicker, 1.6 * flicker, surface);
        beam.glow.position.copy(b.from).addScaledVector(dir, surface);
        beam.glow.scale.setScalar(45 + 25 * flicker);
      }
    }
    for (const [id, beam] of this.beams) {
      if (alive.has(id)) continue;
      this.group.remove(beam.line, beam.glow);
      beam.glow.material.dispose();
      this.beams.delete(id);
    }
  }

  private clearRocks(): void {
    for (const { mesh } of this.meshes.values()) {
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.meshes.clear();
    this.slots = [];
    this.shown = [];
    this.region = null;
  }

  clear(): void {
    this.setBeams([]);
    this.clearRocks();
  }

  dispose(): void {
    this.clear();
    this.beamGeo.dispose();
    this.beamMat.dispose();
    for (const g of this.rocks) g.dispose();
  }
}
