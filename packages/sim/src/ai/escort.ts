/**
 * Escolta de la nave del Emperador (Fase 9d): dónde va cada nave en la
 * formación y cómo llega a su sitio. Reglas puras; las usa `SpaceService`.
 */
import { ESCORT } from "@imperium/content";

type V = readonly [number, number, number];
type Vec = [number, number, number];

/** Gira `v` con el cuaternión `q` (x, y, z, w). */
function rotate(q: readonly number[], v: V): Vec {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/**
 * Sitio `i` de la formación (una cuña detrás de la nave del Emperador, que mira
 * hacia -Z): alternando a izquierda y derecha, cada fila más atrás y más abierta.
 */
export function escortSlot(leader: V, leaderQ: readonly number[], i: number): Vec {
  const row = Math.floor(i / 2) + 1;
  const side = i % 2 === 0 ? -1 : 1;
  const s = ESCORT.spacingM;
  const off = rotate(leaderQ, [side * row * s, (i % 3) * s * 0.15, row * s * 0.9]);
  return [leader[0] + off[0], leader[1] + off[1], leader[2] + off[2]];
}

/**
 * Velocidad deseada para llegar a `goal` (que se mueve con `goalV`): se acerca
 * deprisa de lejos, frena al llegar y acompasa su velocidad a la del sitio.
 */
export function arriveVelocity(p: V, goal: V, goalV: V, maxSpeed: number): Vec {
  const to: Vec = [goal[0] - p[0], goal[1] - p[1], goal[2] - p[2]];
  const d = Math.hypot(to[0], to[1], to[2]);
  const speed = Math.min(maxSpeed, d * 0.8);
  const k = d > 1e-3 ? speed / d : 0;
  return [goalV[0] + to[0] * k, goalV[1] + to[1] * k, goalV[2] + to[2] * k];
}
