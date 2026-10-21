/**
 * Proporciones de los cascos y bocas de fuego de las naves (humanas y
 * alienígenas) a partir de sus pistas de modelo (`ShipModelHints`). Son datos
 * derivados de forma determinista: el servidor dispara desde estas bocas y el
 * modelo procedural del cliente pone los cañones y lanzadores justo ahí.
 */
import type { HullShape, Offset3, ShipHardpoints, ShipModelHints, WeaponDefinition } from "./types";

export interface HullProportions {
  /** Manga (anchura) y puntal (altura) como fracción de la eslora. */
  width: number;
  height: number;
  /** Cañones del morro: separación lateral (fracción de la manga) y avance (fracción de la eslora, negativo hacia el morro). */
  gunX: number;
  gunZ: number;
}

/** Proporciones de cada forma de casco (eslora 1, morro hacia -Z). */
export const HULL_PROPORTIONS: Readonly<Record<HullShape, HullProportions>> = {
  needle: { width: 0.22, height: 0.14, gunX: 0.42, gunZ: -0.42 },
  wedge: { width: 0.5, height: 0.16, gunX: 0.3, gunZ: -0.36 },
  disc: { width: 1, height: 0.22, gunX: 0.18, gunZ: -0.42 },
  spindle: { width: 0.26, height: 0.24, gunX: 0.45, gunZ: -0.36 },
  shard: { width: 0.3, height: 0.3, gunX: 0.3, gunZ: -0.38 },
  pod: { width: 0.3, height: 0.28, gunX: 0.45, gunZ: -0.38 },
  crescent: { width: 0.9, height: 0.15, gunX: 0.42, gunZ: -0.2 },
  monolith: { width: 0.28, height: 0.22, gunX: 0.4, gunZ: -0.44 },
  ring: { width: 1, height: 0.2, gunX: 0.12, gunZ: -0.45 },
  brick: { width: 0.42, height: 0.3, gunX: 0.4, gunZ: -0.44 },
};

/** Largo del cañón de una torreta, como fracción de la eslora (la boca está en su punta). */
export const TURRET_BARREL = 0.06;

/**
 * Bocas de fuego de una nave según su modelo y sus armas, en metros respecto al
 * centro (x derecha, y arriba, -z hacia el morro):
 * - con torretas (naves grandes), una boca por torreta, por parejas a lo largo del lomo;
 * - si no, dos cañones en el morro (en las raíces de las alas si las tiene);
 * - los misiles, dos lanzadores bajo los costados (o las alas).
 */
export function shipHardpoints(model: ShipModelHints, weapons: readonly WeaponDefinition[]): ShipHardpoints {
  const L = model.lengthM;
  const p = HULL_PROPORTIONS[model.hullShape];
  const W = p.width * L;
  const H = p.height * L;
  const r = (x: number, y: number, z: number): Offset3 => [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100];
  const cannon: Offset3[] = [];
  const missile: Offset3[] = [];
  if (weapons.some((w) => w.kind === "cannon")) {
    const turrets = model.turrets ?? 0;
    if (turrets > 0) {
      for (let i = 0; i < turrets; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const row = Math.floor(i / 2);
        const x = turrets === 1 ? 0 : side * W * 0.22;
        cannon.push(r(x, H * 0.5 + L * 0.03, -L * 0.3 + row * L * 0.22 - L * TURRET_BARREL));
      }
    } else {
      const x = model.wings ? W * 0.5 + L * 0.06 : W * p.gunX;
      for (const side of [1, -1]) cannon.push(r(side * x, -H * 0.1, L * p.gunZ));
    }
  }
  if (weapons.some((w) => w.kind === "missile")) {
    const x = model.wings ? W * 0.5 + L * 0.16 : W * 0.5;
    for (const side of [1, -1]) missile.push(r(side * x, -H * 0.4, -L * 0.05));
  }
  return { cannon, missile };
}

/** Completa las bocas de fuego de cada clase que no las traiga a mano (las calcula de su modelo). */
export function withHardpoints<T extends { model: ShipModelHints; combat: { weapons: WeaponDefinition[]; hardpoints?: ShipHardpoints } }>(classes: T[]): T[] {
  return classes.map((c) => (c.combat.hardpoints ? c : { ...c, combat: { ...c.combat, hardpoints: shipHardpoints(c.model, c.combat.weapons) } }));
}
