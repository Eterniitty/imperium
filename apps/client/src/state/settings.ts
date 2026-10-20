import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

/**
 * Acciones con tecla, agrupadas por contexto. Dos acciones pueden compartir
 * tecla si están en contextos distintos (p. ej. E sube la cámara en el mapa y
 * alabea la nave al pilotar); dentro del mismo contexto, sería un conflicto.
 */
export const ACTIONS = {
  // Pilotar la nave (y el vuelo libre de cámara en el mapa).
  flight: ["forward", "back", "strafeLeft", "strafeRight", "up", "down", "rollLeft", "rollRight", "turnLeft", "turnRight", "pitchUp", "pitchDown", "boost", "cameraView", "fireCannon", "fireMissile", "lockTarget", "pulse"],
  // Mover la cámara por el mapa galáctico.
  map: ["mapForward", "mapBack", "mapLeft", "mapRight", "mapUp", "mapDown", "mapBoost", "flightMode", "focus", "enter", "deselect"],
  // En cualquier momento.
  general: ["jump", "toggleMap"],
} as const;

export type ActionContext = keyof typeof ACTIONS;
export type Action = (typeof ACTIONS)[ActionContext][number];

/** Hasta dos teclas por acción (códigos de `KeyboardEvent.code`). */
export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  forward: ["KeyW"],
  back: ["KeyS"],
  strafeLeft: ["KeyA"],
  strafeRight: ["KeyD"],
  up: ["Space"],
  down: ["KeyC"],
  rollLeft: ["KeyQ"],
  rollRight: ["KeyE"],
  turnLeft: ["ArrowLeft"],
  turnRight: ["ArrowRight"],
  pitchUp: ["ArrowUp"],
  pitchDown: ["ArrowDown"],
  boost: ["ShiftLeft", "ShiftRight"],
  cameraView: ["KeyT"],
  fireCannon: ["KeyF"],
  fireMissile: ["KeyR"],
  lockTarget: ["KeyX"],
  pulse: ["KeyP"],
  mapForward: ["KeyW", "ArrowUp"],
  mapBack: ["KeyS", "ArrowDown"],
  mapLeft: ["KeyA", "ArrowLeft"],
  mapRight: ["KeyD", "ArrowRight"],
  mapUp: ["KeyE"],
  mapDown: ["KeyQ"],
  mapBoost: ["ShiftLeft", "ShiftRight"],
  flightMode: ["KeyV"],
  focus: ["KeyF"],
  enter: ["Enter", "NumpadEnter"],
  deselect: ["Escape"],
  jump: ["KeyJ"],
  toggleMap: ["KeyM"],
};

const STORAGE_KEY = "imperium.keys";

function load(): Bindings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Bindings> | null;
    if (!saved) return { ...DEFAULT_BINDINGS };
    // Solo acciones conocidas y listas de texto: un valor viejo o manipulado no rompe nada.
    const out = { ...DEFAULT_BINDINGS };
    for (const action of Object.keys(DEFAULT_BINDINGS) as Action[]) {
      const keys = saved[action];
      if (Array.isArray(keys) && keys.every((k) => typeof k === "string")) out[action] = keys.slice(0, 2);
    }
    return out;
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

/**
 * Calidad de imagen: cuántos píxeles se dibujan por píxel de pantalla. En
 * pantallas grandes o de alta densidad (4K, Retina) es lo que más pesa.
 * - auto: la densidad de la pantalla, hasta 1,5.
 * - high: la densidad de la pantalla, hasta 2.
 * - medium: un píxel por píxel CSS.
 * - low: menos píxeles de los que hay (más fluido en equipos modestos).
 */
export type Quality = "auto" | "high" | "medium" | "low";

export function pixelRatioFor(quality: Quality, devicePixelRatio: number): number {
  switch (quality) {
    case "auto":
      return Math.min(devicePixelRatio, 1.5);
    case "high":
      return Math.min(devicePixelRatio, 2);
    case "medium":
      return 1;
    case "low":
      return 0.75;
  }
}

/** Escala de la interfaz: automática según la ventana, o fija. */
export type UiScale = "auto" | 0.85 | 1 | 1.25 | 1.5 | 1.75;
export const UI_SCALES: UiScale[] = ["auto", 0.85, 1, 1.25, 1.5, 1.75];

