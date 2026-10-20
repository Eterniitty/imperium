/**
 * Constantes compartidas entre cliente, servidor e IA.
 * Cambiar cualquiera de estas constantes altera el universo generado:
 * hazlo solo junto con un aumento de GENERATOR_VERSION.
 */

/** Lado de un sector cúbico, en años luz. 1 unidad de escena = 1 año luz. */
export const SECTOR_SIZE = 100;

/**
 * Versión del generador procedural. Cada sector guarda la versión con la que
 * fue tocado por primera vez, para que una mejora del algoritmo no altere
 * sistemas donde ya hay colonias.
 */
export const GENERATOR_VERSION = 1;

/** Número mínimo y máximo de sistemas estelares por sector. */
export const MIN_SYSTEMS_PER_SECTOR = 4;
export const MAX_SYSTEMS_PER_SECTOR = 56;
