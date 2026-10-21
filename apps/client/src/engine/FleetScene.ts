/**
 * Flotas y batallas de flotas en la vista de sistema (solo se dibujan; el
 * servidor manda):
 * - las flotas propias paradas en el sistema, en formación junto a la colonia
 *   propia (o cerca de la órbita de aparcamiento si no hay colonia), con los
 *   modelos procedurales de sus naves;
 * - las batallas por rondas en curso (Fase 9a), en 3D: los dos bandos frente a
 *   frente, con disparos que salen de las bocas de fuego de cada nave y
 *   explosiones cuando un informe de ronda dice que alguien cayó.
 * El combate es el del servidor (rondas cada 30 s de juego); lo de entre
 * rondas es solo una puesta en escena.
 */
import * as THREE from "three";
import { contentDictionaries, getFaction, getShipClass, type ShipClassId } from "@imperium/content";
import type { Battle, Colony, Fleet, Locale, ShipCounts } from "@imperium/shared";
import { translate } from "@imperium/shared";
import { fleetRallyPoint, fleetSlotPosition, type SystemLayout } from "@imperium/sim";
import { serverNow, worldStore } from "../net/world";
import { gameStore } from "../state/store";
import { createShipModel, shipLength } from "./shipFactory";
import type { ShipRig } from "./shipModel";
import { labelTexture } from "./textures";

/** Naves dibujadas como mucho por flota o por bando (el resto se da por representado). */
const MAX_SHIPS = 14;
/** Separación entre los dos bandos de una batalla (m). */
const BATTLE_GAP = 3200;
const OWN_ACCENT = 0x5fd3e6;
const FOE_ACCENT = 0xff7a5a;

interface ShipVisual {
  classId: string;
  obj: THREE.Group;
  rig: ShipRig;
  /** Posición en la formación (relativa al ancla de su grupo). */
  slot: THREE.Vector3;
  alive: boolean;
}

interface Group3D {
  key: string;
  root: THREE.Group;
  label: THREE.Sprite;
  labelKey: string;
  ships: ShipVisual[];
}

interface BattleVisual extends Group3D {
  own: ShipVisual[];
  foe: ShipVisual[];
  round: number;
  nextShot: number;
  /** Naves de cada bando al empezar a dibujarla. */
  initial: [ShipCounts, ShipCounts];
}

interface Tracer {
  line: THREE.Line;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  hit: boolean;
}

/** Lista de clases de un recuento, de la más grande a la más pequeña, con un tope de naves. */
function expand(counts: ShipCounts): string[] {
  const out: string[] = [];
  const entries = Object.entries(counts).sort((a, b) => (shipLength(b[0]) ?? 0) - (shipLength(a[0]) ?? 0));
  // Reparto proporcional hasta el tope, al menos una de cada clase.
  const total = entries.reduce((a, [, n]) => a + n, 0);
  for (const [id, n] of entries) {
    const k = total <= MAX_SHIPS ? n : Math.max(1, Math.round((n / total) * MAX_SHIPS));
    for (let i = 0; i < k && out.length < MAX_SHIPS; i++) out.push(id);
  }
  return out;
}

/**
 * Formación en cuña hacia -Z (las más grandes delante y en el centro): filas
 * cada vez más anchas. Separación según la eslora mayor.
 */
function wedge(classIds: string[]): THREE.Vector3[] {
  const big = Math.max(40, ...classIds.map((id) => shipLength(id) ?? 40));
  const step = big * 2.2;
  const out: THREE.Vector3[] = [];
  let row = 0;
  let i = 0;
  while (i < classIds.length) {
    const inRow = row + 1;
    for (let k = 0; k < inRow && i < classIds.length; k++, i++) {
      out.push(new THREE.Vector3((k - (inRow - 1) / 2) * step, ((k + row) % 2) * step * 0.25, row * step * 0.9));
    }
    row++;
  }
  return out;
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const { texture, aspect } = labelTexture(text, color);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false, transparent: true }));
  s.scale.set(0.026 * aspect, 0.026, 1);
  s.center.set(0.5, -0.6);
  s.renderOrder = 12;
  return s;
}

