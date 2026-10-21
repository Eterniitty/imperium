import * as THREE from "three";
import { AIM_ASSIST, EMPEROR_FLAGSHIP } from "@imperium/content";
import type { ShipState } from "@imperium/shared";
import { leadPoint } from "@imperium/sim";
import { shipName, spaceStore } from "../net/space";
import { gameStore } from "../state/store";
import { formatDistance } from "../ui/FlightHud";
import { RemoteShips } from "./RemoteShips";

/**
 * Asistencia de puntería (petición del usuario, 21-10-2026: «para atacar
 * necesitaremos un aim casi automático»). Separada del objetivo de navegación:
 * el blanco de armas es `spaceStore.targetId`.
 *
 * - Marcadores de todas las naves del sistema, aunque midan pocos píxeles,
 *   con forma y color según la relación (hostil: rombo rojo; otro Emperador,
 *   neutral: cuadrado ámbar; compañero: círculo cian), distancia, y nombre y
 *   vida del blanco fijado; flecha en el borde si el blanco está fuera de pantalla.
 * - Fijar: el más cercano a la retícula, siguiente / anterior por distancia,
 *   el más cercano, o el marcador bajo el cursor (clic central). Al ciclar no
 *   se fijan compañeros (hay fuego amigo); solo a propósito con el ratón.
 * - Indicador de adelanto del cañón y dirección de puntería automática
 *   (dentro del cono de los montajes, `AIM_ASSIST.cannonGimbalDeg`).
 */

export type Relation = "hostile" | "neutral" | "ally";

export function relationOf(s: Pick<ShipState, "kind" | "ally">): Relation {
  if (s.ally) return "ally";
  return s.kind === "pirate" ? "hostile" : "neutral";
}

/** Puntería del cañón hacia el blanco fijado en este fotograma. */
export interface CannonAim {
  /** Dirección del disparo (unitaria): al punto de adelanto si cabe en el cono; si no, el morro. */
  dir: THREE.Vector3;
  /** El punto de adelanto está dentro del cono de los montajes. */
  inArc: boolean;
  /** El blanco está al alcance del cañón. */
  inRange: boolean;
  relation: Relation;
}

const CANNON = EMPEROR_FLAGSHIP.combat.weapons.find((w) => w.kind === "cannon")!;
/** Un poco menos que el cono del servidor: la orientación que él tiene de la nave llega con algo de retraso. */
const GIMBAL_COS = Math.cos(((AIM_ASSIST.cannonGimbalDeg - 2) * Math.PI) / 180);
/** Fijar en la retícula: solo naves a menos de este ángulo (grados) de la línea de mira. */
const RETICLE_CONE_DEG = 35;
/** Clic central: distancia máxima (px) entre el cursor y el marcador. */
const PICK_RADIUS_PX = 40;
/** Distancia a la que se dejan de dibujar los marcadores de naves no fijadas (m). */
const MARKER_RANGE_M = 300_000;

interface Marker {
  el: HTMLDivElement;
  label: HTMLSpanElement;
  bars: HTMLDivElement;
  key: string;
}

const tmp = new THREE.Vector3();
const tmpV = new THREE.Vector3();

export class TargetAssist {
  private root: HTMLDivElement;
  private markers = new Map<string, Marker>();
  private arrow: HTMLDivElement;
  private lead: HTMLDivElement;
  /** Posición en pantalla (px, respecto a la vista) de cada marcador visible en el último fotograma. */
  private screen = new Map<string, { x: number; y: number }>();

  constructor(private dom: HTMLElement) {
    const root = document.createElement("div");
    root.className = "tgt-layer";
    root.setAttribute("aria-hidden", "true");
    this.root = root;
    this.arrow = document.createElement("div");
    this.arrow.className = "tgt-arrow";
    this.lead = document.createElement("div");
    this.lead.className = "tgt-lead";
    root.append(this.arrow, this.lead);
    (dom.parentElement ?? document.body).appendChild(root);
    this.hideAll();
  }

  /** Posición del blanco fijado ahora (adelantada lo que se dibuja con retraso), o null. */
  private targetNow(remote: RemoteShips, id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const p = remote.positionOf(id);
    if (!p) return null;
    const v = remote.velocityOf(id, tmpV);
    out.copy(p);
    if (v) out.addScaledVector(v, RemoteShips.DRAW_DELAY_SEC);
    return out;
  }

