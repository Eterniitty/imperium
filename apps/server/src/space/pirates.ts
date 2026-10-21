/**
 * Piratas Carroñeros (IA): dónde viven y cómo se mueven. Funciones puras; el
 * estado y la difusión los lleva SpaceService.
 */
import { getAlienShipClass, scavengerDanger, type AlienFlight } from "@imperium/content";
import { hashString } from "@imperium/procgen";
import { parseSystemId, type Quat, type Vec3 } from "@imperium/shared";
import { HUMAN_CORE_RADIUS } from "../emperor/world";
import { planetPosition, type SystemLayout } from "@imperium/sim";
import { normalize } from "./combat";

/** Anillo de un sistema: distancia al Núcleo Humano en sectores (el mayor de |x|, |y|, |z|). */
export function systemRing(systemId: string): number {
  const { sector } = parseSystemId(systemId);
  return Math.max(Math.abs(sector.x), Math.abs(sector.y), Math.abs(sector.z));
}

/** Un pirata que vive en un sistema: su nave y su puntería. */
export interface PirateSpec {
  classId: string;
  /** Error de puntería (radianes, de lado a lado). */
  aimJitter: number;
}

/**
 * Piratas que viven en un sistema, según su nivel de peligro (`SCAVENGER_DANGER`):
 * ninguno en el Núcleo Humano (zona segura); fuera, en una parte de los
 * sistemas, más y más pesados cuanto más lejos. Determinista por sistema.
 */
export function piratesOf(systemId: string): PirateSpec[] {
  const ring = systemRing(systemId);
  if (ring <= HUMAN_CORE_RADIUS) return [];
  const level = scavengerDanger(ring);
  if (!level) return [];
  const h = hashString(`piratas:${systemId}`);
  if (h % 100 >= level.chancePct) return [];
  const [min, max] = level.count;
  const count = min + ((h >>> 8) % (max - min + 1));
  const total = level.ships.reduce((a, [, w]) => a + w, 0);
  const out: PirateSpec[] = [];
  for (let i = 0; i < count; i++) {
    const r = hashString(`pirata-clase:${systemId}:${i}`);
    let classId = level.ships[0]![0];
    if (i === 0 && level.leader && r % 100 < level.leader[1]) {
      classId = level.leader[0];
    } else {
      let roll = (r >>> 7) % (total * 1000);
      for (const [id, w] of level.ships) {
        roll -= w * 1000;
        if (roll < 0) {
          classId = id;
          break;
        }
      }
    }
    out.push({ classId, aimJitter: level.aimJitter });
  }
  return out;
}

/** Cuántos piratas viven en un sistema. */
export function pirateCount(systemId: string): number {
  return piratesOf(systemId).length;
}

/** Vuelo de una nave pirata (el de su clase; si no lo trae, el del asaltante). */
export function pirateFlight(classId: string): AlienFlight {
  return getAlienShipClass(classId)?.flight ?? getAlienShipClass("scav_raider")!.flight!;
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
export function stepPirate(p: Vec3, v: Vec3, home: Vec3, target: Vec3 | null, dtSec: number, phase: number, flight: AlienFlight): PirateStep {
  const max = flight.speedU;
  let desired: Vec3;
  let face: Vec3 | null = null;
  if (target) {
    const to: Vec3 = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
    const d = Math.hypot(...to);
    const dir = normalize(to) ?? [0, 0, -1];
    face = dir;
    if (d > flight.preferredRangeU) {
      desired = [dir[0] * max, dir[1] * max, dir[2] * max];
    } else {
      // Cerca: lo rodea (perpendicular en el plano horizontal), sentido según el pirata;
      // si se le echa encima (menos de la mitad de su distancia), además se aleja (los bombarderos mantienen las distancias).
      const s = phase > 0.5 ? 1 : -1;
      const back = d < flight.preferredRangeU * 0.5 ? 0.6 : 0;
      desired = [(-dir[2] * 0.7 * s - dir[0] * back) * max, -dir[1] * back * max, (dir[0] * 0.7 * s - dir[2] * back) * max];
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