function disposeLabel(s: THREE.Sprite): void {
  s.material.map?.dispose();
  s.material.dispose();
}

export class FleetScene {
  readonly group = new THREE.Group();
  private fleets = new Map<string, Group3D>();
  private battles = new Map<string, BattleVisual>();
  private tracers: Tracer[] = [];
  private tracerMaterials = {
    own: new THREE.LineBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    foe: new THREE.LineBasicMaterial({ color: 0xff8a5a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  private systemId: string | null = null;
  private layout: SystemLayout | null = null;
  /** Nave que se pilota a distancia: no se dibuja con su flota (la dibuja el piloto). */
  private hidden: { fleetId: string; classId: string } | null = null;

  hide(fleetId: string | null, classId: string | null): void {
    this.hidden = fleetId && classId ? { fleetId, classId } : null;
  }

  /** Dónde se dibuja una flota parada, o null si no está. */
  fleetPosition(fleetId: string): THREE.Vector3 | null {
    const g = this.fleets.get(fleetId);
    return g ? g.root.position.clone() : null;
  }

  constructor(
    /** Explosión en un punto (la de los efectos de combate). */
    private explode: (at: THREE.Vector3) => void,
  ) {}

  /** Sistema que se está viendo (vacía lo de otro sistema). */
  setSystem(systemId: string | null, layout: SystemLayout | null): void {
    if (systemId === this.systemId && layout === this.layout) return;
    this.clear();
    this.systemId = systemId;
    this.layout = layout;
  }

  /**
   * Punto de reunión del sistema: junto a la primera colonia propia (fuera de
   * su planeta) o, si no hay, en la órbita de aparcamiento por defecto.
   */
  anchor(out: THREE.Vector3, now = serverNow()): THREE.Vector3 {
    const layout = this.layout;
    if (!layout) return out.set(0, 0, 0);
    // La colonia propia de menor índice (el servidor usa la misma regla para el acople).
    const own = (Object.values(worldStore.getState().colonies) as Colony[]).filter((c) => c.systemId === this.systemId).map((c) => c.planetIndex);
    return out.set(...fleetRallyPoint(layout, own.length ? Math.min(...own) : null, now));
  }

  /** Nave nodriza de una flota parada aquí (posición en el mundo y eslora), o null. */
  mothership(fleetId: string): { at: THREE.Vector3; lengthM: number; q: THREE.Quaternion } | null {
    const g = this.fleets.get(fleetId);
    const s = g?.ships.find((x) => getShipClass(x.classId as ShipClassId)?.dockFlagship);
    if (!g || !s) return null;
    g.root.updateMatrixWorld();
    return { at: s.obj.getWorldPosition(new THREE.Vector3()), lengthM: shipLength(s.classId) ?? 1000, q: s.obj.getWorldQuaternion(new THREE.Quaternion()) };
  }

  /** Dónde se dibuja una batalla (para llevar la cámara allí), o null si no está. */
  battlePosition(battleId: string): THREE.Vector3 | null {
    const b = this.battles.get(battleId);
    return b ? b.root.position.clone() : null;
  }

  update(dt: number, time: number): void {
    if (!this.systemId || !this.layout) return;
    const { fleets, battles } = worldStore.getState();
    const locale = gameStore.getState().locale;
    const base = this.anchor(new THREE.Vector3());

    // Flotas propias paradas (las que combaten salen en su batalla).
    const parked = (Object.values(fleets) as Fleet[]).filter((f) => !f.travel && !f.battleId && f.location.systemId === this.systemId);
    parked.sort((a, b) => a.number - b.number);
    const seen = new Set<string>();
    parked.forEach((f, i) => {
      seen.add(f.id);
      const counts: ShipCounts = {};
      for (const s of f.ships) counts[s.classId] = (counts[s.classId] ?? 0) + 1;
      const h = this.hidden;
      if (h && h.fleetId === f.id && counts[h.classId]) counts[h.classId]! -= 1;
      const key = JSON.stringify(Object.entries(counts).sort());
      let g = this.fleets.get(f.id);
      if (g && g.key !== key) {
        this.removeGroup(g);
        g = undefined;
      }
      if (!g) {
        g = this.makeGroup(key, expand(counts), OWN_ACCENT);
        this.fleets.set(f.id, g);
      }
      this.setLabel(g, translate(locale, "fleet.name", { n: f.number }), "#5fd3e6");
      // Cada flota, a un lado del punto de reunión, mirando hacia la estrella.
      g.root.position.set(...fleetSlotPosition([base.x, base.y, base.z], i));
      g.root.lookAt(0, g.root.position.y, 0);
      g.root.rotateY(Math.PI);
      for (const s of g.ships) {
        s.rig.setThrust(0.15);
        s.rig.tick(time, dt, 1);
      }
    });
    for (const [id, g] of this.fleets) if (!seen.has(id)) {
      this.removeGroup(g);
      this.fleets.delete(id);
    }

    // Batallas en curso en este sistema.
    const live = (Object.values(battles) as Battle[]).filter((b) => b.systemId === this.systemId && b.outcome === "ongoing");
    const seenB = new Set<string>();
    live.forEach((b, i) => {
      seenB.add(b.id);
      let v = this.battles.get(b.id);
      if (!v) {
        v = this.makeBattle(b);
        this.battles.set(b.id, v);
      }
      this.setLabel(v, `${translate(locale, "war.battle3d", { round: b.round })} · ${this.foeName(b, locale)}`, "#ff9f5a");
      v.root.position.set(base.x + 6000 + i * 9000, base.y + 1500, base.z - 4000);
      this.syncLosses(v, b);
      this.stage(v, dt, time);
    });
    for (const [id, v] of this.battles) if (!seenB.has(id)) {
      this.removeGroup(v);
      this.battles.delete(id);
    }

    // Trazas de los disparos.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]!;
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      const head = tr.from.clone().lerp(tr.to, k);
      const tail = tr.from.clone().lerp(tr.to, Math.max(0, k - 0.18));
      const pos = tr.line.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, tail.x, tail.y, tail.z);
      pos.setXYZ(1, head.x, head.y, head.z);
      pos.needsUpdate = true;
      if (k >= 1) {
        this.group.remove(tr.line);
        tr.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  private foeName(b: Battle, locale: Locale): string {
    const f = b.enemyFactionId ? getFaction(b.enemyFactionId) : undefined;
    return (f && contentDictionaries[locale][f.nameKey]) || b.enemyName;
  }

  private makeShip(classId: string, accent: number, slot: THREE.Vector3): ShipVisual | null {
    const obj = createShipModel(classId, { accent });
    if (!obj) return null;
    obj.position.copy(slot);
    return { classId, obj, rig: obj.userData.rig as ShipRig, slot, alive: true };
  }

  private makeGroup(key: string, classIds: string[], accent: number): Group3D {
    const root = new THREE.Group();
    const slots = wedge(classIds);
    const ships: ShipVisual[] = [];
    classIds.forEach((id, i) => {
      const s = this.makeShip(id, accent, slots[i]!);
      if (s) {
        ships.push(s);
        root.add(s.obj);
      }
    });
    const label = makeLabel(" ", "#ffffff");
    root.add(label);
    this.group.add(root);
    return { key, root, label, labelKey: "", ships };
  }

  private makeBattle(b: Battle): BattleVisual {
    const root = new THREE.Group();
    const own: ShipVisual[] = [];
    const foe: ShipVisual[] = [];
    const place = (counts: ShipCounts, accent: number, side: 1 | -1, list: ShipVisual[]) => {
      const ids = expand(counts);
      const slots = wedge(ids);
      ids.forEach((id, i) => {
        // Cada bando mira al otro: el propio en +X mirando a -X, el enemigo al revés.
        const local = slots[i]!;
        const pos = new THREE.Vector3(side * (BATTLE_GAP / 2 + local.z), local.y, local.x);
        const s = this.makeShip(id, accent, pos);
        if (!s) return;
        s.obj.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        list.push(s);
        root.add(s.obj);
      });
    };
    place(b.own, OWN_ACCENT, 1, own);
    place(b.foe, FOE_ACCENT, -1, foe);
    const label = makeLabel(" ", "#ffffff");
    label.position.y = 600;
    root.add(label);
    this.group.add(root);
    return { key: b.id, root, label, labelKey: "", ships: [...own, ...foe], own, foe, round: b.round, nextShot: 0, initial: [{ ...b.own }, { ...b.foe }] };
  }

  private setLabel(g: Group3D, text: string, color: string): void {
    const key = `${text}|${color}`;
    if (g.labelKey === key) return;
    g.labelKey = key;
    const { texture, aspect } = labelTexture(text, color);
    g.label.material.map?.dispose();
    g.label.material.map = texture;
    g.label.material.needsUpdate = true;
    g.label.scale.set(0.026 * aspect, 0.026, 1);
  }

  /**
   * Revienta las naves dibujadas que ya no están: de cada clase quedan en pie
   * las proporcionales a las que siguen en la batalla (al menos una mientras
   * quede alguna de esa clase).
   */
  private syncLosses(v: BattleVisual, b: Battle): void {
    if (b.round === v.round) return;
    v.round = b.round;
    const sync = (list: ShipVisual[], initial: ShipCounts, now: ShipCounts) => {
      for (const id of Object.keys(initial)) {
        const drawn = list.filter((s) => s.classId === id);
        const alive = drawn.filter((s) => s.alive);
        const left = now[id] ?? 0;
        const want = left <= 0 ? 0 : Math.max(1, Math.ceil((drawn.length * left) / initial[id]!));
        for (const s of alive.slice(0, Math.max(0, alive.length - want))) {
          s.alive = false;
          this.explode(s.obj.getWorldPosition(new THREE.Vector3()));
          s.obj.visible = false;
        }
      }
    };
    sync(v.own, v.initial[0], b.own);
    sync(v.foe, v.initial[1], b.foe);
  }

  /** Puesta en escena entre rondas: las naves se mecen y se disparan con trazas desde sus bocas de fuego. */
  private stage(v: BattleVisual, dt: number, time: number): void {
    for (const s of v.ships) {
      if (!s.alive) continue;
      s.rig.setThrust(0.35);
      s.rig.tick(time, dt, 0.6);
      s.obj.position.x = s.slot.x + Math.sin(time * 0.3 + s.slot.z) * 60;
    }
    v.nextShot -= dt;
    if (v.nextShot > 0) return;
    v.nextShot = 0.12 + Math.random() * 0.25;
    const ownAlive = v.own.filter((s) => s.alive);
    const foeAlive = v.foe.filter((s) => s.alive);
    if (!ownAlive.length || !foeAlive.length) return;
    const fromOwn = Math.random() < 0.5;
    const shooter = (fromOwn ? ownAlive : foeAlive)[Math.floor(Math.random() * (fromOwn ? ownAlive : foeAlive).length)]!;
    const target = (fromOwn ? foeAlive : ownAlive)[Math.floor(Math.random() * (fromOwn ? foeAlive : ownAlive).length)]!;
    const muzzle = shooter.rig.muzzle("cannon", Math.floor(Math.random() * 4), new THREE.Vector3());
    const to = target.obj.getWorldPosition(new THREE.Vector3());
    const len = shipLength(target.classId) ?? 40;
    to.add(new THREE.Vector3((Math.random() - 0.5) * len, (Math.random() - 0.5) * len * 0.4, (Math.random() - 0.5) * len));
    const geo = new THREE.BufferGeometry().setFromPoints([muzzle, muzzle.clone()]);
    const line = new THREE.Line(geo, fromOwn ? this.tracerMaterials.own : this.tracerMaterials.foe);
    line.frustumCulled = false;
    this.group.add(line);
    this.tracers.push({ line, from: muzzle, to, t: 0, dur: muzzle.distanceTo(to) / 2400, hit: true });
  }

  private removeGroup(g: Group3D): void {
    this.group.remove(g.root);
    disposeLabel(g.label);
  }

  clear(): void {
    for (const g of this.fleets.values()) this.removeGroup(g);
    for (const v of this.battles.values()) this.removeGroup(v);
    for (const tr of this.tracers) {
      this.group.remove(tr.line);
      tr.line.geometry.dispose();
    }
    this.fleets.clear();
    this.battles.clear();
    this.tracers = [];
  }
}

