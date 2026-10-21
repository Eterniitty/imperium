/**
 * Piloto de los Carroñeros (Fase 9d, `docs/ia-naves.md` §2–§6): reglas puras y
 * deterministas que usa `SpaceService` en cada tick. Cazan en manada al mismo
 * blanco (la presa más débil cerca de la manada), esquivan cuando les dan,
 * huyen con el casco bajo, se reagrupan hasta recargar el escudo, no se
 * estrellan contra planetas, lunas ni la estrella (ni entran en su calor) y no
 * disparan con un compañero en la línea de tiro. Datos en `PIRATE_AI`.
 */
import { PIRATE_AI } from "@imperium/content";

type V = readonly [number, number, number];
type Vec = [number, number, number];

/** Qué hace un pirata: cazar, huir o reagruparse (alejado, recargando el escudo). */
export type PirateMode = "hunt" | "flee" | "regroup";

/** Una nave enemiga que ve la manada. */
export interface PirateContact {
  id: string;
  p: V;
  /** Casco y escudo que le quedan (para elegir la presa más débil). */
  hull: number;
  shield: number;
}

/** Cuerpo que esquivar: centro y radio de lo que no se debe tocar (superficie o zona de calor). */
export interface PirateObstacle {
  center: V;
  radius: number;
}

const sub = (a: V, b: V): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const dist = (a: V, b: V) => len(sub(a, b));

/**
 * Presa común de la manada: entre las naves a `packRadiusU` de algún pirata,
 * la que menos aguanta (casco + escudo), con algo de peso por la distancia al
 * centro de la manada. Null si no hay ninguna.
 */
export function packTarget(pack: readonly V[], contacts: readonly PirateContact[]): string | null {
  if (pack.length === 0) return null;
  const c: Vec = [0, 0, 0];
  for (const p of pack) for (let i = 0; i < 3; i++) c[i]! += p[i]! / pack.length;
  let best: { id: string; score: number } | null = null;
  for (const o of contacts) {
    if (!pack.some((p) => dist(p, o.p) <= PIRATE_AI.packRadiusU)) continue;
    const score = (o.hull + o.shield) * (1 + dist(c, o.p) / PIRATE_AI.packRadiusU);
    if (!best || score < best.score || (score === best.score && o.id < best.id)) best = { id: o.id, score };
  }
  return best?.id ?? null;
}

/**
 * Siguiente modo: huye con el casco bajo si le están dando; deja de huir lejos
 * del enemigo (o sin enemigos) y se reagrupa; vuelve a cazar con el escudo recargado.
 */
export function nextPirateMode(mode: PirateMode, hullFrac: number, shieldFrac: number, underFire: boolean, threatDistance: number | null): PirateMode {
  if (mode === "hunt") return hullFrac < PIRATE_AI.fleeHullPct && underFire ? "flee" : "hunt";
  if (mode === "flee") return threatDistance === null || threatDistance > PIRATE_AI.fleeDistanceU ? "regroup" : "flee";
  if (underFire && hullFrac < PIRATE_AI.fleeHullPct) return "flee";
  return shieldFrac >= PIRATE_AI.regroupShieldPct ? "hunt" : "regroup";
}

/**
 * Corrección de velocidad para no chocar: si siguiendo con esta velocidad la
 * nave pasaría (en `avoidLookaheadSec`) a menos del radio de un cuerpo más el
 * margen, se la empuja hacia fuera, más cuanto más se metería.
 */
export function avoidObstacles(p: V, v: V, obstacles: readonly PirateObstacle[], speed: number): Vec {
  const out: Vec = [0, 0, 0];
  const T = PIRATE_AI.avoidLookaheadSec;
  for (const o of obstacles) {
    const keep = o.radius + PIRATE_AI.avoidMarginM;
    const rel = sub(p, o.center);
    // Punto más cercano al cuerpo a lo largo del tramo [p, p + v·T].
    const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const t = vv > 0 ? Math.max(0, Math.min(T, -(rel[0] * v[0] + rel[1] * v[1] + rel[2] * v[2]) / vv)) : 0;
    const near: Vec = [rel[0] + v[0] * t, rel[1] + v[1] * t, rel[2] + v[2] * t];
    const d = len(near);
    if (d >= keep) continue;
    // Hacia fuera desde el cuerpo (si está justo en el centro, hacia arriba).
    const n: Vec = d > 1e-3 ? [near[0] / d, near[1] / d, near[2] / d] : [0, 1, 0];
    const k = (keep - d) / keep;
    for (let i = 0; i < 3; i++) out[i]! += n[i]! * speed * (0.5 + 1.5 * k);
  }
  return out;
}

/** Maniobra lateral para romper la puntería del atacante (perpendicular a `dir`, cambia con el tiempo). */
export function jinkVector(dir: V, phase: number, timeSec: number, speed: number): Vec {
  const a = timeSec * (1.3 + phase) + phase * 6.283;
  // Dos perpendiculares a dir: una horizontal y la vertical que la completa.
  const h: Vec = [-dir[2], 0, dir[0]];
  const hl = len(h) || 1;
  const hx: Vec = [h[0] / hl, 0, h[2] / hl];
  const up: Vec = [dir[1] * hx[2] - dir[2] * hx[1], dir[2] * hx[0] - dir[0] * hx[2], dir[0] * hx[1] - dir[1] * hx[0]];
  const s = speed * PIRATE_AI.jink;
  return [(hx[0] * Math.sin(a) + up[0] * Math.cos(a * 0.7)) * s, (hx[1] * Math.sin(a) + up[1] * Math.cos(a * 0.7)) * s, (hx[2] * Math.sin(a) + up[2] * Math.cos(a * 0.7)) * s];
}

/** ¿Hay un compañero en la línea de tiro (más cerca que el blanco y a menos de su margen del rayo)? */
export function friendInLine(from: V, dir: V, targetDistance: number, friends: readonly V[]): boolean {
  for (const f of friends) {
    const rel = sub(f, from);
    const along = rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2];
    if (along <= 0 || along >= targetDistance) continue;
    const off = Math.sqrt(Math.max(0, rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2] - along * along));
    if (off < PIRATE_AI.friendlyFireClearanceU) return true;
  }
  return false;
}

/**
 * Tenaza: cada pirata de la manada que caza la misma presa entra por su propio
 * lado (repartidos alrededor de ella), así la presa no puede encararlos a todos.
 * Devuelve el desplazamiento respecto a la presa del punto por el que entra el
 * pirata `index` de `count`, a la distancia `range`.
 */
export function flankOffset(index: number, count: number, range: number): Vec {
  if (count < 2) return [0, 0, 0];
  const a = (index / count) * Math.PI * 2;
  return [Math.cos(a) * range, Math.sin(a * 2) * range * 0.3, Math.sin(a) * range];
}
