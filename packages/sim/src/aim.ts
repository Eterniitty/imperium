/**
 * Geometría de la puntería del combate en tiempo real, compartida por el
 * cliente (indicador de adelanto, puntería automática) y el servidor
 * (impactos contra blancos en movimiento). Sin estado ni red.
 *
 * Modelo del proyectil (el mismo que aplica el servidor): sale de `from` en
 * línea recta en la dirección `dir` con rapidez `speedU + max(0, v·dir)`
 * (hereda la velocidad del tirador solo a lo largo del disparo).
 */

type V3 = readonly [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rapidez del proyectil disparado en `dir` (unitario) por una nave que va a `shooterV`. */
export function projectileSpeed(speedU: number, shooterV: V3, dir: V3): number {
  return speedU + Math.max(0, dot(shooterV, dir));
}

/**
 * Tiempo (s) en que un proyectil a rapidez `speed` desde el origen alcanza un
 * blanco que está en `rel` (respecto al origen) y se mueve a `relV`, o null si
 * no puede alcanzarlo (el blanco se aleja más rápido de lo que va el proyectil).
 */
export function interceptTime(rel: V3, relV: V3, speed: number): number | null {
  // |rel + relV·t| = speed·t  →  (relV² − s²)t² + 2(rel·relV)t + rel² = 0
  const a = dot(relV, relV) - speed * speed;
  const b = 2 * dot(rel, relV);
  const c = dot(rel, rel);
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const ts = [t1, t2].filter((t) => t > 0).sort((x, y) => x - y);
  return ts[0] ?? null;
}

/**
 * Punto de adelanto: dónde hay que disparar para acertar a un blanco en
 * `targetP` que va a `targetV`, desde `from` en una nave que va a `shooterV`,
 * con un arma de rapidez `speedU`. Devuelve el punto, la dirección unitaria y
 * el tiempo de vuelo; null si no hay solución.
 */
export function leadPoint(
  from: V3,
  shooterV: V3,
  targetP: V3,
  targetV: V3,
  speedU: number,
): { point: [number, number, number]; dir: [number, number, number]; time: number } | null {
  const rel: V3 = [targetP[0] - from[0], targetP[1] - from[1], targetP[2] - from[2]];
  const dist = Math.sqrt(dot(rel, rel));
  if (dist < 1e-6) return null;
  // La rapidez depende de la dirección (herencia de la velocidad del tirador): unas pocas iteraciones bastan.
  let dir: V3 = [rel[0] / dist, rel[1] / dist, rel[2] / dist];
  let time: number | null = null;
  for (let i = 0; i < 3; i++) {
    time = interceptTime(rel, targetV, projectileSpeed(speedU, shooterV, dir));
    if (time === null) return null;
    const aim: V3 = [rel[0] + targetV[0] * time, rel[1] + targetV[1] * time, rel[2] + targetV[2] * time];
    const l = Math.sqrt(dot(aim, aim));
    if (l < 1e-6) return null;
    dir = [aim[0] / l, aim[1] / l, aim[2] / l];
  }
  const t = time!;
  return {
    point: [targetP[0] + targetV[0] * t, targetP[1] + targetV[1] * t, targetP[2] + targetV[2] * t],
    dir: [dir[0], dir[1], dir[2]],
    time: t,
  };
}

/**
 * Impacto de un proyectil contra un blanco en movimiento: el proyectil sale
 * de `from` hacia `dir` (unitario) a `speed` durante como mucho `maxTime`
 * segundos; el blanco está en `targetP` y va a `targetV` con radio `radius`.
 * Devuelve el tiempo (s) del primer contacto, o null si no lo toca.
 */
export function sweepHit(from: V3, dir: V3, speed: number, targetP: V3, targetV: V3, maxTime: number, radius: number): number | null {
  // Posición relativa del blanco respecto al proyectil: w + u·t.
  const w: V3 = [targetP[0] - from[0], targetP[1] - from[1], targetP[2] - from[2]];
  const u: V3 = [targetV[0] - dir[0] * speed, targetV[1] - dir[1] * speed, targetV[2] - dir[2] * speed];
  const uu = dot(u, u);
  const wu = dot(w, u);
  const ww = dot(w, w);
  const r2 = radius * radius;
  if (ww <= r2) return 0;
  if (uu < 1e-9) return null;
  // Primer t ≥ 0 con |w + u·t|² = r²: uu·t² + 2wu·t + (ww − r²) = 0.
  const disc = wu * wu - uu * (ww - r2);
  if (disc < 0) return null;
  const t = (-wu - Math.sqrt(disc)) / uu;
  return t >= 0 && t <= maxTime ? t : null;
}

