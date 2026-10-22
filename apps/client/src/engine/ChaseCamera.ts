import * as THREE from "three";
import { FLAGSHIP_LENGTH_M } from "@imperium/content";
import { settingsStore } from "../state/settings";

/** Distancia de la vista de seguimiento (m), en esloras de la nave insignia. */
const DEFAULT_DIST = FLAGSHIP_LENGTH_M * 1.9;

/**
 * Cámara del piloto, separada de la nave: mover la cámara nunca gira la nave.
 *
 * - Exterior: órbita libre alrededor de la nave (arriba, abajo, lados, detrás)
 *   arrastrando con el ratón (botón derecho siempre; izquierdo en el modo de
 *   cámara libre) y rueda para acercar o alejar. En el modo de vuelo con ratón
 *   la cámara sigue detrás y, al soltar el botón derecho, vuelve detrás. Los ángulos son relativos
 *   a la nave: si la nave gira, la cámara la acompaña desde el mismo ángulo,
 *   con un seguimiento suave (sin saltos). La tecla de «vista de seguimiento»
 *   la devuelve detrás de la nave.
 * - Cabina (primera persona): el ratón mira alrededor (girando la cabeza), con
 *   límites; la misma tecla vuelve a mirar al frente.
 */
export class ChaseCamera {
  /** Ángulos de la órbita respecto a la nave (rad): 0, 0 = detrás. Objetivo y valor suavizado. */
  private yaw = 0;
  private pitch = 0;
  private wantYaw = 0;
  private wantPitch = 0;
  /** Distancia a la nave (m). */
  private dist = DEFAULT_DIST;
  private wantDist = DEFAULT_DIST;
  /** Orientación de referencia (la de la nave, suavizada). */
  private frame = new THREE.Quaternion();
  private drag: { x: number; y: number } | null = null;
  private first = false;
  /** Cambio entre cabina y vista exterior: la cámara vuela de una a otra en `BLEND_SEC` (sin cortes). */
  private blend: { from: THREE.Vector3; fromQ: THREE.Quaternion; start: number } | null = null;
  static readonly BLEND_SEC = 0.45;

  /** ¿Está volando entre la cabina y la vista exterior? */
  get transitioning(): boolean {
    return this.blend !== null;
  }

