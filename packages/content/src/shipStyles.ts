/**
 * Naves personalizables (petición del 24-10-2026): modelos base ya hechos que el
 * jugador personaliza (colores y patrones, piezas por zona, proporciones y marcas
 * en el casco), no se construyen pieza a pieza.
 *
 * Cada modelo parte de su INTERIOR, con medidas reales (más adelante se podrá
 * caminar por la nave): el casco se genera alrededor de las salas y ninguna
 * opción puede dejar una sala fuera. Las proporciones solo estiran lo que no es
 * habitable (morro, cola, alas y motores).
 *
 * Ejes de la nave en metros: x a estribor, y arriba, z hacia atrás (la proa en
 * z = 0 apunta a −z, como los demás modelos del cliente).
 */

/** Una sala del interior: caja en metros (centro y medidas) y para qué sirve. */
export interface ShipRoom {
  id: string;
  kind: "cockpit" | "corridor" | "quarters" | "galley" | "cargo" | "engineering" | "airlock";
  /** Centro (x, y, z) y medidas (ancho, alto, largo), en metros. */
  center: readonly [number, number, number];
  size: readonly [number, number, number];
}

export type ShipNose = "needle" | "blunt" | "chisel";
export type ShipWings = "swept" | "delta" | "fan" | "stub";
export type ShipEngines = "nacelles" | "twin" | "quad";
export type ShipExtra = "antenna" | "turret" | "fin" | "pods";
export type ShipPattern = "solid" | "twoTone" | "stripes" | "bands" | "worn";
export type ShipEmblem = "none" | "aeon" | "star" | "wing" | "crown";

export interface ShipTemplate {
  id: string;
  /** Eslora de referencia (m) con las proporciones a 1. */
  lengthM: number;
  /** Plazas en la cabina y literas. */
  crew: number;
  beds: number;
  rooms: readonly ShipRoom[];
  /** Grosor del casco alrededor de las salas (m). */
  hullM: number;
  /** Piezas que admite cada zona (la primera es la de serie). */
  noses: readonly ShipNose[];
  wings: readonly ShipWings[];
  engines: readonly ShipEngines[];
  extras: readonly ShipExtra[];
  /** Diseño de serie. */
  defaults: ShipCustomization;
}

/** Lo que el jugador elige. Es lo que se guarda y lo que ven los demás. */
export interface ShipCustomization {
  template: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    lights: string;
  };
  pattern: ShipPattern;
  parts: {
    nose: ShipNose;
    wings: ShipWings;
    engines: ShipEngines;
    extras: readonly ShipExtra[];
  };
  /** Factores dentro de SHIP_PROPORTIONS. */
  proportions: {
    nose: number;
    wingSpan: number;
    engineSize: number;
  };
  marks: {
    /** Hasta 4 letras o cifras (A–Z, 0–9). */
    number: string;
    /** Nombre pintado en el casco (hasta 20 caracteres). */
    name: string;
    emblem: ShipEmblem;
  };
}

/** Límites de las proporciones (mínimo, máximo). */
export const SHIP_PROPORTIONS = {
  nose: [0.75, 1.5],
  wingSpan: [0.6, 1.5],
  engineSize: [0.8, 1.3],
} as const;

export const SHIP_PATTERNS: readonly ShipPattern[] = ["solid", "twoTone", "stripes", "bands", "worn"];
export const SHIP_EMBLEMS: readonly ShipEmblem[] = ["none", "aeon", "star", "wing", "crown"];
export const SHIP_MARK_NUMBER_MAX = 4;
export const SHIP_MARK_NAME_MAX = 20;

/**
 * Cañonera (unos 35 m): la nave inicial. Cabina de dos plazas al frente, pasillo
 * con el camarote a babor y la cocina a estribor, bodega con rampa ventral y
 * sala de máquinas a popa, entre las dos góndolas de motor.
 */
