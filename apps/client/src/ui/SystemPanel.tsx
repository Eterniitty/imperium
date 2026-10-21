import { useEffect, useState } from "react";
import { distance, type Colony, type Fleet, type I18nKey } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { connection, useWorld } from "../net/world";
import { useAuth } from "../state/auth";
import { useKeyLabels } from "./keys";
import { gameStore, useGame, useT } from "../state/store";
import { useClaims } from "../state/claims";
import { ownColonyAt, planetLabel } from "./colonies";
import { DepositChips, Meter, RESOURCE_COLORS, starColorCss } from "./common";
import { FleetLogistics } from "./FleetLogistics";
import { PlanetColony } from "./PlanetColony";
import { formatDuration, useServerNow } from "./useNow";

export function SystemPanel() {
  const t = useT();
  const selected = useGame((s) => s.selected);
  const detail = useGame((s) => s.detail);
  const detailStatus = useGame((s) => s.detailStatus);
  const focus = useGame((s) => s.focusWorld);
  const hovered = useGame((s) => s.hovered);
  const emperor = useAuth((s) => s.emperor);
  const keys = useKeyLabels();
  const world = useWorld((s) => s.emperors);
  const fleets = useWorld((s) => s.fleets);
  const myId = useWorld((s) => s.myEmperorId);
  const colonies = useWorld((s) => s.colonies);
  const selectedPlanet = useGame((s) => s.selectedPlanet);
  const claims = useClaims();
  const now = useServerNow();
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<I18nKey | null>(null);

  // El error de un traslado solo tiene sentido para el sistema en que se intentó.
  useEffect(() => setMoveError(null), [selected?.id]);

  // El salto lo da el motor: así la cámara sigue a la nave y, al llegar, se entra pilotando.
  const jumpHere = async () => {
    setMoving(true);
    await engineRef.current?.jumpToSelected();
    setMoving(false);
  };

  const sendFleet = async (fleetId: string, systemId: string) => {
    setMoving(true);
    setMoveError(await connection.command("fleet.move", { fleetId, systemId }));
    setMoving(false);
  };

  if (!selected) {
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
  const travelling = emperor?.travel && emperor.travel.arriveAt > now ? emperor.travel : null;
  const emperorHere = !travelling && (emperor?.travel && emperor.travel.arriveAt <= now ? emperor.travel.to : emperor?.location)?.systemId === selected.id;
  // Quién está en este sistema y quién viene de camino (con el viaje resuelto a la hora actual).
  const others = Object.values(world).map((e) => {
    const arrived = e.travel !== null && e.travel.arriveAt <= now;
    const moving = e.travel !== null && !arrived;
    return { e, at: moving ? null : arrived ? e.travel!.to.systemId : e.location.systemId, heading: moving ? e.travel!.to.systemId : null };
  });
  const here = others.filter((o) => o.at === selected.id);
  const coming = others.filter((o) => o.heading === selected.id);
  // Flotas propias: las que están aquí y las que, paradas en otro sitio, se pueden enviar.
  const ownFleets = (Object.values(fleets) as Fleet[]).sort((a, b) => a.number - b.number);
  const fleetAt = (f: Fleet) => (f.travel && f.travel.arriveAt <= now ? f.travel.to : f.location).systemId;
  const fleetMoving = (f: Fleet) => f.travel !== null && f.travel.arriveAt > now;
  const fleetsHere = ownFleets.filter((f) => !fleetMoving(f) && fleetAt(f) === selected.id);
  // Primera colonia propia del sistema (para cargar y descargar).
  const colonyHere = (Object.values(colonies) as Colony[]).find((c) => c.systemId === selected.id);
  const sendable = ownFleets.filter((f) => !fleetMoving(f) && fleetAt(f) !== selected.id);
  const p = selected.position;

  return (
    <aside className="side panel">
      <div className="side-head">
        <span className="dot big" style={{ background: starColorCss(selected.starClass), boxShadow: `0 0 18px ${starColorCss(selected.starClass)}` }} />
        <div>
          <h2>{selected.name}</h2>
          {detailStatus === "unexplored" && <div className="tag unknown">{t("system.unexplored")}</div>}
          {detailStatus === "loading" && <div className="tag unknown">{t("system.loading")}</div>}
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
        {detail && (
          <>
            <dt>{t("system.energy")}</dt>
            <dd>
              <Meter value={detail.energy / 5} color={RESOURCE_COLORS.energy} /> <span className="mono">{detail.energy}</span>
            </dd>
            <dt>{t("system.belts")}</dt>
            <dd>{detail.belts.length || t("system.none")}</dd>
            <dt>{t("system.anomaly")}</dt>
            <dd className={detail.anomaly ? "anomaly" : ""}>{detail.anomaly ? t(`anomaly.${detail.anomaly}`) : t("system.none")}</dd>
          </>
        )}
      </dl>

      {detail ? (
        <>
          <h3>
            {t("system.planets")} <span className="muted">({detail.planets.length})</span>
          </h3>
          {/* Fase 7: cada planeta muestra su nombre y su dueño; al elegirlo, se puede reclamar o gestionar. */}
          <ul className="planet-list selectable">
            {detail.planets.map((pl) => {
              const own = ownColonyAt(colonies, detail.summary.id, pl.index);
              const claim = claims.systemId === detail.summary.id ? claims.claims[pl.index] : undefined;
              return (
                <li
                  key={pl.index}
                  className={pl.index === selectedPlanet ? "active" : ""}
                  onClick={() => gameStore.getState().selectPlanet(pl.index === selectedPlanet ? null : pl.index)}
                >
                  <span className={`ptype ptype-${pl.type}`} />
                  <span className="pname">{planetLabel(pl, claim, own)}</span>
                  {own ? (
                    <span className="planet-owner own">{t("colony.yours")}</span>
                  ) : claim ? (
                    <span className="planet-owner">{claim.ownerName ?? t("colony.independent")}</span>
                  ) : (
                    <span className="muted small">{t(`planet.${pl.type}`)}</span>
                  )}
                  <DepositChips planet={pl} />
                </li>
              );
            })}
            {detail.planets.length === 0 && <li className="muted">{t("system.none")}</li>}
          </ul>
          {(() => {
            const pl = detail.planets.find((p) => p.index === selectedPlanet);
            return pl ? (
              <div className="planet-detail">
                <h3>{planetLabel(pl, claims.systemId === detail.summary.id ? claims.claims[pl.index] : undefined, ownColonyAt(colonies, detail.summary.id, pl.index))}</h3>
                <PlanetColony detail={detail} planet={pl} />
              </div>
            ) : null;
          })()}
        </>
      ) : (
        detailStatus === "unexplored" && <p className="muted small">{t("system.unexploredHint")}</p>
      )}

      {(here.length > 0 || coming.length > 0) && (
        <>
          {here.length > 0 && <h3>{t("emperor.othersHere")}</h3>}
          <ul className="emperor-list">
            {here.map(({ e }) => (
              <li key={e.id} className={e.id === myId ? "own" : ""}>
                <span className={e.online ? "server-dot online" : "server-dot"} aria-hidden="true" />
                <strong>{e.name}</strong>
                <span className="muted small">{e.id === myId ? t("emperor.you") : t(e.online ? "emperor.online" : "emperor.offline")}</span>
              </li>
            ))}
          </ul>
          {coming.length > 0 && <h3>{t("emperor.headingHere")}</h3>}
          <ul className="emperor-list">
            {coming.map(({ e }) => (
              <li key={e.id} className={e.id === myId ? "own" : ""}>
                <span className={e.online ? "server-dot online" : "server-dot"} aria-hidden="true" />
                <strong>{e.name}</strong>
                <span className="muted small mono">{formatDuration(e.travel!.arriveAt - now)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {fleetsHere.length > 0 && (
        <>
          <h3>{t("fleet.here")}</h3>
          <ul className="emperor-list">
            {fleetsHere.map((f) => (
              <li key={f.id} className="fleet">
                <strong>{t("fleet.name", { n: f.number })}</strong>
                <span className="muted small">{t("fleet.ships", { count: f.ships.length })}</span>
              </li>
            ))}
          </ul>
          {/* Logística: flotas con bodega paradas junto a una colonia propia de este sistema. */}
          {colonyHere &&
            fleetsHere
              .filter((f) => f.capacity.resources + f.capacity.humans > 0)
              .map((f) => (
                <div key={f.id}>
                  <h4 className="logistics-title">{t("logistics.title", { name: t("fleet.name", { n: f.number }) })}</h4>
                  <FleetLogistics fleet={f} colony={colonyHere} />
                </div>
              ))}
        </>
      )}

      <div className="actions">
        <button className="btn" onClick={() => engineRef.current?.focusSelected()}>
          {t("system.focus")} <kbd>F</kbd>
        </button>
        <button className="btn btn-primary" onClick={() => engineRef.current?.enterSelected()}>
          {t("system.enter")} <kbd>↵</kbd>
        </button>
        {emperor && !emperorHere && (
          <button className="btn" onClick={() => void jumpHere()} disabled={moving || travelling !== null}>
            {t(moving ? "emperor.moving" : "pilot.jump")} <kbd>{keys.jump}</kbd>
          </button>
        )}
      </div>
      {sendable.length > 0 && (
        <div className="actions">
          {sendable.map((f) => (
            <button key={f.id} className="btn" onClick={() => void sendFleet(f.id, selected.id)} disabled={moving}>
              {t("fleet.send", { name: t("fleet.name", { n: f.number }) })}
            </button>
          ))}
        </div>
      )}
      {moveError && (
        <p className="auth-error" role="alert">
          {t(moveError)}
        </p>
      )}
    </aside>
  );
}
