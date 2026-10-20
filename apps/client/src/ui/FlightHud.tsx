import { useGame, useT } from "../state/store";
import { useKeyLabels } from "./keys";

import { PILOT_BOOST, PILOT_SPEED, PULSE_SPEED } from "@imperium/sim";

/** Velocidad máxima en cada vista: escala de la barra de velocidad (en un sistema, con impulso; con pulso, la del pulso). */
const MAX_SPEED = { galaxy: 150, system: PILOT_SPEED * PILOT_BOOST } as const;

/** Mira y velocímetro al volar: la cámara libre en el mapa o la nave al pilotar en un sistema. */
export function FlightHud() {
  const t = useT();
  const keys = useKeyLabels();
  const flight = useGame((s) => s.flight);
  const speed = useGame((s) => s.flightSpeed);
  const view = useGame((s) => s.view);
  const camera = useGame((s) => s.cameraView);
  const pulse = useGame((s) => s.pulse);
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
        <div className={pulse ? "flight-speed pulse" : "flight-speed"}>
          {piloting ? (speed >= 1000 ? (speed / 1000).toFixed(1) : speed.toFixed(0)) : speed.toFixed(1)}
          <small>{piloting ? t(speed >= 1000 ? "pilot.unitKm" : "pilot.unitM") : `${t("unit.ly")}/s`}</small>
          {pulse && <span className="pulse-tag">{t("pilot.pulse")}</span>}
        </div>
        <div className="flight-bar">
          <span style={{ width: `${Math.min(100, (speed / (pulse ? PULSE_SPEED : MAX_SPEED[view])) * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}
