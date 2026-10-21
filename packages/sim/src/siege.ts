/**
 * Conquista de planetas (Fase 9b). Reglas puras y deterministas (con la misma
 * entrada y semilla, el mismo resultado); los datos están en
 * `@imperium/content` (conquest.ts) y el servidor las aplica en sus eventos
 * `siege.tick` y en la orden `siege.assault`.
 *
 * - **Asedio**: el progreso (0 → 1) sube cada hora de juego
 *   `ataque / (ataque + defensa) / SIEGE.baseHours`, mientras el atacante
 *   mantenga naves armadas en el sistema sin defensores armados.
 * - **Defensas**: las plataformas defensivas dañan cada hora a las naves que
 *   asedian (un impacto por plataforma y resolución, a una nave al azar).
 * - **Desembarco**: con el asedio completo, las tropas (humanos) combaten
 *   contra la milicia y la guarnición; si son más, toman el planeta.
 * - **Captura**: población, instalaciones y existencias pasan al conquistador
 *   con pérdidas.
 */
import { getAnyShipClass, INSTALLATION_DEFENSE, SIEGE, type InstallationId, type StockAmounts } from "@imperium/content";
import type { InstallationCounts } from "./economy";

/** Generador pseudoaleatorio de 32 bits (mulberry32): solo operaciones enteras. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Semilla de la resolución número `step` de un asedio con semilla `siegeSeed`. */
export function siegeStepSeed(siegeSeed: number, step: number): number {
  return (Math.imul(siegeSeed >>> 0, 0x27d4eb2f) ^ Math.imul(step + 1, 0x165667b1)) >>> 0;
}

/** Suma de una propiedad de las instalaciones defensivas. */
function defenseSum(installations: InstallationCounts, key: "defense" | "attackPerHour" | "garrison"): number {
  let total = 0;
  for (const [id, def] of Object.entries(INSTALLATION_DEFENSE)) total += (def?.[key] ?? 0) * (installations[id as InstallationId] ?? 0);
  return total;
}

/** Defensa de una colonia contra un asedio: base + población + instalaciones defensivas. */
export function colonyDefense(population: number, installations: InstallationCounts): number {
  return SIEGE.defenseBase + SIEGE.defensePerPopulation * Math.max(0, population) + defenseSum(installations, "defense");
}

/** Daño por hora de juego que hacen las defensas de una colonia a quien la asedia. */
export function colonyDefenseFire(installations: InstallationCounts): number {
  return defenseSum(installations, "attackPerHour");
}

/** Fuerza de asedio de unas naves: la suma de su ataque (humanas o alienígenas). */
export function siegePower(classIds: readonly string[]): number {
  let total = 0;
  for (const id of classIds) total += getAnyShipClass(id)?.attack ?? 0;
  return total;
}

/** Progreso del asedio por hora de juego con esta fuerza y esta defensa. */
export function siegeProgressPerHour(attack: number, defense: number): number {
  if (!(attack > 0)) return 0;
  return attack / (attack + Math.max(0, defense)) / SIEGE.baseHours;
}

/** Horas de juego que faltan para completar el asedio (Infinity si no avanza). */
export function siegeHoursLeft(progress: number, attack: number, defense: number): number {
  const rate = siegeProgressPerHour(attack, defense);
  return rate > 0 ? Math.max(0, 1 - progress) / rate : Infinity;
}

/** Nave que asedia, para el daño de las defensas. */
export interface SiegeShip {
  id: string;
  hull: number;
}

/**
 * Daño de las defensas de la colonia en `hours` horas de juego: un impacto por
 * plataforma (con su parte del daño, redondeada) a una nave al azar que siga
 * en pie. Devuelve el casco nuevo de las naves tocadas y las destruidas (por id).
 */
