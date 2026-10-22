import { useRef } from "react";
import { CRUISE_LIMIT_MAX, settingsStore, useSettings } from "../state/settings";
import { useT } from "../state/store";
import { fmtSpeedMs } from "./SettingsPanel";

/** Mínimo del dial (m/s). */
const MIN = 1000;
/** Arco del dial: de las 7 y media a las 4 y media (270°), en radianes desde arriba. */
const START = -0.75 * Math.PI;
const SWEEP = 1.5 * Math.PI;
/** El último tramo del arco es «máx.» (sin límite). */
const FREE_FROM = 0.97;

/** Posición en el arco (0–1) ↔ velocidad (escala logarítmica de 1 km/s a la del pulso). */
const toPos = (limit: number) => (limit <= 0 ? 1 : Math.min(FREE_FROM, (Math.log(limit / MIN) / Math.log(CRUISE_LIMIT_MAX / MIN)) * FREE_FROM));
const fromPos = (p: number) => (p >= FREE_FROM ? 0 : Math.round(MIN * (CRUISE_LIMIT_MAX / MIN) ** (p / FREE_FROM)));

/**
 * Dial circular de la velocidad del crucero (petición del usuario): se arrastra
 * alrededor o se gira con la rueda del ratón. Del todo a la derecha, «máx.»: sin
 * límite (el pulso entero). Guarda `prefs.flight.cruiseLimit`.
 */
export function SpeedDial({ size = 92 }: { size?: number }) {
  const t = useT();
  const limit = useSettings((s) => s.prefs.flight.cruiseLimit);
  const ref = useRef<SVGSVGElement>(null);
  const set = (cruiseLimit: number) => {
    const f = settingsStore.getState().prefs.flight;
    settingsStore.getState().setPrefs({ flight: { ...f, cruiseLimit } });
  };
  const fromEvent = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
    const p = Math.max(0, Math.min(1, (a - START) / SWEEP));
    set(fromPos(p));
  };
  const p = toPos(limit);
  const R = 38;
  const point = (q: number) => {
    const a = START + q * SWEEP;
    return [50 + Math.sin(a) * R, 50 - Math.cos(a) * R] as const;
  };
  const arc = (q: number) => {
    const [x0, y0] = point(0);
    const [x1, y1] = point(q);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${q * SWEEP > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const [kx, ky] = point(p);
  return (
    <div className="speed-dial" title={t("cruise.speedHint")}>
      <svg
        ref={ref}
        viewBox="0 0 100 100"
        width={size}
        height={size}
        role="slider"
        aria-label={t("cruise.speed")}
        aria-valuetext={limit > 0 ? fmtSpeedMs(limit) : t("cruise.speedFree")}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          fromEvent(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) fromEvent(e);
        }}
        onWheel={(e) => {
          e.stopPropagation();
          set(fromPos(Math.max(0, Math.min(1, p + (e.deltaY < 0 ? 0.03 : -0.03)))));
        }}
      >
        <path d={arc(1)} className="dial-track" />
        <path d={arc(Math.max(0.001, p))} className="dial-fill" />
        <circle cx={kx} cy={ky} r={5} className="dial-knob" />
        <text x="50" y="50" className="dial-value">
          {limit > 0 ? fmtSpeedMs(limit) : t("cruise.speedFree")}
        </text>
        <text x="50" y="64" className="dial-label">
          {t("cruise.speed")}
        </text>
      </svg>
    </div>
  );
}
