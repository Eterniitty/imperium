import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { GUNSHIP, normalizeShipCustomization, type ShipCustomization } from "@imperium/content";

/**
 * Personalización de la nave del jugador (petición del 24-10-2026). Se guarda en
 * este navegador; con sesión, también en el servidor (para que la vean los demás).
 */
const KEY = "aeon.shipStyle";

function load(): ShipCustomization {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeShipCustomization(JSON.parse(raw));
  } catch {
    // Sin almacenamiento o dato roto: la de serie.
  }
  return normalizeShipCustomization(GUNSHIP.defaults);
}

interface ShipStyleState {
  style: ShipCustomization;
  /** Cambia la personalización (se normaliza: nada fuera de las reglas). */
  set(style: ShipCustomization): void;
  reset(): void;
}

export const shipStyleStore = createStore<ShipStyleState>()((set) => ({
  style: load(),
  set(style) {
    const clean = normalizeShipCustomization(style);
    try {
      localStorage.setItem(KEY, JSON.stringify(clean));
    } catch {
      // Sin almacenamiento: solo dura esta sesión.
    }
    set({ style: clean });
  },
  reset() {
    shipStyleStore.getState().set(normalizeShipCustomization(GUNSHIP.defaults));
  },
}));

export const useShipStyle = <T,>(selector: (s: ShipStyleState) => T): T => useStore(shipStyleStore, selector);
