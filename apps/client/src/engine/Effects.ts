import * as THREE from "three";
import type { ServerMessage, Vec3, WeaponKind } from "@imperium/shared";
import { glowTexture, ringTexture } from "./textures";
import { flashEnvelope, flashGain } from "./fx/flashLimiter";

type Shot = Extract<ServerMessage, { t: "shot" }>;

interface Bolt {
  object: THREE.Object3D;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  t0: number;
  end: number;
  hits: boolean;
  /** Disparo propio dibujado al pulsar (predicción): espera la confirmación del servidor. */
  predicted: boolean;
  confirmed: boolean;
}

interface Missile {
  object: THREE.Group;
  flame: THREE.Sprite;
  trail: Trail;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  targetId: string | null;
  speed: number;
  t0: number;
  end: number;
  hits: boolean;
  last: THREE.Vector3;
  /** Quién lo lanzó y desde qué lanzador: al salir, va pegado al lanzador (hereda el movimiento de la nave). */
  shooter: string;
  muzzle: number;
}

/** Tiempo (ms) que el misil sigue al lanzador al salir: así sale de él aunque la nave se mueva o gire. */
const MISSILE_LAUNCH_MS = 450;
/** Escala del modelo del misil (unos 9 m: se ve junto a una nave de 320 m). */
const MISSILE_SCALE = 2.1;

interface Flash {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  size: number;
  /** Anillo de onda expansiva: crece sin frenar. */
  ring?: boolean;
  /** Intensidad máxima que le dio el limitador de destellos. */
  gain: number;
}

/** Devuelve dónde se dibuja ahora una nave (propia o ajena), o null si no está. */
export type ShipLocator = (id: string) => THREE.Vector3 | null;
/** Devuelve dónde está ahora la boca `index` del arma de una nave, o null si no se dibuja. */
export type MuzzleLocator = (id: string, weapon: WeaponKind, index: number) => THREE.Vector3 | null;

// Geometrías compartidas. Ráfaga de cañón: unos 32 m de largo (la insignia mide 320 m).
const BOLT_OUTER = new THREE.BoxGeometry(2.2, 2.2, 34);
const BOLT_CORE = new THREE.BoxGeometry(0.7, 0.7, 30);
const MISSILE_BODY = new THREE.CylinderGeometry(0.42, 0.42, 4.2, 8).rotateX(Math.PI / 2);
const MISSILE_NOSE = new THREE.ConeGeometry(0.42, 1.1, 8).rotateX(-Math.PI / 2).translate(0, 0, -2.65);
const MISSILE_FIN = new THREE.BoxGeometry(0.08, 1.3, 0.9);

/**
 * Estela de humo y llama: puntos que deja un misil por el camino y que se
 * apagan con el tiempo (del naranja de la llama al gris del humo).
 */
class Trail {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly ages: Float32Array;
  private head = 0;
  private emit = 0;
  /** Segundos que tarda en apagarse un punto. */
  private readonly life = 1.6;

  constructor(private readonly size = 90) {
    this.positions = new Float32Array(size * 3);
    this.colors = new Float32Array(size * 3);
    this.ages = new Float32Array(size).fill(1e9);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: glowTexture(), size: 14, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
  }

  /**
   * Origen local de la estela: los puntos se guardan relativos a él (en Float32,
   * a cientos de millones de metros del centro del sistema se perderían metros).
   */
  private origin: THREE.Vector3 | null = null;

  /** Añade puntos a lo largo del tramo recorrido este fotograma. */
  push(fromW: THREE.Vector3, toW: THREE.Vector3, dt: number): void {
    if (!this.origin) {
      this.origin = toW.clone();
      this.points.position.copy(this.origin);
    }
    const from = fromW.clone().sub(this.origin);
    const to = toW.clone().sub(this.origin);
    this.emit += dt;
    const step = 1 / 60;
    while (this.emit >= step) {
      this.emit -= step;
      const k = this.emit / Math.max(dt, 1e-6);
      const i = this.head;
      this.head = (this.head + 1) % this.size;
      this.positions[i * 3] = to.x + (from.x - to.x) * k + (Math.random() - 0.5) * 1.5;
      this.positions[i * 3 + 1] = to.y + (from.y - to.y) * k + (Math.random() - 0.5) * 1.5;
      this.positions[i * 3 + 2] = to.z + (from.z - to.z) * k + (Math.random() - 0.5) * 1.5;
      this.ages[i] = 0;
    }
  }

