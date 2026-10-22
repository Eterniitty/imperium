import { SpeedDial } from "./SpeedDial";
import { fmtSpeedMs } from "./SettingsPanel";
import { useEffect, useState } from "react";
import { engineRef } from "../engineRef";
import { useTelemetry } from "../engine/telemetry";
import { gameStore, useGame, useT } from "../state/store";
import { formatDistance } from "./FlightHud";
import { formatDuration } from "./useNow";
import { useSettings } from "../state/settings";
import { HudIcon } from "./hudIcons";

type Option = ReturnType<NonNullable<typeof engineRef.current>["cruiseOptions"]>[number];

/**
 * Lista del piloto automático de crucero (botón «Crucero» de la barra de acciones): cuerpos,
 * cinturones, anomalía y asteroides a los que ir, y naves a las que seguir
 * (primero los compañeros). Se refresca cada segundo.
 */
export function CruisePanel() {
  const t = useT();
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
      {(o.kind === "planet" || o.kind === "moon") && (
        <button className="btn cruise-orbit" title={t("cruise.orbitHint", { name: o.name })} onClick={() => engineRef.current?.cruiseTo(o.id, true)}>
          {t("cruise.orbit")}
        </button>
      )}
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
      <div data-tutorial="speed-dial">
        <SpeedDial />
      </div>
      <p className="muted small">{t("cruise.hint")}</p>
      <h3>{t("cruise.ships")}</h3>
      {ships.length === 0 ? <p className="muted small">{t("cruise.noShipsList")}</p> : <ul className="quantum-list">{ships.map(row)}</ul>}
      <h3>{t("cruise.places")}</h3>
      {places.length === 0 ? <p className="muted small">{t("cruise.none")}</p> : <ul className="quantum-list" data-tutorial="cruise-list">{places.map(row)}</ul>}
    </aside>
  );
}

/** El aviso del crucero, minimizado o no (se recuerda en este navegador). */
function readMini(): boolean {
  try {
    return localStorage.getItem("aeon.cruiseHudMini") === "1";
  } catch {
    return false;
  }
}

/** Aviso en el HUD mientras el piloto automático está puesto: modo, destino, fase, distancia y cómo cancelarlo. */
export function CruiseHud() {
  const t = useT();
  const flight = useGame((s) => s.flight);
  const tel = useTelemetry(200);
  const c = tel.cruise;
  const cruiseLimit = useSettings((s) => s.prefs.flight.cruiseLimit);
  const [mini, setMini] = useState(readMini);
  const toggle = () => {
    setMini(!mini);
    try {
      localStorage.setItem("aeon.cruiseHudMini", mini ? "0" : "1");
    } catch {
      // Sin almacenamiento: solo dura esta sesión.
    }
  };
  if (!flight || !c) return null;
  if (mini) {
    // Minimizado: una pastilla con el destino y la llegada (clic: desplegar).
    return (
      <button type="button" className="cruise-pill panel" role="status" data-tutorial="cruise-hud" title={t("cruise.hud.expand")} onClick={toggle}>
        <HudIcon name={c.phase === "orbit" ? "orbit" : "cruise"} size={14} className="cruise-pill-arrow" />
        <strong>{c.name}</strong>
        {c.phase !== "orbit" && c.seconds !== null && <span className="mono">{formatDuration(c.seconds * 1000)}</span>}
        <span className="mono muted">{fmtSpeedMs(tel.speed)}</span>
      </button>
    );
  }
  return (
    <div className="cruise-hud panel" role="status" data-tutorial="cruise-hud">
      <button type="button" className="icon-btn cruise-hud-min" aria-label={t("cruise.hud.minimize")} title={t("cruise.hud.minimize")} onClick={toggle}>
        ▁
      </button>
      {c.phase !== "orbit" && <SpeedDial size={112} speed={tel.speed} wheel={false} />}
      <div className="cruise-info">
        <div className="stat-label">
          {t("cruise.title")} · {t(`cruise.phase.${c.phase}`)}
        </div>
        {c.phase === "orbit" ? (
          // En órbita: la velocidad orbital real y la altitud sobre el cuerpo (la distancia al punto que persigue no dice nada).
          <>
            <div className="cruise-target">
              {t("cruise.hud.orbit")} <strong>{c.name}</strong>
            </div>
            <div className="mono">{t("cruise.hud.orbitStats", { speed: fmtSpeedMs(tel.speed), altitude: formatDistance(tel.nearest?.distance ?? 0) })}</div>
          </>
        ) : (
          <>
            <div className="cruise-target">
              {t(c.mode === "follow" ? "cruise.hud.follow" : c.mode === "orbit" ? "cruise.hud.orbit" : "cruise.hud.goto")} <strong>{c.name}</strong>
            </div>
            <div className="cruise-figures">
              <span>
                <small>{t("cruise.hud.distance")}</small>
                <b className="mono">{formatDistance(c.distance)}</b>
              </span>
              <span>
                <small>{t("cruise.hud.eta")}</small>
                <b className="mono">{c.seconds !== null ? formatDuration(c.seconds * 1000) : "—"}</b>
              </span>
              <span>
                <small>{t("flight.speed")}</small>
                <b className="mono">{fmtSpeedMs(tel.speed)}</b>
              </span>
            </div>
          </>
        )}
        {cruiseLimit > 0 && c.phase !== "orbit" && <div className="small cruise-limited">{t("cruise.hud.limited", { v: fmtSpeedMs(cruiseLimit) })}</div>}
        <div className="cruise-cancel">
          <span className="muted small">{t("cruise.hud.cancel")}</span>
          <button className="btn small" onClick={() => engineRef.current?.cancelCruise()}>
            {t("cruise.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
