import * as THREE from "three";
import { serverNow } from "../net/world";
import { shipName, spaceStore, type PoseSample } from "../net/space";
import { gameStore } from "../state/store";
import type { WeaponKind } from "@imperium/shared";
import { FLAGSHIP_HIT_RADIUS_M, getAlienShipClass, SHIP_COLLISION } from "@imperium/content";
import { createFlagship, disposeShip, SHIP_SCALE, shipRig } from "./shipModel";
import { createShipModel } from "./shipFactory";
import { labelTexture } from "./textures";

const ALLY_COLOR = "#5fd3e6";
/** Otros Emperadores (neutrales: se les puede atacar, hay PvP). Ámbar, distinto del rojo de los hostiles. */
const OTHER_COLOR = "#f2c14e";
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

  /**
   * Se queda con el modelo de una nave que se va (entra en su grieta): deja de
   * seguir sus posiciones y quita su rótulo; hay que soltarlo con `discard`.
   */
  detach(id: string): THREE.Group | null {
    const v = this.visuals.get(id);
    if (!v) return null;
    this.visuals.delete(id);
    this.group.remove(v.label);
    v.label.material.map?.dispose();
    v.label.material.dispose();
    return v.ship;
  }

  /** Suelta un modelo de `detach`. */
  discard(ship: THREE.Group): void {
    this.group.remove(ship);
    disposeShip(ship);
  }

  /** Dónde está ahora la boca de un arma de una nave ajena, o null si no se dibuja. */
  muzzleOf(id: string, weapon: WeaponKind, index: number): THREE.Vector3 | null {
    const v = this.visuals.get(id);
    return v ? shipRig(v.ship).muzzle(weapon, index, new THREE.Vector3()) : null;
  }

  /** El modelo de una nave ajena, si se dibuja. */
  shipOf(id: string): THREE.Group | null {
    return this.visuals.get(id)?.ship ?? null;
  }

  /** Dónde se dibuja ahora una nave ajena, o null si no está. */
  positionOf(id: string): THREE.Vector3 | null {
    return this.visuals.get(id)?.ship.position ?? null;
  }

  /**
   * Velocidad de una nave ajena (m/s): la de su última muestra, o la que se ve
   * entre fotogramas si la muestra no la trae.
   */
  velocityOf(id: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const samples = spaceStore.getState().ships[id]?.samples;
    const last = samples?.[samples.length - 1];
    if (last?.v) return out.set(last.v[0], last.v[1], last.v[2]);
    const prev = samples?.[samples.length - 2];
    if (last && prev && last.t > prev.t) {
      const k = 1000 / (last.t - prev.t);
      return out.set((last.p[0] - prev.p[0]) * k, (last.p[1] - prev.p[1]) * k, (last.p[2] - prev.p[2]) * k);
    }
    return this.visuals.has(id) ? out.set(0, 0, 0) : null;
  }

  /**
   * Choques de la nave propia contra las demás (el daño lo pone el servidor):
   * si se tocan (suma de los radios de impacto, como en el servidor), la nave
   * propia se aparta y rebota (`SHIP_COLLISION.restitution`).
   */
  collide(pos: THREE.Vector3, vel: THREE.Vector3, radius: number): void {
    const { ships } = spaceStore.getState();
    for (const [id, v] of this.visuals) {
      const s = ships[id]?.state;
      if (!s) continue;
      const cls = s.classId ? getAlienShipClass(s.classId) : undefined;
      // Mismo radio que el servidor: la insignia, o según la eslora (mínimo 30 m).
      const other = cls ? Math.max(30, cls.model.lengthM * 0.45) : FLAGSHIP_HIT_RADIUS_M;
      const reach = radius + other;
      const n = pos.clone().sub(v.ship.position);
      const d = n.length();
      if (d >= reach || d < 1e-3) continue;
      n.divideScalar(d);
      pos.copy(v.ship.position).addScaledVector(n, reach);
      const otherV = this.velocityOf(id) ?? new THREE.Vector3();
      const closing = vel.clone().sub(otherV).dot(n);
      if (closing < 0) vel.addScaledVector(n, -closing * (1 + SHIP_COLLISION.restitution));
    }
  }

  /** Retraso con que se dibujan las naves ajenas (s): para adelantar su posición al apuntar. */
  static readonly DRAW_DELAY_SEC = INTERP_DELAY_MS / 1000;

  clear(): void {
    for (const [id, v] of this.visuals) this.remove(id, v);
  }
}
