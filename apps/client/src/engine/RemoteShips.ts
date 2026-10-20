import * as THREE from "three";
import { serverNow } from "../net/world";
import { spaceStore, type PoseSample } from "../net/space";
import { createFlagship, disposeShip } from "./shipModel";
import { labelTexture } from "./textures";

const ALLY_COLOR = "#5fd3e6";
const OTHER_COLOR = "#ff9f5a";
/** Se dibuja ligeramente en el pasado para tener siempre dos muestras entre las que interpolar. */
const INTERP_DELAY_MS = 150;
const LABEL_HEIGHT = 0.028;

interface Visual {
  ship: THREE.Group;
  label: THREE.Sprite;
  key: string;
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/** Posición y orientación interpoladas a la hora `t` (o la última conocida si no hay más). */
function sampleAt(samples: PoseSample[], t: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): boolean {
  if (samples.length === 0) return false;
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1]!.t > t) i--;
  const b = samples[i]!;
  const a = samples[i - 1];
  if (!a || b.t <= a.t || t >= b.t) {
    outPos.set(...b.p);
    outQuat.set(...b.q);
    return true;
  }
  const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  outPos.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
  qa.set(...a.q);
  qb.set(...b.q);
  outQuat.copy(qa).slerp(qb, k);
  return true;
}

/** Las naves de los demás jugadores que vuelan en el mismo sistema. */
export class RemoteShips {
  readonly group = new THREE.Group();
  private visuals = new Map<string, Visual>();

  update(): void {
    const { ships } = spaceStore.getState();
    const t = serverNow() - INTERP_DELAY_MS;
    for (const [id, remote] of Object.entries(ships)) {
      const key = `${remote.state.name}|${remote.state.ally}`;
      let v = this.visuals.get(id);
      if (v && v.key !== key) {
        this.remove(id, v);
        v = undefined;
      }
      if (!v) v = this.add(id, remote.state.name, remote.state.ally, key);
      if (sampleAt(remote.samples, t, v.ship.position, v.ship.quaternion)) {
        v.label.position.copy(v.ship.position);
      }
    }
    for (const [id, v] of this.visuals) if (!ships[id]) this.remove(id, v);
  }

  private add(id: string, name: string, ally: boolean, key: string): Visual {
    const color = ally ? ALLY_COLOR : OTHER_COLOR;
    const ship = createFlagship(color);
    const { texture, aspect } = labelTexture(name, color);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false, transparent: true }));
    label.scale.set(LABEL_HEIGHT * aspect, LABEL_HEIGHT, 1);
    label.center.set(0.5, -1.4);
    label.renderOrder = 12;
    this.group.add(ship, label);
    const v = { ship, label, key };
    this.visuals.set(id, v);
    return v;
  }

  private remove(id: string, v: Visual): void {
    this.group.remove(v.ship, v.label);
    disposeShip(v.ship);
    v.label.material.map?.dispose();
    v.label.material.dispose();
    this.visuals.delete(id);
  }

  clear(): void {
    for (const [id, v] of this.visuals) this.remove(id, v);
  }
}
