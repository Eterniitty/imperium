import { PILOT_BOOST, PILOT_SPEED, PULSE_MAX_SPEED } from "@imperium/sim";
import { useTelemetry } from "../engine/telemetry";
import { FlightInstruments } from "./FlightInstruments";
import { useGame, useT } from "../state/store";
import { useSettings } from "../state/settings";
import { useKeyLabels } from "./keys";
import { formatDuration } from "./useNow";

/** Velocidad máxima en cada vista: escala de la barra de velocidad (en un sistema, con impulso; con pulso, la del pulso). */
const MAX_SPEED = { galaxy: 150, system: PILOT_SPEED * PILOT_BOOST, tunnel: 1 } as const;

/** Distancia en m o km, con pocas cifras. */
export function formatDistance(m: number): string {
  if (m < 10_000) return `${Math.round(m)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString()} km`;
}

/** Velocidad en m/s o km/s: número y unidad por separado. */
export function speedParts(v: number): [string, "pilot.unitKm" | "pilot.unitM"] {
  return v >= 1000 ? [(v / 1000).toFixed(v >= 100_000 ? 0 : 1), "pilot.unitKm"] : [v.toFixed(0), "pilot.unitM"];
}

/** Etapas del arranque: se marcan al pasar su umbral de potencia. */
const ENGINE_STAGES = [
  ["pilot.engineStage.reactor", 0.15],
  ["pilot.engineStage.pumps", 0.45],
  ["pilot.engineStage.ignition", 0.75],
  ["pilot.engineStage.systems", 0.98],
] as const;

/** Aviso central con los motores apagados (cómo arrancarlos) y progreso del arranque. */
function EnginePanel({ state, power, engineKey }: { state: "off" | "starting" | "stopping"; power: number; engineKey: string }) {
  const t = useT();
  return (
    <div className={`engine-panel panel ${state}`}>
      {state === "off" && <div className="engine-title">{t("pilot.enginesOff", { key: engineKey })}</div>}
      {state === "stopping" && <div className="engine-title">{t("pilot.enginesStopping")}</div>}
      {state === "starting" && (
        <>
          <div className="engine-title">{t("pilot.enginesStarting", { pct: Math.round(power * 100) })}</div>
          <div className="flight-bar">
            <span style={{ width: `${Math.min(100, power * 100)}%` }} />
          </div>
          <ul className="engine-stages">
            {ENGINE_STAGES.map(([key, at]) => (
              <li key={key} className={power >= at ? "done" : power >= at - 0.3 ? "busy" : ""}>
                {power >= at ? "■" : "□"} {t(key)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Mira y velocímetro al volar: la cámara libre en el mapa o la nave al pilotar en un sistema. */
export function FlightHud() {
  const t = useT();
  const keys = useKeyLabels();
  const flight = useGame((s) => s.flight);
  const galaxySpeed = useGame((s) => s.flightSpeed);
  const view = useGame((s) => s.view);
  const camera = useGame((s) => s.cameraView);
  const tel = useTelemetry();
  const assist = useSettings((s) => s.prefs.flight.assist);
  if (!flight) return null;
  const piloting = view === "system";
  const speed = piloting ? tel.speed : galaxySpeed;
  const pulse = piloting && tel.pulse;
  const [num, unit] = speedParts(speed);
  const [limitNum, limitUnit] = speedParts(tel.pulseLimit);
  const scale = pulse ? Math.log(1 + speed) / Math.log(1 + PULSE_MAX_SPEED) : speed / MAX_SPEED[view];
  const engines = piloting ? tel.engines : "on";
  // El HUD se enciende con los motores: apagado se ve tenue; durante el arranque, a medias.
  const hudClass = engines === "on" ? "flight-hud" : engines === "off" ? "flight-hud hud-dark" : "flight-hud hud-booting";
  return (
    <div className={hudClass} aria-hidden>
      {piloting && engines !== "on" && <EnginePanel state={engines} power={tel.enginePower} engineKey={keys.engines} />}
      {piloting && <FlightInstruments />}
      {(!piloting || camera === "first") && (
        <svg className="crosshair" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M23 2v9M23 35v9M2 23h9M35 23h9" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
      <div className="flight-readout panel">
        <div className="stat-label">
          {t("flight.speed")}
          {piloting && ` · ${t(camera === "first" ? "pilot.cameraFirst" : "pilot.cameraThird")} (${keys.cameraView})`}
        </div>
        <div className={pulse ? "flight-speed pulse" : "flight-speed"}>
          {piloting ? num : speed.toFixed(1)}
          <small>{piloting ? t(unit) : `${t("unit.ly")}/s`}</small>
          {pulse && <span className="pulse-tag">{t("pilot.pulse")}</span>}
        </div>
        <div className="flight-bar">
          <span style={{ width: `${Math.min(100, scale * 100)}%` }} />
        </div>
        {piloting && (
          <div className="flight-sub">
            <span className={pulse ? "pulse-key on" : "pulse-key"}>{t("pilot.pulseHint", { key: keys.pulse })}</span>
            {pulse && <span className="muted"> · {t("pilot.pulseLimit", { v: `${limitNum} ${t(limitUnit)}` })}</span>}
            <span className={assist ? "pulse-key on" : "pulse-key"}>
              {" "}
              · {t("pilot.assist")} {assist ? "ON" : "OFF"} ({keys.flightAssist})
            </span>
            {engines === "on" && <span className="muted"> · {t("pilot.enginesStopHint", { key: keys.engines })}</span>}
            <div className="muted">
              {t(`pilot.region.${tel.gravity.region}`)}
              {tel.gravity.body && ` · ${tel.gravity.body}`}
              {tel.gravity.g > 0.005 && ` · ${t("pilot.gravity")} ${tel.gravity.g.toFixed(2)} m/s²`}
            </div>
            {tel.freeCam && <div className="muted">{t("pilot.freeCam", { key: keys.cameraReset })}</div>}
          </div>
        )}
        {piloting && tel.eta && (
          <div className="flight-eta">
            <span className="stat-label">{t("pilot.eta")}</span> <strong>{tel.eta.name}</strong> · {formatDistance(tel.eta.distance)} ·{" "}
            <span className="mono">{tel.eta.seconds !== null ? formatDuration(tel.eta.seconds * 1000) : t("pilot.etaNone")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
