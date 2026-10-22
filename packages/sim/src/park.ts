/**
 * Nave aparcada: cuando nadie la pilota, la nave del Emperador no se queda
 * clavada en el espacio, sino que orbita la estrella con la misma ley que los
 * planetas (`orbitalPeriodS` en systemLayout.ts). Su posición se calcula a
 * partir de dónde estaba a una hora dada y de la hora del servidor, así que el
 * servidor (combate, visibilidad) y todos los clientes la ven en el mismo sitio.
 */
import { WORLD_SCALE } from "@imperium/content";
import { bodiesAt, moonOffset, orbitalPeriodS, planetPosition, type SystemLayout } from "./systemLayout";

export type Vec3Like = readonly [number, number, number];

/** Dónde estaba la nave aparcada (metros) a la hora `at` (milisegundos del servidor). */
export interface ParkedOrbit {
  p: Vec3Like;
  at: number;
  /**
   * Aparcada junto a un planeta (índice en `layout.planets`) o a una de sus
   * lunas: `p` es entonces el desplazamiento desde su centro y la nave lo
   * acompaña en su órbita (se queda donde se dejó respecto a él).
   */
  anchor?: { planet: number; moon?: number };
  /** Orientación con que se dejó (cuaternión x, y, z, w). */
  q?: readonly [number, number, number, number];
  /** Si se dejó con los motores encendidos. */
  engines?: boolean;
  /**
   * Crucero sin piloto (se cerró la pestaña en pleno crucero): desde `from` (a
   * la hora `at`) la nave va en línea recta hasta su sitio junto al cuerpo
   * anclado, adonde llega a la hora `until`; después, aparcada allí.
   */
  travel?: { from: Vec3Like; until: number };
  /**
   * En órbita sin piloto: el desplazamiento `p` gira alrededor del eje vertical
   * del cuerpo anclado a `spin` rad/s (positivo: según la regla de la mano
   * derecha sobre +Y), desde la hora `at` (o desde la llegada, si va de camino).
   */
  spin?: number;
}

/** Centro del cuerpo al que está anclada la nave a la hora `t`, o null si no lo está (o no existe). */
export function anchorCenter(park: Pick<ParkedOrbit, "anchor">, t: number, layout: SystemLayout | null | undefined): [number, number, number] | null {
  if (!park.anchor || !layout) return null;
  const planet = layout.planets[park.anchor.planet];
  if (!planet) return null;
  const c = planetPosition(planet, t);
  const moon = park.anchor.moon !== undefined ? planet.moons[park.anchor.moon] : undefined;
  if (park.anchor.moon !== undefined && !moon) return null;
  if (moon) {
    const o = moonOffset(moon, t);
    return [c.x + o.x, c.y + o.y, c.z + o.z];
  }
  return [c.x, c.y, c.z];
}

/**
 * Posición de la nave aparcada a la hora `t`. Anclada a un cuerpo, va con él;
 * si no, gira alrededor del eje vertical de la estrella (en el mismo sentido
 * que los planetas) conservando su altura. Sin `layout` no se puede seguir al
 * cuerpo: se usa la órbita alrededor de la estrella.
 */
export function parkedPosition(park: ParkedOrbit, t: number, layout?: SystemLayout | null): [number, number, number] {
  const c = anchorCenter(park, t, layout);
  if (c && park.travel && t < park.travel.until) {
    // De camino (crucero sin piloto): en línea recta hasta su sitio junto al cuerpo, que se mueve con él.
    const k = Math.max(0, Math.min(1, (t - park.at) / Math.max(1, park.travel.until - park.at)));
    const f = park.travel.from;
    return [f[0] + (c[0] + park.p[0] - f[0]) * k, f[1] + (c[1] + park.p[1] - f[1]) * k, f[2] + (c[2] + park.p[2] - f[2]) * k];
  }
  if (c && park.spin) {
    const since = (t - (park.travel ? park.travel.until : park.at)) / 1000;
    const a = park.spin * since;
    const [x, y, z] = park.p;
    return [c[0] + x * Math.cos(a) + z * Math.sin(a), c[1] + y, c[2] - x * Math.sin(a) + z * Math.cos(a)];
  }
  if (c) return [c[0] + park.p[0], c[1] + park.p[1], c[2] + park.p[2]];
  const [x, y, z] = park.p;
  const r = Math.hypot(x, z);
  if (r < 1) return [x, y, z];
  // La velocidad depende de la distancia a la estrella (no solo de la proyección en el plano).
  const period = orbitalPeriodS(Math.hypot(x, y, z));
  // Se reduce a una vuelta antes de multiplicar para no perder precisión con tiempos enormes.
  const dt = ((t - park.at) / 1000) % period;
  const a = Math.atan2(-z, x) + (2 * Math.PI * dt) / period;
  return [Math.cos(a) * r, y, -Math.sin(a) * r];
}

