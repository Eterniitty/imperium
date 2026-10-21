import { useEffect } from "react";
import { gameStore, useGame, useT } from "../state/store";
import { HumanityTab } from "./HumanityTab";
import { MarketTab } from "./MarketTab";

/**
 * Economía de la humanidad y mercado global: un panel con dos pestañas
 * («Humanidad» y «Mercado») que se abre desde la barra superior. Todo lo que
 * muestra viene del servidor; las órdenes van por el WebSocket.
 */
export function EconomyPanel() {
  const t = useT();
  const tab = useGame((s) => s.economyOpen);
  const close = () => gameStore.getState().setEconomyOpen(null);

  // Esc cierra el panel sin que la tecla llegue al juego.
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [tab]);

  if (!tab) return null;
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="settings economy panel" role="dialog" aria-labelledby="economy-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2 id="economy-title">{t(tab === "humanity" ? "eco.humanity" : "eco.market")}</h2>
          <button className="icon-btn" aria-label={t("settings.close")} onClick={close}>
            ×
          </button>
        </div>
        <div className="tabs" role="tablist">
          {(["humanity", "market"] as const).map((id) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "lang-btn active" : "lang-btn"} onClick={() => gameStore.getState().setEconomyOpen(id)}>
              {t(id === "humanity" ? "eco.humanity" : "eco.market")}
            </button>
          ))}
        </div>
        {tab === "humanity" ? <HumanityTab /> : <MarketTab />}
      </div>
    </div>
  );
}
