/**
 * Cuerpos celestes con sus propiedades físicas, derivadas de forma
 * determinista de lo que generó el universo (tipo, radio en radios
 * terrestres, clase de estrella) y de la configuración centralizada
 * `WORLD_SCALE` / `PLANET_BODIES` / `STAR_BODIES` de `@imperium/content`.
 *
 * Aquí está todo lo que un aterrizaje futuro necesitará saber de un cuerpo
 * (ver docs/aterrizaje.md): tipo, radio, μ, gravedad superficial, atmósfera,
 * superficie, distancia de aproximación, condiciones de entrada, recursos y si
 * se puede aterrizar. Hoy lo usan el pulso, las colisiones, el altímetro, la
 * gravedad y la validación del servidor.
 */
import { MOON_SIZE, PLANET_BODIES, STAR_BODIES, SUPERMASSIVE, WORLD_SCALE, type EntryKind, type SurfaceKind } from "@imperium/content";
import type { PlanetType, ResourceId, StarClass } from "@imperium/shared";

export type BodyKind = "star" | "planet" | "moon" | "asteroid";

export interface CelestialBody {
  /** «star», «p<índice>» o «p<índice>m<luna>». */
  id: string;
  kind: BodyKind;
  /** Id del cuerpo alrededor del que orbita (null para la estrella). */
  parent: string | null;
  /** Radio físico en metros: el de las colisiones, la gravedad y el dibujo (no hay radio «visual» aparte). */
  radius: number;
  /** Parámetro gravitatorio de la simulación (m³/s²): aceleración = μ / r². */
  mu: number;
  /** Gravedad superficial lógica (en g, como la mostraría la ficha del cuerpo). */
  surfaceGravityG: number;
  /** Gravedad superficial simulada (m/s²), recortada a `WORLD_SCALE.maxSimGravity`. */
  surfaceGravity: number;
  /** Masa lógica en masas terrestres (estrellas: solares × 333 000). */
  massEarth: number;
  /** Esfera de influencia (m desde el centro): fuera, el cuerpo no atrae. */
  influenceRadius: number;
  /** Altura (m sobre la superficie) donde empieza la aproximación orbital. */
  approachAltitude: number;
  /** Altura (m) por debajo de la cual se está en proximidad a la superficie. */
  surfaceAltitude: number;
  /** Atmósfera: altura (m) y densidad relativa a la terrestre; null si no tiene. */
  atmosphere: { height: number; density: number } | null;
  surface: SurfaceKind | "plasma";
  /** Condiciones de entrada/descenso para un aterrizaje futuro. */
  entry: EntryKind | "none";
  landable: boolean;
  resources: ResourceId[];
}

const S = WORLD_SCALE;
const EARTH_MASSES_PER_SUN = 333_000;

function finishBody(b: Omit<CelestialBody, "mu" | "surfaceGravity" | "approachAltitude" | "surfaceAltitude">): CelestialBody {
  const surfaceGravity = Math.min(S.maxSimGravity, b.surfaceGravityG * S.standardGravity);
  const atmo = b.atmosphere?.height ?? 0;
  return {
    ...b,
    surfaceGravity,
    mu: surfaceGravity * b.radius * b.radius,
    approachAltitude: Math.max(b.radius * S.approachRadii, atmo * 2),
    surfaceAltitude: Math.max(b.radius * S.surfaceProximityRadii, atmo),
  };
}

/** Radio de una estrella en metros según su clase. */
export function starRadiusM(starClass: StarClass, supermassive = false): number {
  const r = supermassive ? SUPERMASSIVE.radiusSolar : STAR_BODIES[starClass].radiusSolar;
  return Math.max(S.minStarRadiusM, S.sunRadiusM * Math.pow(r, S.starRadiusExponent));
}

/** La estrella de un sistema; `supermassive`: Ónfalo, el agujero negro del centro de la galaxia. */
export function starBody(starClass: StarClass, supermassive = false): CelestialBody {
  const info = supermassive ? SUPERMASSIVE : STAR_BODIES[starClass];
  const radius = starRadiusM(starClass, supermassive);
  // Gravedad lógica: 28 g en el Sol, ∝ M / R² (con el radio lógico, sin comprimir).
  const g = (28 * info.massSolar) / (info.radiusSolar * info.radiusSolar);
  return finishBody({
    id: "star",
    kind: "star",
    parent: null,
    radius,
    surfaceGravityG: g,
    massEarth: info.massSolar * EARTH_MASSES_PER_SUN,
    influenceRadius: radius * S.starInfluenceRadii,
    atmosphere: null,
    surface: "plasma",
    entry: "none",
    landable: false,
    resources: [],
  });
}

/** Radio de un planeta en metros. `radiusEarth` es el del generador (radios terrestres). */
export function planetRadiusM(_type: PlanetType, radiusEarth: number): number {
  return S.earthRadiusM * Math.pow(Math.max(radiusEarth, 0.01), S.planetRadiusExponent);
}

/** Cuerpo de un planeta o luna de tipo `type` y radio `radiusEarth` (radios terrestres lógicos). */
export function rockyBody(id: string, kind: "planet" | "moon", parent: string, type: PlanetType, radiusEarth: number): CelestialBody {
  const info = PLANET_BODIES[type];
  const radius = planetRadiusM(type, radiusEarth);
  return finishBody({
    id,
    kind,
    parent,
    radius,
    surfaceGravityG: info.density * radiusEarth,
    massEarth: info.density * radiusEarth * radiusEarth * radiusEarth,
    influenceRadius: radius * (kind === "planet" ? S.planetInfluenceRadii : S.moonInfluenceRadii),
    atmosphere: info.atmosphere ? { height: radius * info.atmosphere.heightFraction, density: info.atmosphere.density } : null,
    surface: info.surface,
    entry: info.entry,
    landable: info.landable,
    resources: [...info.resources],
  });
}

/**
 * Radio de una luna en radios terrestres: proporcional al planeta en los
 * rocosos (como la Luna y la Tierra) y en radios terrestres en los gigantes
 * (como Ganimedes y Júpiter). `u` ∈ [0, 1) sale de un resumen determinista.
 */
export function moonRadiusEarth(planetType: PlanetType, planetRadiusEarth: number, u: number): number {
  const giant = planetType === "gas_giant" || planetType === "ice_giant";
  const [lo, hi] = giant ? MOON_SIZE.giantEarthRadii : MOON_SIZE.rockyFraction;
  const r = giant ? lo + (hi - lo) * u : planetRadiusEarth * (lo + (hi - lo) * u);
  return Math.max(S.minMoonRadiusM / S.earthRadiusM, r);
}
