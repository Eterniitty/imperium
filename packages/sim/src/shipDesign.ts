/**
 * Reglas del editor de naves (fase E1, `docs/editor-naves.md`): un diseño es
 * un casco con una pieza en algunos de sus anclajes. Aquí se decide si la nave
 * funciona (y qué le falta) y qué estadísticas salen de sus piezas. Funciones
 * puras: las usan el editor (en vivo) y el servidor (que nunca se fía del cliente).
 */
import { fitsSlot, getHull, getPart, hullAtLeast, type HullClass, type PartCost, type PartDef, type PartKind } from "@imperium/content";

/** Un diseño: casco y pieza de cada anclaje ocupado (`slotId → partId`). */
export interface ShipDesign {
  hullId: string;
  parts: Readonly<Record<string, string>>;
}

/**
 * Problema de un diseño. `error`: la nave no se puede construir así;
 * `warning`: se puede, pero le falta algo importante (p. ej. no podrá saltar).
 */
export type DesignProblem =
  | { level: "error"; code: "unknown_hull" }
  | { level: "error"; code: "unknown_slot"; slot: string }
  | { level: "error"; code: "unknown_part"; slot: string; part: string }
  | { level: "error"; code: "wrong_kind"; slot: string; part: string }
  | { level: "error"; code: "too_big"; slot: string; part: string }
  | { level: "error"; code: "min_hull"; slot: string; part: string; min: HullClass }
  | { level: "error"; code: "missing_bridge" | "missing_reactor" | "missing_thruster" }
  | { level: "error"; code: "power_deficit"; use: number; gen: number }
  | { level: "warning"; code: "no_quantum" | "no_fuel" | "unarmed" | "no_shield" };

/** Estadísticas de una nave según sus piezas. */
export interface DesignStats {
  massT: number;
  powerGenMW: number;
  powerUseMW: number;
  thrustKN: number;
  /** Aceleración (m/s²) = empuje / masa. */
  accel: number;
  /** Velocidad de crucero (impulso, m/s) y fracción de la velocidad máxima del pulso que alcanza (0–1). */
  cruiseMs: number;
  pulseFactor: number;
  /** Giro (grados por segundo): cuanto más pesada, más lenta. */
  turnDegPerSec: number;
  /** Salto: velocidad en la grieta (a.l./h), alcance con el depósito lleno (a.l.) y carga (s); null si no tiene motor cuántico. */
  riftLyPerHour: number | null;
  jumpRangeLy: number | null;
  chargeSec: number | null;
  fuel: number;
  hull: number;
  shield: number;
  shieldRegen: number;
  shieldDelaySec: number;
  weapons: Array<{ slot: string; part: string; weapon: NonNullable<PartDef["stats"]["weapon"]>; dps: number; rangeM: number }>;
  dps: number;
  cargo: number;
  humans: number;
  crew: number;
  fighters: number;
  scanLy: number;
  cost: Required<PartCost>;
}

/** Aceleración de referencia: con ella el pulso llega al máximo. */
export const PULSE_FULL_ACCEL = 10;
/** Masa de referencia para el motor cuántico (t): con ella va a su velocidad nominal y carga en su tiempo. */
export const QUANTUM_REF_MASS_T = 1000;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Piezas válidas del diseño con su anclaje (las que no existen o no caben se ignoran; `validateDesign` las señala). */
function placed(design: ShipDesign): Array<{ slot: string; part: PartDef }> {
  const hull = getHull(design.hullId);
  if (!hull) return [];
  const out: Array<{ slot: string; part: PartDef }> = [];
  for (const s of hull.slots) {
    const id = design.parts[s.id];
    const part = id ? getPart(id) : undefined;
    if (part && s.kinds.includes(part.kind) && fitsSlot(part.size, s.size) && (!part.minHull || hullAtLeast(hull.class, part.minHull))) out.push({ slot: s.id, part });
  }
  return out;
}

