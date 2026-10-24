/**
 * Movimiento de los mundos de Aeon (Era II): dónde está cada planeta y cada luna
 * en un instante y cuánto ha girado sobre sí mismo. Lo calcula igual el servidor
 * y el cliente de Unreal (port en aeonarch-ue/Core/include/aeon/orbits.h, con
 * vectores al bit), así que el cliente puede dibujarlo sin preguntar.
 *
 * Órbitas circulares (escala no realista): los planetas en el plano de la
 * eclíptica (z = 0) y las lunas en un plano algo inclinado. La fase inicial sale
 * del id, así cada mundo empieza en su sitio. Distancias en km, tiempo en ms.
 */
import type { AeonMoon, AeonWorld } from "@imperium/content";
import { cosSinTurns, hashString, hashToUnit } from "@imperium/procgen";

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

export type Km3 = [number, number, number];

/** Parte fraccionaria de t / periodo, más la fase del id: el ángulo de la órbita en vueltas. */
export function orbitTurns(id: string, periodH: number, tMs: number): number {
  const phase = hashToUnit(hashString(id));
  const cycles = tMs / (periodH * MS_PER_HOUR);
  return phase + (cycles - Math.floor(cycles));
}

/** Posición del mundo respecto a la estrella, en km. */
export function worldPositionKm(world: Pick<AeonWorld, "id" | "orbitKm" | "orbitPeriodH">, tMs: number): Km3 {
  const [c, s] = cosSinTurns(orbitTurns(world.id, world.orbitPeriodH, tMs));
  return [c * world.orbitKm, s * world.orbitKm, 0];
}

/** Inclinación de la órbita de una luna, en vueltas (entre −0,02 y 0,02: ±7°). */
export function moonTiltTurns(moonId: string): number {
  return (hashToUnit(hashString(moonId + "/inclinacion")) - 0.5) * 0.04;
}

/** Posición de la luna respecto al centro de su planeta, en km. */
export function moonOffsetKm(moon: Pick<AeonMoon, "id" | "orbitKm" | "orbitPeriodH">, tMs: number): Km3 {
  const [c, s] = cosSinTurns(orbitTurns(moon.id, moon.orbitPeriodH, tMs));
  const [ci, si] = cosSinTurns(moonTiltTurns(moon.id));
  const r = moon.orbitKm;
  return [c * r, s * r * ci, s * r * si];
}

/**
 * Giro del mundo sobre su eje (z), en vueltas. Con `dayLengthMin` = 0 está
 * acoplado: siempre la misma cara hacia la estrella.
 */
export function spinTurns(world: Pick<AeonWorld, "id" | "orbitPeriodH" | "dayLengthMin">, tMs: number): number {
  if (world.dayLengthMin === 0) return orbitTurns(world.id, world.orbitPeriodH, tMs) + 0.5;
  const phase = hashToUnit(hashString(world.id + "/giro"));
  const days = tMs / (world.dayLengthMin * MS_PER_MINUTE);
  return phase + (days - Math.floor(days));
}
