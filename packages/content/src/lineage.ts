/**
 * Datos de la Fase 10: muerte y linaje (docs/diseno.md §3, docs/lore.md §II).
 * Solo números; las reglas están en `@imperium/sim` (lineage.ts) y el servidor
 * las aplica en `apps/server/src/lineage/service.ts`.
 *
 * Ley I (Persistencia): el Emperador muere, pero renace en una **Cuna de
 * linaje** (instalación `lineage_cradle` de una colonia) o, sin Cunas, en el
 * Núcleo Humano. Ley III (Consecuencia): la gestación tarda más cuantas más
 * muertes seguidas, y lo que llevaba la nave (humanos, combustible, munición)
 * se pierde. Ley II (Continuidad): el cuerpo nuevo vuelve a generar humanos.
 *
 * Los tiempos son de juego (el servidor los divide por `TIME_SCALE`).
 */
import type { InstallationId, StockAmounts } from "./economy";
import type { AiPersonality } from "./aiEmperors";

export const LINEAGE = {
  /** Gestación (minutos de juego) tras la primera muerte de una racha. */
  gestationBaseMinutes: 3,
  /** Cada muerte seguida multiplica la gestación por este factor… */
  gestationGrowth: 2,
  /** …hasta este máximo (minutos de juego). */
  gestationMaxMinutes: 360,
  /** Sin Cunas, la humanidad reconstruye al Emperador en el Núcleo Humano, más despacio. */
  coreGestationFactor: 1.5,
  /** Cada tantas horas de juego sin morir se olvida una muerte de la racha. */
  streakDecayHours: 6,
  /** Humanos con los que despierta el cuerpo nuevo (Ley II: los demás murieron con la nave). */
  rebirthHumans: 50,
  /**
   * Encarnarse en un Heredero: como mucho una vez cada tantas horas de juego
   * (también estando muerto, en vez de esperar la gestación).
   */
  incarnateCooldownHours: 12,
  /** No se puede abandonar el cuerpo en pleno combate: segundos desde el último impacto recibido. */
  incarnateCombatLockSec: 60,
  /** Muertes que se muestran en el historial del linaje. */
  recentDeaths: 10,
  /** Distancia (m) a la superficie del planeta de la Cuna a la que aparece la nave renacida. */
  rebirthAltitudeM: 30_000,
} as const;

/**
 * La nave del Emperador en el combate de flotas por rondas (Fase 9a): pelea con
 * su escolta (si su dueño tiene flotas en la batalla) o, fuera del Núcleo
 * Humano, sola cuando una flota hostil llega a donde está aparcada. Su casco es
 * el mismo que en el combate en tiempo real (`EMPEROR_FLAGSHIP.hull`).
 */
export const FLAGSHIP_BATTLE = {
  attack: 45,
  battleShield: 25,
} as const;

/**
 * Reparación del casco de la nave del Emperador: a bordo, despacio y solo
 * mientras está activa en un sistema; junto a una colonia propia, deprisa y
 * pagando aleaciones de sus existencias.
 */
export const FLAGSHIP_REPAIR = {
  /** Puntos de casco por segundo que repara la tripulación… */
  onboardPerSec: 0.1,
  /** …tras tantos segundos sin recibir daño. */
  onboardDelaySec: 30,
  /** Puntos de casco por segundo junto a una colonia propia. */
  colonyPerSec: 20,
  /** Aleaciones de la colonia por punto de casco. */
  alloysPerHull: 0.25,
} as const;

/** Doctrina de gobierno de un Heredero (la elige el jugador). */
export type HeirDoctrine = "prosperity" | "bastion" | "balanced";

export interface HeirDoctrineDefinition {
  id: HeirDoctrine;
  /** Clave i18n del nombre (`doctrine.<id>`) en `@imperium/shared`. */
  nameKey: string;
  /** Multiplicador de la extracción de la colonia que gobierna. */
  extraction: number;
  /** Multiplicador de la defensa de la colonia contra los asedios. */
  defense: number;
  /** Instalaciones que encarga el gobernador cuando la cola está vacía, por orden. */
  buildPriority: readonly InstallationId[];
}

export const HEIR_DOCTRINES: readonly HeirDoctrineDefinition[] = [
  { id: "prosperity", nameKey: "doctrine.prosperity", extraction: 1.15, defense: 1, buildPriority: ["mine", "power_plant", "refinery"] },
  { id: "bastion", nameKey: "doctrine.bastion", extraction: 1, defense: 1.3, buildPriority: ["defense_platform", "power_plant", "mine"] },
  { id: "balanced", nameKey: "doctrine.balanced", extraction: 1.05, defense: 1.1, buildPriority: ["mine", "power_plant", "defense_platform", "refinery"] },
];

