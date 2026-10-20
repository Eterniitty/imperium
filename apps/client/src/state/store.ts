import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { generateSystemDetail } from "@imperium/procgen";
import {
  translate,
  type I18nKey,
  type Locale,
  type SectorCoord,
  type StarSystemDetail,
  type StarSystemSummary,
  type WorldPosition,
} from "@imperium/shared";
import { UNIVERSE_SEED } from "../config";

export type ViewMode = "galaxy" | "system";

export interface GameState {
  started: boolean;
  view: ViewMode;
  locale: Locale;

  focusWorld: WorldPosition;
  focusSector: SectorCoord;
  loadedSectors: number;
  loadedSystems: number;
  fps: number;
  flight: boolean;
  flightSpeed: number;

  hovered: StarSystemSummary | null;
  selected: StarSystemSummary | null;
  detail: StarSystemDetail | null;
  selectedPlanet: number | null;

  start(): void;
  setLocale(locale: Locale): void;
  setView(view: ViewMode): void;
  setHovered(s: StarSystemSummary | null): void;
  select(s: StarSystemSummary | null): void;
  selectPlanet(index: number | null): void;
  setNavigation(focus: WorldPosition, sector: SectorCoord): void;
  setFlight(flight: boolean, speed: number): void;
  setStats(stats: { loadedSectors: number; loadedSystems: number; fps: number }): void;
}

const LOCALE_KEY = "imperium.locale";

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch {
    // Almacenamiento no disponible (modo privado, etc.): se usa el idioma del navegador.
  }
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

export const gameStore = createStore<GameState>()((set, get) => ({
  started: false,
  view: "galaxy",
  locale: initialLocale(),

  focusWorld: { x: 50, y: 50, z: 50 },
  focusSector: { x: 0, y: 0, z: 0 },
  loadedSectors: 0,
  loadedSystems: 0,
  fps: 0,
  flight: false,
  flightSpeed: 0,

  hovered: null,
  selected: null,
  detail: null,
  selectedPlanet: null,

  start: () => set({ started: true }),

  setLocale: (locale) => {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // Ignorado: la preferencia solo dura esta sesión.
    }
    document.documentElement.lang = locale;
    set({ locale });
  },

  setView: (view) => set({ view, selectedPlanet: null }),

  setHovered: (s) => {
    if (get().hovered?.id !== s?.id) set({ hovered: s });
  },

  select: (s) => {
    if (get().selected?.id === s?.id) return;
    set({
      selected: s,
      detail: s ? generateSystemDetail(UNIVERSE_SEED, s) : null,
      selectedPlanet: null,
    });
  },

  selectPlanet: (index) => set({ selectedPlanet: index }),

  setNavigation: (focusWorld, focusSector) => set({ focusWorld, focusSector }),

  setFlight: (flight, flightSpeed) => set({ flight, flightSpeed: Math.round(flightSpeed * 10) / 10 }),

  setStats: (stats) => set(stats),
}));

export function useGame<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector);
}

/** Traducción reactiva al idioma actual. */
export function useT() {
  const locale = useGame((s) => s.locale);
  return (key: I18nKey, params?: Record<string, string | number>) => translate(locale, key, params);
}
