/**
 * Contratos (`docs/juego-solitario.md`): encargos que el jugador acepta del
 * tablero y cumple jugando, solo o acompañado. Las ofertas se generan cada día
 * (de forma determinista por Emperador) y caducan si no se cumplen a tiempo.
 * Todo son plantillas: sin texto libre.
 */
export type ContractKind = "hunt" | "explore" | "mine";

export interface ContractKindDef {
  /** Objetivos posibles (de fácil a difícil). */
  targets: readonly number[];
  /** Créditos por unidad del objetivo. */
  creditsPer: number;
  /** Reputación ante la humanidad al cumplirlo (por nivel de dificultad: índice del objetivo + 1). */
  reputationPerTier: number;
  /** Horas reales para cumplirlo desde que se acepta. */
  hours: number;
  /** Peso al sortear las ofertas del día. */
  weight: number;
}

export const CONTRACTS = {
  /** Ofertas nuevas cada día. */
  offersPerDay: 4,
  /** Contratos en curso a la vez, como mucho. */
  maxActive: 3,
  kinds: {
    /** Derribar Carroñeros (en cualquier sistema). */
    hunt: { targets: [2, 4, 7], creditsPer: 140, reputationPerTier: 2, hours: 48, weight: 3 },
    /** Descubrir sistemas nuevos (con la nave, flotas o sondas). */
    explore: { targets: [1, 3, 6], creditsPer: 160, reputationPerTier: 1, hours: 72, weight: 3 },
    /** Extraer mineral en el espacio profundo (unidades a la bodega). */
    mine: { targets: [40, 100, 220], creditsPer: 5, reputationPerTier: 1, hours: 48, weight: 2 },
  } satisfies Record<ContractKind, ContractKindDef>,
} as const;
