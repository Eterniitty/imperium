import { useState } from "react";
import { useGame, useT } from "../state/store";
import { useKeyLabels } from "./keys";

/** Ayuda de controles. Las teclas salen de los ajustes, así que siempre están al día. */
export function HelpPanel() {
  const t = useT();
  const keys = useKeyLabels();
  const view = useGame((s) => s.view);
  const flight = useGame((s) => s.flight);
  const [open, setOpen] = useState(true);
  const piloting = view === "system" && flight;
  return (
    <div className="help panel hide-sm">
      <button className="help-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("help.title")} {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul>
          {piloting ? (
            <>
              <li>{t("help.pilotMouse")}</li>
              <li>{t("help.keysPilot", keys)}</li>
            </>
          ) : (
            <>
              <li>{t("help.rotate")}</li>
              <li>{t("help.pan")}</li>
              <li>{t("help.zoom")}</li>
              <li>{t("help.select")}</li>
              <li>{t("help.keysMap", keys)}</li>
            </>
          )}
          <li className="help-sep">{t("help.keysEdit")}</li>
        </ul>
      )}
    </div>
  );
}
