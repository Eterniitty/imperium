/**
 * Emperadores humanos de la IA (Fase 11, ver docs/ia-naves.md §6b): llenan el
 * universo para que se sienta vivo con pocos jugadores. Juegan con las mismas
 * reglas y órdenes que un jugador (reclamar, construir, explorar, comerciar),
 * sin ver lo que oculta la niebla de guerra. Solo datos: la lógica está en el
 * servidor (`apps/server/src/ai/emperors.ts`).
 */
import type { InstallationId } from "./economy";
import type { ShipClassId } from "./types";

/** Forma de jugar de un Emperador de la IA. */
export type AiPersonality = "expansionist" | "merchant" | "militarist";

export interface AiPersonalityDefinition {
  /** Colonias a las que aspira. */
  maxColonies: number;
  /** Instalaciones que quiere en cada colonia, en orden (se repiten hasta el número indicado). */
  buildOrder: ReadonlyArray<readonly [InstallationId, number]>;
  /** Naves que mantiene construidas (además de los colonizadores). */
  ships: ReadonlyArray<readonly [ShipClassId, number]>;
  /** Vende los excedentes y compra lo que le falta en el mercado. */
  trades: boolean;
  /** Probabilidad de mandar a explorar su explorador en cada decisión. */
  explore: number;
  /** Fase 9b: envía sus naves armadas a romper los asedios a sus colonias. */
  defends: boolean;
  /**
   * Fase 9b: conquista colonias ajenas fuera del Núcleo Humano (independientes
   * o de Emperadores que no son compañeros ni están en su gracia) cuando reúne
   * `minWarships` naves armadas; desembarca los colonos de un colonizador.
   */
  war: { minWarships: number; rangeLy: number } | null;
}

export const AI_PERSONALITIES: Readonly<Record<AiPersonality, AiPersonalityDefinition>> = {
  expansionist: {
    maxColonies: 4,
    buildOrder: [["mine", 1], ["power_plant", 1], ["mine", 2], ["shipyard", 1], ["refinery", 1], ["mine", 3]],
    ships: [],
    trades: false,
    explore: 0.6,
    defends: true,
    war: null,
  },
  merchant: {
    maxColonies: 2,
    buildOrder: [["mine", 2], ["power_plant", 1], ["refinery", 1], ["mine", 3], ["shipyard", 1], ["power_plant", 2]],
    ships: [["freighter", 1], ["corvette", 1]],
    trades: true,
    explore: 0.3,
    defends: true,
    war: null,
  },
  militarist: {
    maxColonies: 2,
    buildOrder: [["mine", 1], ["power_plant", 1], ["shipyard", 1], ["mine", 3], ["refinery", 1], ["power_plant", 2], ["defense_platform", 1]],
    ships: [["frigate", 2], ["corvette", 2], ["destroyer", 1]],
    trades: false,
    explore: 0.4,
    defends: true,
    war: { minWarships: 3, rangeLy: 45 },
  },
};

/** Los Emperadores de la IA (nombres propios: no se traducen). */
export const AI_EMPERORS: ReadonlyArray<{ name: string; personality: AiPersonality }> = [
  { name: "Casio Varn", personality: "expansionist" },
  { name: "Ilsa Moran", personality: "merchant" },
  { name: "Teodor Quill", personality: "militarist" },
  { name: "Nerea Solace", personality: "expansionist" },
  { name: "Aurek Dane", personality: "merchant" },
  { name: "Mireia Kade", personality: "militarist" },
];

/** Parámetros comunes de los Emperadores de la IA (horas de juego). */
export const AI_EMPEROR = {
  /** Cada cuánto decide cada uno. */
  decideEveryHours: 1,
  /** Habitabilidad mínima de los planetas que reclama. */
  minHabitability: 0.25,
  /** Distancia a la que manda explorar o colonizar (a.l.). */
  rangeLy: 45,
  /** Vende lo que pase de esta fracción de su almacén. */
  sellAbove: 0.6,
  /** Fracción del excedente que pone a la venta cada vez. */
  sellShare: 0.25,
  /** Precio: el último del mercado menos este margen (vende algo barato para que se mueva). */
  priceSpread: 0.05,
  /** Humanos que desembarca al reclamar con su nave (además de los mínimos). */
  extraColonists: 20,
} as const;
