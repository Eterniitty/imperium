/**
 * Modelo de vuelo de la nave del Emperador (pilotaje dentro de un sistema).
 * Lo usan el cliente (`ShipController`) y, para validar, el servidor
 * (`@imperium/sim` flight.ts: `PILOT_SPEED`, `PILOT_BOOST`). Los ajustes del
 * jugador (Ajustes → Controles) escalan la aceleración, la inercia y la
 * velocidad máxima, nunca por encima de estas cifras.
 */
export const FLIGHT_MODEL = {
  /** Velocidad máxima de maniobra (m/s) y multiplicador del impulso (Mayús). */
  maxSpeed: 250,
  boostFactor: 4,
  /** Las maniobras laterales y verticales llegan a esta fracción de la velocidad máxima. */
  lateralSpeedFactor: 0.6,
  /** Aceleración de los propulsores (m/s²): principal (avance), de frenado y laterales/verticales. */
  mainAccel: 110,
  reverseAccel: 80,
  lateralAccel: 60,
  /** El impulso multiplica también la aceleración. */
  boostAccelFactor: 2.5,
  /**
   * Asistencia de vuelo: rapidez (1/s) con la que los propulsores corrigen la
   * diferencia entre la velocidad pedida y la real. Dividida entre la «inercia»
   * de los ajustes.
   */
  assistGain: 2.2,
  /** Velocidades de giro máximas (rad/s) y aceleración angular de los propulsores de maniobra (rad/s²). */
  pitchRate: 0.95,
  yawRate: 0.8,
  rollRate: 1.6,
  angularAccel: 3.2,
  /** Pilotaje con ratón: píxeles desde el punto pulsado para el giro máximo. */
  mouseStickPx: 160,
  /** Paso fijo de la integración (s): la física se calcula en subpasos de este tamaño. */
  substep: 1 / 120,
  /** Al apagar el pulso, la velocidad sobrante se pierde con esta rapidez (1/s). */
  pulseDumpRate: 2,
} as const;
