import { useGame, useT } from "../state/store";

/** Máxima velocidad con impulso: escala de la barra de velocidad. */
const MAX_SPEED = 150;

export function FlightHud() {
  const t = useT();
  const flight = useGame((s) => s.flight);
  const speed = useGame((s) => s.flightSpeed);
  if (!flight) return null;
  return (
    <div className="flight-hud" aria-hidden>
      <svg className="crosshair" viewBox="0 0 46 46">
        <circle cx="23" cy="23" r="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M23 2v9M23 35v9M2 23h9M35 23h9" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <div className="flight-readout panel">
        <div className="stat-label">{t("flight.speed")}</div>
        <div className="flight-speed">
          {speed.toFixed(1)}
          <small>
            {t("unit.ly")}/s
          </small>
        </div>
        <div className="flight-bar">
          <span style={{ width: `${Math.min(100, (speed / MAX_SPEED) * 100)}%` }} />
        </div>
        <div className="muted small">{t("flight.hint")}</div>
      </div>
    </div>
  );
}
