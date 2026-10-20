import { distance } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { gameStore, useGame, useT } from "../state/store";
import { DepositChips, Meter, RESOURCE_COLORS, starColorCss } from "./common";

export function SystemPanel() {
  const t = useT();
  const selected = useGame((s) => s.selected);
  const detail = useGame((s) => s.detail);
  const focus = useGame((s) => s.focusWorld);
  const hovered = useGame((s) => s.hovered);

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
  const p = selected.position;

  return (
    <aside className="side panel">
      <div className="side-head">
        <span className="dot big" style={{ background: starColorCss(selected.starClass), boxShadow: `0 0 18px ${starColorCss(selected.starClass)}` }} />
        <div>
          <h2>{selected.name}</h2>
          <div className="tag unknown">{t("system.unexplored")}</div>
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
      </div>
    </aside>
  );
}