/**
 * Aparca una nave en `p` a la hora `at`: anclada al planeta o luna en cuya
 * esfera de influencia está (la menor que la contiene) o, fuera de todas, en
 * órbita alrededor de la estrella.
 */
export function parkAt(layout: SystemLayout | null | undefined, p: Vec3Like, at: number, extra?: Pick<ParkedOrbit, "q" | "engines">): ParkedOrbit {
  let best: { anchor: { planet: number; moon?: number }; c: [number, number, number]; soi: number } | null = null;
  for (const [i, planet] of (layout?.planets ?? []).entries()) {
    const c = planetPosition(planet, at);
    const candidates: Array<{ anchor: { planet: number; moon?: number }; c: [number, number, number]; soi: number }> = [{ anchor: { planet: i }, c: [c.x, c.y, c.z], soi: planet.body.influenceRadius }];
    planet.moons.forEach((m, j) => {
      const o = moonOffset(m, at);
      candidates.push({ anchor: { planet: i, moon: j }, c: [c.x + o.x, c.y + o.y, c.z + o.z], soi: m.body.influenceRadius });
    });
    for (const k of candidates) {
      if (Math.hypot(p[0] - k.c[0], p[1] - k.c[1], p[2] - k.c[2]) < k.soi && (!best || k.soi < best.soi)) best = k;
    }
  }
  if (!best) return { p, at, ...extra };
  return { p: [p[0] - best.c[0], p[1] - best.c[1], p[2] - best.c[2]], at, anchor: best.anchor, ...extra };
}

/** Velocidad orbital (m/s) de una nave aparcada a la hora `t` (para interpolar en los clientes). */
export function parkedVelocity(park: ParkedOrbit, t: number, layout?: SystemLayout | null): [number, number, number] {
  if (anchorCenter(park, t, layout)) {
    // La del cuerpo al que va anclada (diferencia en un segundo).
    const a = parkedPosition(park, t, layout);
    const b = parkedPosition(park, t + 1000, layout);
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  }
  const [x, y, z] = parkedPosition(park, t);
  if (Math.hypot(x, z) < 1) return [0, 0, 0];
  const w = (2 * Math.PI) / orbitalPeriodS(Math.hypot(x, y, z));
  // Derivada de (cos a·r, y, −sin a·r) respecto al tiempo con a' = w.
  return [z * w, 0, -x * w];
}

/**
 * Dónde aparca una nave que no ha volado nunca en el sistema (o que renace):
 * en el hueco entre la esfera de influencia del primer planeta y la del
 * siguiente cuerpo (o fuera de la de la estrella), siempre en el mismo lado.
 * Hora de referencia 0: desde entonces orbita como cualquier otra.
 */
export function defaultPark(layout: SystemLayout): ParkedOrbit {
  const first = layout.planets[0];
  const r = first ? first.orbitRadius + first.body.influenceRadius + WORLD_SCALE.orbitGapM / 2 : layout.parkMinRadius * 1.5;
  const d = Math.hypot(0.2, 0.15, 1);
  const k = r / d;
  return { p: [0.2 * k, 0.15 * k, 1 * k], at: 0 };
}

/**
 * Una nave no se queda aparcada dentro de la esfera de influencia de la
 * estrella: se lleva hacia fuera en la misma dirección. También corrige las
 * órbitas guardadas con la escala anterior (sistemas de pocos miles de km),
 * sin migrar la base de datos.
 */
