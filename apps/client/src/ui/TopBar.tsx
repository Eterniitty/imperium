import { useState, type FormEvent } from "react";
import { engineRef } from "../engineRef";
import { useAuth } from "../state/auth";
import { gameStore } from "../state/store";
import { useKeyLabels } from "./keys";
import { formatDuration, useServerNow } from "./useNow";
import { useGame, useT } from "../state/store";
import { ServerStatus } from "./ServerStatus";
import { useWorld } from "../net/world";
import { fmtInt, fmtRate, liveHumans } from "./colonies";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function TopBar() {
  const t = useT();
  const view = useGame((s) => s.view);
  const sector = useGame((s) => s.focusSector);
  const focus = useGame((s) => s.focusWorld);
  const loaded = useGame((s) => s.loadedSystems);
  const fps = useGame((s) => s.fps);
  const selected = useGame((s) => s.selected);
  const flight = useGame((s) => s.flight);
  const emperor = useAuth((s) => s.emperor);
  const humans = useWorld((s) => s.humans);
  const keys = useKeyLabels();
  const now = useServerNow();
  const travel = emperor?.travel && emperor.travel.arriveAt > now ? emperor.travel : null;
  const [target, setTarget] = useState({ x: "0", y: "0", z: "0" });

  const go = (e: FormEvent) => {
    e.preventDefault();
    const c = { x: Number.parseInt(target.x, 10), y: Number.parseInt(target.y, 10), z: Number.parseInt(target.z, 10) };
    if ([c.x, c.y, c.z].some((n) => !Number.isFinite(n))) return;
    engineRef.current?.goToSector(c);
  };

  return (
    <header className="topbar panel">
      <div className="brand">
        <span className="brand-mark">✦</span> {t("app.title")}
      </div>

      {emperor && (
        <button className="stat stat-button" onClick={() => engineRef.current?.goToEmperor()} title={t("emperor.goTo")}>
          <span className="stat-label">{t("emperor.label")}</span>
          <span className="stat-value">{emperor.name}</span>
          {travel && (
            <span className="stat-sub">
              {t("emperor.travelling", { system: travel.to.systemName })} · <span className="mono">{formatDuration(travel.arriveAt - now)}</span>
            </span>
          )}
        </button>
      )}

      {emperor && humans && (
        <div className="stat humans-stat hide-sm" title={t("humans.title", { rate: fmtRate(humans.perHour).replace("+", "") })}>
          <span className="stat-label">{t("humans.label")}</span>
          <span className="stat-value mono">
            {fmtInt(liveHumans(humans, now))} / {fmtInt(humans.capacity)}
          </span>
        </div>
      )}

      {emperor && (
        <button className="btn" onClick={() => engineRef.current?.toggleMap()} title={t("action.toggleMap")}>
          {t(view === "system" && flight ? "pilot.map" : "pilot.pilot")} <kbd>{keys.toggleMap}</kbd>
        </button>
      )}

      {view === "system" ? (
        <>
          {!flight && (
            <button className="btn" onClick={() => engineRef.current?.exitSystem()}>
              ← {t("view.back")}
            </button>
          )}
          <div className="stat">
            <span className="stat-label">{t("view.system")}</span>
            <span className="stat-value">{selected?.name}</span>
          </div>
        </>
      ) : (
        <>
          <div className="stat">
            <span className="stat-label">{t("hud.sector")}</span>
            <span className="stat-value mono">
              {sector.x} · {sector.y} · {sector.z}
            </span>
          </div>
          <div className="stat hide-md">
            <span className="stat-label">{t("hud.position")}</span>
            <span className="stat-value mono">
              {fmt(focus.x)}, {fmt(focus.y)}, {fmt(focus.z)} {t("unit.ly")}
            </span>
          </div>
          <div className="stat hide-sm">
            <span className="stat-label">{t("hud.systems")}</span>
            <span className="stat-value mono">{loaded.toLocaleString()}</span>
          </div>
          <form className="goto hide-md" onSubmit={go} title={t("hud.gotoTitle")}>
            {(["x", "y", "z"] as const).map((k) => (
              <input
                key={k}
                aria-label={k}
                value={target[k]}
                inputMode="numeric"
                onChange={(e) => setTarget({ ...target, [k]: e.target.value.replace(/[^-0-9]/g, "") })}
              />
            ))}
            <button className="btn" type="submit">
              {t("hud.goto")}
            </button>
          </form>
        </>
      )}

      <div className="topbar-right">
        {view === "galaxy" && (
          <div className="mode" role="group" title={t("hud.modeTitle")}>
            <button className={flight ? "lang-btn" : "lang-btn active"} aria-pressed={!flight} onClick={() => flight && engineRef.current?.toggleFlight()}>
              {t("hud.modeOrbit")}
            </button>
            <button className={flight ? "lang-btn active" : "lang-btn"} aria-pressed={flight} onClick={() => !flight && engineRef.current?.toggleFlight()}>
              {t("hud.modeFlight")} <kbd>V</kbd>
            </button>
          </div>
        )}
        <ServerStatus />
        {/* La Wiki es una página aparte: en otra pestaña, para no perder la partida. */}
        <a className="btn btn-link" href="/wiki/" target="_blank" rel="noopener" title={t("wiki.openTitle")}>
          {t("wiki.open")}
        </a>
        <button className="icon-btn" onClick={() => gameStore.getState().setSettingsOpen(true)} aria-label={t("settings.open")} title={t("settings.title")}>
          ⚙
        </button>
        <span className="fps mono">
          {fps} {t("hud.fps")}
        </span>
      </div>
    </header>
  );
}
