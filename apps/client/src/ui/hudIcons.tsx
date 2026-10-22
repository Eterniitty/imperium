/**
 * Iconos del HUD de vuelo (barra de acciones y estado de la nave): trazos
 * sencillos en una caja de 24 × 24 con el color del texto (`currentColor`).
 */
const PATHS = {
  engines: "M12 3v8M7.5 6.2a7 7 0 1 0 9 0",
  pulse: "M3 12h4l2-6 4 12 2-6h6",
  assist: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM8.5 12l2.5 2.5 4.5-5",
  mouse: "M12 3a5 5 0 0 1 5 5v8a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5zM12 7v3",
  cockpit: "M3 17l3-9h12l3 9M6 8l2 9M18 8l-2 9M3 17h18",
  recenter: "M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  cruise: "M4 18L12 4l8 14-8-4z",
  follow: "M5 17l4-10 4 10-4-2zM13 13l3-7 3 7-3-1.5z",
  dock: "M4 9h6v6H4zM14 12h6M17 9l3 3-3 3",
  weapons: "M12 2v5M12 17v5M2 12h5M17 12h5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  targetNearest: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  targetNext: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M10 9l4 3-4 3",
  autoFire: "M5 12h3M10 12h3M15 12h3M19 9l3 3-3 3",
  help: "M12 2l2.5 5 5.5.8-4 3.9.9 5.5L12 14.6 7.1 17.2l.9-5.5-4-3.9 5.5-.8z",
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z",
  hull: "M12 2l8 4.5v11L12 22l-8-4.5v-11zM12 2v20M4 6.5l16 11M20 6.5l-16 11",
  energy: "M13 2L5 14h6l-1 8 8-12h-6z",
  fuel: "M6 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h14M8 7h6v4H8zM16 9l3 2v6a1.5 1.5 0 0 0 3 0V8l-3-3",
  cannon: "M3 10h12l2-2h4v8h-4l-2-2H3zM6 14v3",
  missile: "M4 20l3-3M14 4l6 0 0 6-9 9-6-6zM9 9l6 6",
  laser: "M3 12h7M14 12h7M12 3v4M12 17v4M10 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
} as const;

export type HudIconName = keyof typeof PATHS;

export function HudIcon({ name, size = 18 }: { name: HudIconName; size?: number }) {
  return (
    <svg className="hud-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