export function sanitizePark(layout: SystemLayout, park: ParkedOrbit): ParkedOrbit {
  // Anclada a un cuerpo que existe: se queda donde se dejó.
  if (anchorCenter(park, park.at, layout)) return park;
  if (park.anchor) park = { p: park.travel ? park.travel.from : park.p, at: park.at, q: park.q, engines: park.engines };
  const [x, y, z] = park.p;
  const d = Math.hypot(x, y, z);
  const min = layout.parkMinRadius * 1.05;
  if (d >= min) return park;
  if (d < 1) return { ...park, p: [0, 0, min] };
  const k = min / d;
  return { ...park, p: [x * k, y * k, z * k] };
}

/** Fracción del radio del sistema a la que aparece una nave que llega de un salto. */
export const ARRIVAL_EDGE = 0.97;

/**
 * Dónde aparece una nave que llega de un salto: en el borde del sistema de
 * destino, del lado por el que llega (`fromDir`: dirección desde la estrella de
 * destino hacia la de origen, en coordenadas de la galaxia; no hace falta que
 * sea unitaria). Orbita desde la hora de llegada.
 */
export function arrivalPark(layout: SystemLayout, fromDir: Vec3Like, arriveAt: number): ParkedOrbit {
  const l = Math.hypot(fromDir[0], fromDir[1], fromDir[2]);
  const d: Vec3Like = l > 0 ? [fromDir[0] / l, fromDir[1] / l, fromDir[2] / l] : [0, 0, 1];
  const r = layout.boundary * ARRIVAL_EDGE;
  return { p: [d[0] * r, d[1] * r, d[2] * r], at: arriveAt };
}

/**
 * Memoria de posición: una nave que vuelve a un sistema donde ya estuvo (o que
 * llega junto a un compañero) aparece en el punto `p` (metros) y orbita desde
 * la hora de llegada. El punto se lleva fuera de la esfera de la estrella y
 * dentro del borde de llegada si hiciese falta.
 */
export function arrivalParkAt(layout: SystemLayout, p: Vec3Like, arriveAt: number): ParkedOrbit {
  let [x, y, z] = p;
  // Los planetas y lunas se han movido desde que se guardó el punto: si ahora cae
  // dentro de uno (o rozándolo), se aparta desde su centro.
  for (const b of bodiesAt(layout, arriveAt).slice(1)) {
    const [cx = 0, cy = 0, cz = 0] = b.center;
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const l = Math.hypot(dx, dy, dz);
    const clear = b.radius * ARRIVAL_BODY_CLEARANCE + ARRIVAL_BODY_MARGIN_M;
    if (l >= clear) continue;
    const k = l > 1 ? clear / l : 0;
    [x, y, z] = l > 1 ? [cx + dx * k, cy + dy * k, cz + dz * k] : [cx, cy + clear, cz];
  }
  const park = sanitizePark(layout, { p: [x, y, z], at: arriveAt });
  const d = Math.hypot(...park.p);
  const max = layout.boundary * ARRIVAL_EDGE;
  if (d <= max) return park;
  const k = max / d;
  return { p: [park.p[0] * k, park.p[1] * k, park.p[2] * k], at: arriveAt };
}

/** Distancia mínima a un planeta o luna al llegar a un punto recordado: radios del cuerpo más un margen. */
const ARRIVAL_BODY_CLEARANCE = 1.5;
const ARRIVAL_BODY_MARGIN_M = 5_000;

/**
 * Punto junto a otra nave (en `p`) para llegar a su lado sin chocar: a `offset`
 * metros de lado, en el sentido de la órbita alrededor de la estrella.
 */
export function besidePoint(p: Vec3Like, offset: number): [number, number, number] {
  const [x, y, z] = p;
  // Tangente a la órbita (eje vertical): (-z, 0, x).
  const l = Math.hypot(x, z);
  const d: Vec3Like = l > 1 ? [-z / l, 0, x / l] : [1, 0, 0];
  return [x + d[0] * offset, y + d[1] * offset, z + d[2] * offset];
}
