import { gameStore, useGame, useT } from "../state/store";
import { Deposits, DepositChips, Meter, RESOURCE_COLORS } from "./common";

export function PlanetPanel() {
  const t = useT();
  const detail = useGame((s) => s.detail);
  const selectedPlanet = useGame((s) => s.selectedPlanet);
  if (!detail) return null;
  const planet = detail.planets.find((p) => p.index === selectedPlanet) ?? null;

  return (
    <aside className="side panel">
      <div className="side-head">
        <div>
          <h2>{detail.summary.name}</h2>
          <div className="muted small">
            {t(`star.${detail.summary.starClass}`)} · {t("system.energy")} {detail.energy}
          </div>
        </div>
      </div>

      <ul className="planet-list selectable">
        {detail.planets.map((pl) => (
          <li
            key={pl.index}
            className={pl.index === selectedPlanet ? "active" : ""}
            onClick={() => gameStore.getState().selectPlanet(pl.index === selectedPlanet ? null : pl.index)}
          >
            <span className={`ptype ptype-${pl.type}`} />
            <span className="pname">{pl.name}</span>
            <DepositChips planet={pl} />
          </li>
        ))}
      </ul>

      {planet ? (
        <div className="planet-detail">
          <h3>{planet.name}</h3>
          <div className="muted">{t(`planet.${planet.type}`)}</div>
          <dl className="facts">
            <dt>{t("system.orbit")}</dt>
            <dd className="mono">
              {planet.orbitAu} {t("unit.au")}
            </dd>
            <dt>{t("system.radius")}</dt>
            <dd className="mono">
              {planet.radius} {t("unit.earth")}
            </dd>
            <dt>{t("system.habitability")}</dt>
            <dd>
              <Meter value={planet.habitability} color="#7ee08a" /> <span className="mono">{Math.round(planet.habitability * 100)}%</span>
            </dd>
            <dt>{t("system.moonCount")}</dt>
            <dd>{planet.moons.length}</dd>
          </dl>
          <Deposits deposits={planet.deposits} />
          <div className="deposit small muted">
            <span className="deposit-name" style={{ color: RESOURCE_COLORS.energy }}>
              {t("resource.energy")}
            </span>
            <span className="mono">{detail.energy}</span>
          </div>
        </div>
      ) : (
        <p className="muted small">{t("system.planetHint")}</p>
      )}
    </aside>
  );
}
