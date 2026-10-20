/**
 * Niebla de guerra en el cliente: el detalle de los sistemas (planetas,
 * recursos, anomalía) ya no se genera aquí, porque depende de una semilla
 * secreta del servidor. Se pide a `GET /api/systems/:id`, solo para los
 * sistemas que el Emperador ha descubierto (`worldStore.discovered`), y se
 * guarda en memoria.
 *
 * Escucha el sistema seleccionado y los descubrimientos y deja en el store
 * `detail` y `detailStatus`. Sin servidor (modo sin conexión) no hay
 * descubrimientos, así que todo sale «Sin explorar».
 */
import type { StarSystemDetail, StarSystemSummary, SystemDetailResponse } from "@imperium/shared";
import { worldStore } from "../net/world";
import { api } from "./auth";
import { gameStore } from "./store";

/** Detalles ya recibidos, por id de sistema. Un descubrimiento no se pierde: no caducan. */
const cache = new Map<string, StarSystemDetail>();
/** Peticiones en curso, para no repetirlas. */
const inflight = new Map<string, Promise<StarSystemDetail | null>>();

/**
 * Detalle vacío de un sistema sin explorar: solo la estrella. Lo usa la vista
 * de sistema para dibujarla (la disposición funciona sin planetas).
 */
export function unexploredDetail(summary: StarSystemSummary): StarSystemDetail {
  return { summary, luminosity: 0, energy: 0, planets: [], belts: [], anomaly: null };
}

function fetchDetail(systemId: string): Promise<StarSystemDetail | null> {
  let p = inflight.get(systemId);
  if (!p) {
    p = api<SystemDetailResponse>("GET", `/api/systems/${encodeURIComponent(systemId)}`).then((res) => {
      inflight.delete(systemId);
      if (!res.ok) return null;
      cache.set(systemId, res.data.detail);
      return res.data.detail;
    });
    inflight.set(systemId, p);
  }
  return p;
}

/** Pone en el store el detalle del sistema seleccionado según lo que se sabe de él. */
function refresh(): void {
  const { selected, detail, detailStatus } = gameStore.getState();
  if (!selected) {
    if (detailStatus !== "none") gameStore.setState({ detail: null, detailStatus: "none" });
    return;
  }
  const cached = cache.get(selected.id);
  if (cached) {
    if (detail !== cached) gameStore.setState({ detail: cached, detailStatus: "explored" });
    return;
  }
  if (!worldStore.getState().discovered[selected.id]) {
    if (detailStatus !== "unexplored") gameStore.setState({ detail: null, detailStatus: "unexplored" });
    return;
  }
  if (detailStatus !== "loading") gameStore.setState({ detail: null, detailStatus: "loading" });
  const id = selected.id;
  void fetchDetail(id).then((d) => {
    // Solo si sigue seleccionado el mismo sistema.
    if (gameStore.getState().selected?.id !== id) return;
    if (d) gameStore.setState({ detail: d, detailStatus: "explored" });
    else gameStore.setState({ detail: null, detailStatus: "unexplored" });
  });
}

gameStore.subscribe((st, prev) => {
  if (st.selected !== prev.selected) refresh();
});
worldStore.subscribe((st, prev) => {
  // Otro Emperador (otra cuenta en la misma pestaña): lo sabido por el anterior no vale.
  if (st.myEmperorId !== prev.myEmperorId) cache.clear();
  if (st.discovered !== prev.discovered || st.myEmperorId !== prev.myEmperorId) refresh();
});
