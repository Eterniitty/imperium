/**
 * Reglas del combate en tiempo real, sin red ni base de datos: estado de cada
 * nave (casco, escudo, armas, energía y combustible) y geometría de los
 * impactos. Las usa SpaceService.
 */
import { FLAGSHIP_REPAIR, FLAGSHIP_SUPPLIES, type ShipCombat, type WeaponDefinition } from "@imperium/content";
import type { Quat, Vec3, WeaponKind } from "@imperium/shared";
import { regenFuel } from "@imperium/sim";

/** Radio de impacto de una nave (metros): la nave mide unos 45 m; algo de margen por la latencia. */
export const HIT_RADIUS = 30;
/** Cono de fijación de misiles: el objetivo tiene que estar a menos de este ángulo del morro. */
export const MISSILE_LOCK_COS = Math.cos((60 * Math.PI) / 180);

export interface WeaponState {
  def: WeaponDefinition;
  readyAt: number;
  ammo: number | null;
  /** Hora de la última recarga de munición contada. */
  ammoAt: number;
}

/**
 * Recursos guardados de la nave del Emperador (persisten en la base de datos):
 * combustible a la hora `fuelAt` y munición a la hora `ammoAt` (lo que se
 * regenera solo se cuenta desde esas horas).
 */
export interface StoredSupplies {
  fuel: number;
  fuelAt: number;
  cannon: number;
  missiles: number;
  ammoAt: number;
  /** Casco de la nave (Fase 10: se guarda; el mismo en el combate de flotas por rondas). */
  hull: number;
}

/** Energía y combustible de una nave que los tiene (la del Emperador; los piratas no). */
interface Reactor {
  energy: number;
  energyAt: number;
  fuel: number;
  fuelAt: number;
}

/** Estado de combate de una nave. Dura aunque salga del sistema (no se cura saliendo y entrando). */
export class Combatant {
  hull: number;
  shield: number;
  lastHitAt = 0;
  readonly weapons = new Map<WeaponKind, WeaponState>();
  /** Siguiente boca de fuego de cada arma (se alternan). */
  private readonly muzzles = new Map<WeaponKind, number>();
  /** Energía y combustible (solo la nave del Emperador). */
  private reactor: Reactor | null = null;
  /** Recursos cambiados desde la última vez que se guardaron. */
  dirty = false;
  /** Los recursos guardados cambiaron fuera (salto cuántico): hay que volver a leerlos antes de usarlos. */
  stale = false;

  constructor(
    readonly hullMax: number,
    readonly combat: ShipCombat,
    now: number,
    /** Recursos guardados de la nave del Emperador; sin ellos, munición llena y sin reactor. */
    supplies?: StoredSupplies,
  ) {
    this.hull = hullMax;
    this.shield = combat.shield;
    for (const def of combat.weapons) this.weapons.set(def.kind, { def, readyAt: 0, ammo: def.ammo, ammoAt: now });
    if (supplies) this.load(supplies, now);
  }

  /** Carga los recursos guardados (al crear la nave o tras un salto). */
  load(s: StoredSupplies, now: number): void {
    this.reactor = { energy: FLAGSHIP_SUPPLIES.energyMax, energyAt: now, fuel: s.fuel, fuelAt: s.fuelAt };
    this.hull = Math.max(0, Math.min(this.hullMax, s.hull));
    const cannon = this.weapons.get("cannon");
    if (cannon && cannon.ammo !== null) Object.assign(cannon, { ammo: s.cannon, ammoAt: s.ammoAt });
    const missile = this.weapons.get("missile");
    if (missile && missile.ammo !== null) Object.assign(missile, { ammo: s.missiles, ammoAt: s.ammoAt });
    this.stale = false;
    this.dirty = false;
  }

  get shieldMax(): number {
    return this.combat.shield;
  }

  get hasReactor(): boolean {
    return this.reactor !== null;
  }

  /** Repone la munición que toque según el tiempo pasado (a bordo, solo hasta su reserva). */
  private regenAmmo(w: WeaponState, now: number): void {
    if (w.ammo === null || w.def.ammo === null || w.def.ammoRegenSec === null) return;
    const cap = Math.min(w.def.ammo, w.def.ammoRegenMax ?? w.def.ammo);
    if (w.ammo >= cap) {
      w.ammoAt = now;
      return;
    }
    const gained = Math.floor((now - w.ammoAt) / (w.def.ammoRegenSec * 1000));
    if (gained <= 0) return;
    w.ammo = Math.min(cap, w.ammo + gained);
    w.ammoAt += gained * w.def.ammoRegenSec * 1000;
    this.dirty = true;
  }