/** Problemas de un diseño (vacío si está perfecto). Los `error` impiden construirla. */
export function validateDesign(design: ShipDesign): DesignProblem[] {
  const hull = getHull(design.hullId);
  if (!hull) return [{ level: "error", code: "unknown_hull" }];
  const problems: DesignProblem[] = [];
  for (const [slotId, partId] of Object.entries(design.parts)) {
    const s = hull.slots.find((x) => x.id === slotId);
    const part = getPart(partId);
    if (!s) problems.push({ level: "error", code: "unknown_slot", slot: slotId });
    else if (!part) problems.push({ level: "error", code: "unknown_part", slot: slotId, part: partId });
    else if (!s.kinds.includes(part.kind)) problems.push({ level: "error", code: "wrong_kind", slot: slotId, part: partId });
    else if (!fitsSlot(part.size, s.size)) problems.push({ level: "error", code: "too_big", slot: slotId, part: partId });
    else if (part.minHull && !hullAtLeast(hull.class, part.minHull)) problems.push({ level: "error", code: "min_hull", slot: slotId, part: partId, min: part.minHull });
  }
  const parts = placed(design);
  const has = (k: PartKind) => parts.some((p) => p.part.kind === k);
  if (!has("bridge")) problems.push({ level: "error", code: "missing_bridge" });
  if (!has("reactor")) problems.push({ level: "error", code: "missing_reactor" });
  if (!has("thruster")) problems.push({ level: "error", code: "missing_thruster" });
  const s = designStats(design);
  if (s.powerUseMW > s.powerGenMW) problems.push({ level: "error", code: "power_deficit", use: s.powerUseMW, gen: s.powerGenMW });
  if (!has("quantum")) problems.push({ level: "warning", code: "no_quantum" });
  else if (s.fuel <= 0) problems.push({ level: "warning", code: "no_fuel" });
  if (!has("weapon")) problems.push({ level: "warning", code: "unarmed" });
  if (!has("shield")) problems.push({ level: "warning", code: "no_shield" });
  return problems;
}

/** ¿Se puede construir? (sin errores; los avisos no lo impiden). */
export function isBuildable(design: ShipDesign): boolean {
  return validateDesign(design).every((p) => p.level !== "error");
}

/** Estadísticas del diseño a partir de sus piezas (las que no son válidas no cuentan). */
export function designStats(design: ShipDesign): DesignStats {
  const hull = getHull(design.hullId);
  const parts = placed(design);
  const sum = (f: (p: PartDef) => number | undefined) => parts.reduce((a, { part }) => a + (f(part) ?? 0), 0);
  const massT = (hull?.massT ?? 0) + sum((p) => p.massT);
  const thrustKN = sum((p) => p.stats.thrustKN);
  const accel = massT > 0 ? thrustKN / massT : 0;
  // El motor cuántico más rápido manda; con más masa va más lento, carga más y gasta más.
  const quantum = parts.map((p) => p.part).filter((p) => p.kind === "quantum").sort((a, b) => (b.stats.riftLyPerHour ?? 0) - (a.stats.riftLyPerHour ?? 0))[0];
  const fuel = sum((p) => p.stats.fuel);
  const massRatio = massT / QUANTUM_REF_MASS_T;
  const weapons = parts
    .filter(({ part }) => part.kind === "weapon" && part.stats.weapon)
    .map(({ slot, part }) => ({ slot, part: part.id, weapon: part.stats.weapon!, dps: part.stats.dps ?? 0, rangeM: part.stats.rangeM ?? 0 }));
  const cost: Required<PartCost> = { credits: 0, metal: 0, crystal: 0, alloys: 0, rare_metals: 0, exotic: 0 };
  for (const c of [hull?.cost, ...parts.map((p) => p.part.cost)]) {
    if (!c) continue;
    for (const k of Object.keys(cost) as Array<keyof PartCost>) cost[k] += c[k] ?? 0;
  }
  return {
    massT,
    powerGenMW: sum((p) => p.stats.powerMW),
    powerUseMW: sum((p) => p.drawMW),
    thrustKN,
    accel: round1(accel),
    cruiseMs: Math.round(clamp(60 + 18 * accel, 0, 600)) * (thrustKN > 0 ? 1 : 0),
    pulseFactor: round1(clamp(accel / PULSE_FULL_ACCEL, 0, 1)),
    turnDegPerSec: massT > 0 ? round1(clamp(90 / Math.sqrt(massT / 100), 4, 90)) : 0,
    riftLyPerHour: quantum ? Math.round((quantum.stats.riftLyPerHour ?? 0) * clamp(1 / Math.sqrt(massRatio), 0.5, 1.3)) : null,
    jumpRangeLy: quantum ? Math.round(fuel / ((quantum.stats.fuelPerLyPer1000T ?? 1) * Math.max(0.05, massRatio))) : null,
    chargeSec: quantum ? round1((quantum.stats.chargeSec ?? 15) * clamp(Math.sqrt(massRatio), 0.8, 1.6)) : null,
    fuel,
    hull: (hull?.hull ?? 0) + sum((p) => p.stats.hull),
    shield: sum((p) => p.stats.shield),
    shieldRegen: sum((p) => p.stats.shieldRegen),
    shieldDelaySec: parts.reduce((a, { part }) => Math.max(a, part.stats.shieldDelaySec ?? 0), 0),
    weapons,
    dps: weapons.reduce((a, w) => a + w.dps, 0),
    cargo: (hull?.cargo ?? 0) + sum((p) => p.stats.cargo),
    humans: sum((p) => p.stats.humans),
    crew: sum((p) => p.stats.crew),
    fighters: sum((p) => p.stats.fighters),
    scanLy: parts.reduce((a, { part }) => Math.max(a, part.stats.scanLy ?? 0), 0),
    cost,
  };
}
