import type { PlanetType, ResourceId, StarClass } from "@imperium/shared";

/**
 * Escala del universo y propiedades físicas de los cuerpos (estrellas,
 * planetas, lunas y asteroides). Es la **configuración centralizada** de la
 * escala: ningún otro archivo debe fijar tamaños de cuerpos a mano. La usan
 * `@imperium/sim` (systemLayout.ts, bodies.ts, gravity.ts) en el cliente y en
 * el servidor, y la Wiki (tablas generadas).
 *
 * Hay cuatro escalas distintas (ver docs/aterrizaje.md y la Wiki «Universo»):
 * 1. **Lógica (astronómica)**: lo que dice el generador (radios terrestres,
 *    unidades astronómicas, clase de estrella). No cambia aquí.
 * 2. **Física (simulación)**: metros de la simulación, iguales en cliente y
 *    servidor: radios, órbitas, μ, esferas de influencia y colisiones.
 * 3. **Visual (render)**: el cliente dibuja cada cuerpo con su radio físico
 *    (nunca más grande para que se vea de lejos); para orientarse de lejos
 *    están los rótulos y las líneas de órbita.
 * 4. **Interacción**: distancias de aproximación, proximidad a la superficie
 *    y alcance del pulso, derivadas de las anteriores.
 */
export const WORLD_SCALE = {
  /** Metros físicos por radio terrestre lógico (1/10 del real: la Tierra mediría 637 km). */
  earthRadiusM: 637_100,
  /**
   * Metros por radio solar a la potencia `starRadiusExponent`: el Sol mediría
   * 40 radios terrestres (25 484 km; el real, 109), así una estrella es siempre
   * claramente mayor que el mayor gigante gaseoso (12 radios terrestres).
   */
  sunRadiusM: 25_484_000,
  /** Compresión de los radios estelares (raíz cuadrada): una gigante roja no ocupa medio sistema. */
  starRadiusExponent: 0.5,
  /** Radio mínimo de una estrella (las de neutrones medirían 10 km). */
  minStarRadiusM: 200_000,
  /**
   * Metros por unidad astronómica a la potencia `orbitExponent`. Las órbitas se
   * comprimen con la raíz cuadrada (conservan el orden y la proporción entre
   * planetas interiores y exteriores) para cruzar el sistema con el pulso en uno
   * o dos minutos.
   */
  auM: 180_000_000,
  orbitExponent: 0.5,
  /** Hueco mínimo entre las esferas de influencia de dos cuerpos vecinos (m). */
  orbitGapM: 20_000_000,
  /** Media anchura de un cinturón de asteroides (m). */
  beltHalfWidthM: 8_000_000,
  /** Periodo de rotación de los planetas (horas reales), entre estos extremos. */
  spinHours: [14, 60],
  /** Margen entre el último cuerpo y el borde del sistema (m). */
  boundaryMarginM: 60_000_000,
  /** Esfera de influencia de la estrella, en radios estelares (dentro no hay planetas). */
  starInfluenceRadii: 6,
  /** Esfera de influencia mínima de un planeta, en radios del planeta. */
  planetInfluenceRadii: 8,
  /** Esfera de influencia de una luna, en radios de la luna. */
  moonInfluenceRadii: 5,
  /** Órbita de la primera luna y separación entre lunas, en radios del planeta. */
  moonFirstOrbitRadii: 3.5,
  moonOrbitSpacingRadii: 2.2,
  /** Radio mínimo de una luna (m): las más pequeñas siguen siendo miles de veces la nave. */
  minMoonRadiusM: 15_000,
  /**
   * Velocidad orbital de referencia (m/s) de un planeta a 100 000 km de la
   * estrella. Las órbitas siguen la ley de Kepler (T ∝ r^1,5) pero mucho más
   * despacio que la real: así un planeta nunca se escapa de una nave que
   * maniobra (250 m/s) y todos lo ven en el mismo sitio.
   */
  orbitSpeedRefMs: 25,
  orbitSpeedRefRadiusM: 100_000_000,
  /** Velocidad orbital de las lunas (m/s) en su primera órbita; las de fuera, más despacio. */
  moonOrbitSpeedMs: 12,
  /** Aceleración de la gravedad en la superficie de un cuerpo de 1 g (m/s²). */
  standardGravity: 9.81,
  /**
   * Tope de la gravedad simulada (m/s²): la de una estrella real (28 g) haría
   * imposible escapar con los propulsores. Se recorta y se documenta.
   */
  maxSimGravity: 30,
  /** Proximidad a la superficie: por debajo de esta fracción del radio (o de la atmósfera, si es mayor). */
  surfaceProximityRadii: 0.05,
  /** Distancia de aproximación (m sobre la superficie), en radios: donde termina la aproximación orbital. */
  approachRadii: 1.5,
} as const;

