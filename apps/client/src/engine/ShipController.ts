import * as THREE from "three";
import { stepPulseSpeed } from "@imperium/sim";
import { FLIGHT_MODEL } from "@imperium/content";
import { settingsStore } from "../state/settings";
import type { Keyboard } from "./input";

/**
 * Mandos de la nave del Emperador, separados de la cámara (que maneja
 * `ChaseCamera`): la orientación solo cambia con los mandos de vuelo (teclas de
 * cabeceo, guiñada y alabeo; o el ratón en el modo «pilotaje con ratón»), nunca
 * porque se mueva la cámara.
 *
 * - Rotación: cada eje tiene una velocidad angular que sube y baja con
 *   aceleración limitada (propulsores de maniobra), así no hay giros bruscos;
 *   al soltar, los propulsores la frenan.
 * - Traslación con inercia: propulsores principales (avance), de frenado
 *   (retroceso) y laterales/verticales, cada uno con su aceleración.
 *   Con la **asistencia de vuelo** encendida, los propulsores llevan la
 *   velocidad hacia la que piden los mandos (sin teclas, frena hasta pararse);
 *   apagada, la nave conserva su velocidad (inercia pura) y solo cambia con el
 *   empuje.
 * - Motor de pulso (supercrucero): solo hacia el morro, con el límite que fija
 *   la vista de sistema según los cuerpos cercanos.
 *
 * Las cifras están en `FLIGHT_MODEL` (`@imperium/content`); los ajustes del
 * jugador (aceleración, inercia, velocidad máxima) las escalan.
 */
export interface Maneuver {
  /** Empuje lineal pedido en ejes de la nave (−1 a 1): x derecha, y arriba, z atrás. */
  x: number;
  y: number;
  z: number;
  /** Giro pedido (−1 a 1). */
  pitch: number;
  yaw: number;
  roll: number;
}

