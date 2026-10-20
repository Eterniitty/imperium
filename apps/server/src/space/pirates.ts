/**
 * Piratas Carroñeros (IA): dónde viven y cómo se mueven. Funciones puras; el
 * estado y la difusión los lleva SpaceService.
 */
import { PIRATE_RAIDER } from "@imperium/content";
import { hashString } from "@imperium/procgen";
import { parseSystemId, type Quat, type Vec3 } from "@imperium/shared";
import { HUMAN_CORE_RADIUS } from "../emperor/world";
import { planetPosition, type SystemLayout } from "@imperium/sim";
import { normalize } from "./combat";

/** Cuántos piratas viven en un sistema: ninguno en el Núcleo Humano (zona segura); fuera, en cuatro de cada diez. */
export function pirateCount(systemId: string): number {
  const { sector } = parseSystemId(systemId);
  const r = HUMAN_CORE_RADIUS;
  if (Math.abs(sector.x) <= r && Math.abs(sector.y) <= r && Math.abs(sector.z) <= r) return 0;
  const h = hashString(`piratas:${systemId}`);
  return h % 100 < 40 ? 1 + ((h >>> 8) % 3) : 0;
}

/**
 * Punto de partida de un pirata: rondando un planeta del sistema (a unas decenas
 * de km), que es adonde van los jugadores. Sin planetas, cerca de la estrella.
 */
export function pirateHome(systemId: string, index: number, layout: SystemLayout, serverTimeMs: number): Vec3 {
  const h = hashString(`pirata:${systemId}:${index}`);
  const planet = layout.planets.length ? layout.planets[h % layout.planets.length]! : null;
  const center = planet ? planetPosition(planet, serverTimeMs) : { x: 0, y: 0, z: 0 };
  const away = planet ? planet.size * 4 + 20_000 : layout.starRadius * 3;
  const a = (((h >>> 8) % 3600) / 3600) * Math.PI * 2;
  return [center.x + Math.cos(a) * away, center.y + (((h >>> 20) % 40) - 20) * 100, center.z + Math.sin(a) * away];
}

/** Orientación que lleva el morro (0, 0, -1) hacia `dir`. */
export function quatFromForward(dir: Vec3): Quat {
  const d = normalize(dir);
  if (!d) return [0, 0, 0, 1];
  // Rotación mínima de a = (0, 0, -1) a d: eje a × d, w = 1 + a·d.
  const w = 1 - d[2];
  if (w < 1e-6) return [0, 1, 0, 0]; // justo hacia atrás: media vuelta sobre Y
  const q: Quat = [d[1], -d[0], 0, w];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export interface PirateStep {
  p: Vec3;
  v: Vec3;
  q: Quat;
}

/**
 * Un paso de la IA. Con objetivo: se acerca hasta su distancia preferida y
 * luego lo rodea; sin objetivo: vuelve despacio a casa. La velocidad cambia
 * poco a poco (inercia) y el morro mira hacia donde va o hacia el objetivo.
 */
export function stepPirate(p: Vec3, v: Vec3, home: Vec3, target: Vec3 | null, dtSec: number, phase: number): PirateStep {
  const max = PIRATE_RAIDER.speedU;
  let desired: Vec3;
  let face: Vec3 | null = null;
  if (target) {
    const to: Vec3 = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
    const d = Math.hypot(...to);
    const dir = normalize(to) ?? [0, 0, -1];
    face = dir;
    if (d > PIRATE_RAIDER.preferredRangeU) {
      desired = [dir[0] * max, dir[1] * max, dir[2] * max];
    } else {
      // Cerca: lo rodea (perpendicular en el plano horizontal), sentido según el pirata.
      const s = phase > 0.5 ? 1 : -1;
      desired = [-dir[2] * max * 0.7 * s, 0, dir[0] * max * 0.7 * s];
    }
  } else {
    const back: Vec3 = [home[0] - p[0], home[1] - p[1], home[2] - p[2]];
    const d = Math.hypot(...back);
    const dir = normalize(back);
    desired = dir && d > 200 ? [dir[0] * max * 0.4, dir[1] * max * 0.4, dir[2] * max * 0.4] : [0, 0, 0];
  }
  const k = 1 - Math.exp(-dtSec * 1.5);
  const nv: Vec3 = [v[0] + (desired[0] - v[0]) * k, v[1] + (desired[1] - v[1]) * k, v[2] + (desired[2] - v[2]) * k];
  const np: Vec3 = [p[0] + nv[0] * dtSec, p[1] + nv[1] * dtSec, p[2] + nv[2] * dtSec];
  const heading = face ?? (Math.hypot(...nv) > 0.5 ? nv : null);
  return { p: np, v: nv, q: heading ? quatFromForward(heading) : quatFromForward([0, 0, -1]) };
}
