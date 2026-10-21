/**
 * Datos de la Fase 9b: conquista de planetas ajenos (asedio, defensas de las
 * colonias, desembarco de tropas y captura). Solo números; las reglas que los
 * usan están en `@imperium/sim` (siege.ts) y el servidor las aplica en
 * `apps/server/src/war/siege.ts`.
 *
 * Todas las tasas son por hora de juego (el servidor las multiplica por `TIME_SCALE`).
 */
import type { InstallationId } from "./economy";

/** Lo que aporta cada instalación defensiva de una colonia. */
export interface InstallationDefense {
  /** Puntos de defensa contra el asedio (frenan el progreso). */
  defense: number;
  /** Daño por hora de juego al casco de las naves que asedian la colonia. */
  attackPerHour: number;
  /** Soldados que defienden el planeta contra un desembarco (además de la milicia). */
  garrison: number;
}

/** Instalaciones con valor defensivo (las demás no defienden). */
export const INSTALLATION_DEFENSE: Partial<Record<InstallationId, InstallationDefense>> = {
  defense_platform: { defense: 60, attackPerHour: 30, garrison: 40 },
};

/**
 * Asedio: una flota armada parada en el sistema de una colonia ajena la
 * bloquea y bombardea; el progreso (0 → 1) sube cada hora de juego
 * `ataque / (ataque + defensa) / baseHours`. Con el progreso completo se
 * pueden desembarcar tropas (humanos transportados: Ley II).
 */
export const SIEGE = {
  /** Horas de juego del asedio con una fuerza abrumadora; con ataque igual a la defensa, el doble. */
  baseHours: 3,
  /** Cada cuánto se resuelve un asedio (minutos de juego). */
  tickGameMinutes: 20,
  /** Defensa de cualquier colonia (sin instalaciones ni población). */
  defenseBase: 20,
  /** Defensa por cada habitante (la población se organiza). */
  defensePerPopulation: 0.02,
  /** Parte de la población que combate contra un desembarco (milicia). */
  militiaShare: 0.1,
  /** Tropas atacantes que caen por cada defensor al tomar el planeta. */
  attackerLossPerDefender: 0.8,
  /** Defensores que caen por cada soldado de un desembarco que fracasa. */
  defenderLossPerAttacker: 0.8,
  /** Pérdidas al tomar el planeta (captura, no destrucción): parte de la población, de las existencias y de las instalaciones. */
  capture: { populationLoss: 0.1, stockLoss: 0.25, installationLoss: 0.2 },
  /**
   * Bombardeo orbital (`siege.raze`): con el asedio listo, en vez de asaltar se
   * destruye una instalación elegida (la Cuna de linaje, una plataforma…) sin
   * tomar la colonia; el asedio vuelve a este progreso.
   */
  razeProgressAfter: 0.5,
  /**
   * Protección de los Emperadores nuevos: durante sus primeras horas de juego
   * nadie puede asediar sus colonias (igual que la gracia de las facciones).
   */
  noviceGraceHours: 24,
  /** Asedios terminados que se siguen mostrando: los de las últimas horas reales. */
  recentHours: 6,
} as const;

/** Asedios de las facciones alienígenas a colonias humanas de su territorio. */
export const ALIEN_SIEGE = {
  /** Probabilidad por decisión de la región (multiplicada por la agresividad de la facción) de empezar o preparar un asedio. */
  chancePerTick: 0.25,
  /** Asedios a la vez como mucho por región. */
  maxPerRegion: 2,
  /** Al ocupar una colonia (no desembarcan humanos: la toman con sus tropas), parte de la población que muere además de la de la captura. */
  occupationPopulationLoss: 0.25,
  /** Rencor que suma asediar una colonia que ocupa una facción. */
  grudge: 1,
} as const;

/** Errores de coherencia de los datos de conquista (vacío si todo está bien). */
export function validateConquest(): string[] {
  const errors: string[] = [];
  const unit = (name: string, v: number) => {
    if (!(v >= 0 && v <= 1)) errors.push(`${name} fuera de [0,1]`);
  };
  if (!(SIEGE.baseHours > 0)) errors.push("SIEGE.baseHours debe ser > 0");
  if (!(SIEGE.tickGameMinutes > 0)) errors.push("SIEGE.tickGameMinutes debe ser > 0");
  unit("SIEGE.militiaShare", SIEGE.militiaShare);
  unit("SIEGE.capture.populationLoss", SIEGE.capture.populationLoss);
  unit("SIEGE.capture.stockLoss", SIEGE.capture.stockLoss);
  unit("SIEGE.capture.installationLoss", SIEGE.capture.installationLoss);
  unit("ALIEN_SIEGE.chancePerTick", ALIEN_SIEGE.chancePerTick);
  unit("ALIEN_SIEGE.occupationPopulationLoss", ALIEN_SIEGE.occupationPopulationLoss);
  for (const [id, d] of Object.entries(INSTALLATION_DEFENSE)) {
    if (!d || !(d.defense >= 0 && d.attackPerHour >= 0 && d.garrison >= 0)) errors.push(`defensa de ${id}: valores negativos`);
  }
  return errors;
}
