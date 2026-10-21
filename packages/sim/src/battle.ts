/**
 * Combate de flotas por rondas (Fase 9a). Reglas puras y deterministas: con
 * los mismos bandos y la misma semilla, el resultado es siempre el mismo. El
 * servidor las aplica en cada evento `battle.round`; los datos de las naves
 * (ataque, escudo de batalla, casco) están en `@imperium/content`.
 *
 * Una ronda: todas las naves disparan a la vez (las que caen en la ronda
 * también disparan). Cada nave con ataque elige al azar una nave enemiga que
 * siga en pie y le hace `ataque ± dispersión` de daño; el escudo de batalla del
 * objetivo absorbe daño hasta agotarse en esa ronda y el resto va al casco.
 * Con el casco a 0, la nave queda destruida.
 */
import { FLEET_BATTLE, getAnyShipClass } from "@imperium/content";

/** Nave en una batalla. */
export interface BattleShip {
  id: string;
  /** Clase (para los informes de pérdidas). */
  classId: string;
  /** Daño base de su disparo en cada ronda (0 = no dispara). */
  attack: number;
  /** Daño que absorbe su escudo en cada ronda. */
  shield: number;
  /** Casco actual (entero). */
  hull: number;
}

/** Resultado de una ronda. */
export interface BattleRoundResult {
  /** Casco de cada nave tras la ronda (las destruidas, 0). */
  hull: Record<string, number>;
  /** Naves destruidas en la ronda, en orden de id. */
  destroyed: string[];
  /** Daño al casco que ha hecho cada bando. */
  dealt: [number, number];
  /** Daño que han absorbido los escudos de cada bando. */
  absorbed: [number, number];
  /** Naves perdidas por cada bando, por clase. */
  lost: [Record<string, number>, Record<string, number>];
}

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

/** Semilla de la ronda `round` de una batalla con semilla `battleSeed`. */
export function battleRoundSeed(battleSeed: number, round: number): number {
  return (Math.imul(battleSeed >>> 0, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0;
}

/** Nave de batalla con los datos de su clase (ataque y escudo; humana o alienígena) y su casco actual. */
export function battleShip(id: string, classId: string, hull: number, /** Multiplicador del escudo (Defensas del Núcleo). */ shieldFactor = 1): BattleShip {
  const cls = getAnyShipClass(classId);
  return { id, classId, attack: cls?.attack ?? 0, shield: (cls?.battleShield ?? 0) * shieldFactor, hull };
}

/** ¿Puede este bando hacer daño? (alguna nave con ataque). */
export function canAttack(side: readonly BattleShip[]): boolean {
  return side.some((s) => s.attack > 0 && s.hull > 0);
}

const byId = (a: BattleShip, b: BattleShip) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Resuelve una ronda entre dos bandos. No modifica la entrada. El orden de las
 * naves de entrada no importa (se ordenan por id).
 */
export function resolveBattleRound(sides: readonly [readonly BattleShip[], readonly BattleShip[]], seed: number): BattleRoundResult {
  const next = rng(seed);
  const spread = FLEET_BATTLE.damageSpreadPct;
  const ordered = [sides[0].filter((s) => s.hull > 0).sort(byId), sides[1].filter((s) => s.hull > 0).sort(byId)] as const;
  const hull = new Map<string, number>();
  const shield = new Map<string, number>();
  for (const side of ordered)
    for (const s of side) {
      hull.set(s.id, s.hull);
      shield.set(s.id, s.shield);
    }
  const dealt: [number, number] = [0, 0];
  const absorbed: [number, number] = [0, 0];

  for (const from of [0, 1] as const) {
    const enemies = ordered[from === 0 ? 1 : 0];
    for (const shooter of ordered[from]) {
      if (shooter.attack <= 0) continue;
      // Objetivos: los enemigos que siguen en pie (así no se malgastan disparos).
      const alive = enemies.filter((e) => hull.get(e.id)! > 0);
      if (alive.length === 0) break;
      const target = alive[next() % alive.length]!;
      // Daño: ataque ± dispersión, redondeado (entero).
      const pct = 100 - spread + (next() % (2 * spread + 1));
      const damage = Math.round((shooter.attack * pct) / 100);
      const s = shield.get(target.id)!;
      const blocked = Math.min(s, damage);
      shield.set(target.id, s - blocked);
      const h = hull.get(target.id)!;
      const toHull = Math.min(h, damage - blocked);
      hull.set(target.id, h - toHull);
      dealt[from] += toHull;
      absorbed[from === 0 ? 1 : 0] += blocked;
    }
  }

  const destroyed: string[] = [];
  const lost: [Record<string, number>, Record<string, number>] = [{}, {}];
  ordered.forEach((side, i) => {
    for (const s of side) {
      if (hull.get(s.id)! > 0) continue;
      destroyed.push(s.id);
      lost[i]![s.classId] = (lost[i]![s.classId] ?? 0) + 1;
    }
  });
  destroyed.sort();
  return { hull: Object.fromEntries(hull), destroyed, dealt, absorbed, lost };
}

/** Milisegundos reales entre dos rondas con la escala de tiempo `timeScale`. */
export function battleRoundMs(timeScale: number): number {
  return Math.max(250, Math.round((FLEET_BATTLE.roundGameSeconds * 1000) / timeScale));
}
