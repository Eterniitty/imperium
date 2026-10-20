import { useState } from "react";
import type { Colony } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { useWorld } from "../net/world";
import { findSystemSummary, gameStore, useT } from "../state/store";
import { fmtInt, livePopulation } from "./colonies";
import { useServerNow } from "./useNow";

/** Lista de las colonias propias. Clic: selecciona su sistema y su planeta (y centra la cámara). */
export function ColoniesPanel() {
  const t = useT();
  const colonies = useWorld((s) => s.colonies);
  const now = useServerNow();
  const [open, setOpen] = useState(true);
  const list = (Object.values(colonies) as Colony[]).sort((a, b) => a.foundedAt - b.foundedAt);
  if (list.length === 0) return null;

  const go = (c: Colony) => {
    const summary = findSystemSummary(c.systemId);
    if (!summary) return;
    const g = gameStore.getState();
    g.select(summary);
    g.selectPlanet(c.planetIndex);
    engineRef.current?.focusSelected();
  };

  return (
    <div className="fleets colonies panel hide-sm">
      <button className="help-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("colony.title")} {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul className="fleet-list">
          {list.map((c) => (
            <li key={c.id}>
              <button className="fleet-row" onClick={() => go(c)}>
                <strong>{c.name ?? c.planetName}</strong>
                <span className="muted small">{t("colony.in", { planet: c.planetName, system: c.systemName })}</span>
                <span className="small">
                  {t("colony.population")}: <span className="mono">{fmtInt(livePopulation(c, now))}</span>
                  {c.builds.length > 0 && <> · {t("colony.queue")}: {c.builds.length}</>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
