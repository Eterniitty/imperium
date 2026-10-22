/**
 * Metas (fase 5 del plan de juego): prestigio y clasificación, y objetivos de
 * la era. El prestigio sale de lo que un Emperador ha logrado; llegar a Ónfalo,
 * el agujero negro del centro de la galaxia, es la gran hazaña.
 */

/** Lo que se cuenta de cada Emperador. */
export type MetaStat = "colonies" | "population" | "discoveries" | "ships" | "core";

/** Prestigio por unidad de cada estadística. */
export const PRESTIGE: Record<MetaStat, number> = {
  colonies: 100,
  population: 0.1,
  discoveries: 2,
  ships: 10,
  /** Haber pilotado en el sistema de Ónfalo. */
  core: 5000,
};

/** Objetivos de la era: hitos con su estadística y la cifra que hay que alcanzar. */
export const ERA_GOALS: ReadonlyArray<{ id: string; stat: MetaStat; target: number }> = [
  { id: "first_colony", stat: "colonies", target: 1 },
  { id: "explorer", stat: "discoveries", target: 100 },
  { id: "fleet", stat: "ships", target: 10 },
  { id: "colonies", stat: "colonies", target: 5 },
  { id: "people", stat: "population", target: 10_000 },
  { id: "cartographer", stat: "discoveries", target: 1000 },
  { id: "armada", stat: "ships", target: 50 },
  { id: "core", stat: "core", target: 1 },
];

export function prestigeOf(stats: Record<MetaStat, number>): number {
  return Math.round((Object.keys(PRESTIGE) as MetaStat[]).reduce((a, k) => a + stats[k] * PRESTIGE[k], 0));
}
