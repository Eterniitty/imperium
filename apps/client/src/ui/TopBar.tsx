import { useState, type FormEvent } from "react";
import { engineRef } from "../engineRef";
import { useGame, useT } from "../state/store";
import { LanguageToggle } from "./LanguageToggle";

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

      {view === "system" ? (
        <>
          <button className="btn" onClick={() => engineRef.current?.exitSystem()}>
            ← {t("view.back")}
          </button>
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
          <div className="stat hide-sm">
            <span className="stat-label">{t("hud.position")}</span>
            <span className="stat-value mono">
              {fmt(focus.x)}, {fmt(focus.y)}, {fmt(focus.z)} {t("unit.ly")}
            </span>
          </div>
          <div className="stat hide-sm">
            <span className="stat-label">{t("hud.systems")}</span>
            <span className="stat-value mono">{loaded.toLocaleString()}</span>
          </div>
          <form className="goto hide-sm" onSubmit={go} title={t("hud.gotoTitle")}>
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
        <span className="fps mono">
          {fps} {t("hud.fps")}
        </span>
        <LanguageToggle />
      </div>
    </header>
  );
}
