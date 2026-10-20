import * as THREE from "three";
import { generateSector, STAR_CLASSES } from "@imperium/procgen";
import {
  SECTOR_SIZE,
  sectorKey,
  sectorOrigin,
  type SectorCoord,
  type SectorData,
  type StarSystemSummary,
  type WorldPosition,
} from "@imperium/shared";
import { LOAD_RADIUS, SECTORS_PER_FRAME, UNIVERSE_SEED } from "../config";
import { createStarMaterial } from "./starMaterial";

interface LoadedSector {
  data: SectorData;
  points: THREE.Points;
  /** Posiciones locales al sector (las mismas que la geometría). */
  local: Float32Array;
}

export interface PickResult {
  system: StarSystemSummary;
  /** Posición en coordenadas de escena (relativas al origen flotante). */
  scenePosition: THREE.Vector3;
}

/**
 * Carga y descarga sectores alrededor del foco de la cámara.
 * Cada sector es un único objeto Points: miles de estrellas cuestan muy pocas
 * llamadas de dibujo, lo que mantiene el rendimiento en equipos modestos.
 */
export class SectorManager {
  readonly group = new THREE.Group();
  readonly material = createStarMaterial();
  private loaded = new Map<string, LoadedSector>();
  private origin: WorldPosition = { x: 0, y: 0, z: 0 };

  constructor() {
    this.material.uniforms.uFadeRadius!.value = (LOAD_RADIUS + 0.5) * SECTOR_SIZE;
  }

  get sectorCount(): number {
    return this.loaded.size;
  }

  get systemCount(): number {
    let n = 0;
    for (const s of this.loaded.values()) n += s.data.systems.length;
    return n;
  }

  /** Cambia el origen flotante: recoloca todos los sectores cargados. */
  setOrigin(origin: WorldPosition): void {
    this.origin = { ...origin };
    for (const s of this.loaded.values()) this.placeSector(s);
  }

  private placeSector(s: LoadedSector): void {
    const o = sectorOrigin(s.data.coord);
    s.points.position.set(o.x - this.origin.x, o.y - this.origin.y, o.z - this.origin.z);
    s.points.updateMatrixWorld();
  }

  /**
   * Carga los sectores dentro del radio (los más cercanos primero, con un
   * límite por fotograma) y descarga los que quedan lejos.
   */
  update(focus: SectorCoord): void {
    const r = LOAD_RADIUS;
    const wanted: Array<{ c: SectorCoord; d: number }> = [];
    for (let x = -r; x <= r; x++) {
      for (let y = -r; y <= r; y++) {
        for (let z = -r; z <= r; z++) {
          const d = x * x + y * y + z * z;
          if (d > r * r + 1) continue; // forma aproximadamente esférica
          const c = { x: focus.x + x, y: focus.y + y, z: focus.z + z };
          if (!this.loaded.has(sectorKey(c))) wanted.push({ c, d });
        }
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const { c } of wanted.slice(0, SECTORS_PER_FRAME)) this.load(c);

    for (const [key, s] of this.loaded) {
      const c = s.data.coord;
      const far = Math.max(Math.abs(c.x - focus.x), Math.abs(c.y - focus.y), Math.abs(c.z - focus.z));
      if (far > r + 1) {
        this.group.remove(s.points);
        s.points.geometry.dispose();
        this.loaded.delete(key);
      }
    }
  }

  clear(): void {
    for (const s of this.loaded.values()) {
      this.group.remove(s.points);
      s.points.geometry.dispose();
    }
    this.loaded.clear();
  }

  private load(c: SectorCoord): void {
    const data = generateSector(UNIVERSE_SEED, c);
    const o = sectorOrigin(c);
    const n = data.systems.length;
    const local = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const tmp = new THREE.Color();
    data.systems.forEach((s, i) => {
      local[i * 3] = s.position.x - o.x;
      local[i * 3 + 1] = s.position.y - o.y;
      local[i * 3 + 2] = s.position.z - o.z;
      const info = STAR_CLASSES[s.starClass];
      tmp.setHex(info.color);
      color[i * 3] = tmp.r;
      color[i * 3 + 1] = tmp.g;
      color[i * 3 + 2] = tmp.b;
      size[i] = info.mapSize * 1.6;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(local, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(color, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(SECTOR_SIZE / 2, SECTOR_SIZE / 2, SECTOR_SIZE / 2),
      SECTOR_SIZE * 0.9,
    );
    const points = new THREE.Points(geo, this.material);
    const entry: LoadedSector = { data, points, local };
    this.placeSector(entry);
    this.group.add(points);
    this.loaded.set(sectorKey(c), entry);
  }

  /** Posición de escena de un sistema cargado o no (a partir de su posición absoluta). */
  toScene(p: WorldPosition, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z);
  }

  /**
   * Selección en pantalla: busca la estrella visible más cercana al puntero,
   * dentro de un radio en píxeles. Más fiable que un rayo contra puntos diminutos.
   */
  pick(camera: THREE.Camera, ndcX: number, ndcY: number, width: number, height: number, radiusPx = 14): PickResult | null {
    const v = new THREE.Vector3();
    let best: PickResult | null = null;
    let bestScore = Infinity;
    const r2 = radiusPx * radiusPx;
    for (const s of this.loaded.values()) {
      const base = s.points.position;
      for (let i = 0; i < s.data.systems.length; i++) {
        v.set(s.local[i * 3]! + base.x, s.local[i * 3 + 1]! + base.y, s.local[i * 3 + 2]! + base.z);
        const depth = v.distanceToSquared(camera.position);
        v.project(camera);
        if (v.z < -1 || v.z > 1) continue; // detrás de la cámara o fuera del rango
        const dx = ((v.x - ndcX) * width) / 2;
        const dy = ((v.y - ndcY) * height) / 2;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        // Prioriza la cercanía en pantalla y, a igualdad, la estrella más próxima.
        const score = d2 + depth * 1e-6;
        if (score < bestScore) {
          bestScore = score;
          const sys = s.data.systems[i]!;
          best = { system: sys, scenePosition: this.toScene(sys.position) };
        }
      }
    }
    return best;
  }
}
