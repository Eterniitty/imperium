/**
 * Objetivos del día y de la semana (`docs/juego-solitario.md`, prioridad 4):
 * cada día tres objetivos pequeños y cada semana uno grande, iguales para el
 * mismo Emperador durante ese periodo (deterministas). Se cumplen solos al
 * jugar (los empujan los mismos sucesos que los contratos) y pagan experiencia
 * y créditos. Cumplir los tres del día seguidos varios días hace una racha que
 * sube la experiencia de los objetivos.
 */
export type GoalKind = "hunt" | "explore" | "mine" | "contract";

export interface GoalPeriodDef {
  /** Objetivos posibles por tipo (se elige uno al azar). */
  kinds: Record<GoalKind, readonly number[]>;
  xp: number;
  credits: number;
}

export const GOALS = {
  /** Objetivos del día (de tipos distintos). */
  dailyCount: 3,
  daily: {
    kinds: { hunt: [1, 2, 3], explore: [1, 2], mine: [20, 50], contract: [1] },
    xp: 20,
    credits: 100,
  } satisfies GoalPeriodDef,
  weekly: {
    kinds: { hunt: [10, 15], explore: [5, 8], mine: [200, 400], contract: [3, 5] },
    xp: 150,
    credits: 800,
  } satisfies GoalPeriodDef,
  /** Experiencia de más por cada día de racha (en %), hasta `streakMaxPct`. */
  streakBonusPct: 10,
  streakMaxPct: 50,
} as const;

/** Experiencia de un objetivo con la racha actual. */
export function goalXp(base: number, streak: number): number {
  return Math.round(base * (1 + Math.min(GOALS.streakMaxPct, Math.max(0, streak) * GOALS.streakBonusPct) / 100));
}