/** Estrella lógica por clase: radio y masa en unidades solares (valores típicos). */
export interface StarBody {
  radiusSolar: number;
  massSolar: number;
}

export const STAR_BODIES: Record<StarClass, StarBody> = {
  O: { radiusSolar: 10, massSolar: 30 },
  B: { radiusSolar: 4, massSolar: 6 },
  A: { radiusSolar: 1.8, massSolar: 2 },
  F: { radiusSolar: 1.3, massSolar: 1.3 },
  G: { radiusSolar: 1, massSolar: 1 },
  K: { radiusSolar: 0.8, massSolar: 0.75 },
  M: { radiusSolar: 0.4, massSolar: 0.3 },
  RG: { radiusSolar: 30, massSolar: 1.2 },
  WD: { radiusSolar: 0.013, massSolar: 0.6 },
  NS: { radiusSolar: 0.000015, massSolar: 1.4 },
  // Agujero negro: «radio» del horizonte de sucesos con el disco, exagerado para que se vea.
  BH: { radiusSolar: 0.012, massSolar: 10 },
};

export type SurfaceKind = "rock" | "dust" | "ice" | "lava" | "ocean" | "sand" | "toxic" | "gas";
/** Cómo es la entrada en la atmósfera (o el descenso sin ella) para un aterrizaje futuro. */
export type EntryKind = "vacuum" | "gentle" | "turbulent" | "hot" | "crushing";

/** Propiedades físicas de un tipo de planeta o luna (ver docs/aterrizaje.md). */
export interface PlanetBody {
  /** Densidad media relativa a la Tierra: con el radio da la gravedad (g ∝ ρ·R) y la masa (∝ ρ·R³). */
  density: number;
  /** Atmósfera: altura en fracción del radio y densidad relativa a la terrestre; null si no tiene. */
  atmosphere: { heightFraction: number; density: number } | null;
  surface: SurfaceKind;
  entry: EntryKind;
  /** Se podrá aterrizar (cuando exista el aterrizaje). Los gigantes no tienen superficie. */
  landable: boolean;
  /** Recursos que se podrán extraer en la superficie (futuro). */
  resources: ResourceId[];
}

export const PLANET_BODIES: Record<PlanetType, PlanetBody> = {
  lava: { density: 1.05, atmosphere: { heightFraction: 0.012, density: 0.6 }, surface: "lava", entry: "hot", landable: true, resources: ["metal", "crystal"] },
  barren: { density: 0.75, atmosphere: null, surface: "dust", entry: "vacuum", landable: true, resources: ["metal"] },
  rocky: { density: 1, atmosphere: { heightFraction: 0.016, density: 0.8 }, surface: "rock", entry: "gentle", landable: true, resources: ["metal", "volatiles"] },
  desert: { density: 0.95, atmosphere: { heightFraction: 0.014, density: 0.5 }, surface: "sand", entry: "turbulent", landable: true, resources: ["metal", "crystal"] },
  ocean: { density: 0.92, atmosphere: { heightFraction: 0.02, density: 1 }, surface: "ocean", entry: "gentle", landable: true, resources: ["volatiles"] },
  toxic: { density: 0.95, atmosphere: { heightFraction: 0.03, density: 3 }, surface: "toxic", entry: "turbulent", landable: true, resources: ["volatiles", "crystal"] },
  ice: { density: 0.5, atmosphere: { heightFraction: 0.008, density: 0.2 }, surface: "ice", entry: "gentle", landable: true, resources: ["volatiles"] },
  gas_giant: { density: 0.24, atmosphere: { heightFraction: 0.06, density: 50 }, surface: "gas", entry: "crushing", landable: false, resources: ["volatiles"] },
  ice_giant: { density: 0.3, atmosphere: { heightFraction: 0.05, density: 30 }, surface: "gas", entry: "crushing", landable: false, resources: ["volatiles"] },
};

/**
 * Tamaño de las lunas en fracción del radio de su planeta (planetas rocosos:
 * la Luna es 0,27 la Tierra) o, en los gigantes, en radios terrestres
 * (Ganimedes, 0,41). El punto exacto dentro del intervalo sale de un resumen
 * determinista del sistema, el planeta y la luna.
 */
export const MOON_SIZE = {
  rockyFraction: [0.1, 0.27],
  giantEarthRadii: [0.08, 0.45],
} as const;
