import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

/**
 * Acciones con tecla, agrupadas por contexto. Dos acciones pueden compartir
 * tecla si están en contextos distintos (p. ej. E sube la cámara en el mapa y
 * alabea la nave al pilotar); dentro del mismo contexto, sería un conflicto.
 */
export const ACTIONS = {
  // Pilotar la nave (y el vuelo libre de cámara en el mapa).
  flight: ["forward", "back", "strafeLeft", "strafeRight", "up", "down", "rollLeft", "rollRight", "turnLeft", "turnRight", "pitchUp", "pitchDown", "boost", "cameraView"],
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

export interface SettingsState {
  bindings: Bindings;
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
