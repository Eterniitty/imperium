/**
 * Cifras de las colonias y de los humanos que avanzan solas entre dos avisos
 * del servidor: el servidor manda los valores a una hora (`at`) y sus tasas por
 * hora real, y aquí se proyectan a la hora actual (con sus topes). Es solo
 * para mostrar: lo que vale es lo que calcula el servidor.
 */
import { STOCK_IDS, type StockAmounts } from "@imperium/content";
import type { Colony, EmperorHumans, Planet, PlanetClaim } from "@imperium/shared";

const HOUR_MS = 3_600_000;

export function liveStock(c: Colony, now: number): StockAmounts {
  const h = Math.max(0, now - c.at) / HOUR_MS;
  const out = { ...c.stock };
  for (const r of STOCK_IDS) out[r] = Math.min(c.storage[r], Math.max(0, c.stock[r] + c.ratesPerHour[r] * h));
  return out;
}

export function livePopulation(c: Colony, now: number): number {
  const h = Math.max(0, now - c.at) / HOUR_MS;
  const p = c.population + c.populationPerHour * h;
  return c.populationPerHour >= 0 ? Math.min(Math.max(c.population, c.populationCap), p) : Math.max(c.populationCap, p);
}

export function liveHumans(h: EmperorHumans | null, now: number): number {
  if (!h) return 0;
  if (h.count >= h.capacity) return h.count;
  return Math.min(h.capacity, h.count + (h.perHour * Math.max(0, now - h.at)) / HOUR_MS);
}

/** Nombre que se muestra de un planeta: el de su dueño o, si no tiene, su designación. */
export function planetLabel(planet: Pick<Planet, "name" | "index">, claim: PlanetClaim | undefined, own: Colony | undefined): string {
  return own?.name ?? claim?.name ?? planet.name;
}

/** Colonia propia en un planeta concreto, si la hay. */
export function ownColonyAt(colonies: Record<string, Colony>, systemId: string, planetIndex: number): Colony | undefined {
  return Object.values(colonies).find((c) => c.systemId === systemId && c.planetIndex === planetIndex);
}

/** Número entero con separador de miles. */
export function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString();
}

/** Tasa con signo y un decimal si es pequeña. */
export function fmtRate(n: number): string {
  const v = Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return `${v > 0 ? "+" : ""}${v.toLocaleString()}`;
}
