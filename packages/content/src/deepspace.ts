/**
 * Espacio profundo y minería (datos). Al salir del túnel cuántico a mitad de
 * viaje, la nave del Emperador queda en una **región de espacio profundo**: una
 * celda del espacio interestelar con id determinista, compartida por quien esté
 * allí. Su contenido (vacío, campos de asteroides, restos, anomalías) sale de
 * una capa determinista y secreta (`@imperium/sim` deepspace.ts, semilla
 * derivada de `DETAIL_SEED`); aquí solo las cifras.
 *
 * Escala: los asteroides se miden con la misma escala centralizada que el resto
 * (`WORLD_SCALE` en bodies.ts): son cuerpos pequeños, de decenas a cientos de
 * metros (la nave del Emperador mide unos 45 m), muy lejos del tamaño de una luna.
 */
import { DEEP_CELL_LY, type DeepRegionView } from "@imperium/shared";
import type { StockId } from "./economy";

/** Lo que contiene una región de espacio profundo. */
export type DeepRegionKind = DeepRegionView["kind"];

/** Tipo de asteroide: decide su aspecto y lo que da al minarlo. */
export type AsteroidKind = "ice" | "metal" | "rare" | "exotic";

export interface AsteroidKindDefinition {
  /** Qué se obtiene por unidad minada (las fracciones suman 1). */
  yields: Partial<Record<StockId, number>>;
  /** Unidades que contiene por metro de radio (un asteroide de 100 m, con 0,5, tiene 50). */
  unitsPerRadiusM: number;
  /** Color base del modelo (el cliente lo varía un poco). */
  color: number;
}

export const ASTEROID_KINDS: Record<AsteroidKind, AsteroidKindDefinition> = {
  /** Hielo y volátiles: combustible para refinar a bordo. */
  ice: { yields: { volatiles: 1 }, unitsPerRadiusM: 0.6, color: 0xbfe3f2 },
  /** Metálico: metal y algo de metales raros (platino, iridio, osmio, neodimio…). */
  metal: { yields: { metal: 0.8, rare_metals: 0.2 }, unitsPerRadiusM: 0.5, color: 0x8d8478 },
  /** Rico: sobre todo metales raros y trazas de materia exótica. */
  rare: { yields: { rare_metals: 0.6, metal: 0.36, exotic: 0.04 }, unitsPerRadiusM: 0.4, color: 0xb59a5a },
  /** Exótico: fragmentos donde el espacio conserva una huella antigua (anomalías, restos de los Precursores). */
  exotic: { yields: { exotic: 0.35, rare_metals: 0.65 }, unitsPerRadiusM: 0.25, color: 0x9a5cff },
};

/** Una forma de región: con qué peso aparece y qué asteroides tiene. */
export interface DeepRegionDefinition {
  weight: number;
  /** Número de asteroides [mín, máx] (0 en las regiones vacías). */
  asteroids: readonly [number, number];
  /** Proporción de cada tipo de asteroide. */
  mix: Partial<Record<AsteroidKind, number>>;
  /** Radio del campo [mín, máx] en metros, alrededor del punto donde se aparece. */
  fieldRadiusM: readonly [number, number];
}

export const DEEP_REGIONS: Record<DeepRegionKind, DeepRegionDefinition> = {
  empty: { weight: 34, asteroids: [0, 0], mix: {}, fieldRadiusM: [0, 0] },
  ice_field: { weight: 24, asteroids: [40, 90], mix: { ice: 0.85, metal: 0.15 }, fieldRadiusM: [6_000, 16_000] },
  metal_field: { weight: 20, asteroids: [30, 70], mix: { metal: 0.75, ice: 0.15, rare: 0.1 }, fieldRadiusM: [5_000, 14_000] },
  mixed_field: { weight: 10, asteroids: [40, 80], mix: { ice: 0.4, metal: 0.4, rare: 0.18, exotic: 0.02 }, fieldRadiusM: [7_000, 18_000] },
  /** Restos: un campo pequeño de chatarra metálica de batallas olvidadas. */
  debris: { weight: 8, asteroids: [12, 30], mix: { metal: 0.7, rare: 0.3 }, fieldRadiusM: [2_000, 5_000] },
  /** Anomalía: pocos fragmentos, pero con materia exótica. */
  anomaly: { weight: 4, asteroids: [6, 14], mix: { exotic: 0.5, rare: 0.5 }, fieldRadiusM: [3_000, 7_000] },
};

