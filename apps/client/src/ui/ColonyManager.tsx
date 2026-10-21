import { useEffect, useState } from "react";
import type { Colony, I18nKey } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { gameStore, useGame, useT } from "../state/store";
import { fmtInt, livePopulation } from "./colonies";
import { ColonyDetail } from "./PlanetColony";
import { useServerNow } from "./useNow";

/**
 * Gestión de colonias desde cualquier sitio (también durante el viaje
 * cuántico): la lista de colonias propias con lo que pide atención y, de la
 * elegida, existencias, producción, instalaciones (construir y derribar) y
 * cola de obras. Lo que exige estar allí (desembarcar, descargar) sigue en
 * la ficha del planeta.
 */
export function ColonyManager() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const openId = useGame((s) => s.colonyManager);
  const colonies = useWorld((s) => s.colonies);
  const now = useServerNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const close = () => gameStore.getState().setColonyManager(null);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [openId]);
  useEffect(() => setError(null), [openId]);

  if (!openId) return null;
  const list = (Object.values(colonies) as Colony[]).sort((a, b) => a.foundedAt - b.foundedAt);
  const colony = colonies[openId] ?? list[0];
  const run = async (op: Promise<I18nKey | null>) => {
    setBusy(true);
    setError(await op);
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="settings colony-manager panel" role="dialog" aria-labelledby="colony-manager-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2 id="colony-manager-title">{t("colony.manager")}</h2>
          <button className="icon-btn" aria-label={t("settings.close")} onClick={close}>
            ×
          </button>
        </div>
        {list.length === 0 || !colony ? (
          <p className="muted">{t("colony.noColonies")}</p>
        ) : (
          <div className="colony-manager-body">
            <ul className="fleet-list colony-manager-list">
              {list.map((c) => (
                <li key={c.id}>
                  <button className={c.id === colony.id ? "fleet-row active" : "fleet-row"} onClick={() => gameStore.getState().setColonyManager(c.id)}>
                    <strong>{c.name ?? c.planetName}</strong>
                    <span className="muted small">{t("colony.in", { planet: c.planetName, system: c.systemName })}</span>
                    <span className="small">
                      {t("colony.population")}: <span className="mono">{fmtInt(livePopulation(c, now))}</span>
                      {c.builds.length > 0 && <> · {t("colony.queue")}: {c.builds.length}</>}
                    </span>
                    {c.shortage && <span className="small battle-tag">{t("colony.shortageShort")}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="colony colony-manager-detail">
              <h3>{colony.name ?? colony.planetName}</h3>
              <ColonyDetail
                colony={colony}
                now={now}
                busy={busy}
                locale={locale}
                onBuild={(kind, itemId) => void run(connection.command("colony.build", { colonyId: colony.id, kind, itemId }))}
                onCancel={(buildId) => void run(connection.command("colony.cancel", { colonyId: colony.id, buildId }))}
                onDemolish={(installationId) => void run(connection.command("colony.demolish", { colonyId: colony.id, installationId }))}
              />
              {error && (
                <p className="auth-error" role="alert">
                  {t(error)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
