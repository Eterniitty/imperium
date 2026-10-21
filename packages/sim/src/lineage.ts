/**
 * Muerte y linaje (Fase 10). Reglas puras: racha de muertes, gestación,
 * efectos de la doctrina de un Heredero, decisión del gobernador y dónde
 * aparece la nave renacida. Los datos están en `@imperium/content`
 * (lineage.ts); el servidor las aplica en `apps/server/src/lineage/`.
 */
import { ECONOMY, getDoctrine, getInstallation, HEIR_NAMES, HEIRS, LINEAGE, STOCK_IDS, type InstallationId, type StockAmounts } from "@imperium/content";
import { gameHours, installationAllowed, realDurationMs, type InstallationCounts } from "./economy";
import type { ParkedOrbit } from "./park";
import { planetPosition, type SystemLayout } from "./systemLayout";

/**
 * Racha de muertes a la hora `now`: la guardada menos una por cada
 * `streakDecayHours` de juego sin morir desde la última muerte.
 */
export function decayedStreak(streak: number, lastDeathAt: number | null, now: number, timeScale: number): number {
  if (streak <= 0 || lastDeathAt === null) return 0;
  const forgiven = Math.floor(gameHours(lastDeathAt, now, timeScale) / LINEAGE.streakDecayHours);
  return Math.max(0, streak - forgiven);
}

/**
 * Minutos de juego de gestación de la muerte número `streak` de una racha
 * (1 = la primera): crece con cada muerte seguida hasta el máximo. Sin Cuna,
 * en el Núcleo Humano, tarda más.
 */
export function gestationMinutes(streak: number, atCore: boolean): number {
  const n = Math.max(1, Math.floor(streak));
  const base = Math.min(LINEAGE.gestationMaxMinutes, LINEAGE.gestationBaseMinutes * LINEAGE.gestationGrowth ** (n - 1));
  return atCore ? base * LINEAGE.coreGestationFactor : base;
}

/** Milisegundos reales de gestación con la escala de tiempo `timeScale`. */
export function gestationMs(streak: number, atCore: boolean, timeScale: number): number {
  return realDurationMs(gestationMinutes(streak, atCore) / 60, timeScale);
}

/** Hora (ms) desde la que se puede volver a encarnar en un Heredero. */
export function incarnateReadyAt(incarnatedAt: number | null, timeScale: number): number {
  return incarnatedAt === null ? 0 : incarnatedAt + realDurationMs(LINEAGE.incarnateCooldownHours, timeScale);
}

/** Multiplicador de la extracción de una colonia gobernada con esta doctrina (1 sin gobernador). */
export function doctrineExtraction(doctrine: string | null | undefined): number {
  return getDoctrine(doctrine)?.extraction ?? 1;
}

/** Multiplicador de la defensa contra asedios de una colonia gobernada con esta doctrina. */
export function doctrineDefense(doctrine: string | null | undefined): number {
  return getDoctrine(doctrine)?.defense ?? 1;
}

/**
 * Lo que encarga el gobernador de una colonia (o null): la primera instalación
 * de las prioridades de su doctrina que aún quepa y que se pueda pagar sin
 * dejar ningún recurso por debajo de la reserva. Solo con la cola vacía: nunca
 * se mete en las órdenes del jugador.
 */
export function governorChoice(doctrine: string, built: InstallationCounts, queueLength: number, stock: StockAmounts): InstallationId | null {
  const def = getDoctrine(doctrine);
  if (!def || queueLength > 0) return null;
  for (const id of def.buildPriority) {
    const inst = getInstallation(id);
    if (!inst || !installationAllowed(id, built, 0)) continue;
    const affordable = STOCK_IDS.every((r) => stock[r] - inst.cost[r] >= ECONOMY.storage[r] * HEIRS.reserveShare || inst.cost[r] === 0);
    if (affordable) return id;
  }
  return null;
}

/** Nombre del Heredero número `n` (0, 1, 2…) de un linaje: la lista y, al agotarse, con ordinal. */
export function heirName(n: number): string {
  const i = Math.max(0, Math.floor(n));
  const name = HEIR_NAMES[i % HEIR_NAMES.length]!;
  const round = Math.floor(i / HEIR_NAMES.length);
  return round === 0 ? name : `${name} ${round + 1}`;
}

/**
 * Órbita de aparcamiento junto a un planeta a la hora `t`: en su misma
 * dirección desde la estrella, `altitude` metros más allá de su superficie. La
 * nave orbita casi al ritmo del planeta (la ley de los periodos), así que se
 * queda a su lado bastante tiempo. Null si el planeta no existe.
 */
export function parkNearPlanet(layout: SystemLayout, planetIndex: number, t: number, altitude = LINEAGE.rebirthAltitudeM): ParkedOrbit | null {
  const planet = layout.planets.find((p) => p.index === planetIndex);
  if (!planet) return null;
  const c = planetPosition(planet, t);
  const r = Math.hypot(c.x, c.z);
  if (r < 1) return null;
  const k = (r + planet.size + altitude) / r;
  return { p: [c.x * k, 0, c.z * k], at: t };
}
