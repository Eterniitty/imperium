/**
 * Funciones hash de 32 bits, deterministas en cualquier motor de JavaScript.
 *
 * Regla del generador: solo se usan operaciones enteras (Math.imul, xor,
 * desplazamientos) y aritmética básica de coma flotante (+ - * / sqrt).
 * Funciones como Math.sin, Math.pow o Math.log no garantizan resultados
 * idénticos entre navegadores y servidor, así que no se usan para nada que
 * afecte al juego.
 */

/** Mezclador final de MurmurHash3. Distribuye bien bits parecidos. */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash FNV-1a de una cadena, mezclado al final. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/** Combina una semilla con una lista de enteros (coordenadas, índices…). */
export function hashInts(seed: number, ...values: number[]): number {
  let h = seed >>> 0;
  for (const v of values) {
    h ^= mix32((v | 0) + 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = (h << 13) | (h >>> 19);
  }
  return mix32(h);
}

/** Convierte un hash de 32 bits en un número en [0, 1). */
export function hashToUnit(h: number): number {
  return (h >>> 0) / 4294967296;
}
