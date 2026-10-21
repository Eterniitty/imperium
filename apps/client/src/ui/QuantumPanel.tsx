import { useMemo } from "react";
import { useStore } from "zustand";
import { EMPEROR_FLAGSHIP, FLAGSHIP_SUPPLIES, QUANTUM_MAX_LY } from "@imperium/content";
import { generateSector } from "@imperium/procgen";
import { distance, isDeepId, worldToSector, type StarSystemSummary, type WorldPosition } from "@imperium/shared";
import { quantumFuelCost, quantumRangeLy, regenFuel, travelDurationMs } from "@imperium/sim";
import { UNIVERSE_SEED } from "../config";
import { engineRef } from "../engineRef";
import { spaceStore } from "../net/space";
import { serverNow, useWorld } from "../net/world";
import { useAuth } from "../state/auth";
import { gameStore, useGame, useT } from "../state/store";
import { useKeyLabels } from "./keys";
import { formatDuration } from "./useNow";
import { companionsIn, useCompanionTrail } from "./companionTrail";

/** Cuántos destinos se listan (los más cercanos al alcance). */
const MAX_DESTINATIONS = 40;

/** Sistemas a `rangeLy` o menos de `center`, del más cercano al más lejano (sin el propio). */
function reachable(center: { id: string; position: WorldPosition }, rangeLy: number): Array<{ system: StarSystemSummary; ly: number }> {
  const p = center.position;
  const min = worldToSector({ x: p.x - rangeLy, y: p.y - rangeLy, z: p.z - rangeLy });
  const max = worldToSector({ x: p.x + rangeLy, y: p.y + rangeLy, z: p.z + rangeLy });
  const out: Array<{ system: StarSystemSummary; ly: number }> = [];
  for (let x = min.x; x <= max.x; x++)
    for (let y = min.y; y <= max.y; y++)
      for (let z = min.z; z <= max.z; z++)
        for (const s of generateSector(UNIVERSE_SEED, { x, y, z }).systems) {
          const ly = distance(p, s.position);
          if (s.id !== center.id && ly <= rangeLy) out.push({ system: s, ly });
        }
  return out.sort((a, b) => a.ly - b.ly).slice(0, MAX_DESTINATIONS);
}

/**
 * Selector del salto cuántico al pilotar (tecla J): sistemas al alcance del
 * combustible, con la distancia, la duración del viaje y el combustible que
 * gasta. Al elegir uno, la nave se alinea, carga el motor y salta. También se
 * puede elegir el destino en el mapa galáctico (M) y saltar desde allí.
 */
export function QuantumPanel() {
  const t = useT();
  const keys = useKeyLabels();
  const open = useGame((s) => s.quantumPanel);
  const selected = useGame((s) => s.selected);
  const emperor = useAuth((s) => s.emperor);
  const discovered = useWorld((s) => s.discovered);
  const flagship = useWorld((s) => s.flagship);
  const timeScale = useWorld((s) => s.timeScale);
  const live = useStore(spaceStore, (s) => s.supplies);
  const fuel = live?.fuel ?? (flagship ? regenFuel(flagship.supplies.fuel, (serverNow() - flagship.supplies.fuelAt) / 1000) : FLAGSHIP_SUPPLIES.fuelMax);
  const range = Math.min(QUANTUM_MAX_LY, quantumRangeLy(fuel));
  // Desde un sistema (el seleccionado) o desde el espacio profundo (la región donde está la nave).
  const loc = emperor && !emperor.travel ? emperor.location : null;
  const here = loc && isDeepId(loc.systemId) ? { id: loc.systemId, position: loc.position } : loc && selected?.id === loc.systemId ? selected : null;
  // Se recalcula solo al cambiar de sistema o de alcance (redondeado), no a cada aviso de combustible.
  const rangeKey = Math.floor(range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => (open && here ? reachable(here, rangeKey) : []), [open, here?.id, rangeKey]);
  // Memoria de posición: compañeros que están o estuvieron en cada destino (se puede llegar a su lado).
  const trail = useCompanionTrail(open);
  if (!open || !here) return null;
  const speed = EMPEROR_FLAGSHIP.speedLyPerHour * timeScale;

  return (
    <aside className="side panel quantum-panel" aria-label={t("quantum.title")}>
      <div className="side-head">
        <div>
          <h2>{t("quantum.title")}</h2>
          <div className="muted small">{t("quantum.subtitle", { range: range.toFixed(0), fuel: Math.floor(fuel) })}</div>
        </div>
        <button className="icon-btn" onClick={() => gameStore.getState().setQuantumPanel(false)} aria-label={t("quantum.close")}>
          ✕
        </button>
      </div>
      <p className="muted small">{t("quantum.hint", { map: keys.toggleMap, jump: keys.jump })}</p>
      {list.length === 0 ? (
        <p className="small warn-text">{t("quantum.noneInRange")}</p>
      ) : (
        <ul className="quantum-list">
          {list.map(({ system, ly }) => (
            <li key={system.id}>
              <button className="quantum-dest" onClick={() => engineRef.current?.startQuantum(system)}>
                <span className="quantum-name">
                  <strong>{system.name}</strong>
                  {!discovered[system.id] && <span className="tag unknown">{t("system.unexplored")}</span>}
                </span>
                <span className="mono small">
                  {ly.toFixed(1)} {t("unit.ly")} · {formatDuration(travelDurationMs(here.position, system.position, speed))} · {t("quantum.fuelCost", { n: quantumFuelCost(ly) })}
                </span>
              </button>
              {companionsIn(trail, system.id).map((c) => (
                <button
                  key={c.id}
                  className="quantum-near small"
                  title={t("quantum.nearTitle", { name: c.name })}
                  onClick={() => engineRef.current?.startQuantum(system, c.id)}
                >
                  {t(c.present ? "quantum.nearHere" : "quantum.nearWas", { name: c.name })}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
