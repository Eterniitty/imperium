import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Colony, Fleet, I18nKey } from "@imperium/shared";
import { useWorld } from "../net/world";
import { useT } from "../state/store";
import { BridgePanel } from "./BridgePanel";
import { ColoniesPanel } from "./ColoniesPanel";
import { FleetsPanel } from "./FleetsPanel";
import { WarPanel } from "./WarPanel";

type EmpireTab = "bridge" | "fleets" | "colonies" | "war";

/** Abierta o no y pestaña (se recuerda en este navegador). */
function load(): { open: boolean; tab: EmpireTab } {
  try {
    const raw = JSON.parse(localStorage.getItem("aeon.empireWin") ?? "{}") as { open?: boolean; tab?: EmpireTab };
    return { open: raw.open === true, tab: raw.tab && ["bridge", "fleets", "colonies", "war"].includes(raw.tab) ? raw.tab : "fleets" };
  } catch {
    return { open: false, tab: "fleets" };
  }
}

/** Estado de la ventana: lo comparten la ventana y su botón de la barra superior. */
export const empireStore = createStore<{ open: boolean; tab: EmpireTab; set(next: Partial<{ open: boolean; tab: EmpireTab }>): void }>((set, get) => ({
  ...load(),
  set(next) {
    set(next);
    try {
      localStorage.setItem("aeon.empireWin", JSON.stringify({ open: get().open, tab: get().tab }));
    } catch {
      // Sin almacenamiento: solo dura esta sesión.
    }
  },
}));

/** Botón de la barra superior: flotas y colonias con su número; abre o pliega la ventana del imperio. */
export function EmpireButton() {
  const t = useT();
  const open = useStore(empireStore, (s) => s.open);
  const fleets = useWorld((s) => Object.keys(s.fleets).length);
  const colonies = useWorld((s) => Object.values(s.colonies) as Colony[]);
  const short = colonies.some((c) => c.shortage);
  return (
    <button type="button" className={open ? "btn empire-btn on" : "btn empire-btn"} title={t("empire.open")} aria-pressed={open} onClick={() => empireStore.getState().set({ open: !open })}>
      ⚑ <span className="mono">{fleets}</span> · ⌂ <span className={short ? "mono empire-short" : "mono"}>{colonies.length}</span>
    </button>
  );
}

/**
 * El imperio en una ventana con pestañas (en vez de una pila de cajas a la
 * izquierda): flotas, colonias, batallas y, a bordo de una nodriza o en el
 * túnel, el puente de mando. Se abre y se pliega con su botón de la barra
 * superior; va a la derecha (la izquierda es de la barra de acciones).
 */
export function EmpireWindow({ bridge = false }: { bridge?: boolean }) {
  const t = useT();
  const fleets = useWorld((s) => Object.values(s.fleets) as Fleet[]);
  const colonies = useWorld((s) => Object.values(s.colonies) as Colony[]);
  const state = useStore(empireStore, (s) => s);
  const save = (next: { open: boolean; tab: EmpireTab }) => state.set(next);
  const tabs: Array<{ id: EmpireTab; label: I18nKey; n?: number }> = [
    ...(bridge ? [{ id: "bridge" as const, label: "empire.tab.bridge" as const }] : []),
    { id: "fleets", label: "empire.tab.fleets", n: fleets.length },
    { id: "colonies", label: "empire.tab.colonies", n: colonies.length },
    { id: "war", label: "empire.tab.war" },
  ];
  const tab = tabs.some((x) => x.id === state.tab) ? state.tab : bridge ? "bridge" : "fleets";

  if (!state.open) return null;
  return (
    <section className="empire-win panel" aria-label={t("empire.title")}>
      <header className="empire-head">
        <nav className="planet-win-tabs empire-tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === tab} className={x.id === tab ? "planet-win-tab active" : "planet-win-tab"} onClick={() => save({ open: true, tab: x.id })}>
              {t(x.label)}
              {x.n !== undefined && <span className="empire-count">{x.n}</span>}
            </button>
          ))}
        </nav>
        <button type="button" className="icon-btn" aria-label={t("empire.close")} title={t("empire.close")} onClick={() => save({ ...state, open: false })}>
          ▁
        </button>
      </header>
      <div className="empire-body" key={tab}>
        {tab === "bridge" && <BridgePanel />}
        {tab === "fleets" && <FleetsPanel />}
        {tab === "colonies" && <ColoniesPanel />}
        {tab === "war" && <WarPanel />}
      </div>
    </section>
  );
}
