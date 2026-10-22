/**
 * Fabricación: reglas puras del inventario de componentes de una colonia
 * (datos en `@imperium/content` manufacturing.ts).
 */
import { COMPONENT_IDS, type ComponentAmounts } from "@imperium/content";

/** ¿Tiene el inventario todo lo que se pide? */
export function hasComponents(items: ComponentAmounts, need: ComponentAmounts | undefined): boolean {
  if (!need) return true;
  return COMPONENT_IDS.every((k) => (items[k] ?? 0) + 1e-9 >= (need[k] ?? 0));
}

/** Inventario tras sumar (`sign` 1) o restar (`sign` -1) unas cantidades, multiplicadas por `k`; sin negativos ni ceros. */
export function addComponents(items: ComponentAmounts, delta: ComponentAmounts | undefined, sign: 1 | -1 = 1, k = 1): ComponentAmounts {
  const out: ComponentAmounts = { ...items };
  if (!delta) return out;
  for (const id of COMPONENT_IDS) {
    const d = (delta[id] ?? 0) * sign * k;
    if (!d) continue;
    const v = Math.max(0, (out[id] ?? 0) + d);
    if (v > 1e-9) out[id] = Math.round(v * 1000) / 1000;
    else delete out[id];
  }
  return out;
}
