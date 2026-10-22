import { CrisisBanner } from "./CrisisBanner";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { engineRef } from "../engineRef";
import { useAuth } from "../state/auth";
import { gameStore } from "../state/store";
import { useKeyLabels } from "./keys";
import { formatDuration, useServerNow } from "./useNow";
import { useGame, useT } from "../state/store";
import { ServerStatus } from "./ServerStatus";
import { EmpireButton } from "./EmpireWindow";
import { ContractsButton } from "./ContractsWindow";
import { HudIcon } from "./hudIcons";
import { useWorld } from "../net/world";
import { rankOf } from "@imperium/content";
import type { I18nKey } from "@imperium/shared";
import { fmtCredits, fmtInt, fmtRate, liveCredits, liveHumans } from "./colonies";

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
  const rankXp = useWorld((s) => s.rank?.xp ?? null);
  const rankTitle = rankXp === null ? null : t(`rank.title.${rankOf(rankXp).rank.id}` as I18nKey);
  const humans = useWorld((s) => s.humans);
  const wallet = useWorld((s) => s.wallet);
  const keys = useKeyLabels();
  const now = useServerNow();
  const travel = emperor?.travel && emperor.travel.arriveAt > now ? emperor.travel : null;
  const [target, setTarget] = useState({ x: "0", y: "0", z: "0" });
  // Alto real de la barra (puede pasar a dos líneas si no cabe): los paneles se colocan debajo con `--topbar-bottom`.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty("--topbar-bottom", `${Math.round(el.getBoundingClientRect().bottom)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = (e: FormEvent) => {
    e.preventDefault();
    const c = { x: Number.parseInt(target.x, 10), y: Number.parseInt(target.y, 10), z: Number.parseInt(target.z, 10) };
    if ([c.x, c.y, c.z].some((n) => !Number.isFinite(n))) return;
    engineRef.current?.goToSector(c);
  };

  return (
    <header ref={bar} className="topbar panel">
      <div className="brand">
        <span className="brand-mark">✦</span> {t("app.title")}
      </div>

      {emperor && (
        <button className="stat stat-button" onClick={() => engineRef.current?.goToEmperor()} title={t("emperor.goTo")}>
          <span className="stat-label">
            {t("emperor.label")}
            {rankTitle && <> · {rankTitle}</>}
          </span>
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

      {/* Economía de la humanidad: créditos (abre el mercado) y el panel «Humanidad». */}
      {emperor && wallet && (
        <button className="stat stat-button credits-stat" onClick={() => gameStore.getState().setEconomyOpen("market")} title={t("eco.marketTitle")}>
          <span className="stat-label">{t("eco.credits")}</span>
          <span className="stat-value mono">₢ {fmtCredits(liveCredits(wallet, now))}</span>
        </button>
      )}
      {emperor && (
        <button className="btn hide-sm" onClick={() => gameStore.getState().setEconomyOpen("humanity")} title={t("eco.humanityTitle")}>
          {t("eco.humanity")}
        </button>
      )}
      {/* Fase 10: linaje (Cunas, Herederos, muertes); en rojo mientras el Emperador se gesta. */}
      {emperor && (
        <button className={emperor.gestating ? "btn hide-sm lineage-btn dead" : "btn hide-sm lineage-btn"} onClick={() => gameStore.getState().setLineageOpen(true)} title={t("lineage.openTitle")}>
          {t("lineage.open")}
        </button>
      )}
      {/* Astillero: diseño de naves por piezas. */}
      {emperor && (
        <button className="btn hide-sm" onClick={() => gameStore.getState().setShipEditorOpen(true)} title={t("shipEditor.openTitle")}>
          {t("shipEditor.open")}
        </button>
      )}

      {/* Imperio: flotas y colonias en una ventana con pestañas. */}
      {emperor && <EmpireButton />}
      {emperor && <ContractsButton />}
      {emperor && (
        <button className="btn" onClick={() => engineRef.current?.toggleMap()} title={t("action.toggleMap")}>
          {t((view === "system" && flight) || view === "tunnel" ? "pilot.map" : "pilot.pilot")} <kbd>{keys.toggleMap}</kbd>
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
        <CrisisBanner />
        <ServerStatus compact />
        {/* La Wiki es una página aparte: en otra pestaña, para no perder la partida. */}
        <a className="btn btn-link" href="/wiki/" target="_blank" rel="noopener" title={t("wiki.openTitle")}>
          {t("wiki.open")}
        </a>
        {/* Lo menos usado: posición, sistemas cargados, ir a unas coordenadas y FPS (la barra cabe en una línea). */}
        <details className="topbar-more">
          <summary className="icon-btn" title={t("hud.more")} aria-label={t("hud.more")}>
            ⋯
          </summary>
          <div className="topbar-more-menu panel">
            {view !== "system" && (
              <>
          <div className="stat">
            <span className="stat-label">{t("hud.position")}</span>
            <span className="stat-value mono">
              {fmt(focus.x)}, {fmt(focus.y)}, {fmt(focus.z)} {t("unit.ly")}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">{t("hud.systems")}</span>
            <span className="stat-value mono">{loaded.toLocaleString()}</span>
          </div>
          <form className="goto" onSubmit={go} title={t("hud.gotoTitle")}>
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
            <span className="fps mono">
              {fps} {t("hud.fps")}
            </span>
          </div>
        </details>
        <button className="icon-btn" onClick={() => gameStore.getState().setSettingsOpen(true)} aria-label={t("settings.open")} title={t("settings.title")}>
          <HudIcon name="gear" size={16} />
        </button>

      </div>
    </header>
  );
}
