import * as THREE from "three";
import type { ServerMessage, Vec3 } from "@imperium/shared";
import { glowTexture } from "./textures";

type Shot = Extract<ServerMessage, { t: "shot" }>;

interface Bolt {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  t0: number;
  end: number;
  hits: boolean;
}

interface Missile {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  targetId: string | null;
  speed: number;
  t0: number;
  end: number;
  hits: boolean;
  last: THREE.Vector3;
}

interface Flash {
  sprite: THREE.Sprite;
  age: number;
  life: number;
  size: number;
}

/** Devuelve dónde se dibuja ahora una nave (propia o ajena), o null si no está. */
export type ShipLocator = (id: string) => THREE.Vector3 | null;

const BOLT_GEO = new THREE.BoxGeometry(0.18, 0.18, 3.2);

/**
 * Efectos del combate: ráfagas de cañón, misiles que persiguen al objetivo,
 * destellos de impacto y explosiones. Solo visuales: el daño lo decide el servidor.
 */
export class Effects {
  readonly group = new THREE.Group();
  private bolts: Bolt[] = [];
  private missiles: Missile[] = [];
  private flashes: Flash[] = [];
  private ownBolt = new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  private enemyBolt = new THREE.MeshBasicMaterial({ color: 0xff7a4a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(private readonly ownId: () => string | null) {}

  add(shot: Shot): void {
    const from = new THREE.Vector3(...shot.from);
    const dir = new THREE.Vector3(...shot.dir).normalize();
    const end = shot.hitAt ?? shot.serverTime + (shot.range / shot.speed) * 1000;
    if (shot.weapon === "cannon") {
      const mesh = new THREE.Mesh(BOLT_GEO, shot.id === this.ownId() ? this.ownBolt : this.enemyBolt);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.group.add(mesh);
      this.bolts.push({ mesh, from, dir, speed: shot.speed, t0: shot.serverTime, end, hits: shot.hitAt !== null });
    } else {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb35c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      sprite.scale.setScalar(2.2);
      this.group.add(sprite);
      this.missiles.push({ sprite, from, dir, targetId: shot.target, speed: shot.speed, t0: shot.serverTime, end, hits: shot.hitAt !== null, last: from.clone() });
    }
  }

  /** Destello en un punto: impacto (pequeño) o explosión de una nave (grande). */
  flash(at: THREE.Vector3 | Vec3, size: number, life: number, color = 0xffd27a): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    if (Array.isArray(at)) sprite.position.set(...at);
    else sprite.position.copy(at);
    this.group.add(sprite);
    this.flashes.push({ sprite, age: 0, life, size });
  }

  explode(at: THREE.Vector3 | Vec3): void {
    this.flash(at, 28, 1.2, 0xffa040);
    this.flash(at, 12, 0.6, 0xffffff);
  }

  update(dt: number, serverTime: number, locate: ShipLocator): void {
    this.bolts = this.bolts.filter((b) => {
      if (serverTime >= b.end) {
        this.group.remove(b.mesh);
        if (b.hits) this.flash(b.from.clone().addScaledVector(b.dir, (b.speed * (b.end - b.t0)) / 1000), 5, 0.35);
        return false;
      }
      b.mesh.position.copy(b.from).addScaledVector(b.dir, (b.speed * Math.max(0, serverTime - b.t0)) / 1000);
      return true;
    });

    this.missiles = this.missiles.filter((m) => {
      const target = m.targetId ? locate(m.targetId) : null;
      const k = Math.min(1, Math.max(0, (serverTime - m.t0) / (m.end - m.t0)));
      if (target) {
        // Curva suave hacia donde está el objetivo ahora: parece que lo persigue.
        const straight = m.from.clone().addScaledVector(m.dir, ((m.speed * (m.end - m.t0)) / 1000) * k);
        m.last.copy(straight.lerp(target, k * k));
      } else {
        m.last.copy(m.from).addScaledVector(m.dir, (m.speed * (serverTime - m.t0)) / 1000);
      }
      m.sprite.position.copy(m.last);
      if (k >= 1) {
        this.group.remove(m.sprite);
        m.sprite.material.dispose();
        if (m.hits) this.flash(m.last, 9, 0.5);
        return false;
      }
      return true;
    });

    this.flashes = this.flashes.filter((f) => {
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        this.group.remove(f.sprite);
        f.sprite.material.dispose();
        return false;
      }
      f.sprite.scale.setScalar(f.size * (0.3 + 0.7 * Math.sqrt(k)));
      f.sprite.material.opacity = 1 - k;
      return true;
    });
  }

  clear(): void {
    for (const o of [...this.group.children]) this.group.remove(o);
    this.bolts = [];
    this.missiles = [];
    this.flashes = [];
  }
}