/** Escala automática: 1 para una ventana de 1440 × 810, más en pantallas grandes, menos en pequeñas. */
export function uiScaleFor(scale: UiScale, width: number, height: number): number {
  if (scale !== "auto") return scale;
  const k = Math.min(width / 1440, height / 810);
  return Math.round(Math.min(1.75, Math.max(0.85, k)) * 100) / 100;
}

export interface Preferences {
  quality: Quality;
  uiScale: UiScale;
  /** Volumen de la música, 0 a 1 (0 = apagada). */
  musicVolume: number;
}

const DEFAULT_PREFERENCES: Preferences = { quality: "auto", uiScale: "auto", musicVolume: 0.5 };
const PREFS_KEY = "imperium.prefs";

function loadPrefs(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Preferences> | null;
    const quality = saved?.quality;
    const volume = saved?.musicVolume;
    return {
      quality: quality === "auto" || quality === "high" || quality === "medium" || quality === "low" ? quality : DEFAULT_PREFERENCES.quality,
      uiScale: UI_SCALES.includes(saved?.uiScale as UiScale) ? (saved!.uiScale as UiScale) : DEFAULT_PREFERENCES.uiScale,
      musicVolume: typeof volume === "number" && volume >= 0 && volume <= 1 ? volume : DEFAULT_PREFERENCES.musicVolume,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export interface SettingsState {
  bindings: Bindings;
  prefs: Preferences;
  setPrefs(prefs: Partial<Preferences>): void;
  /** Asigna `code` a la posición `slot` (0 o 1) de la acción. */
  bind(action: Action, slot: number, code: string): void;
  /** Quita la tecla de esa posición. */
  unbind(action: Action, slot: number): void;
  resetBindings(): void;
}

function save(bindings: Bindings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Sin almacenamiento: los cambios duran solo esta sesión.
  }
}

export const settingsStore = createStore<SettingsState>()((set, get) => ({
  bindings: load(),
  prefs: loadPrefs(),
  setPrefs: (changes) => {
    const prefs = { ...get().prefs, ...changes };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Sin almacenamiento: dura solo esta sesión.
    }
    set({ prefs });
  },
  bind: (action, slot, code) => {
    const keys = [...get().bindings[action]];
    keys[slot] = code;
    const bindings = { ...get().bindings, [action]: [...new Set(keys.filter(Boolean))] };
    save(bindings);
    set({ bindings });
  },
  unbind: (action, slot) => {
    const keys = get().bindings[action].filter((_, i) => i !== slot);
    const bindings = { ...get().bindings, [action]: keys };
    save(bindings);
    set({ bindings });
  },
  resetBindings: () => {
    save(DEFAULT_BINDINGS);
    set({ bindings: { ...DEFAULT_BINDINGS } });
  },
}));

export function useSettings<T>(selector: (s: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}

/** ¿La tecla `code` está asignada a `action`? */
export function isBound(action: Action, code: string): boolean {
  return settingsStore.getState().bindings[action].includes(code);
}

/** Contexto al que pertenece una acción. */
export function contextOf(action: Action): ActionContext {
  return (Object.keys(ACTIONS) as ActionContext[]).find((c) => (ACTIONS[c] as readonly string[]).includes(action))!;
}

/** Otras acciones que usan la misma tecla en un contexto que se solapa (el mismo o "general"). */
export function conflictsOf(action: Action, code: string): Action[] {
  const ctx = contextOf(action);
  const { bindings } = settingsStore.getState();
  return (Object.keys(bindings) as Action[]).filter((other) => {
    if (other === action || !bindings[other].includes(code)) return false;
    const otherCtx = contextOf(other);
    return otherCtx === ctx || otherCtx === "general" || ctx === "general";
  });
}

/** Nombre legible de una tecla: "KeyW" → "W", "ArrowUp" → "↑", "ShiftLeft" → "Mayús izq.". */
export function keyLabel(code: string, locale: "es" | "en"): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  const es = locale === "es";
  const names: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Space: es ? "Espacio" : "Space",
    ShiftLeft: es ? "Mayús izq." : "Left Shift",
    ShiftRight: es ? "Mayús der." : "Right Shift",
    ControlLeft: es ? "Ctrl izq." : "Left Ctrl",
    ControlRight: es ? "Ctrl der." : "Right Ctrl",
    AltLeft: "Alt",
    AltRight: "Alt Gr",
    Enter: es ? "Intro" : "Enter",
    Escape: "Esc",
    Tab: es ? "Tab" : "Tab",
    Backspace: es ? "Retroceso" : "Backspace",
  };
  return names[code] ?? code;
}
