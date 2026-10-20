import { useEffect, useState } from "react";
import { distance, type I18nKey } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { authStore, useAuth } from "../state/auth";
import { gameStore, useGame, useT } from "../state/store";
import { DepositChips, Meter, RESOURCE_COLORS, starColorCss } from "./common";

export function SystemPanel() {
  const t = useT();
  const selected = useGame((s) => s.selected);
  const detail = useGame((s) => s.detail);
  const focus = useGame((s) => s.focusWorld);
  const hovered = useGame((s) => s.hovered);
  const emperor = useAuth((s) => s.emperor);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<I18nKey | null>(null);

  // El error de un traslado solo tiene sentido para el sistema en que se intentó.
  useEffect(() => setMoveError(null), [selected?.id]);

  const moveHere = async (systemId: string) => {
    setMoving(true);
    setMoveError(await authStore.getState().moveEmperor(systemId));
    setMoving(false);
  };

  if (!selected || !detail) {
    return (
      <aside className="side panel side-empty">
        {hovered ? (
          <div className="hover-tip">
            <span className="dot" style={{ background: starColorCss(hovered.starClass) }} />
            <strong>{hovered.name}</strong>
            <span className="muted">{t(`star.${hovered.starClass}`)}</span>
          </div>
        ) : (
          <p className="muted">{t("system.selectHint")}</p>
        )}
      </aside>
    );
  }

  const d = distance(focus, selected.position);
  const emperorHere = emperor?.location.systemId === selected.id;
  const p = selected.position;

  return (
    <aside className="side panel">
      <div className="side-head">
        <span className="dot big" style={{ background: starColorCss(selected.starClass), boxShadow: `0 0 18px ${starColorCss(selected.starClass)}` }} />
        <div>
          <h2>{selected.name}</h2>
          <div className="tag unknown">{t("system.unexplored")}</div>
          {emperorHere && <div className="tag emperor">{t("emperor.here")}</div>}
        </div>
        <button className="icon-btn" aria-label={t("system.close")} onClick={() => gameStore.getState().select(null)}>
          ×
        </button>
      </div>

      <dl className="facts">
        <dt>{t("system.class")}</dt>
        <dd>{t(`star.${selected.starClass}`)}</dd>
        <dt>{t("system.coords")}</dt>
        <dd className="mono">
          {p.x.toFixed(1)}, {p.y.toFixed(1)}, {p.z.toFixed(1)}
        </dd>
        <dt>{t("system.distance")}</dt>
        <dd className="mono">
          {d.toFixed(1)} {t("unit.ly")}
        </dd>
        <dt>{t("system.energy")}</dt>
        <dd>
          <Meter value={detail.energy / 5} color={RESOURCE_COLORS.energy} /> <span className="mono">{detail.energy}</span>
        </dd>
        <dt>{t("system.belts")}</dt>
        <dd>{detail.belts.length || t("system.none")}</dd>
        <dt>{t("system.anomaly")}</dt>
        <dd className={detail.anomaly ? "anomaly" : ""}>{detail.anomaly ? t(`anomaly.${detail.anomaly}`) : t("system.none")}</dd>
      </dl>

      <h3>
        {t("system.planets")} <span className="muted">({detail.planets.length})</span>
      </h3>
      <ul className="planet-list">
        {detail.planets.map((pl) => (
          <li key={pl.index}>
            <span className={`ptype ptype-${pl.type}`} />
            <span className="pname">{pl.name}</span>
            <span className="muted small">{t(`planet.${pl.type}`)}</span>
            <DepositChips planet={pl} />
          </li>
        ))}
        {detail.planets.length === 0 && <li className="muted">{t("system.none")}</li>}
      </ul>

      <div className="actions">
        <button className="btn" onClick={() => engineRef.current?.focusSelected()}>
          {t("system.focus")} <kbd>F</kbd>
        </button>
        <button className="btn btn-primary" onClick={() => engineRef.current?.enterSelected()}>
          {t("system.enter")} <kbd>↵</kbd>
        </button>
        {emperor && !emperorHere && (
          <button className="btn" onClick={() => void moveHere(selected.id)} disabled={moving}>
            {t(moving ? "emperor.moving" : "emperor.move")}
          </button>
        )}
      </div>
      {moveError && (
        <p className="auth-error" role="alert">
          {t(moveError)}
        </p>
      )}
    </aside>
  );
}
