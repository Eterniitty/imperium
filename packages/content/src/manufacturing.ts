/**
 * Fabricación (petición del usuario, 22-10-2026: «hay que desarrollar más lo
 * de materiales y crafteos»): las colonias con **Fábrica** convierten recursos
 * en **componentes** con recetas, en su cola de construcción. Los componentes
 * se guardan en el inventario de la colonia y los piden las piezas avanzadas
 * del Astillero (`PartDef.components`). Son datos; las reglas están en
 * `@imperium/sim` y el servidor las aplica.
 */
import type { InstallationId, StockAmounts } from "./economy";

export type ComponentId = "hull_plates" | "circuits" | "power_cells" | "optics" | "superconductors" | "exotic_cores";
export const COMPONENT_IDS: readonly ComponentId[] = ["hull_plates", "circuits", "power_cells", "optics", "superconductors", "exotic_cores"];

export type ComponentAmounts = Partial<Record<ComponentId, number>>;

export interface RecipeDef {
  /** Lo que fabrica (una receta por componente). */
  id: ComponentId;
  /** Unidades por tanda. */
  output: number;
  /** Recursos de la colonia que gasta cada tanda. */
  inputs: Partial<StockAmounts>;
  /** Componentes que gasta cada tanda (cadenas de producción). */
  components?: ComponentAmounts;
  /** Horas de juego por tanda. */
  hours: number;
  /** Instalaciones que tiene que tener la colonia. */
  requires: Partial<Record<InstallationId, number>>;
}

export const RECIPES: readonly RecipeDef[] = [
  { id: "hull_plates", output: 5, inputs: { metal: 60, alloys: 10 }, hours: 1, requires: { factory: 1 } },
  { id: "circuits", output: 5, inputs: { crystal: 20, metal: 10, volatiles: 10 }, hours: 1.5, requires: { factory: 1 } },
  { id: "power_cells", output: 4, inputs: { volatiles: 30, crystal: 10, metal: 10 }, hours: 1.5, requires: { factory: 1 } },
  { id: "optics", output: 3, inputs: { crystal: 30, rare_metals: 2 }, hours: 2, requires: { factory: 1 } },
  { id: "superconductors", output: 3, inputs: { rare_metals: 6, alloys: 10 }, components: { circuits: 2 }, hours: 3, requires: { factory: 1, refinery: 1 } },
  { id: "exotic_cores", output: 1, inputs: { exotic: 4 }, components: { superconductors: 2, power_cells: 2 }, hours: 6, requires: { factory: 1 } },
];

export function getRecipe(id: string): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function isComponentId(id: string): id is ComponentId {
  return (COMPONENT_IDS as readonly string[]).includes(id);
}