export const GUNSHIP: ShipTemplate = {
  id: "gunship",
  lengthM: 35,
  crew: 2,
  beds: 2,
  hullM: 0.5,
  rooms: [
    { id: "cockpit", kind: "cockpit", center: [0, 0.4, 7.5], size: [3.4, 2.3, 4] },
    { id: "hall", kind: "corridor", center: [0, 0, 12.5], size: [1.8, 2.3, 6] },
    { id: "quarters", kind: "quarters", center: [-2.4, 0, 12.5], size: [3, 2.3, 5] },
    { id: "galley", kind: "galley", center: [2.4, 0, 12.5], size: [3, 2.3, 5] },
    { id: "airlock", kind: "airlock", center: [0, 0, 16.5], size: [3, 2.3, 2] },
    { id: "cargo", kind: "cargo", center: [0, -0.3, 21], size: [6, 3.2, 7] },
    { id: "engineering", kind: "engineering", center: [0, 0, 27], size: [4.4, 2.6, 5] },
  ],
  noses: ["chisel", "needle", "blunt"],
  wings: ["swept", "delta", "fan", "stub"],
  engines: ["nacelles", "twin", "quad"],
  extras: ["antenna", "turret", "fin", "pods"],
  defaults: {
    template: "gunship",
    colors: { primary: "#8b929c", secondary: "#2b3038", accent: "#e3b24e", lights: "#7fd0ff" },
    pattern: "twoTone",
    parts: { nose: "chisel", wings: "swept", engines: "nacelles", extras: ["antenna", "turret"] },
    proportions: { nose: 1, wingSpan: 1, engineSize: 1 },
    marks: { number: "01", name: "", emblem: "aeon" },
  },
};

export const SHIP_TEMPLATES: Readonly<Record<string, ShipTemplate>> = { gunship: GUNSHIP };

const HEX = /^#[0-9a-f]{6}$/;
const clamp = (v: number, [lo, hi]: readonly [number, number]) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);

/**
 * Deja una personalización dentro de las reglas (para el servidor y para lo que
 * llega de otros): plantilla existente, piezas que admite, colores #rrggbb,
 * proporciones en sus límites y marcas con caracteres permitidos. Lo que no
 * vale vuelve al valor de serie.
 */
export function normalizeShipCustomization(input: unknown): ShipCustomization {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<ShipCustomization>;
  const tpl = SHIP_TEMPLATES[typeof raw.template === "string" ? raw.template : ""] ?? GUNSHIP;
  const d = tpl.defaults;
  const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v.toLowerCase()) ? v.toLowerCase() : fallback);
  const pick = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const parts = (raw.parts ?? {}) as Partial<ShipCustomization["parts"]>;
  const extras = Array.isArray(parts.extras) ? [...new Set(parts.extras.filter((e): e is ShipExtra => tpl.extras.includes(e as ShipExtra)))] : [...d.parts.extras];
  const props = (raw.proportions ?? {}) as Partial<ShipCustomization["proportions"]>;
  const marks = (raw.marks ?? {}) as Partial<ShipCustomization["marks"]>;
  const colors = (raw.colors ?? {}) as Partial<ShipCustomization["colors"]>;
  return {
    template: tpl.id,
    colors: {
      primary: color(colors.primary, d.colors.primary),
      secondary: color(colors.secondary, d.colors.secondary),
      accent: color(colors.accent, d.colors.accent),
      lights: color(colors.lights, d.colors.lights),
    },
    pattern: pick(raw.pattern, SHIP_PATTERNS, d.pattern),
    parts: {
      nose: pick(parts.nose, tpl.noses, d.parts.nose),
      wings: pick(parts.wings, tpl.wings, d.parts.wings),
      engines: pick(parts.engines, tpl.engines, d.parts.engines),
      extras,
    },
    proportions: {
      nose: clamp(Number(props.nose), SHIP_PROPORTIONS.nose),
      wingSpan: clamp(Number(props.wingSpan), SHIP_PROPORTIONS.wingSpan),
      engineSize: clamp(Number(props.engineSize), SHIP_PROPORTIONS.engineSize),
    },
    marks: {
      number: typeof marks.number === "string" ? marks.number.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, SHIP_MARK_NUMBER_MAX) : d.marks.number,
      name: typeof marks.name === "string" ? marks.name.replace(/[^\p{L}\p{N} .'-]/gu, "").replace(/\s+/g, " ").replace(/^ /, "").slice(0, SHIP_MARK_NAME_MAX) : d.marks.name,
      emblem: pick(marks.emblem, SHIP_EMBLEMS, d.marks.emblem),
    },
  };
}
