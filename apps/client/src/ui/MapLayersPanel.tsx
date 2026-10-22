import { engineRef } from "../engineRef";
import { HudIcon, type HudIconName } from "./hudIcons";
import { mapLayersStore, useMapLayers, type MapLayers } from "../state/mapLayers";
import { useT } from "../state/store";
import type { I18nKey } from "@imperium/shared";

const LAYERS: ReadonlyArray<readonly [keyof MapLayers, HudIconName, I18nKey]> = [
  ["emperors", "crown", "map.layer.emperors"],
  ["fleets", "fleet", "map.layer.fleets"],
  ["labels", "labels", "map.layer.labels"],
  ["territory", "territory", "map.layer.territory"],
  ["galaxy", "galaxy", "map.layer.galaxy"],
];

/**
 * Mapa galáctico: qué capas se ven (Emperadores, flotas, nombres, territorios,
 * la galaxia lejana) y dos niveles de zoom, el del sector alrededor del foco y
 * el de la galaxia entera. Barra vertical de iconos abajo a la izquierda.
 */
export function MapLayersPanel() {
  const t = useT();
  const layers = useMapLayers((s) => s);
  return (
    <nav className="map-layers panel" aria-label={t("map.layers")}>
      <button type="button" className="action-btn" title={t("map.zoom.sector")} aria-label={t("map.zoom.sector")} onClick={() => engineRef.current?.mapZoom("sector")}>
        <HudIcon name="zoomSector" />
      </button>
      <button type="button" className="action-btn" title={t("map.zoom.galaxy")} aria-label={t("map.zoom.galaxy")} onClick={() => engineRef.current?.mapZoom("galaxy")}>
        <HudIcon name="zoomGalaxy" />
      </button>
      <i className="action-sep" />
      {LAYERS.map(([key, glyph, label]) => (
        <button
          key={key}
          type="button"
          className={layers[key] ? "action-btn on" : "action-btn"}
          aria-pressed={layers[key]}
          title={`${t(label)} — ${t(layers[key] ? "map.layer.on" : "map.layer.off")}`}
          aria-label={t(label)}
          onClick={() => mapLayersStore.getState().toggle(key)}
        >
          <HudIcon name={glyph} />
        </button>
      ))}
    </nav>
  );
}