export const DEEP_SPACE = {
  /** Lado de la celda (a.l.) de una región: quien sale del túnel en la misma celda comparte región y se ve. */
  cellLy: DEEP_CELL_LY,
  /** Radio de los asteroides (m) [mín, máx]: de unas veces la nave a casi diez veces. */
  asteroidRadiusM: [30, 420] as const,
  /** Hueco libre (m) alrededor del punto de llegada: nadie aparece dentro de una roca. */
  clearRadiusM: 2_500,
  /** Borde de la región (m): más allá, se sale al espacio interestelar como del borde de un sistema. */
  boundaryM: 60_000_000,
  /** Horas para que un asteroide agotado se regenere del todo (se regenera de forma lineal). */
  regenHours: 24,
} as const;

/** Láser de minería de la nave del Emperador (servidor autoritativo). */
export const MINING = {
  /** Distancia máxima (m) del centro de la nave a la superficie del asteroide (con margen para naves grandes). */
  rangeM: 1_000,
  /** Unidades extraídas por segundo de láser. */
  unitsPerSec: 3,
  /** Energía por segundo de láser (la del reactor de la nave). */
  energyPerSec: 4,
  /** Cada cuánto envía el cliente un pulso de minería (s); el servidor no acepta más de uno por intervalo. */
  tickSec: 0.5,
} as const;

/** Bodega de la nave del Emperador: pequeña, para lo minado. */
export const FLAGSHIP_HOLD = {
  /** Capacidad total (unidades, todos los recursos juntos). */
  capacity: 200,
  /** Refinería de a bordo: volátiles de la bodega por unidad de combustible (peor que en una colonia, 0,2). */
  refineVolatilesPerFuel: 0.5,
  /** Combustible refinado por segundo (lento: un depósito lleno, casi un cuarto de hora). */
  refineFuelPerSec: 1.2,
} as const;

/** Recursos que pueden ir en la bodega de la nave. */
export const HOLD_STOCK_IDS: readonly StockId[] = ["volatiles", "metal", "rare_metals", "exotic"];

/** Errores de coherencia de estos datos (vacío si todo está bien). */
export function validateDeepSpace(): string[] {
  const errors: string[] = [];
  for (const [id, k] of Object.entries(ASTEROID_KINDS)) {
    const sum = Object.values(k.yields).reduce((a, b) => a + (b ?? 0), 0);
    if (Math.abs(sum - 1) > 1e-9) errors.push(`asteroide ${id}: los rendimientos no suman 1`);
    for (const r of Object.keys(k.yields)) if (!HOLD_STOCK_IDS.includes(r as StockId)) errors.push(`asteroide ${id}: ${r} no cabe en la bodega`);
    if (!(k.unitsPerRadiusM > 0)) errors.push(`asteroide ${id}: unitsPerRadiusM debe ser > 0`);
  }
  for (const [id, r] of Object.entries(DEEP_REGIONS)) {
    if (!(r.weight >= 0)) errors.push(`región ${id}: peso negativo`);
    if (r.asteroids[0] > r.asteroids[1]) errors.push(`región ${id}: intervalo de asteroides al revés`);
    const sum = Object.values(r.mix).reduce((a, b) => a + (b ?? 0), 0);
    if (r.asteroids[1] > 0 && Math.abs(sum - 1) > 1e-9) errors.push(`región ${id}: la mezcla no suma 1`);
    if (r.asteroids[1] > 0 && r.fieldRadiusM[0] <= DEEP_SPACE.clearRadiusM) errors.push(`región ${id}: campo más pequeño que el hueco de llegada`);
  }
  return errors;
}
