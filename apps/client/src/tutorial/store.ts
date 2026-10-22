/**
 * Estado del tutorial: el capítulo y el paso en curso, los capítulos hechos y
 * si el panel está plegado. Se guarda en este navegador (se puede reiniciar
 * desde Ajustes → Tutorial); no toca la partida.
 */
import { createStore } from "zustand/vanilla";
import { chapterById } from "./chapters";

const KEY = "aeon.tutorial";

interface Saved {
  active: { chapter: string; step: number } | null;
  done: Record<string, true>;
  mini: boolean;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Saved>;
    const active = raw.active && chapterById(raw.active.chapter) ? raw.active : null;
    return { active, done: raw.done && typeof raw.done === "object" ? raw.done : {}, mini: raw.mini === true };
  } catch {
    return { active: null, done: {}, mini: false };
  }
}

export interface TutorialState extends Saved {
  start(chapter: string): void;
  next(): void;
  exit(): void;
  setMini(mini: boolean): void;
  reset(): void;
}

export const tutorialStore = createStore<TutorialState>((set, get) => {
  const save = () => {
    const { active, done, mini } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ active, done, mini }));
    } catch {
      // Sin almacenamiento: dura solo esta sesión.
    }
  };
  return {
    ...load(),
    start(chapter) {
      if (!chapterById(chapter)) return;
      set({ active: { chapter, step: 0 }, mini: false });
      save();
    },
    next() {
      const a = get().active;
      if (!a) return;
      const ch = chapterById(a.chapter);
      if (!ch || a.step + 1 >= ch.steps.length) set({ active: null, done: { ...get().done, [a.chapter]: true } });
      else set({ active: { chapter: a.chapter, step: a.step + 1 } });
      save();
    },
    exit() {
      set({ active: null });
      save();
    },
    setMini(mini) {
      set({ mini });
      save();
    },
    reset() {
      set({ active: null, done: {}, mini: false });
      save();
    },
  };
});
