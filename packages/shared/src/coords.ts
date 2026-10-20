import { SECTOR_SIZE } from "./constants";

/** Coordenadas enteras de un sector en la rejilla 3D infinita. */
export interface SectorCoord {
  x: number;
  y: number;
  z: number;
}

/** Posición absoluta en el universo, en años luz. */
export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

/** Clave textual estable de un sector: "x:y:z". */
export function sectorKey(c: SectorCoord): string {
  return `${c.x}:${c.y}:${c.z}`;
}

export function parseSectorKey(key: string): SectorCoord {
  const parts = key.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Clave de sector no válida: ${key}`);
  }
  return { x: parts[0]!, y: parts[1]!, z: parts[2]! };
}

/** Sector que contiene una posición absoluta. */
export function worldToSector(p: WorldPosition): SectorCoord {
  return {
    x: Math.floor(p.x / SECTOR_SIZE),
    y: Math.floor(p.y / SECTOR_SIZE),
    z: Math.floor(p.z / SECTOR_SIZE),
  };
}

/** Esquina mínima del sector en coordenadas absolutas. */
export function sectorOrigin(c: SectorCoord): WorldPosition {
  return { x: c.x * SECTOR_SIZE, y: c.y * SECTOR_SIZE, z: c.z * SECTOR_SIZE };
}

export function distance(a: WorldPosition, b: WorldPosition): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Identificador de sistema estelar: "sx:sy:sz:indice". */
export function systemId(sector: SectorCoord, index: number): string {
  return `${sectorKey(sector)}:${index}`;
}

export function parseSystemId(id: string): { sector: SectorCoord; index: number } {
  const parts = id.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Identificador de sistema no válido: ${id}`);
  }
  return { sector: { x: parts[0]!, y: parts[1]!, z: parts[2]! }, index: parts[3]! };
}
