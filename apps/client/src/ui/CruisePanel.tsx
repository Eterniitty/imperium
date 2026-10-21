import { useEffect, useState } from "react";
import { engineRef } from "../engineRef";
import { useTelemetry } from "../engine/telemetry";
import { gameStore, useGame, useT } from "../state/store";
import { formatDistance } from "./FlightHud";
import { useKeyLabels } from "./keys";
import { formatDuration } from "./useNow";

type Option = ReturnType<NonNullable<typeof engineRef.current>["cruiseOptions"]>[number];

/**
 * Lista del piloto automático de crucero (tecla N al pilotar): cuerpos,
 * cinturones, anomalía y asteroides a los que ir, y naves a las que seguir
 * (primero los compañeros). Se refresca cada segundo.
 */
export function CruisePanel() {
  const t = useT();
  const keys = useKeyLabels();
  const open = useGame((s) => s.cruisePanel);
  const [options, setOptions] = useState<Option[]>([]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const refresh = () => {
      setOptions(engineRef.current?.cruiseOptions() ?? []);
      setActive(engineRef.current?.cruiseTarget?.id ?? null);
    };
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [open]);
  if (!open) return null;
  const places = options.filter((o) => o.kind !== "ship");
  const rank = (o: Option) => (o.ally ? 0 : o.pirate ? 2 : 1);
  const ships = options.filter((o) => o.kind === "ship").sort((a, b) => rank(a) - rank(b) || a.distance - b.distance);

  const row = (o: Option) => (
    <li key={o.id}>
      <button className={o.id === active ? "quantum-dest active" : "quantum-dest"} onClick={() => engineRef.current?.cruiseTo(o.id)}>
        <span className="quantum-name">
          <strong>{o.name}</strong>
          <span className="tag">{t(`cruise.kind.${o.kind}`)}</span>
          {o.ally && <span className="tag ally">{t("cruise.tag.ally")}</span>}
          {o.pirate && <span className="tag warn">{t("cruise.tag.pirate")}</span>}
          {o.own && <span className="tag own">{t("cruise.tag.own")}</span>}
        </span>
        <span className="mono small">
          {formatDistance(o.distance)} · {t(o.kind === "ship" ? "cruise.follow" : "cruise.go")}
        </span>
      </button>
    </li>
  );

  return (
    <aside className="side panel quantum-panel" aria-label={t("cruise.title")}>
      <div className="side-head">
        <div>
          <h2>{t("cruise.title")}</h2>
        </div>
        <button className="icon-btn" onClick={() => gameStore.getState().setCruisePanel(false)} aria-label={t("cruise.close")}>
          ✕
        </button>
      </div>
      <p className="muted small">{t("cruise.hint", { cruise: keys.cruise, follow: keys.follow })}</p>
      <h3>{t("cruise.ships")}</h3>
      {ships.length === 0 ? <p className="muted small">{t("cruise.noShipsList")}</p> : <ul className="quantum-list">{ships.map(row)}</ul>}
      <h3>{t("cruise.places")}</h3>
      {places.length === 0 ? <p className="muted small">{t("cruise.none")}</p> : <ul className="quantum-list">{places.map(row)}</ul>}
    </aside>
  );
}

/** Aviso en el HUD mientras el piloto automático está puesto: modo, destino, fase, distancia y cómo cancelarlo. */
export function CruiseHud() {
  const t = useT();
  const keys = useKeyLabels();
  const flight = useGame((s) => s.flight);
  const tel = useTelemetry(200);
  const c = tel.cruise;
  if (!flight || !c) return null;
  return (
    <div className="cruise-hud panel" role="status">
      <div className="stat-label">
        {t("cruise.title")} · {t(`cruise.phase.${c.phase}`)}
      </div>
      <div>
        {t(c.mode === "follow" ? "cruise.hud.follow" : "cruise.hud.goto")} <strong>{c.name}</strong> · <span className="mono">{formatDistance(c.distance)}</span>
        {c.seconds !== null && <span className="mono"> · {formatDuration(c.seconds * 1000)}</span>}
      </div>
      <div className="muted small">
        {t("cruise.hud.cancel", { key: keys.cruise })}
        <button className="link-btn" onClick={() => engineRef.current?.cancelCruise()}>
          {t("cruise.cancel")}
        </button>
      </div>
    </div>
  );
}
