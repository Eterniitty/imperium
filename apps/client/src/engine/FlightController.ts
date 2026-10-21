import * as THREE from "three";
import { stepPulseSpeed } from "@imperium/sim";
import type { Keyboard } from "./input";

/**
 * Vuelo tipo nave con inercia. Mueve un objeto: la cámara (vuelo libre por el
 * mapa) o la nave del Emperador (pilotaje dentro de un sistema).
 * - Arrastrar con el ratón orienta la nave (el cursor sigue libre para seleccionar).
 * - Teclas configurables (ver state/settings.ts); por defecto W/S avanzar y
 *   frenar, A/D lateral, Espacio/C subir y bajar, Q/E alabeo, flechas girar y
 *   Mayús impulso.
 * La velocidad no cambia de golpe: se aproxima a la deseada, lo que da
 * sensación de masa.
 */
export class FlightController {
  enabled = false;
  readonly velocity = new THREE.Vector3();

  /** Velocidad de crucero en unidades de la escena por segundo. */
  baseSpeed = 25;
  boostFactor = 6;
  lookSensitivity = 0.0022;
  rollSpeed = 1.4;
  turnSpeed = 1.1;
  /** Mayor = responde antes; menor = más inercia. */
  responsiveness = 2.5;
  /**
   * Motor de pulso (supercrucero): solo hacia delante. Quien use el controlador
   * (la vista de sistema) lo enciende y apaga y fija en cada fotograma su
   * velocidad máxima (`pulseLimit`, según la distancia a los cuerpos); la
   * velocidad sube y baja de forma suave hacia ese límite.
   */
  private pulseOn = false;
  pulseLimit = 0;
  private pulseSpeed = 0;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private tmp = new THREE.Vector3();
  private desired = new THREE.Vector3();

  constructor(
    private camera: THREE.Object3D,
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

  /** Empuje relativo (0–1) para el brillo de los motores. */
  thrust = 0;

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onMove = (e: PointerEvent) => {
    if (!this.enabled || !this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Rotación en los ejes locales de la nave: así no hay "polo" que bloquee el giro.
    this.camera.rotateY(-dx * this.lookSensitivity);
    this.camera.rotateX(-dy * this.lookSensitivity);
  };

  private onUp = () => {
    this.dragging = false;
  };

  /** Detiene la nave en seco (al cambiar de modo o teletransportar). */
  stop(): void {
    this.velocity.set(0, 0, 0);
    this.pulseSpeed = 0;
  }

  /** Devuelve el desplazamiento aplicado este fotograma. */
  update(dt: number): THREE.Vector3 {
    const kb = this.keyboard;
    if (kb.action("rollLeft")) this.camera.rotateZ(this.rollSpeed * dt);
    if (kb.action("rollRight")) this.camera.rotateZ(-this.rollSpeed * dt);
    if (kb.action("turnLeft")) this.camera.rotateY(this.turnSpeed * dt);
    if (kb.action("turnRight")) this.camera.rotateY(-this.turnSpeed * dt);
    if (kb.action("pitchUp")) this.camera.rotateX(this.turnSpeed * dt);
    if (kb.action("pitchDown")) this.camera.rotateX(-this.turnSpeed * dt);

    // Entrada en ejes locales: -Z es "delante" en Three.js.
    const input = this.tmp.set(0, 0, 0);
    if (kb.action("forward")) input.z -= 1;
    if (kb.action("back")) input.z += 1;
    if (kb.action("strafeLeft")) input.x -= 1;
    if (kb.action("strafeRight")) input.x += 1;
    if (kb.action("up")) input.y += 1;
    if (kb.action("down")) input.y -= 1;
    if (input.lengthSq() > 0) input.normalize();

    const boost = kb.action("boost") ? this.boostFactor : 1;
    if (this.pulseOn) {
      // Supercrucero: la nave va siempre hacia el morro; la velocidad, suave hacia el límite.
      this.pulseSpeed = stepPulseSpeed(this.pulseSpeed, this.pulseLimit, dt);
      this.velocity.set(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(this.pulseSpeed);
      this.thrust = 1;
    } else {
      this.desired.copy(input).applyQuaternion(this.camera.quaternion).multiplyScalar(this.baseSpeed * boost);
      // Al salir del pulso a gran velocidad se frena más deprisa que al maniobrar.
      const fast = this.velocity.lengthSq() > (this.baseSpeed * this.boostFactor * 2) ** 2;
      const k = 1 - Math.exp(-dt * (fast ? this.responsiveness * 1.6 : this.responsiveness));
      this.velocity.lerp(this.desired, k);
      if (this.velocity.lengthSq() < 1e-6 && input.lengthSq() === 0) this.velocity.set(0, 0, 0);
      const target = input.lengthSq() > 0 ? (boost > 1 ? 1 : 0.55) : 0.08;
      this.thrust += (target - this.thrust) * Math.min(1, dt * 4);
    }

    const step = this.velocity.clone().multiplyScalar(dt);
    this.camera.position.add(step);
    return step;
  }

  dispose(): void {
    this.dom.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
  }
}