  /**
   * Puntería del cañón al blanco fijado: punto de adelanto según la velocidad
   * relativa y la del proyectil (la misma cuenta que hace el servidor).
   */
  aim(remote: RemoteShips, from: THREE.Vector3, vel: THREE.Vector3, fwd: THREE.Vector3): (CannonAim & { point: THREE.Vector3 | null }) | null {
    const { targetId, ships } = spaceStore.getState();
    const s = targetId ? ships[targetId] : undefined;
    if (!targetId || !s) return null;
    const at = this.targetNow(remote, targetId, new THREE.Vector3());
    if (!at) return null;
    const v = remote.velocityOf(targetId) ?? new THREE.Vector3();
    const sol = leadPoint([from.x, from.y, from.z], [vel.x, vel.y, vel.z], [at.x, at.y, at.z], [v.x, v.y, v.z], CANNON.speedU);
    const relation = relationOf(s.state);
    if (!sol) return { dir: fwd.clone(), inArc: false, inRange: false, relation, point: null };
    const dir = new THREE.Vector3(...sol.dir);
    const inArc = dir.dot(fwd) >= GIMBAL_COS;
    const inRange = from.distanceTo(at) <= CANNON.rangeU;
    return { dir: inArc ? dir : fwd.clone(), inArc, inRange, relation, point: new THREE.Vector3(...sol.point) };
  }

  /** Candidatas para ciclar: sin compañeros, hostiles primero y luego por distancia. */
  private candidates(remote: RemoteShips, me: THREE.Vector3): string[] {
    const order = { hostile: 0, neutral: 1, ally: 2 } as const;
    return Object.values(spaceStore.getState().ships)
      .filter((s) => relationOf(s.state) !== "ally" && remote.positionOf(s.state.id))
      .map((s) => ({ id: s.state.id, r: order[relationOf(s.state)], d: remote.positionOf(s.state.id)!.distanceTo(me) }))
      .sort((a, b) => a.r - b.r || a.d - b.d)
      .map((c) => c.id);
  }

  /** Siguiente (+1) o anterior (−1) blanco: hostiles del más cercano al más lejano, luego otros Emperadores. */
  cycle(remote: RemoteShips, me: THREE.Vector3, step: 1 | -1): string | null {
    const list = this.candidates(remote, me);
    if (list.length === 0) return this.set(null);
    const i = list.indexOf(spaceStore.getState().targetId ?? "");
    const next = i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length;
    return this.set(list[next]!);
  }

  /** El hostil más cercano (si no hay, el Emperador no compañero más cercano). */
  nearest(remote: RemoteShips, me: THREE.Vector3): string | null {
    return this.set(this.candidates(remote, me)[0] ?? null);
  }

  /** El que está más cerca de la línea de mira (desde la cámara hacia `aimPoint`), sin compañeros. */
  atReticle(remote: RemoteShips, eye: THREE.Vector3, aimDir: THREE.Vector3): string | null {
    let best: string | null = null;
    let bestCos = Math.cos((RETICLE_CONE_DEG * Math.PI) / 180);
    for (const s of Object.values(spaceStore.getState().ships)) {
      if (relationOf(s.state) === "ally") continue;
      const p = remote.positionOf(s.state.id);
      if (!p) continue;
      const c = tmp.copy(p).sub(eye).normalize().dot(aimDir);
      if (c > bestCos) {
        bestCos = c;
        best = s.state.id;
      }
    }
    return best ? this.set(best) : null;
  }

