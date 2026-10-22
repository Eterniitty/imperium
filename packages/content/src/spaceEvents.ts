/**
 * Sucesos en el espacio (`docs/juego-solitario.md`, prioridad 3): mientras se
 * pilota (al llegar a un sistema o de vez en cuando) aparece una señal cerca de
 * la nave. Los decide el servidor y viven en memoria, como los Carroñeros del
 * espacio local: si nadie pilota, no pasa nada.
 *
 * - Restos con carga: llegar a la señal y quedarse junto a ella da mineral a la
 *   bodega y experiencia.
 * - Señal de socorro: se elige acudir o no. Acudir paga créditos, reputación y
 *   experiencia; fuera del Núcleo Humano puede ser una trampa de Carroñeros.
 */
export type SpaceEventKind = "salvage" | "distress";

export const SPACE_EVENTS = {
  /** Probabilidad de un suceso al salir de la grieta en un sistema. */
  chanceOnArrival: 0.4,
  /** Pilotando sin suceso: cada cuántos minutos se tira el dado, y con qué probabilidad sale. */
  checkEveryMin: 8,
  chancePerCheck: 0.3,
  /** Minutos sin sucesos tras uno (salga como salga). */
  cooldownMin: 10,
  /** Distancia (m) a la que aparece la señal, entre estos dos valores. */
  distanceM: [40_000, 120_000] as const,
  /** Hay que estar a menos de `reachM` metros de la señal `holdSec` segundos. */
  reachM: 3000,
  holdSec: 5,
  /** Minutos hasta que la señal se pierde. */
  expiresMin: 15,
  /** Peso de cada suceso al sortear. */
  weights: { salvage: 3, distress: 2 } satisfies Record<SpaceEventKind, number>,
  /** Restos: unidades de mineral a la bodega (entre estos valores) y experiencia. */
  salvage: { units: [30, 90] as const, xp: 15 },
  /** Socorro: recompensa al rescatar y probabilidad de trampa (solo fuera del Núcleo, si hay Carroñeros). */
  distress: { credits: 400, reputation: 2, xp: 25, trapChance: 0.3 },
} as const;
