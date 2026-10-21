/**
 * Especies alienígenas en el cliente (Fase 11): territorio de los sistemas
 * descubiertos, ruinas precursoras y relación con cada facción conocida
 * (`GET /api/aliens`). El servidor solo cuenta lo que el jugador ha
 * descubierto (niebla de guerra), así que se vuelve a pedir cuando cambian
 * los descubrimientos (agrupando los cambios) y cada pocos minutos.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { AlienStanding, AlienTerritory, AliensResponse } from "@imperium/shared";
import { worldStore } from "../net/world";
import { api } from "./auth";

export interface AliensState {
  /** Dueño alienígena de cada sistema descubierto que es territorio de alguien. */
  territory: Record<string, AlienTerritory>;
  /** Sistemas descubiertos con ruinas precursoras. */
  relics: Record<string, true>;
  standings: AlienStanding[];
  hostileAt: number;
  /** Cambia con cada respuesta (para redibujar el mapa). */
  version: number;
}

export const aliensStore = createStore<AliensState>()(() => ({ territory: {}, relics: {}, standings: [], hostileAt: 1, version: 0 }));

export function useAliens<T>(selector: (s: AliensState) => T): T {
  return useStore(aliensStore, selector);
}

const REFRESH_MS = 120_000;
const DEBOUNCE_MS = 2_000;
let timer: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

/** Pide de nuevo el territorio y las relaciones. */
export async function refreshAliens(): Promise<void> {
  if (worldStore.getState().status !== "open") return;
  const res = await api<AliensResponse>("GET", "/api/aliens");
  if (!res.ok) return;
  const territory: Record<string, AlienTerritory> = {};
  for (const t of res.data.territory) territory[t.systemId] = { factionId: t.factionId, speciesId: t.speciesId };
  const relics: Record<string, true> = {};
  for (const id of res.data.relics) relics[id] = true;
  aliensStore.setState((s) => ({ territory, relics, standings: res.data.standings, hostileAt: res.data.hostileAt, version: s.version + 1 }));
}

function schedule(delay = DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refreshAliens();
  }, delay);
}

worldStore.subscribe((st, prev) => {
  if (st.myEmperorId !== prev.myEmperorId) aliensStore.setState({ territory: {}, relics: {}, standings: [], version: 0 });
  if (st.status === "open" && prev.status !== "open") {
    schedule(0);
    interval ??= setInterval(() => void refreshAliens(), REFRESH_MS);
  }
  if (st.status === "idle" && interval) {
    clearInterval(interval);
    interval = null;
  }
  if (st.discovered !== prev.discovered && st.status === "open") schedule();
});
