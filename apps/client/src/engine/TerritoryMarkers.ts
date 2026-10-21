import * as THREE from "three";
import { getSpecies } from "@imperium/content";
import { findSystemSummary } from "../state/store";
import { aliensStore } from "../state/aliens";
import type { SectorManager } from "./SectorManager";
import { glowTexture } from "./textures";

/** Radio aparente del halo de un sistema de territorio, en años luz. */
const ZONE_SIZE = 22;
const RELIC_SIZE = 7;
const RELIC_COLOR = "#f5e6a8";

/**
 * Territorios alienígenas en el mapa (Fase 11): un halo suave del color de la
 * especie alrededor de cada sistema descubierto que es suyo. Los halos se
 * funden en zonas, discretas, y solo se ve lo descubierto (el servidor no
 * cuenta más: niebla de guerra). Las ruinas precursoras, un punto dorado.
 *
 * Las posiciones se guardan relativas a un ancla (el primer sistema) para no
 * perder precisión con coordenadas grandes; el grupo se recoloca con el origen
 * flotante del mapa.
 */
export class TerritoryMarkers {
  readonly group = new THREE.Group();
  private zones: THREE.Points | null = null;
  private relics: THREE.Points | null = null;
  private anchor = { x: 0, y: 0, z: 0 };
  private version = -1;

  constructor(private sectors: SectorManager) {
    this.group.renderOrder = 1;
  }

  private build(): void {
    const { territory, relics, version } = aliensStore.getState();
    this.version = version;
    this.clear();
    const zoneIds = Object.keys(territory);
    const relicIds = Object.keys(relics);
    const first = zoneIds[0] ?? relicIds[0];
    const firstSystem = first ? findSystemSummary(first) : null;
    if (!firstSystem) return;
    this.anchor = { ...firstSystem.position };
    const color = new THREE.Color();
    const points = (ids: string[], colorOf: (id: string) => string, size: number, opacity: number) => {
      const pos: number[] = [];
      const col: number[] = [];
      for (const id of ids) {
        const s = findSystemSummary(id);
        if (!s) continue;
        pos.push(s.position.x - this.anchor.x, s.position.y - this.anchor.y, s.position.z - this.anchor.z);
        color.set(colorOf(id));
        col.push(color.r, color.g, color.b);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({
        size,
        map: glowTexture(),
        vertexColors: true,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const p = new THREE.Points(geo, mat);
      p.frustumCulled = false;
      this.group.add(p);
      return p;
    };
    if (zoneIds.length) this.zones = points(zoneIds, (id) => getSpecies(territory[id]!.speciesId)?.visual.emissiveColor ?? "#ff8a5c", ZONE_SIZE, 0.16);
    if (relicIds.length) this.relics = points(relicIds, () => RELIC_COLOR, RELIC_SIZE, 0.55);
  }

  private clear(): void {
    for (const p of [this.zones, this.relics]) {
      if (!p) continue;
      this.group.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this.zones = this.relics = null;
  }

  update(): void {
    if (aliensStore.getState().version !== this.version) this.build();
    this.sectors.toScene(this.anchor, this.group.position);
  }

  dispose(): void {
    this.clear();
  }
}