  /** Energía actual (el reactor la recarga sola). */
  energyNow(now: number): number {
    const r = this.reactor;
    if (!r) return 0;
    r.energy = Math.min(FLAGSHIP_SUPPLIES.energyMax, r.energy + (FLAGSHIP_SUPPLIES.energyRegenPerSec * Math.max(0, now - r.energyAt)) / 1000);
    r.energyAt = now;
    return r.energy;
  }

  /** Combustible actual (con la reserva de emergencia que se regenera sola). */
  fuelNow(now: number): number {
    const r = this.reactor;
    if (!r) return 0;
    const fuel = regenFuel(r.fuel, (now - r.fuelAt) / 1000);
    if (fuel !== r.fuel) this.dirty = true;
    r.fuel = fuel;
    r.fuelAt = now;
    return fuel;
  }

  /** Intenta disparar: comprueba cadencia, munición y energía y las gasta. Devuelve el arma, o null si no puede. */
  tryFire(kind: WeaponKind, now: number): WeaponDefinition | null {
    const w = this.weapons.get(kind);
    if (!w) return null;
    this.regenAmmo(w, now);
    if (now < w.readyAt || w.ammo === 0) return null;
    // El cañón de la nave del Emperador gasta energía del reactor en cada disparo.
    if (kind === "cannon" && this.reactor) {
      if (this.energyNow(now) < FLAGSHIP_SUPPLIES.cannonEnergy) return null;
      this.reactor.energy -= FLAGSHIP_SUPPLIES.cannonEnergy;
    }
    w.readyAt = now + w.def.cooldownSec * 1000;
    if (w.ammo !== null) {
      w.ammo--;
      this.dirty = true;
    }
    return w.def;
  }

  /**
   * El pulso ha estado encendido `dtSec` segundos: gasta combustible y energía.
   * Devuelve false si no queda combustible (el pulso no puede funcionar).
   */
  spendPulse(dtSec: number, now: number): boolean {
    const r = this.reactor;
    if (!r) return true;
    const cost = FLAGSHIP_SUPPLIES.pulseFuelPerSec * dtSec;
    if (this.fuelNow(now) < cost || r.fuel <= 0) return false;
    r.fuel = Math.max(0, r.fuel - cost);
    this.energyNow(now);
    r.energy = Math.max(0, r.energy - FLAGSHIP_SUPPLIES.pulseEnergyPerSec * dtSec);
    this.dirty = true;
    return true;
  }

  /** Gasta energía del reactor (láser de minería). False si no hay bastante (no gasta nada). */
  spendEnergy(amount: number, now: number): boolean {
    const r = this.reactor;
    if (!r) return true;
    if (this.energyNow(now) < amount) return false;
    r.energy -= amount;
    return true;
  }

  /**
   * Reposición junto a una colonia: añade combustible, proyectiles y misiles
   * (sin pasar del máximo). Devuelve lo que de verdad cabía.
   */
  refill(add: { fuel: number; cannon: number; missiles: number; hull: number }, now: number): { fuel: number; cannon: number; missiles: number; hull: number } {
    const out = { fuel: 0, cannon: 0, missiles: 0, hull: 0 };
    if (this.hull > 0) {
      out.hull = Math.max(0, Math.min(add.hull, this.hullMax - this.hull));
      this.hull += out.hull;
    }
    if (this.reactor) {
      const fuel = this.fuelNow(now);
      out.fuel = Math.max(0, Math.min(add.fuel, FLAGSHIP_SUPPLIES.fuelMax - fuel));
      this.reactor.fuel = fuel + out.fuel;
    }
    for (const [kind, key] of [
      ["cannon", "cannon"],
      ["missile", "missiles"],
    ] as const) {
      const w = this.weapons.get(kind);
      if (!w || w.ammo === null || w.def.ammo === null) continue;
      this.regenAmmo(w, now);
      out[key] = Math.max(0, Math.min(Math.floor(add[key]), w.def.ammo - w.ammo));
      w.ammo += out[key];
    }
    if (out.fuel > 0 || out.cannon > 0 || out.missiles > 0 || out.hull > 0) this.dirty = true;
    return out;
  }

