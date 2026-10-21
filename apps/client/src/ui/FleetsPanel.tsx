import { useState } from "react";
import type { Fleet } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { useWorld } from "../net/world";
import { useAliens } from "../state/aliens";
import { factionName, speciesColor } from "./aliens";
import { useGame, useT } from "../state/store";
import { cargoSummary } from "./FleetLogistics";
import { contentText, shipCounts } from "./fleets";
import { ShipThumb } from "./ShipThumb";
import { formatDuration, useServerNow } from "./useNow";

/** Lista de las flotas propias: dónde están, a dónde van y con qué naves. Clic: centrar en la flota. */
export function FleetsPanel() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const fleets = useWorld((s) => s.fleets);
  const territory = useAliens((s) => s.territory);
  const now = useServerNow();
  const [open, setOpen] = useState(true);
  const list = (Object.values(fleets) as Fleet[]).sort((a, b) => a.number - b.number);
  if (list.length === 0) return null;

  return (
    <div className="fleets panel hide-sm">
      <button className="help-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("fleet.title")} {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul className="fleet-list">
          {list.map((f) => {
            const moving = f.travel && f.travel.arriveAt > now ? f.travel : null;
            const at = f.travel && !moving ? f.travel.to : f.location;
            return (
              <li key={f.id}>
                <button className="fleet-row" onClick={() => engineRef.current?.goToFleet(f.id)}>
                  <strong>{t("fleet.name", { n: f.number })}</strong>
                  <span className="muted small">
                    {moving
                      ? t("fleet.travelling", { system: moving.to.systemName, time: formatDuration(moving.arriveAt - now) })
                      : t("fleet.at", { system: at.systemName })}
                  </span>
                  <span className="small fleet-ships">
                    {shipCounts(f).map(([id, n]) => (
                      <span key={id}>
                        <ShipThumb classId={id} size={34} />
                        {t("ship.count", { count: n, name: contentText(locale, `ship.${id}.name`) })}
                      </span>
                    ))}
                  </span>
                  {cargoSummary(f).resources + cargoSummary(f).humans > 0 && (
                    <span className="muted small">
                      {t("logistics.carrying", { n: Math.round(cargoSummary(f).resources), h: Math.round(cargoSummary(f).humans) })}
                    </span>
                  )}
                  {/* Fase 11: territorio alienígena donde está la flota. */}
                  {!moving && territory[at.systemId] && (
                    <span className="small" style={{ color: speciesColor(territory[at.systemId]!.speciesId) }}>
                      {t("fleet.inTerritory", { faction: factionName(locale, territory[at.systemId]!.factionId) })}
                    </span>
                  )}
                  {f.route && <span className="small route-tag">{t("logistics.onRoute")}</span>}
                  {f.battleId && <span className="small battle-tag">{t("fleet.inBattle")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
