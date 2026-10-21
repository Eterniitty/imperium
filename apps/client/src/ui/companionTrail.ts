import { useEffect, useState } from "react";
import type { CompanionTrail, CompanionTrailResponse } from "@imperium/shared";
import { api } from "../state/auth";

/** Compañero junto al que se puede llegar en un sistema: está allí ahora o estuvo. */
export interface CompanionSpot {
  id: string;
  name: string;
  present: boolean;
}

/** Cuánto vale la última respuesta (ms). */
const CACHE_MS = 20_000;
let cache: { at: number; data: CompanionTrail[] } | null = null;

/**
 * Dónde están y estuvieron los compañeros (`GET /api/social/trail`), para
 * saltar junto a ellos. Se pide cada vez que `active` pasa a verdadero (al abrir
 * el selector de salto) o cambia `key` (otro sistema elegido).
 */
export function useCompanionTrail(active: boolean, key?: string): CompanionTrail[] {
  const [trail, setTrail] = useState<CompanionTrail[]>(() => cache?.data ?? []);
  useEffect(() => {
    if (!active) return;
    // Al pasear por el mapa cambia mucho el sistema elegido: se reutiliza la respuesta un rato.
    if (cache && Date.now() - cache.at < CACHE_MS) return setTrail(cache.data);
    let alive = true;
    void api<CompanionTrailResponse>("GET", "/api/social/trail").then((r) => {
      if (!r.ok) return;
      cache = { at: Date.now(), data: r.data.companions };
      if (alive) setTrail(r.data.companions);
    });
    return () => {
      alive = false;
    };
  }, [active, key]);
  return trail;
}

/** Compañeros junto a los que se puede llegar en `systemId` (primero los que están allí). */
export function companionsIn(trail: CompanionTrail[], systemId: string): CompanionSpot[] {
  return trail
    .filter((c) => c.at === systemId || c.systems.includes(systemId))
    .map((c) => ({ id: c.id, name: c.name, present: c.at === systemId }))
    .sort((a, b) => Number(b.present) - Number(a.present) || a.name.localeCompare(b.name));
}
