import { useState } from "react";
import { useT } from "../state/store";

export function HelpPanel() {
  const t = useT();
  const [open, setOpen] = useState(true);
  return (
    <div className="help panel hide-sm">
      <button className="help-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("help.title")} {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul>
          <li>{t("help.rotate")}</li>
          <li>{t("help.pan")}</li>
          <li>{t("help.zoom")}</li>
          <li>{t("help.move")}</li>
          <li>{t("help.boost")}</li>
          <li>{t("help.select")}</li>
          <li>{t("help.focus")}</li>
          <li className="help-sep">{t("help.flightToggle")}</li>
          <li>{t("help.flightLook")}</li>
          <li>{t("help.flightMove")}</li>
        </ul>
      )}
    </div>
  );
}
