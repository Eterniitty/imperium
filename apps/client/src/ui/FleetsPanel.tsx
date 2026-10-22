import { useState } from "react";
import { fleetName } from "./fleetName";
import { getShipClass, type ShipClassId } from "@imperium/content";
import { PLANET_NAME_MAX, PLANET_NAME_MIN, type Colony, type Fleet, type I18nKey } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { connection, useWorld } from "../net/world";
import { useAliens } from "../state/aliens";
import { factionName, speciesColor } from "./aliens";
import { gameStore, useGame, useT } from "../state/store";
import { cargoSummary } from "./FleetLogistics";
import { contentText, shipCounts } from "./fleets";
import { ShipThumb } from "./ShipThumb";
import { formatDuration, useServerNow } from "./useNow";

/** La nave armada más grande de una flota (la que se pilota a distancia), o undefined si no tiene. */
function armedShip(f: Fleet): Fleet["ships"][number] | undefined {
  let best: { ship: Fleet["ships"][number]; hull: number } | undefined;
  for (const s of f.ships) {
    const cls = getShipClass(s.classId as ShipClassId);
    if (!cls || cls.combat.weapons.length === 0) continue;
    if (!best || cls.hull > best.hull) best = { ship: s, hull: cls.hull };
  }
  return best?.ship;
}

/** ¿Le queda a la flota menos de un cuarto de depósito a alguna nave? */
function fuelLow(f: Fleet): boolean {
  return f.ships.some((s) => s.fuelMax > 0 && s.fuel < s.fuelMax * 0.25);
}

const ownColonyIn = (colonies: Record<string, Colony>, systemId: string) => Object.values(colonies).some((c) => c.systemId === systemId);

/** Lista de las flotas propias: dónde están, a dónde van y con qué naves. Clic: centrar en la flota. */
export function FleetsPanel() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const fleets = useWorld((s) => s.fleets);
  const colonies = useWorld((s) => s.colonies);
  const territory = useAliens((s) => s.territory);
  const now = useServerNow();
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState<I18nKey | null>(null);
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
              <li key={f.id} className="fleet-item">
                {/* Renombrar la flota: un nombre propio en vez de «Flota N» (vacío: vuelve al número). */}
                {renaming?.id === f.id ? (
                  <form
                    className="fleet-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void connection.command("fleet.rename", { fleetId: f.id, name: renaming.name }).then((err) => (err ? setRenameError(err) : setRenaming(null)));
                    }}
                  >
                    <input autoFocus maxLength={PLANET_NAME_MAX} value={renaming.name} placeholder={t("fleet.name", { n: f.number })} onChange={(e) => setRenaming({ id: f.id, name: e.target.value })} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setRenaming(null))} />
                    <button className="btn btn-small" type="submit">
                      {t("colony.save")}
                    </button>
                    {renameError && <span className="auth-error small">{t(renameError, { min: PLANET_NAME_MIN, max: PLANET_NAME_MAX })}</span>}
                  </form>
                ) : (
                  <button
                    type="button"
                    className="icon-btn fleet-rename-btn"
                    title={t("fleet.rename")}
                    aria-label={t("fleet.rename")}
                    onClick={() => {
                      setRenameError(null);
                      setRenaming({ id: f.id, name: f.name ?? "" });
                    }}
                  >
                    ✎
                  </button>
                )}
                <button className="fleet-row" onClick={() => engineRef.current?.goToFleet(f.id)}>
                  <strong>{fleetName(f, t)}</strong>
                  <span className="muted small">
                    {moving
                      ? t("fleet.travelling", { system: moving.to.systemName, time: formatDuration(moving.arriveAt - now) })
                      : t("fleet.at", { system: at.systemName })}
                  </span>
                  <span className="small fleet-ships">
                    {shipCounts(f).map(({ key, classId, design, n }) => (
                      <span key={key}>
                        <ShipThumb classId={classId} size={34} design={f.ships.find((s) => s.design?.name === design)?.design} />
                        {t("ship.count", { count: n, name: design ?? contentText(locale, `ship.${classId}.name`) })}
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
                  {/* Combustible: el alcance de la flota es el de la nave con menos. */}
                  {f.ships.length > 0 && (
                    <span className={fuelLow(f) ? "small fuel-low" : "muted small"} title={t("fleet.fuel")}>
                      ⛽ {t("fleet.fuelRange", { ly: Math.floor(Math.min(...f.ships.map((s) => s.fuel))) })}
                    </span>
                  )}
                  {f.route && <span className="small route-tag">{t("logistics.onRoute")}</span>}
                  {f.battleId && <span className="small battle-tag">{t("fleet.inBattle")}</span>}
                </button>
                {/* Repostar en una colonia propia del sistema (también lo hace sola al llegar). */}
                {!moving && f.ships.some((s) => s.fuel < s.fuelMax - 0.5) && ownColonyIn(colonies, at.systemId) && (
                  <button className="link-btn small" title={t("fleet.refuelHint")} onClick={() => void connection.command("fleet.refuel", { fleetId: f.id }).then((e) => e && gameStore.getState().notify(e))}>
                    {t("fleet.refuel")}
                  </button>
                )}
                {/* Pilotar a distancia una nave armada de la flota parada. */}
                {!moving && !f.battleId && armedShip(f) && (
                  <button className="link-btn small" title={t("remote.pilotTitle")} onClick={() => void engineRef.current?.pilotFleetShip(f.id, armedShip(f)!.id)}>
                    {t("remote.pilot")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
