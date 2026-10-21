/**
 * Regiones de espacio profundo: celdas del espacio interestelar donde se queda
 * la nave del Emperador al salir del túnel cuántico a mitad de viaje. Su id es
 * determinista («deep:x:y:z», coordenadas enteras de la celda) y se usa como un
 * id de sistema más (sala del espacio local compartida por quien esté allí).
 * Su contenido (asteroides…) es secreto y lo manda el servidor.
 */
import type { SystemLocation } from "./api";
import type { WorldPosition } from "./coords";

/** Lado de la celda de una región (años luz). Cambiarlo movería las regiones existentes. */
export const DEEP_CELL_LY = 2;

const PREFIX = "deep:";

/** ¿Es el id de una región de espacio profundo (y no de un sistema estelar)? */
export function isDeepId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PREFIX);
}

/** Celda que contiene una posición (años luz). */
export function deepCellAt(p: WorldPosition): { x: number; y: number; z: number } {
  return { x: Math.floor(p.x / DEEP_CELL_LY), y: Math.floor(p.y / DEEP_CELL_LY), z: Math.floor(p.z / DEEP_CELL_LY) };
}

/** Id de la región que contiene una posición. */
export function deepRegionIdAt(p: WorldPosition): string {
  const c = deepCellAt(p);
  return `${PREFIX}${c.x}:${c.y}:${c.z}`;
}

/** Celda de un id de región, o null si no es válido (o no es canónico). */
export function parseDeepId(id: string): { x: number; y: number; z: number } | null {
  if (!isDeepId(id)) return null;
  const parts = id.slice(PREFIX.length).split(":");
  if (parts.length !== 3 || parts.some((p) => !/^-?\d{1,7}$/.test(p))) return null;
  const [x, y, z] = parts.map((p) => Number.parseInt(p, 10)) as [number, number, number];
  if (`${PREFIX}${x}:${y}:${z}` !== id) return null;
  return { x, y, z };
}

/** Centro de una región (años luz): ahí queda la nave en el mapa galáctico. */
export function deepRegionCenter(cell: { x: number; y: number; z: number }): WorldPosition {
  return { x: (cell.x + 0.5) * DEEP_CELL_LY, y: (cell.y + 0.5) * DEEP_CELL_LY, z: (cell.z + 0.5) * DEEP_CELL_LY };
}

/**
 * Ubicación de una región como la de un sistema: el nombre va vacío (el cliente
 * muestra «Espacio profundo» traducido). Null si el id no es válido.
 */
export function deepLocation(id: string): SystemLocation | null {
  const cell = parseDeepId(id);
  return cell ? { systemId: id, systemName: "", position: deepRegionCenter(cell) } : null;
}

/** Asteroide de una región (lo que ve el cliente): posición (m), radio (m), tipo y unidades que tenía al generarse. */
export interface DeepAsteroid {
  i: number;
  p: [number, number, number];
  r: number;
  kind: "ice" | "metal" | "rare" | "exotic";
  amount: number;
}

/** Contenido de una región: su tipo y sus asteroides (`left`: unidades que quedan en cada uno, por índice). */
export interface DeepRegionView {
  regionId: string;
  kind: "empty" | "ice_field" | "metal_field" | "mixed_field" | "debris" | "anomaly";
  asteroids: DeepAsteroid[];
  left: number[];
}
