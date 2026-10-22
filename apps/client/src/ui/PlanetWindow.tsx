import { useEffect, useState } from "react";
import type { I18nKey } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { useWorld } from "../net/world";
import { useClaims } from "../state/claims";
import { gameStore, useGame, useT } from "../state/store";
import { ownColonyAt, planetLabel } from "./colonies";
import { Deposits, KeyHint, Meter, RESOURCE_COLORS } from "./common";
import { COLONY_SECTIONS, PlanetColony, type PlanetTab } from "./PlanetColony";

/**
 * Ventana del planeta elegido (petición del usuario): un rectángulo con
 * pestañas — el planeta (tierra, órbita, yacimientos, dueño) y, si la colonia
 * es tuya, población, recursos, instalaciones, producción y naves. Se minimiza
 * en una pestaña bajo la barra superior y se vuelve a desplegar; al cerrarla se
 * deja de tener el planeta elegido.
 */
export function PlanetWindow() {
  const t = useT();
  const detail = useGame((s) => s.detail);
  const selectedPlanet = useGame((s) => s.selectedPlanet);
  const colonies = useWorld((s) => s.colonies);
  const claims = useClaims();
  const piloting = useGame((s) => s.flight && s.view === "system");
  const [tab, setTab] = useState<PlanetTab>("planet");
  const [minimized, setMinimized] = useState(false);
  const planet = detail?.planets.find((p) => p.index === selectedPlanet) ?? null;
  const key = planet && detail ? `${detail.summary.id}:${planet.index}` : null;

  // Otro planeta: se abre desplegada, en la ficha del planeta.
  useEffect(() => {
    setTab("planet");
    if (key) setMinimized(false);
  }, [key]);

  if (!detail || !planet) return null;
  const own = ownColonyAt(colonies, detail.summary.id, planet.index);
  const claim = claims.systemId === detail.summary.id ? claims.claims[planet.index] : undefined;
  const name = planetLabel(planet, claim, own);
  const tabs: PlanetTab[] = own ? ["planet", ...COLONY_SECTIONS] : ["planet"];
  const current = tabs.includes(tab) ? tab : "planet";
  const close = () => gameStore.getState().selectPlanet(null);

  if (minimized) {
    return (
      <button type="button" className="planet-win-pill panel" title={t("planetWin.expand")} onClick={() => setMinimized(false)}>
        <span className={`ptype ptype-${planet.type}`} />
        <strong>{name}</strong>
        <span className="muted small">{own ? t("colony.yours") : t(`planet.${planet.type}`)}</span>
        <span className="planet-win-chevron" aria-hidden>
          ▾
        </span>
      </button>
    );
  }

  return (
    <section className="planet-win panel" role="dialog" aria-label={name}>
      <header className="planet-win-head">
        <span className={`ptype ptype-${planet.type} big`} />
        <div className="planet-win-title">
          <h2>{name}</h2>
          <div className="muted small">
            {t(`planet.${planet.type}`)} · {detail.summary.name}
            {own && <span className="tag capital">{t("colony.yours")}</span>}
          </div>
        </div>
        <div className="planet-win-buttons">
          <button type="button" className="icon-btn" aria-label={t("planetWin.minimize")} title={t("planetWin.minimize")} onClick={() => setMinimized(true)}>
            ▁
          </button>
          <button type="button" className="icon-btn" aria-label={t("planetWin.close")} title={t("planetWin.close")} onClick={close}>
            ×
          </button>
        </div>
      </header>
      {tabs.length > 1 && (
        <nav className="planet-win-tabs" role="tablist">
          {tabs.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={id === current} className={id === current ? "planet-win-tab active" : "planet-win-tab"} onClick={() => setTab(id)}>
              {t(`planetWin.tab.${id}` as I18nKey)}
            </button>
          ))}
        </nav>
      )}
      <div className="planet-win-body" key={current}>
        {current === "planet" && (
          <>
            {piloting && (
              <div className="planet-cruise">
                <button className="btn btn-small" onClick={() => engineRef.current?.cruiseTo(`planet:${planet.index}`)}>
                  {t("cruise.goHere")} <KeyHint action="cruise" />
                </button>
                {/* Orbitar el planeta: ir y quedarse dando vueltas por su ecuador. */}
                <button className="btn btn-small" title={t("cruise.orbitHint", { name })} onClick={() => engineRef.current?.cruiseTo(`planet:${planet.index}`, true)}>
                  {t("cruise.orbit")}
                </button>
              </div>
            )}
            <div className="planet-win-grid">
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
              <div>
                <Deposits deposits={planet.deposits} />
                <div className="deposit small muted">
                  <span className="deposit-name" style={{ color: RESOURCE_COLORS.energy }}>
                    {t("resource.energy")}
                  </span>
                  <span className="mono">{detail.energy}</span>
                </div>
              </div>
            </div>
          </>
        )}
        <PlanetColony detail={detail} planet={planet} tab={current} />
      </div>
    </section>
  );
}
