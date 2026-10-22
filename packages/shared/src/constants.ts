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
export const GENERATOR_VERSION = 2;

/** Número mínimo y máximo de sistemas estelares por sector. */
export const MIN_SYSTEMS_PER_SECTOR = 4;
export const MAX_SYSTEMS_PER_SECTOR = 56;

/**
 * La galaxia (desde `GENERATOR_VERSION` 2, 22-10-2026): un disco espiral de
 * 30 000 a.l. de diámetro con un agujero negro supermasivo en el centro. El
 * Núcleo Humano sigue en el origen (los anillos se cuentan desde él) y cae en
 * uno de los brazos, a `|center|` del centro, como el Sol en la Vía Láctea.
 * Fuera del disco no hay estrellas. En años luz.
 */
export const GALAXY = {
  /** Centro: el agujero negro supermasivo, en mitad del sector (-90, 0, 0). */
  center: { x: -8950, y: 50, z: 50 },
  radius: 15_000,
  /** Escala del disco: la densidad cae a la mitad a esta distancia del centro. */
  diskScale: 12_000,
  /** Grosor: la densidad cae a 1/4 a esta altura sobre el plano (se ensancha hacia el borde). */
  scaleHeight: 350,
  /** Bulbo central (esférico). */
  bulgeRadius: 1_800,
  arms: 4,
  /** Lo que se enrolla un brazo: 1/tan(ángulo de paso); 4,3 ≈ 13°, como la Vía Láctea. */
  armWind: 4.3,
  /** Densidad entre brazos, respecto a la de un brazo. */
  interArm: 0.3,
  /**
   * Desde la versión 3: fracción de las estrellas que se quedan (≈ 30 000 en
   * toda la galaxia, a ~135 a.l. de su vecina) y, en el Núcleo Humano (anillos
   * hasta `coreRings`), la que se queda allí: el hogar de la humanidad sigue
   * poblado para que haya donde aparecer y colonizar.
   */
  starFraction: 0.0066,
  coreStarFraction: 0.4,
  coreRings: 1,
  /** Nombre del sistema del agujero negro supermasivo (índice 0 de su sector). */
  centerName: "Ónfalo",
} as const;