  /** Envejece los puntos; devuelve false cuando ya no queda ninguno visible. */
  update(dt: number): boolean {
    let alive = false;
    for (let i = 0; i < this.size; i++) {
      const a = (this.ages[i]! += dt);
      const k = Math.min(1, a / this.life);
      // Llama (naranja intenso) al principio, humo grisáceo después, y se apaga.
      const fade = (1 - k) * (1 - k);
      const r = k < 0.12 ? 1 : 0.55;
      const g = k < 0.12 ? 0.62 : 0.5;
      const b = k < 0.12 ? 0.25 : 0.48;
      this.colors[i * 3] = r * fade;
      this.colors[i * 3 + 1] = g * fade;
      this.colors[i * 3 + 2] = b * fade;
      if (k < 1) alive = true;
    }
    this.points.geometry.attributes.position!.needsUpdate = true;
    this.points.geometry.attributes.color!.needsUpdate = true;
    return alive;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Chispas o restos que salen despedidos de un punto y se apagan. */
class Burst {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private age = 0;

  constructor(
    at: THREE.Vector3,
    count: number,
    speed: number,
    private readonly life: number,
    color: number,
    size: number,
  ) {
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      // Relativas a `at` (la malla se coloca allí): precisión de Float32 lejos del centro.
      this.positions.set([0, 0, 0], i * 3);
      this.velocities.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: glowTexture(), color, size, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }),
    );
    this.points.position.copy(at);
    this.points.frustumCulled = false;
  }

  update(dt: number): boolean {
    this.age += dt;
    const k = this.age / this.life;
    if (k >= 1) return false;
    for (let i = 0; i < this.positions.length; i++) this.positions[i]! += this.velocities[i]! * dt;
    this.points.geometry.attributes.position!.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = 1 - k;
    return true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Efectos del combate: ráfagas de cañón que salen de las bocas de los cañones,
 * misiles con su estela de llama y humo que persiguen al objetivo, chispas de
 * impacto y explosiones con bola de fuego, onda expansiva y restos. Solo
 * visuales: el daño lo decide el servidor.
 */
export class Effects {
  readonly group = new THREE.Group();
  private bolts: Bolt[] = [];
  private missiles: Missile[] = [];
  private flashes: Flash[] = [];
  private trails: Trail[] = [];
  private bursts: Burst[] = [];
  private mats = {
    own: new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    enemy: new THREE.MeshBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    core: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    missile: new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.6, roughness: 0.4 }),
    missileFin: new THREE.MeshStandardMaterial({ color: 0xb03030, metalness: 0.4, roughness: 0.5 }),
  };

  constructor(
    private readonly ownId: () => string | null,
    private readonly muzzleOf: MuzzleLocator = () => null,
  ) {}

  private sprite(color: number, size: number, map: THREE.Texture = glowTexture()): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(size);
    return s;
  }

  private makeBolt(own: boolean): THREE.Object3D {
    const o = new THREE.Group();
    o.add(new THREE.Mesh(BOLT_OUTER, own ? this.mats.own : this.mats.enemy), new THREE.Mesh(BOLT_CORE, this.mats.core));
    // Halo: desde detrás de la nave la ráfaga se ve de punta; el halo la hace visible desde cualquier ángulo.
    o.add(this.sprite(own ? 0x8fe9ff : 0xff7a4a, 26));
    return o;
  }

  private launchBolt(from: THREE.Vector3, dir: THREE.Vector3, speed: number, t0: number, end: number, own: boolean, predicted: boolean, hits: boolean): void {
    const object = this.makeBolt(own);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    object.position.copy(from);
    this.group.add(object);
    // Fogonazo en la boca del cañón.
    this.flash(from, 9, 0.08, own ? 0xbff4ff : 0xffb090);
    this.bolts.push({ object, from, dir, speed, t0, end, hits, predicted, confirmed: !predicted });
  }

  /**
   * Disparo propio del cañón dibujado nada más pulsar, desde la boca del cañón
   * (si se esperase al servidor, saldría de donde estaba la nave hace un instante).
   */
  fireLocal(from: THREE.Vector3, dir: THREE.Vector3, speed: number, range: number, now: number): void {
    // Fogonazo en la boca: un cañón de una nave capital, no un láser de juguete.
    this.flash(from, 34, 0.1, 0xfff0c8);
    this.flash(from.clone().addScaledVector(dir, 12), 22, 0.16, 0xffb060);
    this.launchBolt(from.clone(), dir.clone().normalize(), speed, now, now + (range / speed) * 1000, true, true, false);
  }

  /** Disparo confirmado por el servidor. `now` es la hora del servidor al recibirlo. */
  add(shot: Shot, now: number): void {
    const dir = new THREE.Vector3(...shot.dir).normalize();
    const own = shot.id === this.ownId();
    const flight = shot.hitAt !== null ? shot.hitAt - shot.serverTime : (shot.range / shot.speed) * 1000;
    if (shot.weapon === "cannon") {
      if (own) {
        // Se dibujó al disparar: se empareja con la ráfaga predicha más antigua sin confirmar.
        const b = this.bolts.find((x) => x.predicted && !x.confirmed && now - x.t0 < 1500);
        if (b) {
          b.confirmed = true;
          if (shot.hitAt !== null) {
            b.hits = true;
            b.end = b.t0 + flight;
          }
          return;
        }
      }
      // Sale de la boca del cañón de la nave tal y como se dibuja ahora (o de donde dice el servidor).
      const from = this.muzzleOf(shot.id, "cannon", shot.muzzle) ?? new THREE.Vector3(...shot.from);
      this.launchBolt(from, dir, shot.speed, now, now + flight, own, false, shot.hitAt !== null);
      return;
    }
    const from = this.muzzleOf(shot.id, "missile", shot.muzzle) ?? new THREE.Vector3(...shot.from);
    const object = new THREE.Group();
    object.add(new THREE.Mesh(MISSILE_BODY, this.mats.missile), new THREE.Mesh(MISSILE_NOSE, this.mats.missileFin));
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(MISSILE_FIN, this.mats.missileFin);
      const a = (i * Math.PI) / 2;
      fin.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 1.7);
      fin.rotation.z = a;
      object.add(fin);
    }
    const flame = this.sprite(0xffb35c, 12);
    flame.position.z = 2.6;
    object.add(flame, this.sprite(0xff8a3a, 22));
    object.position.copy(from);
    object.scale.setScalar(MISSILE_SCALE);
    // Sale ya orientado hacia donde se lanza (el morro del modelo mira a -Z).
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const trail = new Trail();
    this.group.add(object, trail.points);
    this.trails.push(trail);
    this.flash(from, 18, 0.18, 0xffc080);
    this.missiles.push({ object, flame, trail, from, dir, targetId: shot.target, speed: shot.speed, t0: now, end: now + flight, hits: shot.hitAt !== null, last: from.clone(), shooter: shot.id, muzzle: shot.muzzle });
  }

  /** Destello en un punto: impacto (pequeño) o explosión de una nave (grande). */
  flash(at: THREE.Vector3 | Vec3, size: number, life: number, color = 0xffd27a, ring = false): void {
    const sprite = this.sprite(color, size * 0.3, ring ? ringTexture() : glowTexture());
    if (Array.isArray(at)) sprite.position.set(...at);
    else sprite.position.copy(at);
    this.group.add(sprite);
    this.flashes.push({ sprite, age: 0, life, size, ring, gain: flashGain(size) });
  }

  /** Impacto: destello, chispas y un pequeño anillo. */
  private impact(at: THREE.Vector3, big: boolean): void {
    this.flash(at, big ? 110 : 55, big ? 0.55 : 0.32);
    this.flash(at, big ? 40 : 20, 0.12, 0xffffff);
    if (big) this.flash(at, 160, 0.6, 0xffc070, true);
    const b = new Burst(at, big ? 50 : 22, big ? 220 : 140, big ? 0.9 : 0.5, 0xffc27a, big ? 7 : 5);
    this.group.add(b.points);
    this.bursts.push(b);
  }

  /** Explosión de una nave: bola de fuego en capas, onda expansiva y restos ardiendo. */
  explode(at: THREE.Vector3 | Vec3): void {
    const p = Array.isArray(at) ? new THREE.Vector3(...at) : at.clone();
    this.flash(p, 140, 0.25, 0xffffff);
    this.flash(p, 320, 1.4, 0xff9030);
    const jitter = new THREE.Vector3();
    for (let i = 0; i < 5; i++) {
      jitter.randomDirection().multiplyScalar(25 + Math.random() * 30);
      this.flash(p.clone().add(jitter), 140 + Math.random() * 90, 0.9 + Math.random() * 0.8, i % 2 ? 0xff6a20 : 0xffb050);
    }
    this.flash(p, 700, 1.1, 0xffd9a0, true);
    for (const [count, speed, life, color, size] of [
      [120, 260, 1.8, 0xffa040, 9],
      [60, 90, 2.6, 0x8a8a8a, 22],
      [30, 420, 1.2, 0xffffff, 5],
    ] as const) {
      const b = new Burst(p, count, speed, life, color, size);
      this.group.add(b.points);
      this.bursts.push(b);
    }
  }

  update(dt: number, serverTime: number, locate: ShipLocator): void {
    this.bolts = this.bolts.filter((b) => {
      if (serverTime >= b.end || (b.predicted && !b.confirmed && serverTime - b.t0 > 1500)) {
        this.group.remove(b.object);
        for (const c of b.object.children) if (c instanceof THREE.Sprite) c.material.dispose();
        if (b.hits) this.impact(b.from.clone().addScaledVector(b.dir, (b.speed * (b.end - b.t0)) / 1000), false);
        return false;
      }
      b.object.position.copy(b.from).addScaledVector(b.dir, (b.speed * Math.max(0, serverTime - b.t0)) / 1000);
      return true;
    });

    const prev = new THREE.Vector3();
    this.missiles = this.missiles.filter((m) => {
      const target = m.targetId ? locate(m.targetId) : null;
      const k = Math.min(1, Math.max(0, (serverTime - m.t0) / (m.end - m.t0)));
      // Al salir, el punto de partida es el lanzador tal y como se dibuja ahora (la nave se mueve y gira).
      if (serverTime - m.t0 < MISSILE_LAUNCH_MS) {
        const at = this.muzzleOf(m.shooter, "missile", m.muzzle);
        if (at) m.from.copy(at);
      }
      prev.copy(m.last);
      if (target) {
        // Curva suave hacia donde está el objetivo ahora: parece que lo persigue.
        const straight = m.from.clone().addScaledVector(m.dir, ((m.speed * (m.end - m.t0)) / 1000) * k);
        m.last.copy(straight.lerp(target, k * k));
      } else {
        m.last.copy(m.from).addScaledVector(m.dir, (m.speed * (serverTime - m.t0)) / 1000);
      }
      m.object.position.copy(m.last);
      if (m.last.distanceToSquared(prev) > 1e-6) m.object.lookAt(prev.clone().multiplyScalar(2).sub(m.last));
      m.trail.push(prev, m.last, dt);
      m.flame.scale.setScalar((10 + Math.random() * 5) / MISSILE_SCALE);
      if (k >= 1) {
        this.group.remove(m.object);
        for (const c of m.object.children) if (c instanceof THREE.Sprite) c.material.dispose();
        if (m.hits) this.impact(m.last, true);
        return false;
      }
      return true;
    });

    this.trails = this.trails.filter((t) => {
      if (t.update(dt) || this.missiles.some((m) => m.trail === t)) return true;
      this.group.remove(t.points);
      t.dispose();
      return false;
    });

    this.bursts = this.bursts.filter((b) => {
      if (b.update(dt)) return true;
      this.group.remove(b.points);
      b.dispose();
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
      f.sprite.scale.setScalar(f.ring ? f.size * (0.1 + 0.9 * k) : f.size * (0.3 + 0.7 * Math.sqrt(k)));
      f.sprite.material.opacity = f.gain * flashEnvelope(f.age, f.life, f.ring ? (1 - k) * 0.8 : 1 - k);
      return true;
    });
  }

  clear(): void {
    for (const t of this.trails) t.dispose();
    for (const b of this.bursts) b.dispose();
    for (const o of [...this.group.children]) this.group.remove(o);
    this.bolts = [];
    this.missiles = [];
    this.flashes = [];
    this.trails = [];
    this.bursts = [];
  }
}
