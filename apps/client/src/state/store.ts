import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { generateSector } from "@imperium/procgen";
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

export type ViewMode = "galaxy" | "system" | "tunnel";
export type EconomyTab = "humanity" | "market";

/**
 * Detalle del sistema seleccionado (niebla de guerra; ver `details.ts`):
 * - none: no hay sistema seleccionado.
 * - unexplored: el Emperador no lo ha descubierto (o no hay servidor): sin detalle.
 * - loading: descubierto, pidiendo el detalle al servidor.
 * - explored: `detail` tiene el detalle.
 */
export type DetailStatus = "none" | "unexplored" | "loading" | "explored";

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
  /** Motor de pulso encendido (al pilotar en un sistema). */
  pulse: boolean;

  hovered: StarSystemSummary | null;
  selected: StarSystemSummary | null;
  /** Detalle del sistema seleccionado, solo si lo ha descubierto; lo rellena `details.ts`. */
  detail: StarSystemDetail | null;
  detailStatus: DetailStatus;
  selectedPlanet: number | null;
  /** Aviso breve en pantalla (salir de un sistema, error de un salto…). */
  notice: { key: I18nKey; params?: Record<string, string | number>; id: number } | null;
  settingsOpen: boolean;
  /** Panel de economía abierto: «Humanidad», «Mercado» o ninguno. */
  economyOpen: EconomyTab | null;
  /** Panel del linaje (Fase 10: Cunas, Herederos, muertes) abierto. */
  lineageOpen: boolean;
  /** Cámara al pilotar: desde la cabina (primera persona) o desde detrás de la nave (tercera). */
  cameraView: "first" | "third";
  /** Selector de destinos del salto cuántico abierto (al pilotar). */
  quantumPanel: boolean;
  /** Destino del salto cuántico que se está preparando (alinear y cargar), o null. */
  quantumTarget: StarSystemSummary | null;

  /** Entra en el juego; con Emperador, la cámara empieza en su sistema y lo selecciona. */
  start(at?: SystemLocation): void;
  setLocale(locale: Locale): void;
  setView(view: ViewMode): void;
  setHovered(s: StarSystemSummary | null): void;
  select(s: StarSystemSummary | null): void;
  selectPlanet(index: number | null): void;
  setNavigation(focus: WorldPosition, sector: SectorCoord): void;
  setFlight(flight: boolean, speed: number, pulse?: boolean): void;
  setStats(stats: { loadedSectors: number; loadedSystems: number; fps: number }): void;
  notify(key: I18nKey, params?: Record<string, string | number>): void;
  setSettingsOpen(open: boolean): void;
  setEconomyOpen(tab: EconomyTab | null): void;
  setLineageOpen(open: boolean): void;
  toggleCameraView(): void;
  setQuantumPanel(open: boolean): void;
  setQuantumTarget(target: StarSystemSummary | null): void;
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
  pulse: false,

  hovered: null,
  selected: null,
  detail: null,
  detailStatus: "none",
  selectedPlanet: null,
  notice: null,
  settingsOpen: false,
  economyOpen: null,
  lineageOpen: false,
  cameraView: "third",
  quantumPanel: false,
  quantumTarget: null,

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
    // El detalle lo pone `details.ts`, que escucha este cambio (al momento si ya lo tiene en caché).
    set({ selected: s, detail: null, detailStatus: s ? "loading" : "none", selectedPlanet: null });
  },

  selectPlanet: (index) => set({ selectedPlanet: index }),

  setNavigation: (focusWorld, focusSector) => set({ focusWorld, focusSector }),

  setFlight: (flight, flightSpeed, pulse = false) => set({ flight, flightSpeed: Math.round(flightSpeed * 10) / 10, pulse }),

  setStats: (stats) => set(stats),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setEconomyOpen: (economyOpen) => set({ economyOpen }),
  setLineageOpen: (lineageOpen) => set({ lineageOpen }),
  toggleCameraView: () => set({ cameraView: get().cameraView === "first" ? "third" : "first" }),
  setQuantumPanel: (quantumPanel) => set({ quantumPanel }),
  setQuantumTarget: (quantumTarget) => set({ quantumTarget }),

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
