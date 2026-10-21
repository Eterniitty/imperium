import * as THREE from "three";
import { serverNow } from "../net/world";
import { shipName, spaceStore, type PoseSample } from "../net/space";
import { gameStore } from "../state/store";
import type { WeaponKind } from "@imperium/shared";
import { createFlagship, disposeShip, SHIP_SCALE, shipRig } from "./shipModel";
import { createShipModel } from "./shipFactory";
import { labelTexture } from "./textures";

const ALLY_COLOR = "#5fd3e6";
const OTHER_COLOR = "#ff9f5a";
const PIRATE_COLOR = "#ff5a5a";
/** Se dibuja ligeramente en el pasado para tener siempre dos muestras entre las que interpolar. */
const INTERP_DELAY_MS = 150;
const LABEL_HEIGHT = 0.028;

interface Visual {
  ship: THREE.Group;
  label: THREE.Sprite;
  key: string;
  /** Posición del fotograma anterior, para estimar la velocidad (empuje y balanceo). */
  prev: THREE.Vector3;
  speed: number;
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
    // Más allá de la última muestra se sigue con su velocidad un rato (las aparcadas envían una por segundo).
    const ahead = Math.min(1.5, Math.max(0, (t - b.t) / 1000));
    if (b.v && ahead > 0) outPos.set(b.p[0] + b.v[0] * ahead, b.p[1] + b.v[1] * ahead, b.p[2] + b.v[2] * ahead);
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

  update(dt = 0, time = 0): void {
    const { ships } = spaceStore.getState();
    const locale = gameStore.getState().locale;
    const t = serverNow() - INTERP_DELAY_MS;
    for (const [id, remote] of Object.entries(ships)) {
      const name = shipName(remote.state, locale);
      const key = `${name}|${remote.state.ally}|${remote.state.kind}|${remote.state.classId ?? ""}`;
      let v = this.visuals.get(id);
      if (v && v.key !== key) {
        this.remove(id, v);
        v = undefined;
      }
      if (!v) v = this.add(id, name, remote.state.kind === "pirate" ? PIRATE_COLOR : remote.state.ally ? ALLY_COLOR : OTHER_COLOR, remote.state.classId, key);
      if (sampleAt(remote.samples, t, v.ship.position, v.ship.quaternion)) {
        v.label.position.copy(v.ship.position);
      }
      if (dt > 0) {
        if (!Number.isFinite(v.prev.x)) v.prev.copy(v.ship.position);
        v.speed += (v.ship.position.distanceTo(v.prev) / dt - v.speed) * Math.min(1, dt * 3);
        v.prev.copy(v.ship.position);
        const rig = shipRig(v.ship);
        rig.setThrust(Math.min(1, v.speed / 1000), v.speed > 2000);
        rig.tick(time, dt, Math.max(0, 1 - v.speed / 60));
      }
    }
    for (const [id, v] of this.visuals) if (!ships[id]) this.remove(id, v);
  }

  private add(id: string, name: string, color: string, classId: string | undefined, key: string): Visual {
    // Naves de la IA con clase (piratas Carroñeros…): su modelo procedural a escala real; las de los Emperadores, la insignia.
    const model = classId ? createShipModel(classId) : null;
    const ship = model ?? createFlagship(color);
    if (!model) ship.scale.setScalar(SHIP_SCALE);
    const { texture, aspect } = labelTexture(name, color);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false, transparent: true }));
    label.scale.set(LABEL_HEIGHT * aspect, LABEL_HEIGHT, 1);
    label.center.set(0.5, -1.4);
    label.renderOrder = 12;
    this.group.add(ship, label);
    const v = { ship, label, key, prev: new THREE.Vector3(Infinity, 0, 0), speed: 0 };
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

  /** Dónde está ahora la boca de un arma de una nave ajena, o null si no se dibuja. */
  muzzleOf(id: string, weapon: WeaponKind, index: number): THREE.Vector3 | null {
    const v = this.visuals.get(id);
    return v ? shipRig(v.ship).muzzle(weapon, index, new THREE.Vector3()) : null;
  }

  /** Dónde se dibuja ahora una nave ajena, o null si no está. */
  positionOf(id: string): THREE.Vector3 | null {
    return this.visuals.get(id)?.ship.position ?? null;
  }

  clear(): void {
    for (const [id, v] of this.visuals) this.remove(id, v);
  }
}
