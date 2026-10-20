import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { generateSector, generateSystemDetail } from "@imperium/procgen";
import {
  parseSystemId,
  translate,
  worldToSector,
  type SystemLocation,
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
  /** Aviso breve en pantalla (salir de un sistema, error de un salto…). */
  notice: { key: I18nKey; params?: Record<string, string | number>; id: number } | null;
  settingsOpen: boolean;
  /** Cámara al pilotar: desde la cabina (primera persona) o desde detrás de la nave (tercera). */
  cameraView: "first" | "third";

  /** Entra en el juego; con Emperador, la cámara empieza en su sistema y lo selecciona. */
  start(at?: SystemLocation): void;
  setLocale(locale: Locale): void;
  setView(view: ViewMode): void;
  setHovered(s: StarSystemSummary | null): void;
  select(s: StarSystemSummary | null): void;
  selectPlanet(index: number | null): void;
  setNavigation(focus: WorldPosition, sector: SectorCoord): void;
  setFlight(flight: boolean, speed: number): void;
  setStats(stats: { loadedSectors: number; loadedSystems: number; fps: number }): void;
  notify(key: I18nKey, params?: Record<string, string | number>): void;
  setSettingsOpen(open: boolean): void;
  toggleCameraView(): void;
}

/**
 * Resumen de un sistema generado en este cliente. Null si no existe, lo que
 * indica que el cliente y el servidor usan semillas distintas.
 */
export function findSystemSummary(systemId: string): StarSystemSummary | null {
  const { sector, index } = parseSystemId(systemId);
  const s = generateSector(UNIVERSE_SEED, sector).systems[index];
  return s && s.id === systemId ? s : null;
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
  notice: null,
  settingsOpen: false,
  cameraView: "third",

  start: (at) => {
    if (!at) return set({ started: true });
    set({ started: true, focusWorld: { ...at.position }, focusSector: worldToSector(at.position) });
    get().select(findSystemSummary(at.systemId));
  },

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

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  toggleCameraView: () => set({ cameraView: get().cameraView === "first" ? "third" : "first" }),

  notify: (key, params) => {
    const id = (get().notice?.id ?? 0) + 1;
    set({ notice: { key, params, id } });
    setTimeout(() => {
      if (get().notice?.id === id) set({ notice: null });
    }, 5000);
  },
}));

export function useGame<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector);
}

/** Traducción reactiva al idioma actual. */
export function useT() {
  const locale = useGame((s) => s.locale);
  return (key: I18nKey, params?: Record<string, string | number>) => translate(locale, key, params);
}
