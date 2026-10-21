/**
 * Territorio del sistema seleccionado: dueño y nombre de sus planetas
 * reclamados (`GET /api/systems/:id/claims`). A diferencia del detalle, cambia
 * con el tiempo, así que no se guarda: se pide al seleccionar el sistema y
 * cuando cambia una colonia propia de ese sistema. Las colonias propias llegan
 * además en tiempo real por el tema "me" (`worldStore.colonies`).
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { PlanetClaim, SystemClaimsResponse } from "@imperium/shared";
import { worldStore } from "../net/world";
import { api } from "./auth";
import { gameStore } from "./store";

export interface ClaimsState {
  systemId: string | null;
  /** Planetas con dueño, por índice. */
  claims: Record<number, PlanetClaim>;
}

export const claimsStore = createStore<ClaimsState>()(() => ({ systemId: null, claims: {} }));

export function useClaims(): ClaimsState {
  return useStore(claimsStore);
}

let request = 0;

async function load(systemId: string | null): Promise<void> {
  const id = ++request;
  if (!systemId || !worldStore.getState().discovered[systemId]) {
    claimsStore.setState({ systemId, claims: {} });
    return;
  }
  const res = await api<SystemClaimsResponse>("GET", `/api/systems/${encodeURIComponent(systemId)}/claims`);
  // Solo la última petición cuenta (el jugador puede haber cambiado de sistema).
  if (id !== request) return;
  const claims: Record<number, PlanetClaim> = {};
  if (res.ok) for (const c of res.data.claims) claims[c.planetIndex] = c;
  claimsStore.setState({ systemId, claims });
}

const selectedId = () => gameStore.getState().selected?.id ?? null;

gameStore.subscribe((st, prev) => {
  if (st.selected?.id !== prev.selected?.id) void load(st.selected?.id ?? null);
});
worldStore.subscribe((st, prev) => {
  const sel = selectedId();
  if (!sel) return;
  if (st.discovered !== prev.discovered && st.discovered[sel] && !prev.discovered[sel]) return void load(sel);
  // Fase 9b: un asedio de este sistema empieza o termina (planetas asediados, dueños nuevos).
  if (st.sieges !== prev.sieges) {
    const sig = (ss: typeof st.sieges) => Object.values(ss).filter((x) => x.systemId === sel).map((x) => `${x.id}:${x.outcome}`).sort().join();
    if (sig(st.sieges) !== sig(prev.sieges)) return void load(sel);
  }
  if (st.colonies === prev.colonies) return;
  // Una colonia propia de este sistema ha aparecido, cambiado de nombre o desaparecido.
  const touches = (cs: typeof st.colonies) => Object.values(cs).some((c) => c.systemId === sel);
  if (touches(st.colonies) || touches(prev.colonies)) {
    const now = Object.values(st.colonies).filter((c) => c.systemId === sel).map((c) => `${c.planetIndex}:${c.name ?? ""}`).join();
    const before = Object.values(prev.colonies).filter((c) => c.systemId === sel).map((c) => `${c.planetIndex}:${c.name ?? ""}`).join();
    if (now !== before) void load(sel);
  }
});
