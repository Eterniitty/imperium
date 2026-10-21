/**
 * Espaguetización del salto cuántico: la nave que entra en una grieta se
 * estira hacia ella hasta ser un hilo de luz y desaparece dentro en medio
 * segundo (como si acelerase a la velocidad de la luz); en la llegada, un rayo
 * sale disparado de la grieta y se contrae en la nave. Lo ven igual el piloto
 * y los demás del sistema (va con las grietas del mundo, `RiftField`).
 *
 * Se hace sin sombreadores propios, para que valga con cualquier modelo de
 * nave: escalado no uniforme del grupo a lo largo de su eje (Z), desplazamiento
 * del centro, una raya de luz aditiva (dos planos cruzados), un brillo en la
 * cabeza y un destello. La deformación es solo visual: el desplazamiento que
 * se aplica a la posición se deshace si nadie la vuelve a fijar antes del
 * siguiente fotograma.
 *
 * Con «Reducir efectos visuales», los destellos y la raya son más tenues y pequeños.
 */
import * as THREE from "three";
import { FLAGSHIP_LENGTH_M, QUANTUM_RIFT } from "@imperium/content";
import { glowTexture, streakTexture } from "../textures";
import { flashGain } from "./flashLimiter";

/** Color de la luz del salto (el de la grieta). */
const LIGHT = new THREE.Color(0xbfd4ff);