export function siegeAttrition(
  ships: readonly SiegeShip[],
  installations: InstallationCounts,
  hours: number,
  seed: number,
): { hull: Record<string, number>; destroyed: string[]; dealt: number } {
  const hull = new Map<string, number>();
  const ordered = [...ships].filter((s) => s.hull > 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of ordered) hull.set(s.id, s.hull);
  let dealt = 0;
  const next = rng(seed);
  for (const [id, def] of Object.entries(INSTALLATION_DEFENSE)) {
    const count = installations[id as InstallationId] ?? 0;
    const damage = Math.round((def?.attackPerHour ?? 0) * Math.max(0, hours));
    if (damage <= 0) continue;
    for (let i = 0; i < count; i++) {
      const alive = ordered.filter((s) => hull.get(s.id)! > 0);
      if (alive.length === 0) break;
      const target = alive[next() % alive.length]!;
      const h = hull.get(target.id)!;
      const hit = Math.min(h, damage);
      hull.set(target.id, h - hit);
      dealt += hit;
    }
  }
  const destroyed = ordered.filter((s) => hull.get(s.id)! <= 0).map((s) => s.id);
  const changed: Record<string, number> = {};
  for (const s of ordered) if (hull.get(s.id) !== s.hull) changed[s.id] = hull.get(s.id)!;
  return { hull: changed, destroyed, dealt };
}

/** Defensores de un planeta contra un desembarco: la milicia (parte de la población) y la guarnición de las defensas. */
export function planetDefenders(population: number, installations: InstallationCounts): number {
  return Math.round(Math.max(0, population) * SIEGE.militiaShare + defenseSum(installations, "garrison"));
}

/** Resultado de un desembarco. */
export interface AssaultResult {
  /** Las tropas toman el planeta. */
  captured: boolean;
  /** Defensores que había. */
  defenders: number;
  /** Tropas que caen. */
  attackerLosses: number;
  /** Habitantes que caen (la milicia; la guarnición de las plataformas no es población). */
  populationLosses: number;
  /** Tropas que sobreviven (si se toma el planeta, se quedan como colonos). */
  survivors: number;
}

/**
 * Desembarco de `troops` humanos en un planeta asediado. Si superan a los
 * defensores, lo toman: caen `attackerLossPerDefender` por defensor y la
 * milicia entera. Si no, caen todas las tropas y se llevan por delante a
 * `defenderLossPerAttacker` habitantes por soldado.
 */
export function resolveAssault(troops: number, population: number, installations: InstallationCounts): AssaultResult {
  const t = Math.max(0, Math.floor(troops));
  const defenders = planetDefenders(population, installations);
  const militia = Math.min(Math.max(0, population), Math.round(Math.max(0, population) * SIEGE.militiaShare));
  if (t > defenders) {
    const attackerLosses = Math.min(t, Math.round(defenders * SIEGE.attackerLossPerDefender));
    return { captured: true, defenders, attackerLosses, populationLosses: militia, survivors: t - attackerLosses };
  }
  const populationLosses = Math.min(militia, Math.round(t * SIEGE.defenderLossPerAttacker));
  return { captured: false, defenders, attackerLosses: t, populationLosses, survivors: 0 };
}

/**
 * Pérdidas de la captura: parte de la población (además de `extraPopulationLoss`,
 * p. ej. la ocupación alienígena), de las existencias y de las instalaciones
 * (cada una cae con probabilidad `installationLoss`, con la semilla). Devuelve
 * lo que queda y los ids de las instalaciones destruidas.
 */
export function captureLosses(
  population: number,
  stock: StockAmounts,
  installationIds: readonly string[],
  seed: number,
  extraPopulationLoss = 0,
): { population: number; stock: StockAmounts; destroyed: string[] } {
  const keep = Math.max(0, 1 - SIEGE.capture.populationLoss - extraPopulationLoss);
  const next = rng(seed);
  const destroyed: string[] = [];
  const threshold = Math.round(SIEGE.capture.installationLoss * 1000);
  for (const id of [...installationIds].sort()) if (next() % 1000 < threshold) destroyed.push(id);
  const s = 1 - SIEGE.capture.stockLoss;
  return {
    population: Math.max(0, population * keep),
    stock: { metal: stock.metal * s, volatiles: stock.volatiles * s, crystal: stock.crystal * s, alloys: stock.alloys * s },
    destroyed,
  };
}
