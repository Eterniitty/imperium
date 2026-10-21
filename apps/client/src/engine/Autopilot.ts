import * as THREE from "three";
import { FLAGSHIP_LENGTH_M, FLIGHT_MODEL, MINING } from "@imperium/content";
import { PULSE_APPROACH_SEC, PULSE_MIN_SPEED } from "@imperium/sim";
import { translate, type AnomalyType, type DeepRegionView, type I18nKey, type Locale } from "@imperium/shared";
import { settingsStore } from "../state/settings";
import type { Maneuver } from "./ShipController";

/**
 * Piloto automático de crucero dentro de un sistema (o de una región de
 * espacio profundo). No mueve la nave: pide a `ShipController` lo mismo que
 * pedirían las teclas (giro, empuje por ejes, impulso y pulso), así que la
 * física, los límites del pulso y las posiciones que llegan al servidor son
 * las del pilotaje manual.
 *
 * - **Ir a**: se orienta hacia el destino, enciende el pulso si está lejos
 *   (con su velocidad recortada para frenar a tiempo), lo apaga cerca y termina
 *   con los propulsores hasta detenerse a una distancia segura del objeto.
 *   Rodea la estrella, los planetas y las lunas que se crucen en el camino.
 * - **Seguir**: se mantiene en formación detrás y a un lado de otra nave,
 *   igualando su velocidad (con pulso si ella lo lleva o si se queda lejos).
 */

export type CruiseKind = "planet" | "moon" | "belt" | "anomaly" | "asteroid" | "ship" | "point";

/** Un sitio al que se puede ir (o una nave a la que seguir) en este momento. */
export interface CruiseSpot {
  /** Identificador estable: `planet:3`, `moon:3:1`, `belt:0`, `anomaly`, `asteroid:12`, `ship:<id>` o `point`. */
  id: string;
  kind: CruiseKind;
  name: string;
  center: THREE.Vector3;
  /** Radio físico (m); 0 en un punto o un cinturón. */
  radius: number;
  /** Distancia al centro a la que detenerse. */
  stopRadius: number;
  /** Naves: compañero (`emperor_allies`) y pirata. */
  ally?: boolean;
  pirate?: boolean;
  /** Naves: orientación dibujada (para la formación). */
  quaternion?: THREE.Quaternion;
  /** Planetas: con colonia propia. */
  own?: boolean;
}

/** Cuerpo que hay que rodear (estrella, planeta o luna). */
export interface CruiseObstacle {
  id: string;
  center: THREE.Vector3;
  radius: number;
  star: boolean;
}

/** Lo que el piloto automático pide a los mandos en este fotograma. */
export interface CruiseCommand extends Maneuver {
  boost: boolean;
  /** ¿Pulso encendido? */
  pulse: boolean;
  /** Velocidad máxima del pulso que se pide (m/s), por debajo de su límite. */
  pulseCap: number;
}

export type CruiseStatus = "ok" | "arrived" | "lost";

/** Datos del mundo que necesita cada paso. */
export interface CruiseContext {
  ship: THREE.Object3D;
  velocity: THREE.Vector3;
  pulseOn: boolean;
  /** Motores encendidos (sin ellos no hay empuje ni pulso). */
  powered: boolean;
  /** Hay combustible para el pulso. */
  canPulse: boolean;
  /** El destino resuelto ahora (null: ya no existe). */
  spot: CruiseSpot | null;
  obstacles: CruiseObstacle[];
}

/** Por encima de esta distancia al destino se usa el pulso; por debajo de la de salida, se apaga. */
const PULSE_ENTER_M = 30_000;
const PULSE_EXIT_M = 12_000;
/** Distancia que se deja al recortar el pulso (se recorre mientras se disipa la velocidad sobrante). */
const PULSE_STOP_MARGIN_M = 6_000;
/** Formación al seguir: a un lado, algo arriba y detrás de la otra nave, en esloras de la insignia. */
const FORMATION = new THREE.Vector3(2.5, 0.5, 5).multiplyScalar(FLAGSHIP_LENGTH_M);
/** Las posiciones ajenas se dibujan con este retraso (ver `RemoteShips`): se adelanta el hueco de la formación. */
const REMOTE_DELAY_S = 0.15;

const UP = new THREE.Vector3(0, 1, 0);

