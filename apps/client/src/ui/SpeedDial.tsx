import { useId, useRef } from "react";
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
/** Marcas de la escala (m/s), con su rótulo en km/s. */
const TICKS: ReadonlyArray<readonly [number, string]> = [
  [1_000, "1"],
  [10_000, "10"],
  [100_000, "100"],
  [1_000_000, "1000"],
  [CRUISE_LIMIT_MAX, String(Math.round(CRUISE_LIMIT_MAX / 1000))],
];

export function SpeedDial({ size = 150, speed }: { size?: number; /** Velocidad actual (m/s): aguja fina sobre el arco. */ speed?: number }) {
  const t = useT();
  const limit = useSettings((s) => s.prefs.flight.cruiseLimit);
  const ref = useRef<SVGSVGElement>(null);
  const gradId = `dial-grad-${useId().replace(/:/g, "")}`;
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
  const R = 40;
  const point = (q: number, r = R) => {
    const a = START + q * SWEEP;
    return [50 + Math.sin(a) * r, 50 - Math.cos(a) * r] as const;
  };
  const arc = (q: number) => {
    const [x0, y0] = point(0);
    const [x1, y1] = point(q);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${q * SWEEP > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const [kx, ky] = point(p);
  const value = limit > 0 ? fmtSpeedMs(limit) : t("cruise.speedFree");
  const [num, unit] = value.split(" ");
  // Aguja de la velocidad real (escala logarítmica, por debajo de 1 km/s se queda en el principio).
  const needle = speed !== undefined && speed > 0 ? Math.min(1, Math.max(0, (Math.log(Math.max(MIN, speed) / MIN) / Math.log(CRUISE_LIMIT_MAX / MIN)) * FREE_FROM)) : null;
  return (
    <div className="speed-dial" title={t("cruise.speedHint")}>
      <svg
        ref={ref}
        viewBox="0 0 100 100"
        width={size}
        height={size}
        role="slider"
        aria-label={t("cruise.speed")}
        aria-valuetext={value}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          fromEvent(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) fromEvent(e);
        }}
        onWheel={(e) => {
          e.stopPropagation();
          // Desde «máx.» (fuera de la escala), un paso abajo vuelve a lo más alto de la escala.
          const next = p >= FREE_FROM && e.deltaY > 0 ? FREE_FROM - 0.03 : p + (e.deltaY < 0 ? 0.03 : -0.03);
          set(fromPos(Math.max(0, Math.min(1, next))));
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#5fd3e6" />
            <stop offset="1" stopColor="#e8b64c" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="47" className="dial-face" />
        <path d={arc(1)} className="dial-track" />
        <path d={arc(Math.max(0.001, p))} className="dial-fill" stroke={`url(#${gradId})`} />
        {/* Escala: marcas mayores con rótulo (km/s) y menores entre ellas. */}
        {Array.from({ length: 31 }, (_, i) => {
          const q = (i / 30) * FREE_FROM;
          const [x0, y0] = point(q, R - 6);
          const [x1, y1] = point(q, R - (i % 10 === 0 ? 10 : 8));
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={i % 10 === 0 ? "dial-tick major" : "dial-tick"} />;
        })}
        {TICKS.map(([v, label]) => {
          const [x, y] = point(toPos(v), R - 15);
          return (
            <text key={v} x={x} y={y} className="dial-scale">
              {label}
            </text>
          );
        })}
        {needle !== null && (() => {
          const [x0, y0] = point(needle, R - 4);
          const [x1, y1] = point(needle, R + 4);
          return <line x1={x0} y1={y0} x2={x1} y2={y1} className="dial-needle" />;
        })()}
        <circle cx={kx} cy={ky} r={4.2} className="dial-knob" />
        <text x="50" y="52" className="dial-value">
          {num}
        </text>
        <text x="50" y="63" className="dial-unit">
          {unit ?? ""}
        </text>
        <text x="50" y="80" className="dial-label">
          {t("cruise.speed")}
        </text>
      </svg>
    </div>
  );
}
