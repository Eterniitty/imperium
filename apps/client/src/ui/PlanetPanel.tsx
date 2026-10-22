import { useWorld } from "../net/world";
import { useClaims } from "../state/claims";
import { gameStore, useGame, useT } from "../state/store";
import { ownColonyAt, planetLabel } from "./colonies";
import { DepositChips } from "./common";

export function PlanetPanel() {
  const t = useT();
  const detail = useGame((s) => s.detail);
  const detailStatus = useGame((s) => s.detailStatus);
  const selected = useGame((s) => s.selected);
  const selectedPlanet = useGame((s) => s.selectedPlanet);
  const colonies = useWorld((s) => s.colonies);
  const claims = useClaims();
  if (!detail) {
    // Sin explorar (o el detalle aún no ha llegado): solo se sabe la estrella.
    if (!selected) return null;
    return (
      <aside className="side panel">
        <div className="side-head">
          <div>
            <h2>{selected.name}</h2>
            <div className="muted small">{t(`star.${selected.starClass}`)}</div>
            <div className="tag unknown">{t(detailStatus === "loading" ? "system.loading" : "system.unexplored")}</div>
          </div>
        </div>
        {detailStatus === "unexplored" && <p className="muted small">{t("system.unexploredHint")}</p>}
      </aside>
    );
  }
  const planet = detail.planets.find((p) => p.index === selectedPlanet) ?? null;
  // Nombre que ha puesto su dueño (Fase 7), o la designación.
  const label = (pl: (typeof detail.planets)[number]) =>
    planetLabel(pl, claims.systemId === detail.summary.id ? claims.claims[pl.index] : undefined, ownColonyAt(colonies, detail.summary.id, pl.index));

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
            <span className="pname">{label(pl)}</span>
            <DepositChips planet={pl} />
          </li>
        ))}
      </ul>

      {!planet && <p className="muted small">{t("system.planetHint")}</p>}
    </aside>
  );
}
