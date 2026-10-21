import * as THREE from "three";
import { translate, type Emperor, type EmperorView, type Fleet } from "@imperium/shared";
import { positionAt } from "@imperium/sim";
import { serverNow, worldStore } from "../net/world";
import { authStore } from "../state/auth";
import { gameStore } from "../state/store";
import type { SectorManager } from "./SectorManager";
import { labelTexture, ringTexture } from "./textures";

const OWN_COLOR = "#c792ff";
const OTHER_COLOR = "#ff9f5a";
const FLEET_COLOR = "#5fd3e6";
/** Altura del rótulo en pantalla (fracción de la altura de la vista). */
const LABEL_HEIGHT = 0.03;
/** Distancia en pantalla (coordenadas normalizadas) a la que dos rótulos se consideran solapados. */
const LABEL_NEAR_X = 0.25;
const LABEL_NEAR_Y = 0.06;

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

  /**
   * Qué dibujar: los Emperadores del mundo compartido (o, sin conexión, solo el
   * propio) y las flotas propias.
   */
  private list(): Array<{ e: Pick<Emperor, "id" | "location" | "travel">; name: string; color: string; size: number; online: boolean }> {
    const { emperors, myEmperorId, fleets } = worldStore.getState();
    const all = Object.values(emperors) as EmperorView[];
    const own = authStore.getState().emperor;
    const shown: Array<{ e: Emperor; online: boolean }> = all.length > 0 ? all.map((e) => ({ e, online: e.online })) : own ? [{ e: own, online: true }] : [];
    const locale = gameStore.getState().locale;
    return [
      ...shown.map(({ e, online }) => {
        const mine = e.id === (myEmperorId ?? own?.id);
        // Los Emperadores de la IA (Fase 11) llevan la marca «IA» en el rótulo.
        const name = e.name;
        return { e, name, color: mine ? OWN_COLOR : OTHER_COLOR, size: mine ? 0.075 : 0.06, online };
      }),
      ...(Object.values(fleets) as Fleet[]).map((f) => ({
        e: f,
        name: translate(locale, "fleet.name", { n: f.number }),
        color: FLEET_COLOR,
        size: 0.045,
        online: true,
      })),
    ];
  }

  update(camera: THREE.Camera): void {
    const now = serverNow();
    const seen = new Set<string>();
    // Rótulos cercanos en pantalla se apilan en vez de solaparse.
    const placed: THREE.Vector3[] = [];
    const ndc = new THREE.Vector3();
    for (const item of this.list()) {
      const { e } = item;
      seen.add(e.id);
      const m = this.marker(item);
      const pos = this.sectors.toScene(positionAt(e, now));
      ndc.copy(pos).project(camera);
      let level = 0;
      for (const p of placed) if (Math.abs(p.x - ndc.x) < LABEL_NEAR_X && Math.abs(p.y - ndc.y) < LABEL_NEAR_Y) level++;
      placed.push(ndc.clone());
      m.label.center.set(0.5, -1.1 - level * 1.15);
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

  private marker({ e, name, color, size, online }: { e: { id: string }; name: string; color: string; size: number; online: boolean }): Marker {
    const key = `${name}|${color}|${online}`;
    const existing = this.markers.get(e.id);
    if (existing && existing.key === key) return existing;
    if (existing) this.removeMarker(e.id, existing);

    // Los desconectados se ven más tenues.
    const opacity = online ? 1 : 0.45;
    const ring = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color, depthTest: false, sizeAttenuation: false, transparent: true, opacity }),
    );
    ring.scale.setScalar(size);
    ring.renderOrder = 11;

    const { texture, aspect } = labelTexture(name, color);
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
