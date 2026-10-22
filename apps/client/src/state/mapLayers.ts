import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

/** Capas del mapa galáctico que se pueden mostrar u ocultar (se recuerdan en este navegador). */
export interface MapLayers {
  emperors: boolean;
  fleets: boolean;
  labels: boolean;
  territory: boolean;
  galaxy: boolean;
}

const KEY = "aeon.mapLayers";
const DEFAULTS: MapLayers = { emperors: true, fleets: true, labels: true, territory: true, galaxy: true };

function load(): MapLayers {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<MapLayers>;
    return { ...DEFAULTS, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in DEFAULTS && typeof v === "boolean")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const mapLayersStore = createStore<MapLayers & { toggle(k: keyof MapLayers): void }>((set, get) => ({
  ...load(),
  toggle(k) {
    set({ [k]: !get()[k] } as Partial<MapLayers>);
    const { toggle: _toggle, ...layers } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify(layers));
    } catch {
      // Sin almacenamiento: solo dura esta sesión.
    }
  },
}));

export function useMapLayers<T>(pick: (s: MapLayers) => T): T {
  return useStore(mapLayersStore, pick);
}
