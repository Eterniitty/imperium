/**
 * Reglas del combate en tiempo real, sin red ni base de datos: estado de cada
 * nave (casco, escudo, armas) y geometría de los impactos. Las usa SpaceService.
 */
import type { ShipCombat, WeaponDefinition } from "@imperium/content";
import type { Quat, Vec3, WeaponKind } from "@imperium/shared";

/** Radio de impacto de una nave (unidades de sistema): algo mayor que el modelo, por la latencia. */
export const HIT_RADIUS = 4;
/** Cono de fijación de misiles: el objetivo tiene que estar a menos de este ángulo del morro. */
export const MISSILE_LOCK_COS = Math.cos((60 * Math.PI) / 180);

export interface WeaponState {
  def: WeaponDefinition;
  readyAt: number;
  ammo: number | null;
  /** Hora de la última recarga de munición contada. */
  ammoAt: number;
}

/** Estado de combate de una nave. Dura aunque salga del sistema (no se cura saliendo y entrando). */
export class Combatant {
  hull: number;
  shield: number;
  lastHitAt = 0;
  readonly weapons = new Map<WeaponKind, WeaponState>();

  constructor(
    readonly hullMax: number,
    readonly combat: ShipCombat,
    now: number,
  ) {
    this.hull = hullMax;
    this.shield = combat.shield;
    for (const def of combat.weapons) this.weapons.set(def.kind, { def, readyAt: 0, ammo: def.ammo, ammoAt: now });
  }

  get shieldMax(): number {
    return this.combat.shield;
  }

  /** Repone la munición que toque según el tiempo pasado. */
  private regenAmmo(w: WeaponState, now: number): void {
    if (w.ammo === null || w.def.ammo === null || w.def.ammoRegenSec === null) return;
    if (w.ammo >= w.def.ammo) {
      w.ammoAt = now;
      return;
    }
    const gained = Math.floor((now - w.ammoAt) / (w.def.ammoRegenSec * 1000));
    if (gained <= 0) return;
    w.ammo = Math.min(w.def.ammo, w.ammo + gained);
    w.ammoAt += gained * w.def.ammoRegenSec * 1000;
  }

  /** Intenta disparar: comprueba cadencia y munición y las gasta. Devuelve el arma, o null si no puede. */
  tryFire(kind: WeaponKind, now: number): WeaponDefinition | null {
    const w = this.weapons.get(kind);
    if (!w) return null;
    this.regenAmmo(w, now);
    if (now < w.readyAt || w.ammo === 0) return null;
    w.readyAt = now + w.def.cooldownSec * 1000;
    if (w.ammo !== null) w.ammo--;
    return w.def;
  }

  weaponsView(now: number) {
    return [...this.weapons.values()].map((w) => {
      this.regenAmmo(w, now);
      return { kind: w.def.kind, ammo: w.ammo, ammoMax: w.def.ammo, readyAt: w.readyAt };
    });
  }

  /** Aplica daño: primero al escudo, luego al casco. Devuelve true si la nave queda destruida. */
  damage(amount: number, now: number): boolean {
    this.lastHitAt = now;
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    this.hull = Math.max(0, this.hull - (amount - absorbed));
    return this.hull <= 0;
  }

  /** Recarga del escudo tras unos segundos sin recibir daño. Devuelve true si cambió. */
  regenShield(dtSec: number, now: number): boolean {
    if (this.shield >= this.shieldMax || now - this.lastHitAt < this.combat.shieldDelaySec * 1000) return false;
    this.shield = Math.min(this.shieldMax, this.shield + this.combat.shieldRegenPerSec * dtSec);
    return true;
  }

  restore(now: number): void {
    this.hull = this.hullMax;
    this.shield = this.shieldMax;
    this.lastHitAt = 0;
    for (const w of this.weapons.values()) {
      w.ammo = w.def.ammo;
      w.ammoAt = now;
      w.readyAt = 0;
    }
  }
}

export function normalize(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : null;
}

/** Dirección del morro de una nave: (0, 0, -1) rotado por su orientación. */
export function forwardOf(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}

/**
 * Distancia a lo largo del rayo (`origin`, `dir` unitario) a la que pasa cerca
 * de `point`, o null si no pasa a menos de `radius` dentro del alcance.
 */
export function rayHit(origin: Vec3, dir: Vec3, point: Vec3, range: number, radius = HIT_RADIUS): number | null {
  const w: Vec3 = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  const t = w[0] * dir[0] + w[1] * dir[1] + w[2] * dir[2];
  if (t < 0 || t > range) return null;
  const d = Math.hypot(w[0] - dir[0] * t, w[1] - dir[1] * t, w[2] - dir[2] * t);
  return d <= radius ? t : null;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