  /** El marcador más cercano al punto de la pantalla (px de la vista), cualquiera, compañeros incluidos. */
  pickAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = PICK_RADIUS_PX;
    for (const [id, p] of this.screen) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best ? this.set(best) : null;
  }

  private set(id: string | null): string | null {
    spaceStore.setState({ targetId: id });
    return id;
  }

  /** Dibuja marcadores, flecha y adelanto. `lead`: punto de adelanto del blanco fijado y si está a tiro y en arco. */
  update(camera: THREE.Camera, remote: RemoteShips, me: THREE.Vector3, lead: { point: THREE.Vector3 | null; ready: boolean } | null): void {
    const rect = this.dom.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const { ships, targetId } = spaceStore.getState();
    const locale = gameStore.getState().locale;
    this.screen.clear();
    const seen = new Set<string>();
    let arrowShown = false;
    for (const [id, remoteShip] of Object.entries(ships)) {
      const p = remote.positionOf(id);
      if (!p) continue;
      const s = remoteShip.state;
      const dist = p.distanceTo(me);
      const locked = id === targetId;
      if (!locked && dist > MARKER_RANGE_M) continue;
      const rel = relationOf(s);
      tmp.copy(p).project(camera);
      const behind = tmp.z > 1;
      const onScreen = !behind && Math.abs(tmp.x) <= 1 && Math.abs(tmp.y) <= 1;
      if (!onScreen) {
        if (locked) {
          this.placeArrow(tmp.x, tmp.y, behind, w, h, rel);
          arrowShown = true;
        }
        continue;
      }
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;
      seen.add(id);
      this.screen.set(id, { x, y });
      const m = this.marker(id);
      const key = `${rel}|${locked}`;
      if (m.key !== key) {
        m.key = key;
        m.el.className = `tgt-marker ${rel}${locked ? " locked" : ""}`;
      }
      m.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const text = locked ? `${shipName(s, locale)} · ${formatDistance(dist)}` : formatDistance(dist);
      if (m.label.textContent !== text) m.label.textContent = text;
      if (locked) {
        const hull = s.hullMax > 0 ? Math.max(0, Math.min(1, s.hull / s.hullMax)) : 0;
        const shield = s.shieldMax > 0 ? Math.max(0, Math.min(1, s.shield / s.shieldMax)) : 0;
        m.bars.style.setProperty("--hull", `${(hull * 100).toFixed(0)}%`);
        m.bars.style.setProperty("--shield", `${(shield * 100).toFixed(0)}%`);
      }
      m.el.style.display = "";
    }
    for (const [id, m] of this.markers) {
      if (!ships[id]) {
        m.el.remove();
        this.markers.delete(id);
      } else if (!seen.has(id)) m.el.style.display = "none";
    }
    if (!arrowShown) this.arrow.style.display = "none";
    // Punto de adelanto.
    if (lead?.point) {
      tmp.copy(lead.point).project(camera);
      if (tmp.z <= 1 && Math.abs(tmp.x) <= 1 && Math.abs(tmp.y) <= 1) {
        const x = (tmp.x * 0.5 + 0.5) * w;
        const y = (-tmp.y * 0.5 + 0.5) * h;
        this.lead.style.display = "";
        this.lead.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        this.lead.className = lead.ready ? "tgt-lead ready" : "tgt-lead";
      } else this.lead.style.display = "none";
    } else this.lead.style.display = "none";
  }

  /** Flecha en el borde de la pantalla hacia el blanco fijado. */
  private placeArrow(nx: number, ny: number, behind: boolean, w: number, h: number, rel: Relation): void {
    // Detrás de la cámara, la proyección sale invertida.
    let dx = behind ? -nx : nx;
    let dy = behind ? -ny : ny;
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) dy = -1;
    const k = 0.9 / Math.max(Math.abs(dx), Math.abs(dy));
    dx *= k;
    dy *= k;
    const x = (dx * 0.5 + 0.5) * w;
    const y = (-dy * 0.5 + 0.5) * h;
    const angle = Math.atan2(-dy, dx);
    this.arrow.style.display = "";
    this.arrow.className = `tgt-arrow ${rel}`;
    this.arrow.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
  }

  private marker(id: string): Marker {
    let m = this.markers.get(id);
    if (m) return m;
    const el = document.createElement("div");
    const shape = document.createElement("i");
    shape.className = "tgt-shape";
    const label = document.createElement("span");
    label.className = "tgt-label";
    const bars = document.createElement("div");
    bars.className = "tgt-bars";
    bars.innerHTML = '<b class="tgt-shield"></b><b class="tgt-hull"></b>';
    el.append(shape, label, bars);
    this.root.appendChild(el);
    m = { el, label, bars, key: "" };
    this.markers.set(id, m);
    return m;
  }

  hideAll(): void {
    for (const m of this.markers.values()) m.el.remove();
    this.markers.clear();
    this.screen.clear();
    this.arrow.style.display = "none";
    this.lead.style.display = "none";
  }

  dispose(): void {
    this.hideAll();
    this.root.remove();
  }
}