/** Dos planos cruzados de 1×1×1 a lo largo de Z; u va de la cola (z = -0,5) a la cabeza (z = +0,5). */
function crossedQuads(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // prettier-ignore
  const pos = new Float32Array([
    -0.5, 0, -0.5,  0.5, 0, -0.5,  0.5, 0, 0.5,  -0.5, 0, 0.5,
    0, -0.5, -0.5,  0, 0.5, -0.5,  0, 0.5, 0.5,  0, -0.5, 0.5,
  ]);
  // prettier-ignore
  const uv = new Float32Array([0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

const quads = crossedQuads();
const Z = new THREE.Vector3(0, 0, 1);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

interface Anim {
  kind: "depart" | "arrive";
  ship: THREE.Object3D;
  /** Escala original del grupo (se restaura al acabar). */
  base: THREE.Vector3;
  /** Eslora de la nave (m). */
  len: number;
  t: number;
  reduce: boolean;
  /** Centro de la grieta. */
  rift: THREE.Vector3;
  /** Entrada: dónde estaba la nave y hacia dónde va. */
  from: THREE.Vector3;
  dir: THREE.Vector3;
  /** Llegada: espera hasta el rayo (s). */
  delay: number;
  /** Desplazamiento aplicado este fotograma y la posición que quedó (para deshacerlo si nadie la fija). */
  offset: THREE.Vector3;
  written: THREE.Vector3 | null;
  hidden: boolean;
  /** Visibilidad que tenía la nave antes de ocultarla (en cabina, la propia ya estaba oculta). */
  wasVisible: boolean;
  flashed: boolean;
  streak: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  head: THREE.Sprite;
  done?: (ship: THREE.Object3D) => void;
}

interface Flash {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  size: number;
  peak: number;
}

/** Las naves que se espaguetizan al entrar en una grieta o que salen de ella como un rayo. */
export class WarpStreaks {
  readonly group = new THREE.Group();
  private anims: Anim[] = [];
  private flashes: Flash[] = [];

  /** ¿Se está animando esta nave? */
  has(ship: THREE.Object3D): boolean {
    return this.anims.some((a) => a.ship === ship);
  }

  /**
   * Entrada: la nave se estira hacia la grieta en `rift` y desaparece dentro en
   * `QUANTUM_RIFT.departSec`; al acabar recupera su escala y se llama a `done`
   * (ocultarla o liberarla), con un destello en la grieta.
   */
  depart(ship: THREE.Object3D, rift: THREE.Vector3, reduce: boolean, done: (ship: THREE.Object3D) => void): void {
    this.cancel(ship);
    const dir = rift.clone().sub(ship.position);
    if (dir.lengthSq() < 1) dir.set(0, 0, -1).applyQuaternion(ship.quaternion);
    dir.normalize();
    this.anims.push(this.make("depart", ship, rift, reduce, { from: ship.position.clone(), dir, done }));
  }

  /**
   * Llegada: tras `delay` s (la grieta abriéndose) sale un rayo de luz de la
   * grieta en `rift`, en la dirección del morro, y se contrae en la nave.
   * Mientras espera, la nave está oculta. Su posición la sigue fijando quien la
   * mueve (este efecto solo la deforma alrededor).
   */
  arrive(ship: THREE.Object3D, rift: THREE.Vector3, delay: number, reduce: boolean): void {
    this.cancel(ship);
    this.anims.push(this.make("arrive", ship, rift, reduce, { from: ship.position.clone(), dir: new THREE.Vector3(), delay }));
  }

  private make(kind: Anim["kind"], ship: THREE.Object3D, rift: THREE.Vector3, reduce: boolean, extra: { from: THREE.Vector3; dir: THREE.Vector3; delay?: number; done?: (s: THREE.Object3D) => void }): Anim {
    const streak = new THREE.Mesh(
      quads,
      new THREE.MeshBasicMaterial({ map: streakTexture(), color: LIGHT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    streak.frustumCulled = false;
    streak.renderOrder = 7;
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: LIGHT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    head.renderOrder = 7;
    this.group.add(streak, head);
    const len = typeof ship.userData.lengthM === "number" ? (ship.userData.lengthM as number) : FLAGSHIP_LENGTH_M;
    return {
      kind,
      ship,
      base: ship.scale.clone(),
      len,
      t: 0,
      reduce,
      rift: rift.clone(),
      from: extra.from,
      dir: extra.dir,
      delay: extra.delay ?? 0,
      offset: new THREE.Vector3(),
      written: null,
      hidden: false,
      wasVisible: true,
      flashed: false,
      streak,
      head,
      done: extra.done,
    };
  }

  /** Destello en un punto (más tenue y pequeño con «reducir efectos»). */
  flash(at: THREE.Vector3, size: number, life: number, reduce: boolean): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: LIGHT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sprite.position.copy(at);
    sprite.renderOrder = 8;
    this.group.add(sprite);
    this.flashes.push({ sprite, age: 0, life: reduce ? life * 1.6 : life, size: reduce ? size * 0.45 : size, peak: (reduce ? 0.22 : 1) * flashGain(size) });
  }

  update(dt: number): void {
    this.anims = this.anims.filter((a) => {
      // La nave ya no está en la escena (se quitó): se abandona.
      if (!a.ship.parent) {
        this.dispose(a);
        return false;
      }
      a.t += dt;
      const finished = a.kind === "depart" ? this.stepDepart(a) : this.stepArrive(a);
      if (!finished) return true;
      this.restore(a);
      this.dispose(a);
      a.done?.(a.ship);
      return false;
    });
    this.flashes = this.flashes.filter((f) => {
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        this.group.remove(f.sprite);
        f.sprite.material.dispose();
        return false;
      }
      // Sube de golpe y se apaga rápido.
      const env = Math.min(1, k * 12) * (1 - k) ** 2;
      f.sprite.material.opacity = f.peak * env;
      f.sprite.scale.setScalar(f.size * (0.35 + 0.65 * Math.sqrt(k)));
      return true;
    });
  }

  /**
   * Entrada. A lo largo de `dir`, desde la posición inicial: un instante de
   * anticipación (se encoge un poco) y luego el morro sale disparado hacia la
   * grieta mientras la cola se queda atrás; la nave se alarga y adelgaza hasta
   * ser un hilo, la cola la alcanza y todo cae en el centro de la grieta.
   */
  private stepDepart(a: Anim): boolean {
    const D = QUANTUM_RIFT.departSec;
    const k = Math.min(1, a.t / D);
    const h = a.len / 2;
    const R = Math.max(h, tmpA.copy(a.rift).sub(a.from).dot(a.dir));
    const end = R + a.len * 0.4;
    const pre = 0.16;
    let nose: number;
    let tail: number;
    let thick: number;
    let glow: number;
    if (k < pre) {
      const s = smooth(0, 1, k / pre);
      nose = h - 0.12 * h * s;
      tail = -h - 0.05 * h * s;
      thick = 1 + 0.07 * s;
      glow = 0.35 * s;
    } else {
      const u = (k - pre) / (1 - pre);
      const n0 = h * 0.88;
      const t0 = -h * 1.05;
      nose = n0 + (end + a.len * 0.6 - n0) * (1 - (1 - u) ** 5);
      tail = t0 + (end - t0) * u ** 3.2;
      // El morro se pasa un poco y vuelve al centro con la cola: todo acaba en un punto.
      nose -= a.len * 0.6 * smooth(0.7, 1, u);
      const stretch = Math.max(1, (nose - tail) / a.len);
      thick = Math.min(1, stretch ** -0.8) * (1 - 0.95 * smooth(0.6, 1, u));
      glow = 0.35 + 0.65 * smooth(0, 0.25, u) - 0.6 * smooth(0.75, 1, u);
    }
    const length = Math.max(1e-3, nose - tail);
    a.ship.position.copy(a.from).addScaledVector(a.dir, (nose + tail) / 2);
    a.ship.scale.set(a.base.x * Math.max(0.02, thick), a.base.y * Math.max(0.02, thick), a.base.z * (length / a.len));
    // Raya: desde un poco por detrás de la cola (estela) hasta más allá del morro.
    const trail = a.len * 1.8 * smooth(pre, 0.5, k) * (1 - smooth(0.7, 1, k));
    tmpA.copy(a.from).addScaledVector(a.dir, tail - trail);
    tmpB.copy(a.from).addScaledVector(a.dir, nose + a.len * 0.25);
    this.placeStreak(a, tmpA, tmpB, a.len * 0.5 * Math.max(0.25, thick), glow);
    if (k >= 1 && !a.flashed) {
      a.flashed = true;
      this.flash(a.rift, a.len * 6, 0.35, a.reduce);
    }
    return k >= 1;
  }

  /**
   * Llegada. Primero (30 %) el rayo sale de la grieta y su cabeza llega al
   * morro de la nave; luego la cola se recoge hacia la nave, que engorda hasta
   * su forma (con un pequeño rebote) y destella al condensarse.
   */
  private stepArrive(a: Anim): boolean {
    const ship = a.ship;
    // Si nadie ha vuelto a fijar la posición desde el último fotograma, se quita el desplazamiento aplicado.
    if (a.written && ship.position.equals(a.written)) ship.position.sub(a.offset);
    a.offset.set(0, 0, 0);
    a.written = null;
    if (a.t < a.delay) {
      if (!a.hidden) a.wasVisible = ship.visible;
      ship.visible = false;
      a.hidden = true;
      return false;
    }
    if (a.hidden) {
      ship.visible = a.wasVisible;
      a.hidden = false;
    }
    const k = Math.min(1, (a.t - a.delay) / QUANTUM_RIFT.arriveBeamSec);
    const h = a.len / 2;
    const dir = a.dir.set(0, 0, -1).applyQuaternion(ship.quaternion).normalize();
    // Distancia de la grieta al centro de la nave (si llega por detrás de ella con retraso, se da por delante).
    const D0 = Math.max(a.len * 0.9, tmpA.copy(ship.position).sub(a.rift).dot(dir));
    const shoot = 0.3;
    let nose: number;
    let tail: number;
    let thick: number;
    let glow: number;
    if (k < shoot) {
      const v = k / shoot;
      const head = (D0 + h * 1.2) * (1 - (1 - v) ** 3);
      nose = head - D0;
      tail = -D0;
      thick = 0.05;
      glow = smooth(0, 0.4, v);
    } else {
      const v = (k - shoot) / (1 - shoot);
      nose = h + h * 0.2 * (1 - smooth(0, 0.5, v));
      const c = 1 - (1 - Math.min(1, v / 0.65)) ** 3;
      tail = -D0 + (D0 - h) * c;
      // Engorda con un pequeño rebote al condensarse.
      const s = Math.min(1, v / 0.75);
      const back = 1 + 2.4 * (s - 1) ** 3 + 1.4 * (s - 1) ** 2;
      thick = 0.05 + 0.95 * back;
      glow = (1 - smooth(0.3, 1, v)) * 1;
      if (!a.flashed && v >= 0.5) {
        a.flashed = true;
        this.flash(ship.position, a.len * 3.5, 0.3, a.reduce);
      }
    }
    if (k >= 1) return true;
    const length = Math.max(1e-3, nose - tail);
    a.offset.copy(dir).multiplyScalar((nose + tail) / 2);
    ship.position.add(a.offset);
    a.written = ship.position.clone();
    ship.scale.set(a.base.x * thick, a.base.y * thick, a.base.z * (length / a.len));
    // Raya: de la grieta (o de la cola, al recogerse) a un poco más allá del morro.
    tmpA.copy(ship.position).sub(a.offset).addScaledVector(dir, tail);
    const headAt = new THREE.Vector3().copy(ship.position).sub(a.offset).addScaledVector(dir, nose + a.len * 0.2);
    this.placeStreak(a, tmpA, headAt, a.len * 0.45, glow);
    return false;
  }

  /** Coloca la raya de `from` (cola) a `to` (cabeza), con su brillo en la cabeza. */
  private placeStreak(a: Anim, from: THREE.Vector3, to: THREE.Vector3, width: number, glow: number): void {
    const len = from.distanceTo(to);
    const g = Math.max(0, Math.min(1, glow)) * (a.reduce ? 0.35 : 1);
    a.streak.visible = len > 1 && g > 0.01;
    a.head.visible = g > 0.01;
    if (len > 1) {
      a.streak.position.copy(from).add(to).multiplyScalar(0.5);
      a.streak.quaternion.copy(tmpQ.setFromUnitVectors(Z, tmpC.copy(to).sub(from).normalize()));
      a.streak.scale.set(width, width, len);
    }
    a.streak.material.opacity = g;
    a.head.position.copy(to);
    a.head.scale.setScalar(a.len * (a.reduce ? 0.8 : 1.6) * (0.5 + 0.5 * g));
    a.head.material.opacity = g * 0.8;
  }

  private restore(a: Anim): void {
    a.ship.scale.copy(a.base);
    if (a.written && a.ship.position.equals(a.written)) a.ship.position.sub(a.offset);
    a.offset.set(0, 0, 0);
    a.written = null;
    if (a.hidden) a.ship.visible = a.wasVisible;
  }

  /** Quita la animación de una nave (restaurándola), si la tenía. */
  cancel(ship: THREE.Object3D): void {
    this.anims = this.anims.filter((a) => {
      if (a.ship !== ship) return true;
      this.restore(a);
      this.dispose(a);
      return false;
    });
  }

  private dispose(a: Anim): void {
    this.group.remove(a.streak, a.head);
    a.streak.material.dispose();
    a.head.material.dispose();
  }

  /** Termina todo: las naves que entraban acaban su `done`. */
  clear(): void {
    for (const a of this.anims) {
      this.restore(a);
      this.dispose(a);
      a.done?.(a.ship);
    }
    this.anims = [];
    for (const f of this.flashes) {
      this.group.remove(f.sprite);
      f.sprite.material.dispose();
    }
    this.flashes = [];
  }
}
