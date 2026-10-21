import type { ShipClassId } from "./types";

/** Una oferta de los mercenarios: qué naves, cuánto cuesta y cuánto dura el contrato. */
export interface MercenaryOffer {
  id: string;
  nameKey: string;
  /** Naves de la compañía: clase y cuántas. */
  ships: ReadonlyArray<readonly [ShipClassId, number]>;
  /** Precio del contrato (créditos, se paga al firmar). */
  credits: number;
  /** Duración del contrato (horas de juego); al acabar, la flota se marcha (si está en batalla, al terminarla). */
  hours: number;
}

/**
 * Mercenarios (fase 3 del plan, «Aliados de verdad»): compañías que se
 * contratan con créditos donde esté la nave del Emperador. Aparecen allí como
 * una flota propia más (se puede mover, interceptar, asediar y pilotar a
 * distancia), pero se marchan al acabar el contrato.
 */
export const MERCENARIES = {
  /** Contratos a la vez por Emperador. */
  maxActive: 2,
  offers: [
    { id: "skirmishers", nameKey: "mercenary.skirmishers", ships: [["corvette", 4]], credits: 600, hours: 6 },
    { id: "line", nameKey: "mercenary.line", ships: [["frigate", 2], ["destroyer", 1]], credits: 1500, hours: 6 },
    { id: "heavy", nameKey: "mercenary.heavy", ships: [["destroyer", 2], ["cruiser", 1]], credits: 3500, hours: 8 },
  ] satisfies MercenaryOffer[],
} as const;

/** Busca una oferta de mercenarios por id. */
export function getMercenaryOffer(id: string): MercenaryOffer | undefined {
  return MERCENARIES.offers.find((o) => o.id === id);
}