  /** Lo que falta para tener todo lleno (para pedir a la colonia solo eso). */
  missing(now: number): { fuel: number; cannon: number; missiles: number; hull: number } {
    const ammo = (kind: WeaponKind) => {
      const w = this.weapons.get(kind);
      if (!w || w.ammo === null || w.def.ammo === null) return 0;
      this.regenAmmo(w, now);
      return w.def.ammo - w.ammo;
    };
    return {
      fuel: this.reactor ? FLAGSHIP_SUPPLIES.fuelMax - this.fuelNow(now) : 0,
      cannon: ammo("cannon"),
      missiles: ammo("missile"),
      hull: this.reactor && this.hull > 0 ? this.hullMax - this.hull : 0,
    };
  }

  /** Recursos para guardar (resueltos a la hora `now`). */
  stored(now: number): StoredSupplies {
    for (const w of this.weapons.values()) this.regenAmmo(w, now);
    const ammoAt = Math.min(...[...this.weapons.values()].filter((w) => w.ammo !== null).map((w) => w.ammoAt), now);
    return {
      fuel: this.fuelNow(now),
      fuelAt: now,
      cannon: this.weapons.get("cannon")?.ammo ?? 0,
      missiles: this.weapons.get("missile")?.ammo ?? 0,
      ammoAt,
      hull: this.hull,
    };
  }

  /** Energía y combustible para el piloto. */
  reactorView(now: number): { energy: number; energyMax: number; fuel: number; fuelMax: number } | null {
    if (!this.reactor) return null;
    return { energy: this.energyNow(now), energyMax: FLAGSHIP_SUPPLIES.energyMax, fuel: this.fuelNow(now), fuelMax: FLAGSHIP_SUPPLIES.fuelMax };
  }

  /**
   * Boca de la que sale el siguiente disparo de un arma y su desplazamiento
   * (metros, en ejes de la nave). Sin bocas definidas, del centro.
   */
  nextMuzzle(kind: WeaponKind): { index: number; offset: Vec3 } {
    const list = this.combat.hardpoints?.[kind] ?? [];
    if (list.length === 0) return { index: 0, offset: [0, 0, 0] };
    const index = (this.muzzles.get(kind) ?? 0) % list.length;
    this.muzzles.set(kind, index + 1);
    const o = list[index]!;
    return { index, offset: [o[0], o[1], o[2]] };
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
    const before = this.hull;
    this.hull = Math.max(0, this.hull - (amount - absorbed));
    // El casco de la nave del Emperador se guarda (Fase 10).
    if (this.reactor && this.hull !== before) this.dirty = true;
    return this.hull <= 0;
  }

  /**
   * Reparación a bordo (Fase 10): solo la nave del Emperador, despacio y tras
   * un rato sin recibir daño. Devuelve true si cambió.
   */
  repairHull(dtSec: number, now: number): boolean {
    if (!this.reactor || this.hull <= 0 || this.hull >= this.hullMax) return false;
    if (now - this.lastHitAt < FLAGSHIP_REPAIR.onboardDelaySec * 1000) return false;
    this.hull = Math.min(this.hullMax, this.hull + FLAGSHIP_REPAIR.onboardPerSec * dtSec);
    this.dirty = true;
    return true;
  }

  /**
   * Recarga del escudo tras unos segundos sin recibir daño. Con reactor, cada
   * punto de escudo gasta energía: sin energía, el escudo no se recarga.
   * Devuelve true si cambió.
   */
  regenShield(dtSec: number, now: number): boolean {
    if (this.shield >= this.shieldMax || now - this.lastHitAt < this.combat.shieldDelaySec * 1000) return false;
    let gain = Math.min(this.shieldMax - this.shield, this.combat.shieldRegenPerSec * dtSec);
    if (this.reactor) {
      gain = Math.min(gain, this.energyNow(now) / FLAGSHIP_SUPPLIES.shieldEnergyPerPoint);
      this.reactor.energy -= gain * FLAGSHIP_SUPPLIES.shieldEnergyPerPoint;
    }
    if (gain <= 0) return false;
    this.shield += gain;
    return true;
  }

  /** Nave nueva (al renacer): todo lleno. */
  restore(now: number): void {
    this.hull = this.hullMax;
    this.shield = this.shieldMax;
    this.lastHitAt = 0;
    for (const w of this.weapons.values()) {
      w.ammo = w.def.ammo;
      w.ammoAt = now;
      w.readyAt = 0;
    }
    if (this.reactor) this.reactor = { energy: FLAGSHIP_SUPPLIES.energyMax, energyAt: now, fuel: FLAGSHIP_SUPPLIES.fuelMax, fuelAt: now };
    this.dirty = true;
  }
}

export function normalize(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : null;
}

/** Gira el vector `v` con el cuaternión `q` (x, y, z, w). */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 · (q × v); v' = v + w·t + q × t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
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
