/**
 * Colonias que piden cosas (`docs/juego-solitario.md`, prioridad 6): de vez en
 * cuando una colonia propia hace una petición con plazo. Lo decide el servidor
 * (con el recálculo periódico de la cartera), también sin el jugador.
 *
 * - Escasez: hay que llevarle un recurso. Cuenta lo que descarga la nave del
 *   Emperador y lo que descargan las flotas traído de otro sistema (la misma
 *   regla que los contratos de reparto).
 * - Malestar: se calma pagando créditos.
 *
 * Cumplirla da población, reputación y experiencia; si vence el plazo, la
 * colonia pierde población.
 */
export type ColonyRequestKind = "shortage" | "unrest";

export const COLONY_REQUESTS = {
  /** Probabilidad, en cada recálculo (una vez por hora de juego), de que una colonia pida algo. */
  chancePerHour: 0.08,
  /** Peticiones abiertas a la vez por Emperador, como mucho (una por colonia). */
  maxActive: 2,
  /** Solo las colonias con al menos esta población. */
  minPopulation: 50,
  /** Horas para cumplirla. */
  hours: 24,
  /** Peso de cada tipo al sortear. */
  weights: { shortage: 3, unrest: 1 } satisfies Record<ColonyRequestKind, number>,
  /** Escasez: recursos posibles y cantidad según la población (entre `min` y `max`). */
  shortage: { resources: ["metal", "volatiles", "crystal", "alloys"] as const, perPop: 0.5, min: 50, max: 600 },
  /** Malestar: créditos según la población (entre `min` y `max`). */
  unrest: { creditsPerPop: 1.5, min: 100, max: 2000 },
  /** Al cumplirla: población (en %, sin pasar del tope), reputación y experiencia. */
  reward: { popPct: 5, reputation: 2, xp: 25 },
  /** Si vence el plazo: población perdida (en %). */
  penalty: { popPct: 10 },
} as const;

export type ShortageResource = (typeof COLONY_REQUESTS.shortage.resources)[number];