export class ShipController {
  enabled = true;
  readonly velocity = new THREE.Vector3();
  /** Velocidad angular en ejes de la nave (rad/s): x cabeceo, y guiñada, z alabeo. */
  readonly angular = new THREE.Vector3();
  /** Aceleración externa (m/s², mundo) que se suma en cada subpaso: la gravedad. */
  readonly external = new THREE.Vector3();
  /** Proporción de empuje (0–1) para el brillo de los motores. */
  thrust = 0;
  /** Lo que piden los mandos ahora (para los propulsores de maniobra del modelo). */
  readonly maneuver: Maneuver = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  pulseLimit = 0;
  private pulseOn = false;
  private pulseSpeed = 0;
  private mouse: { x: number; y: number; ox: number; oy: number } | null = null;
  private input = new THREE.Vector3();
  private turn = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(
    private ship: THREE.Object3D,
    private dom: HTMLElement,
    private keyboard: Keyboard,
  ) {
    dom.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  get speed(): number {
    return this.velocity.length();
  }

  get pulse(): boolean {
    return this.pulseOn;
  }

  /** Enciende o apaga el pulso; arranca desde la velocidad que se lleve. */
  set pulse(on: boolean) {
    if (on && !this.pulseOn) this.pulseSpeed = this.velocity.length();
    this.pulseOn = on;
  }

  /** ¿Se está pilotando con el ratón ahora mismo (botón izquierdo en el modo de pilotaje con ratón)? */
  get mouseSteering(): boolean {
    return this.mouse !== null;
  }

  // Pilotaje con ratón: con el botón izquierdo pulsado, la distancia al punto donde
  // se pulsó marca la velocidad de giro (como una palanca), no un giro instantáneo.
  private onDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0 || !settingsStore.getState().prefs.flight.mouseFlight) return;
    this.mouse = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY };
  };

  private onMove = (e: PointerEvent) => {
    if (!this.mouse) return;
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  };

  private onUp = () => {
    this.mouse = null;
  };

  /** Detiene la nave en seco (al cambiar de modo o teletransportar). */
  stop(): void {
    this.velocity.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.pulseSpeed = 0;
  }

  /** Mueve la nave `dt` segundos (con subpasos fijos); devuelve el desplazamiento. */
  update(dt: number): THREE.Vector3 {
    const kb = this.keyboard;
    const prefs = settingsStore.getState().prefs.flight;
    const M = FLIGHT_MODEL;

    // Mandos de giro (−1 a 1 por eje).
    const turn = this.turn.set(0, 0, 0);
    if (this.enabled) {
      if (kb.action("pitchUp")) turn.x += 1;
      if (kb.action("pitchDown")) turn.x -= 1;
      if (kb.action("turnLeft")) turn.y += 1;
      if (kb.action("turnRight")) turn.y -= 1;
      if (kb.action("rollLeft")) turn.z += 1;
      if (kb.action("rollRight")) turn.z -= 1;
      if (this.mouse) {
        const r = M.mouseStickPx;
        turn.y -= Math.max(-1, Math.min(1, (this.mouse.x - this.mouse.ox) / r));
        turn.x -= Math.max(-1, Math.min(1, (this.mouse.y - this.mouse.oy) / r));
        turn.clampScalar(-1, 1);
      }
    }
    // Mandos de traslación, en ejes de la nave (−Z es delante).
    const input = this.input.set(0, 0, 0);
    if (this.enabled) {
      if (kb.action("forward")) input.z -= 1;
      if (kb.action("back")) input.z += 1;
      if (kb.action("strafeLeft")) input.x -= 1;
      if (kb.action("strafeRight")) input.x += 1;
      if (kb.action("up")) input.y += 1;
      if (kb.action("down")) input.y -= 1;
    }
    const boost = this.enabled && kb.action("boost");
    Object.assign(this.maneuver, { x: input.x, y: input.y, z: input.z, pitch: turn.x, yaw: turn.y, roll: turn.z });

    const accelK = prefs.accel;
    const maxSpeed = M.maxSpeed * prefs.maxSpeed * (boost ? M.boostFactor : 1);
    const steps = Math.max(1, Math.min(16, Math.ceil(dt / M.substep)));
    const h = dt / steps;
    const start = this.ship.position.clone();
    for (let i = 0; i < steps; i++) {
      // Rotación: velocidad angular hacia la pedida, con aceleración angular limitada.
      const rates = [M.pitchRate, M.yawRate, M.rollRate];
      for (let a = 0; a < 3; a++) {
        const want = turn.getComponent(a) * rates[a]!;
        const cur = this.angular.getComponent(a);
        const maxStep = M.angularAccel * accelK * h;
        this.angular.setComponent(a, cur + Math.max(-maxStep, Math.min(maxStep, want - cur)));
      }
      const w = this.angular.length();
      if (w > 1e-6) {
        this.q.setFromAxisAngle(this.tmp.copy(this.angular).divideScalar(w), w * h);
        this.ship.quaternion.multiply(this.q);
      }
      this.ship.quaternion.normalize();

      if (this.pulseOn) {
        // Supercrucero: siempre hacia el morro; la velocidad, suave hacia el límite. Sin gravedad (el pulso la compensa).
        this.pulseSpeed = stepPulseSpeed(this.pulseSpeed, this.pulseLimit, h);
        this.velocity.set(0, 0, -1).applyQuaternion(this.ship.quaternion).multiplyScalar(this.pulseSpeed);
      } else {
        this.stepThrust(input, prefs.assist, maxSpeed, accelK * (boost ? M.boostAccelFactor : 1), prefs.inertia, h);
        this.velocity.addScaledVector(this.external, h);
      }
      // Semi-implícito: primero la velocidad, luego la posición con la velocidad nueva.
      this.ship.position.addScaledVector(this.velocity, h);
    }
    const target = this.pulseOn ? 1 : input.lengthSq() > 0 ? (boost ? 1 : 0.55) : 0.08;
    this.thrust += (target - this.thrust) * Math.min(1, dt * 4);
    return this.ship.position.clone().sub(start);
  }

  /**
   * Empuje de los propulsores en un subpaso. Con asistencia: hacia la velocidad
   * pedida (proporcional al error, `inertia` lo hace más lento), sin pasar de la
   * aceleración de cada propulsor. Sin asistencia: el empuje de las teclas, y la
   * velocidad se conserva; los propulsores no empujan más allá de la máxima.
   */
  private stepThrust(input: THREE.Vector3, assist: boolean, maxSpeed: number, accelK: number, inertia: number, h: number): void {
    const M = FLIGHT_MODEL;
    const inv = this.q.copy(this.ship.quaternion).invert();
    // Velocidad en ejes de la nave.
    const local = this.tmp.copy(this.velocity).applyQuaternion(inv);
    const acc = new THREE.Vector3();
    const limits = (axis: number, sign: number) =>
      (axis === 2 ? (sign < 0 ? M.mainAccel : M.reverseAccel) : M.lateralAccel) * accelK;
    for (let a = 0; a < 3; a++) {
      const u = input.getComponent(a);
      if (assist) {
        // Velocidad pedida en ese eje y aceleración para alcanzarla.
        const want = u * maxSpeed * (a === 2 ? 1 : M.lateralSpeedFactor);
        const err = want - local.getComponent(a);
        const a0 = (err * M.assistGain) / inertia;
        const lim = limits(a, Math.sign(err));
        acc.setComponent(a, Math.max(-lim, Math.min(lim, a0)));
      } else if (u !== 0) {
        const v = local.getComponent(a);
        // Sin asistencia, el empuje no lleva más allá de la velocidad máxima en ese eje.
        const cap = maxSpeed * (a === 2 ? 1 : M.lateralSpeedFactor);
        if (Math.sign(u) * v < cap) acc.setComponent(a, u * limits(a, u));
      }
    }
    acc.applyQuaternion(this.ship.quaternion);
    this.velocity.addScaledVector(acc, h);
    // Al apagar el pulso, la velocidad que pasa de la máxima con impulso se pierde en un par de segundos.
    const cap = M.maxSpeed * M.boostFactor * 1.2;
    const speed = this.velocity.length();
    if (speed > cap) this.velocity.multiplyScalar((cap + (speed - cap) * Math.exp(-M.pulseDumpRate * h)) / speed);
    if (assist && input.lengthSq() === 0 && this.velocity.lengthSq() < 0.01 && this.external.lengthSq() === 0) this.velocity.set(0, 0, 0);
  }

  dispose(): void {
    this.dom.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
  }
}