/** Margen por encima de la superficie al que detenerse junto a un cuerpo (m). */
export function bodyClearance(radius: number): number {
  return Math.min(120_000, Math.max(5_000, radius * 0.5));
}

/** Zona que se rodea alrededor de un cuerpo (m desde su centro). */
function safeRadius(o: CruiseObstacle): number {
  return o.radius * (o.star ? 1.6 : 1.3) + 2_000;
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** Modo del piloto automático: ir a un sitio, seguir una nave u orbitar un planeta o luna. */
export type CruiseMode = "goto" | "follow" | "orbit";

/** Órbita: velocidad (fracción de la de impulso) y sentido (antihorario visto desde arriba, como los planetas). */
const ORBIT_SPEED_FACTOR = 0.85;
/** Se empieza a orbitar a menos de esta distancia del radio de la órbita (m, o fracción del radio si es mayor). */
const ORBIT_CAPTURE_M = 8_000;

export class Autopilot {
  /** Destino o nave seguida; null: apagado. */
  target: { id: string; mode: CruiseMode; name: string; point?: THREE.Vector3 } | null = null;
  /** Fase para el HUD. */
  phase: "align" | "cruise" | "approach" | "formation" | "orbit" = "align";
  /** Distancia al punto de llegada (o al hueco de la formación) y velocidad de acercamiento. */
  distance = 0;
  closing = 0;
  /** Velocidad estimada de la nave seguida (de sus posiciones dibujadas). */
  private targetVel = new THREE.Vector3();
  private targetPrev: THREE.Vector3 | null = null;
  private lastSpot: CruiseSpot | null = null;
  readonly command: CruiseCommand = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, boost: false, pulse: false, pulseCap: 0 };

  get active(): boolean {
    return this.target !== null;
  }

  engage(id: string, mode: CruiseMode, name: string, point?: THREE.Vector3): void {
    this.target = { id, mode, name, point: point?.clone() };
    this.phase = "align";
    this.targetVel.set(0, 0, 0);
    this.targetPrev = null;
    this.lastSpot = null;
    this.distance = 0;
    this.closing = 0;
  }

  cancel(): void {
    this.target = null;
  }

  /** Último destino resuelto (para el marcador). */
  get spot(): CruiseSpot | null {
    return this.target ? this.lastSpot : null;
  }

  /** Un paso: calcula `command`. */
  step(dt: number, ctx: CruiseContext): CruiseStatus {
    const tg = this.target;
    const cmd = this.command;
    Object.assign(cmd, { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, boost: false, pulse: false, pulseCap: 0 });
    if (!tg) return "ok";
    const spot = ctx.spot;
    if (!spot) return "lost";
    this.lastSpot = spot;
    const prefs = settingsStore.getState().prefs.flight;
    const M = FLIGHT_MODEL;
    const ship = ctx.ship;
    const pos = ship.position;
    const R0 = spot.stopRadius;
    // Órbita: ya en su radio, se persigue un punto que da vueltas al cuerpo por su ecuador (plano XZ).
    let orbiting = false;
    const orbitGoal = new THREE.Vector3();
    const orbitVel = new THREE.Vector3();
    if (tg.mode === "orbit") {
      const rel = pos.clone().sub(spot.center);
      const flat = new THREE.Vector3(rel.x, 0, rel.z);
      if (flat.lengthSq() < 1) flat.set(1, 0, 0);
      const u = flat.normalize();
      if (Math.abs(rel.length() - R0) < Math.max(ORBIT_CAPTURE_M, R0 * 0.25)) {
        orbiting = true;
        const vOrb = M.maxSpeed * prefs.maxSpeed * M.boostFactor * ORBIT_SPEED_FACTOR;
        const tangent = new THREE.Vector3().crossVectors(UP, u).normalize();
        orbitVel.copy(tangent).multiplyScalar(vOrb);
        // El sitio en la órbita, un poco por delante (así se avanza en vez de pararse).
        const ahead = Math.min(0.5, (vOrb * 2) / R0);
        const dirAhead = u.clone().multiplyScalar(Math.cos(ahead)).addScaledVector(tangent, Math.sin(ahead));
        orbitGoal.copy(spot.center).addScaledVector(dirAhead, R0);
      }
    }
    const follow = tg.mode === "follow" || orbiting;

    // Velocidad de la nave seguida (los cuerpos se mueven a decenas de m/s: se ignora).
    if (tg.mode === "follow" && dt > 0) {
      if (this.targetPrev) {
        const inst = spot.center.clone().sub(this.targetPrev).divideScalar(dt);
        // Un salto grande entre muestras no es velocidad (corrección o nave nueva).
        if (inst.length() < 3_000_000) this.targetVel.lerp(inst, Math.min(1, dt * 3));
      }
      this.targetPrev = spot.center.clone();
    }
    const goalVel = orbiting ? orbitVel : follow ? this.targetVel : new THREE.Vector3();
    const targetSpeed = goalVel.length();

    // Punto de llegada: el hueco de la formación, o a la distancia segura del objeto por el lado de la nave.
    const goal = new THREE.Vector3();
    if (orbiting) {
      goal.copy(orbitGoal);
    } else if (follow) {
      const q = spot.quaternion ?? new THREE.Quaternion();
      goal.copy(FORMATION).applyQuaternion(q).add(spot.center).addScaledVector(goalVel, REMOTE_DELAY_S);
    } else {
      const away = pos.clone().sub(spot.center);
      if (away.lengthSq() < 1) away.set(0, 1, 0);
      goal.copy(spot.center).addScaledVector(away.normalize(), spot.stopRadius);
    }
    const toGoal = goal.clone().sub(pos);
    const dGoal = toGoal.length();
    const uGoal = dGoal > 1e-3 ? toGoal.clone().divideScalar(dGoal) : new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const aim = this.detour(pos, goal, uGoal, dGoal, spot.id, ctx.obstacles);
    const toAim = aim.clone().sub(pos);
    const uAim = toAim.lengthSq() > 1e-6 ? toAim.clone().normalize() : uGoal;
    const relVel = ctx.velocity.clone().sub(goalVel);
    this.distance = dGoal;
    this.closing = relVel.dot(uGoal);

    // Llegada (solo al ir a un sitio; orbitando no se llega nunca): cerca y casi quieto.
    const tol = spot.kind === "point" || spot.kind === "belt" ? 1_500 : Math.max(600, spot.stopRadius * 0.03);
    if (!follow && tg.mode !== "orbit" && dGoal < tol && relVel.length() < 25 && !ctx.pulseOn) return "arrived";

    if (!ctx.powered) {
      // Arrancando los motores: nada que pedir todavía.
      this.phase = "align";
      return "ok";
    }

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const align = fwd.dot(uAim);
    const boostMax = M.maxSpeed * prefs.maxSpeed * M.boostFactor;
    const targetFast = follow && targetSpeed > boostMax * 0.9;
    // Pulso con histéresis: se enciende lejos y bien alineado; se apaga cerca (salvo si la otra nave va en pulso).
    let pulse: boolean;
    if (!ctx.canPulse) pulse = false;
    else if (ctx.pulseOn) pulse = dGoal > PULSE_EXIT_M || targetFast;
    else pulse = (dGoal > PULSE_ENTER_M || (targetFast && dGoal > 2_000)) && align > 0.97;

    // Hacia dónde mirar.
    let face: THREE.Vector3 | null = uAim;
    if (!pulse) {
      if (follow && dGoal < 4_000) {
        // En formación: el rumbo de la otra nave (o su morro, si está quieta).
        face = targetSpeed > 20 ? goalVel.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(spot.quaternion ?? ship.quaternion);
      } else if (!follow && dGoal < 2_500) face = null; // Al final, sin girar (se frena con los propulsores).
    }
    // Orbitando, el morro sigue el rumbo de la órbita.
    if (orbiting && !pulse) face = orbitVel.clone().normalize();
    if (face) this.steer(ship.quaternion, face, prefs.accel, cmd);
    else this.levelRoll(ship.quaternion, prefs.accel, cmd);

    if (pulse) {
      this.phase = follow ? "formation" : "cruise";
      cmd.pulse = true;
      // Velocidad del pulso: la que permite frenar a tiempo (como al acercarse a un cuerpo), más la de la otra nave.
      let cap = Math.max(PULSE_MIN_SPEED, (dGoal - PULSE_STOP_MARGIN_M) / PULSE_APPROACH_SEC);
      if (follow) cap = Math.max(PULSE_MIN_SPEED, targetSpeed + Math.max(0, dGoal - 2_000) / PULSE_APPROACH_SEC);
      // Girando, más despacio (el pulso solo empuja hacia el morro).
      cmd.pulseCap = cap * Math.max(0.05, Math.min(1, (align - 0.5) * 2));
      return "ok";
    }

    // Propulsores con asistencia: velocidad pedida hacia el punto (y la de la nave seguida), frenando a tiempo.
    this.phase = orbiting ? "orbit" : follow ? "formation" : dGoal > PULSE_ENTER_M && ctx.canPulse ? "align" : "approach";
    // Lejos, o aún rápido (al salir del pulso): con impulso, que también frena más.
    const far = dGoal > 3_000 || relVel.length() > M.maxSpeed * prefs.maxSpeed * 1.05;
    const brake = M.reverseAccel * prefs.accel * (far ? M.boostAccelFactor : 1);
    const vMax = M.maxSpeed * prefs.maxSpeed * (far ? M.boostFactor : 1);
    // Mientras se gira para el pulso, despacio (para no alejarse del rumbo).
    const turning = !follow && dGoal > PULSE_ENTER_M && ctx.canPulse && align < 0.97;
    let speed = Math.min(vMax, Math.sqrt(2 * brake * Math.max(0, dGoal - tol * 0.3)) * 0.75, dGoal * 0.6);
    if (turning) speed = Math.min(speed, M.maxSpeed * 0.3);
    const want = goalVel.clone().addScaledVector(dGoal > 1e-3 ? (aim === goal ? uGoal : uAim) : uGoal, speed);
    const boost = far || want.length() > M.maxSpeed * prefs.maxSpeed * 0.95;
    const maxS = M.maxSpeed * prefs.maxSpeed * (boost ? M.boostFactor : 1);
    const local = want.applyQuaternion(ship.quaternion.clone().invert());
    cmd.x = clamp1(local.x / (maxS * M.lateralSpeedFactor));
    cmd.y = clamp1(local.y / (maxS * M.lateralSpeedFactor));
    cmd.z = clamp1(local.z / maxS);
    cmd.boost = boost;
    return "ok";
  }

  /**
   * Punto hacia el que ir: el destino o, si el camino recto cruza un cuerpo
   * (que no sea el destino), un punto a su lado para rodearlo.
   */
  private detour(pos: THREE.Vector3, goal: THREE.Vector3, u: THREE.Vector3, length: number, targetId: string, obstacles: CruiseObstacle[]): THREE.Vector3 {
    let best = Infinity;
    let aim = goal;
    for (const o of obstacles) {
      if (o.id === targetId) continue;
      const safe = safeRadius(o);
      const rel = o.center.clone().sub(pos);
      // Ya dentro de su zona (despegando de él, por ejemplo): no se rodea.
      if (rel.length() < safe) continue;
      // El destino está dentro de su zona (una luna junto a su planeta): no se puede evitar del todo.
      if (goal.distanceTo(o.center) < safe) continue;
      const t = rel.dot(u);
      if (t <= 0 || t >= length) continue;
      const perp = pos.clone().addScaledVector(u, t).sub(o.center);
      if (perp.length() >= safe || t >= best) continue;
      best = t;
      if (perp.lengthSq() < 1) {
        perp.crossVectors(u, UP);
        if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
      }
      aim = o.center.clone().addScaledVector(perp.normalize(), safe * 1.25);
    }
    return aim;
  }

  /** Giro (−1 a 1 por eje) para llevar el morro hacia `dir`, frenando el giro a tiempo; alabeo para nivelar. */
  private steer(q: THREE.Quaternion, dir: THREE.Vector3, accelK: number, out: CruiseCommand): void {
    const M = FLIGHT_MODEL;
    const l = dir.clone().applyQuaternion(q.clone().invert());
    // −Z es el morro: guiñada positiva lo lleva a la izquierda (−X); cabeceo positivo, arriba (+Y).
    const yawErr = Math.atan2(-l.x, -l.z);
    const pitchErr = Math.atan2(l.y, Math.hypot(l.x, l.z));
    out.yaw = rateFor(yawErr, M.yawRate, M.angularAccel * accelK);
    out.pitch = rateFor(pitchErr, M.pitchRate, M.angularAccel * accelK);
    this.levelRoll(q, accelK, out);
  }

  /** Alabeo para que el techo de la nave mire hacia arriba del plano del sistema (salvo con el morro casi vertical). */
  private levelRoll(q: THREE.Quaternion, accelK: number, out: CruiseCommand): void {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    if (Math.abs(fwd.y) > 0.85) return;
    const up = UP.clone().applyQuaternion(q.clone().invert());
    const rollErr = Math.atan2(-up.x, up.y);
    out.roll = rateFor(rollErr, FLIGHT_MODEL.rollRate, FLIGHT_MODEL.angularAccel * accelK) * 0.6;
  }
}