export function getDoctrine(id: string | null | undefined): HeirDoctrineDefinition | undefined {
  return HEIR_DOCTRINES.find((d) => d.id === id);
}

/**
 * Herederos: cuerpos del linaje que se gestan en una Cuna, gobiernan una
 * colonia propia (uno por colonia) y en los que el Emperador puede encarnarse.
 */
export const HEIRS = {
  /** Herederos por Emperador (contando los que se gestan). */
  maxPerEmperor: 3,
  /** Coste en existencias de la colonia de la Cuna. */
  cost: { metal: 400, volatiles: 120, crystal: 60, alloys: 80 } satisfies StockAmounts,
  /** Habitantes de la colonia que se dedican a criarlo (salen de su población). */
  population: 25,
  /** Horas de juego de gestación. */
  gestationHours: 6,
  /** Cada cuántas horas de juego decide el gobernador. */
  governEveryHours: 2,
  /** El gobernador no encarga nada que deje las existencias por debajo de esta parte del almacén. */
  reserveShare: 0.1,
} as const;

/** Nombres de los Herederos (nombres propios: no se traducen). Se toman en orden. */
export const HEIR_NAMES: readonly string[] = [
  "Aelia", "Bastian", "Calia", "Darius", "Elena", "Fabian", "Galia", "Hadrian",
  "Irene", "Julian", "Livia", "Marco", "Nadia", "Octavio", "Petra", "Quintus",
  "Rhea", "Silvio", "Tania", "Ulric", "Vera", "Xenia", "Yago", "Zoe",
];

/**
 * Especies que persiguen las Cunas (lore: los Erradicadores destruyen las
 * instalaciones de reconstrucción): al elegir qué colonia asediar en su
 * territorio, prefieren las que tienen Cuna de linaje.
 */
export const CRADLE_HUNTERS: readonly string[] = ["eradicators"];

/** Uso del linaje por los Emperadores humanos de la IA (Fase 10). */
export interface AiLineageDefinition {
  /** Construye una Cuna en su capital. */
  cradle: boolean;
  /** Herederos que mantiene. */
  heirs: number;
  /** Doctrina de sus Herederos. */
  doctrine: HeirDoctrine;
}

export const AI_LINEAGE: Readonly<Record<AiPersonality, AiLineageDefinition>> = {
  expansionist: { cradle: true, heirs: 2, doctrine: "prosperity" },
  merchant: { cradle: true, heirs: 1, doctrine: "prosperity" },
  militarist: { cradle: true, heirs: 2, doctrine: "bastion" },
};

/** Errores de coherencia de los datos del linaje (vacío si todo está bien). */
export function validateLineage(): string[] {
  const errors: string[] = [];
  if (!(LINEAGE.gestationBaseMinutes > 0)) errors.push("La gestación base debe ser positiva");
  if (!(LINEAGE.gestationGrowth >= 1)) errors.push("La gestación no puede menguar con las muertes seguidas");
  if (LINEAGE.gestationMaxMinutes < LINEAGE.gestationBaseMinutes) errors.push("La gestación máxima es menor que la base");
  if (!(LINEAGE.streakDecayHours > 0)) errors.push("La racha de muertes tiene que olvidarse con el tiempo");
  const ids = new Set<string>();
  for (const d of HEIR_DOCTRINES) {
    if (ids.has(d.id)) errors.push(`Doctrina duplicada: ${d.id}`);
    ids.add(d.id);
    if (d.nameKey !== `doctrine.${d.id}`) errors.push(`doctrina ${d.id}: nameKey inesperada`);
    if (!(d.extraction >= 1) || !(d.defense >= 1)) errors.push(`doctrina ${d.id}: un gobernador no debe empeorar su colonia`);
    if (d.buildPriority.length === 0) errors.push(`doctrina ${d.id}: sin prioridades de construcción`);
  }
  if (HEIR_NAMES.length < HEIRS.maxPerEmperor) errors.push("Hay menos nombres de Herederos que Herederos posibles");
  for (const [p, l] of Object.entries(AI_LINEAGE)) {
    if (!getDoctrine(l.doctrine)) errors.push(`IA ${p}: doctrina desconocida`);
    if (l.heirs > HEIRS.maxPerEmperor) errors.push(`IA ${p}: más Herederos de los permitidos`);
  }
  return errors;
}
