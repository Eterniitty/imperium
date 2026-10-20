import * as THREE from "three";
import type { Emperor, EmperorView } from "@imperium/shared";
import { positionAt } from "@imperium/sim";
import { serverNow, worldStore } from "../net/world";
import { authStore } from "../state/auth";
import type { SectorManager } from "./SectorManager";
import { labelTexture, ringTexture } from "./textures";

const OWN_COLOR = "#c792ff";
const OTHER_COLOR = "#ff9f5a";
/** Altura del rótulo en pantalla (fracción de la altura de la vista). */
const LABEL_HEIGHT = 0.03;

interface Marker {
  ring: THREE.Sprite;
  label: THREE.Sprite;
  route: THREE.Line;
  /** Lo que se dibujó en el rótulo, para regenerarlo solo si cambia. */
  key: string;
}

/**
 * Marcadores de los Emperadores en el mapa: anillo, nombre y, si viajan, la
 * línea hasta el destino. La posición se calcula en cada fotograma a partir del
 * viaje (origen, destino y horas), así que el movimiento es fluido sin que el
 * servidor envíe posiciones.
 */
export class EmperorMarkers {
  readonly group = new THREE.Group();
  private markers = new Map<string, Marker>();

  constructor(private sectors: SectorManager) {}

  /** Emperadores a dibujar: los del mundo compartido o, sin conexión, solo el propio. */
  private list(): Array<{ e: Emperor; online: boolean; own: boolean }> {
    const { emperors, myEmperorId } = worldStore.getState();
    const all = Object.values(emperors) as EmperorView[];
    if (all.length > 0) return all.map((e) => ({ e, online: e.online, own: e.id === myEmperorId }));
    const own = authStore.getState().emperor;
    return own ? [{ e: own, online: true, own: true }] : [];
  }

  update(): void {
    const now = serverNow();
    const seen = new Set<string>();
    // Varios Emperadores en el mismo punto: los rótulos se apilan en vez de solaparse.
    const stacks = new Map<string, number>();
    for (const { e, online, own } of this.list()) {
      seen.add(e.id);
      const m = this.marker(e, own, online);
      const world = positionAt(e, now);
      const spot = `${world.x.toFixed(2)}:${world.y.toFixed(2)}:${world.z.toFixed(2)}`;
      const level = stacks.get(spot) ?? 0;
      stacks.set(spot, level + 1);
      m.label.center.set(0.5, -1.1 - level * 1.15);
      const pos = this.sectors.toScene(world);
      m.ring.position.copy(pos);
      m.label.position.copy(pos);
      const travelling = e.travel !== null && e.travel.arriveAt > now;
      m.route.visible = travelling;
      if (travelling) {
        const attr = m.route.geometry.attributes.position as THREE.BufferAttribute;
        const to = this.sectors.toScene(e.travel!.to.position);
        attr.setXYZ(0, pos.x, pos.y, pos.z);
        attr.setXYZ(1, to.x, to.y, to.z);
        attr.needsUpdate = true;
        m.route.computeLineDistances();
      }
    }
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) this.removeMarker(id, m);
    }
  }

  private marker(e: Emperor, own: boolean, online: boolean): Marker {
    const key = `${e.name}|${own}|${online}`;
    const existing = this.markers.get(e.id);
    if (existing && existing.key === key) return existing;
    if (existing) this.removeMarker(e.id, existing);

    const color = own ? OWN_COLOR : OTHER_COLOR;
    // Los desconectados se ven más tenues.
    const opacity = online ? 1 : 0.45;
    const ring = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color, depthTest: false, sizeAttenuation: false, transparent: true, opacity }),
    );
    ring.scale.setScalar(own ? 0.075 : 0.06);
    ring.renderOrder = 11;

    const { texture, aspect } = labelTexture(e.name, color);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false, transparent: true, opacity }));
    label.scale.set(LABEL_HEIGHT * aspect, LABEL_HEIGHT, 1);
    label.renderOrder = 12;

    const route = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color, dashSize: 1.5, gapSize: 1, transparent: true, opacity: 0.7 * opacity, depthTest: false }),
    );
    route.frustumCulled = false;
    route.visible = false;

    const m: Marker = { ring, label, route, key };
    this.group.add(ring, label, route);
    this.markers.set(e.id, m);
    return m;
  }

  private removeMarker(id: string, m: Marker): void {
    this.group.remove(m.ring, m.label, m.route);
    m.ring.material.dispose();
    m.label.material.map?.dispose();
    m.label.material.dispose();
    m.route.geometry.dispose();
    (m.route.material as THREE.Material).dispose();
    this.markers.delete(id);
  }

  dispose(): void {
    for (const [id, m] of this.markers) this.removeMarker(id, m);
  }
}