  static readonly DEFAULT_DIST = DEFAULT_DIST;
  /** Altura de la cámara sobre la línea de mira (fracción de la distancia): la nave queda algo por debajo del centro, por encima de los paneles del HUD. */
  static readonly HEIGHT = 0.15;
  static readonly MIN_DIST = FLAGSHIP_LENGTH_M * 0.9;
  static readonly MAX_DIST = FLAGSHIP_LENGTH_M * 60;
  /** Cabina: posición en el puente (m, ejes de la nave; ver la receta `flagship`). */
  static readonly COCKPIT = new THREE.Vector3(0, FLAGSHIP_LENGTH_M * 0.062, -FLAGSHIP_LENGTH_M * 0.17);

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    dom.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    dom.addEventListener("wheel", this.onWheel, { passive: true });
  }

  /** ¿La cámara está fuera de la vista de seguimiento (para avisar en el HUD)? */
  get free(): boolean {
    return Math.abs(this.wantYaw) > 0.02 || Math.abs(this.wantPitch) > 0.02;
  }

  /**
   * Armas a punto (motores encendidos y ratón para combatir): el botón
   * izquierdo dispara en vez de mover la cámara y la rueda cambia de arma
   * (la distancia de la cámara pasa a Mayús + rueda). Lo pone la vista.
   */
  armed = false;

  private onDown = (e: PointerEvent) => {
    const mouseFlight = settingsStore.getState().prefs.flight.mouseFlight;
    // Izquierdo: cámara (salvo pilotando con ratón o con las armas a punto; con Alt, siempre); derecho: siempre cámara.
    if (e.button === 2 || (e.button === 0 && !mouseFlight && (!this.armed || e.altKey))) this.drag = { x: e.clientX, y: e.clientY };
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    // Con el ratón atrapado (vuelo con ratón) la posición no cambia: se usa cuánto se movió.
    const locked = document.pointerLockElement !== null;
    const dx = locked ? e.movementX : e.clientX - this.drag.x;
    const dy = locked ? e.movementY : e.clientY - this.drag.y;
    this.drag = { x: e.clientX, y: e.clientY };
    const k = 0.005;
    const invert = settingsStore.getState().prefs.flight.invertCameraY ? -1 : 1;
    this.wantYaw -= dx * k;
    this.wantPitch -= dy * k * invert;
    if (this.first) {
      // Cabeza: hasta ~110° a los lados y ~70° arriba y abajo.
      this.wantYaw = Math.max(-1.9, Math.min(1.9, this.wantYaw));
      this.wantPitch = Math.max(-1.2, Math.min(1.2, this.wantPitch));
    } else {
      this.wantPitch = Math.max(-1.45, Math.min(1.45, this.wantPitch));
    }
  };

  private onUp = () => {
    if (!this.drag) return;
    this.drag = null;
    // En vuelo con ratón la cámara va detrás de la nave: mirar alrededor (botón derecho) es solo un momento.
    if (settingsStore.getState().prefs.flight.mouseFlight && !this.first) this.reset();
  };

  private onWheel = (e: WheelEvent) => {
    // La rueda siempre acerca o aleja (petición del usuario); Mayús + rueda cambia de arma.
    if (this.first || e.shiftKey) return;
    // Con Mayús, algunos navegadores convierten la rueda en desplazamiento horizontal (deltaX).
    const delta = e.deltaY || e.deltaX;
    this.wantDist = Math.max(ChaseCamera.MIN_DIST, Math.min(ChaseCamera.MAX_DIST, this.wantDist * Math.exp(delta * 0.001)));
  };

  /** Vuelve a la vista de seguimiento, detrás de la nave (o a mirar al frente en cabina). */
  reset(): void {
    this.wantYaw = 0;
    this.wantPitch = 0;
    if (!this.first) this.wantDist = ChaseCamera.DEFAULT_DIST;
  }

  /** Pone la órbita en un ángulo (rad, respecto a la nave; π = de frente) de golpe, sin suavizado. */
  setOrbit(yaw: number, pitch: number): void {
    this.wantYaw = this.yaw = yaw;
    this.wantPitch = this.pitch = pitch;
  }

  /** Coloca la cámara de golpe (al empezar a pilotar o tras una corrección del servidor). */
  snap(ship: THREE.Object3D, first: boolean): void {
    this.frame.copy(ship.quaternion);
    this.yaw = this.wantYaw;
    this.pitch = this.wantPitch;
    this.dist = this.wantDist;
    this.blend = null;
    this.first = first;
    this.place(ship, first, 1);
  }

  /** Sigue a la nave; `k` (0–1) es cuánto se acerca este fotograma a su sitio ideal. */
  place(ship: THREE.Object3D, first: boolean, k: number): void {
    if (first !== this.first) {
      // Al cambiar de cámara se vuelve a mirar al frente (los ángulos de la cabina y de la órbita no se mezclan)
      // y la cámara vuela desde donde estaba.
      this.first = first;
      this.wantYaw = this.wantPitch = this.yaw = this.pitch = 0;
      this.blend = { from: this.camera.position.clone(), fromQ: this.camera.quaternion.clone(), start: performance.now() };
    }
    this.yaw += (this.wantYaw - this.yaw) * Math.min(1, k * 1.4);
    this.pitch += (this.wantPitch - this.pitch) * Math.min(1, k * 1.4);
    this.dist += (this.wantDist - this.dist) * Math.min(1, k);
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    if (first) {
      // Cabina: va pegada a la nave (sin retraso); la cabeza gira con el ratón.
      this.frame.copy(ship.quaternion);
      this.camera.position.copy(ChaseCamera.COCKPIT).applyQuaternion(ship.quaternion).add(ship.position);
      this.camera.quaternion.copy(ship.quaternion).multiply(look);
      this.applyBlend();
      return;
    }
    // La referencia sigue la orientación de la nave con un poco de retraso: los giros se notan sin sacudidas.
    this.frame.slerp(ship.quaternion, Math.min(1, k)).normalize();
    const orient = this.frame.clone().multiply(look);
    // Detrás y algo por encima de la nave según la órbita, mirando en la dirección de la órbita.
    const back = new THREE.Vector3(0, ChaseCamera.HEIGHT, 1).multiplyScalar(this.dist).applyQuaternion(orient);
    this.camera.position.copy(ship.position).add(back);
    this.camera.quaternion.copy(orient);
    this.applyBlend();
  }

  /** Mezcla la pose calculada con la de antes del cambio de cámara, con una curva suave. */
  private applyBlend(): void {
    const b = this.blend;
    if (!b) return;
    const t = Math.min(1, (performance.now() - b.start) / (ChaseCamera.BLEND_SEC * 1000));
    const e = t * t * (3 - 2 * t);
    this.camera.position.lerpVectors(b.from, this.camera.position, e);
    this.camera.quaternion.slerpQuaternions(b.fromQ, this.camera.quaternion.clone(), e);
    if (t >= 1) this.blend = null;
  }

  dispose(): void {
    this.dom.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("wheel", this.onWheel);
  }
}