/** Velocidad de giro pedida (fracción de la máxima) para corregir `err` radianes y llegar parado. */
function rateFor(err: number, maxRate: number, accel: number): number {
  const a = Math.abs(err);
  if (a < 0.002) return 0;
  const rate = Math.min(maxRate, Math.sqrt(2 * accel * 0.5 * a), a * 4);
  return (Math.sign(err) * rate) / maxRate;
}

/** Datos para el catálogo de destinos (los pone la vista de sistema). */
export interface CruiseSources {
  locale: Locale;
  shipPos: THREE.Vector3;
  bodies: Array<{ id: string; kind: "star" | "planet" | "moon"; name: string; center: THREE.Vector3; radius: number; own?: boolean }>;
  belts: Array<{ orbitRadius: number }>;
  anomaly: { type: AnomalyType; at: THREE.Vector3 } | null;
  field: DeepRegionView | null;
  ships: Array<{ id: string; name: string; ally: boolean; pirate: boolean; at: THREE.Vector3; q: THREE.Quaternion }>;
  point: THREE.Vector3 | null;
}

/** Cuántos asteroides cercanos se ofrecen como destino. */
const MAX_ASTEROIDS = 12;

/** Destinos posibles ahora mismo (sin la estrella: no es un sitio al que ir). */
export function cruiseCatalog(src: CruiseSources): CruiseSpot[] {
  const out: CruiseSpot[] = [];
  const t = (key: I18nKey, params?: Record<string, string | number>) => translate(src.locale, key, params);
  for (const b of src.bodies) {
    if (b.kind === "star") continue;
    out.push({ id: b.id, kind: b.kind, name: b.name, center: b.center, radius: b.radius, stopRadius: b.radius + bodyClearance(b.radius), own: b.own });
  }
  src.belts.forEach((belt, i) => {
    // El punto del cinturón más cercano a la nave (en el plano del sistema).
    const flat = new THREE.Vector3(src.shipPos.x, 0, src.shipPos.z);
    if (flat.lengthSq() < 1) flat.set(1, 0, 0);
    out.push({ id: `belt:${i}`, kind: "belt", name: t("cruise.belt", { n: i + 1 }), center: flat.normalize().multiplyScalar(belt.orbitRadius), radius: 0, stopRadius: 0 });
  });
  if (src.anomaly) {
    out.push({ id: "anomaly", kind: "anomaly", name: t(`anomaly.${src.anomaly.type}`), center: src.anomaly.at, radius: 0, stopRadius: 60_000 });
  }
  if (src.field) {
    const near = src.field.asteroids
      .filter((a) => (src.field!.left[a.i] ?? a.amount) > 0)
      .map((a) => ({ a, d: src.shipPos.distanceToSquared(new THREE.Vector3(...a.p)) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, MAX_ASTEROIDS);
    for (const { a } of near) {
      // A tiro del láser de minería, desde el casco.
      out.push({ id: `asteroid:${a.i}`, kind: "asteroid", name: t(`asteroid.${a.kind}`), center: new THREE.Vector3(...a.p), radius: a.r, stopRadius: a.r + FLAGSHIP_LENGTH_M * 0.6 + MINING.rangeM * 0.5 });
    }
  }
  for (const s of src.ships) {
    out.push({ id: `ship:${s.id}`, kind: "ship", name: s.name, center: s.at, radius: 0, stopRadius: 0, ally: s.ally, pirate: s.pirate, quaternion: s.q });
  }
  if (src.point) out.push({ id: "point", kind: "point", name: t("cruise.point"), center: src.point, radius: 0, stopRadius: 0 });
  return out;
}
