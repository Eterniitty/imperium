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

/**
 * Reputación ante la humanidad (de `min` a `max`): sube derribando Carroñeros
 * y aportando a los proyectos comunes; baja atacando a otros humanos en el
 * Núcleo. Con buena reputación la IA acepta pactos (ser compañeros), incluso
 * la militarista.
 */
export const REPUTATION = {
  min: -100,
  max: 100,
  pirateKill: 1,
  lairKill: 10,
  /** Por cada 1000 créditos aportados a la humanidad. */
  perThousandCredits: 4,
  /** Atacar a otro humano en el Núcleo (una vez por incidente). */
  attackHuman: -8,
  /** Reputación mínima para que un Emperador de la IA acepte un pacto, por personalidad. */
  aiPact: { merchant: -20, expansionist: 0, militarist: 40 } as Record<string, number>,
} as const;
