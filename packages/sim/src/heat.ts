/**
 * Calor de las estrellas (`STAR_HEAT`): daño por segundo que recibe una nave
 * según su distancia al centro de la estrella. Lo usan el servidor (daño) y el
 * cliente (aviso del HUD y corte del pulso).
 */
import { STAR_HEAT, SUPERMASSIVE } from "@imperium/content";
import type { SystemLayout } from "./systemLayout";

/** Daño por segundo a `distance` metros del centro de la estrella del sistema (0 fuera de la zona o sin estrella). */
export function starHeatDps(layout: Pick<SystemLayout, "starClass" | "starRadius" | "supermassive">, distance: number): number {
  if (!layout.starClass || layout.starRadius <= 0) return 0;
  const h = layout.supermassive ? SUPERMASSIVE.heat : STAR_HEAT[layout.starClass];
  const outer = layout.starRadius * h.zoneRadii;
  if (distance >= outer) return 0;
  const k = Math.min(1, (outer - distance) / (outer - layout.starRadius));
  return h.surfaceDps * k * k;
}

/** ¿Ha cruzado la nave el horizonte de sucesos (solo en los agujeros negros)? */
export function insideEventHorizon(layout: Pick<SystemLayout, "starClass" | "starRadius" | "supermassive">, distance: number): boolean {
  return layout.starClass === "BH" && distance < layout.starRadius;
}
