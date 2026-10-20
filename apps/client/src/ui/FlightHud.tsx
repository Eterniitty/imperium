import { useGame, useT } from "../state/store";
import { useKeyLabels } from "./keys";

/** Velocidad máxima con impulso en cada vista: escala de la barra de velocidad. */
const MAX_SPEED = { galaxy: 150, system: 90 } as const;

/** Mira y velocímetro al volar: la cámara libre en el mapa o la nave al pilotar en un sistema. */
export function FlightHud() {
  const t = useT();
  const keys = useKeyLabels();
  const flight = useGame((s) => s.flight);
  const speed = useGame((s) => s.flightSpeed);
  const view = useGame((s) => s.view);
  const camera = useGame((s) => s.cameraView);
  if (!flight) return null;
  const piloting = view === "system";
  return (
    <div className="flight-hud" aria-hidden>
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
        <div className="flight-speed">
          {speed.toFixed(1)}
          <small>{piloting ? t("pilot.unitSystem") : `${t("unit.ly")}/s`}</small>
        </div>
        <div className="flight-bar">
          <span style={{ width: `${Math.min(100, (speed / MAX_SPEED[view]) * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}
