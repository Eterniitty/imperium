/**
 * Peticiones de ayuda de los compañeros (`helpCall`, `HELP_CALL`): quién la
 * pidió, dónde y cuándo. Se olvidan a los pocos minutos o al descartarlas.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

export interface HelpCallEntry {
  from: string;
  name: string;
  systemId: string;
  /** Hora local de llegada (para caducarla). */
  at: number;
}

/** Minutos que se muestra una petición de ayuda. */
export const HELP_CALL_SHOW_MS = 3 * 60_000;

export const helpStore = createStore<{ calls: HelpCallEntry[] }>()(() => ({ calls: [] }));

export function useHelpCalls(): HelpCallEntry[] {
  return useStore(helpStore, (s) => s.calls);
}

/** Llega una petición: sustituye a la anterior del mismo compañero. */
export function addHelpCall(entry: Omit<HelpCallEntry, "at">): void {
  helpStore.setState((s) => ({ calls: [...s.calls.filter((c) => c.from !== entry.from), { ...entry, at: Date.now() }] }));
}

export function dismissHelpCall(from: string): void {
  helpStore.setState((s) => ({ calls: s.calls.filter((c) => c.from !== from) }));
}
