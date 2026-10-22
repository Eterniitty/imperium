import * as THREE from "three";
import { PULSE_CHARGE_SEC, stepPulseSpeed } from "@imperium/sim";
import { FLIGHT_MODEL } from "@imperium/content";
import { settingsStore, thrustScale } from "../state/settings";
import type { Keyboard } from "./input";
import { lockedPointer } from "./pointerLock";
import { gameStore } from "../state/store";

/** ¿Hay abierta una ventana o panel que se maneja con el ratón? Entonces no se atrapa (y se suelta). */
function uiOpen(): boolean {
  const g = gameStore.getState();
  return g.settingsOpen || g.economyOpen !== null || g.colonyManager !== null || g.lineageOpen || g.shipEditorOpen || g.quantumPanel || g.cruisePanel || document.querySelector(".planet-win, .modal-backdrop") !== null;
}
import type { CruiseCommand } from "./Autopilot";

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

/** Vuelo arcade: fracción de la velocidad máxima sin tocar W/S (crucero) y segundos hasta la máxima. */
const ARCADE_CRUISE = 0.3;
const ARCADE_SECONDS_TO_MAX = 5;

export class ShipController {
  /** Prestaciones propias (naves del Astillero): multiplican la aceleración y el giro de `FLIGHT_MODEL`. */
  performance = { accel: 1, turn: 1 };

  enabled = true;
  readonly velocity = new THREE.Vector3();
  /** Velocidad angular en ejes de la nave (rad/s): x cabeceo, y guiñada, z alabeo. */
  readonly angular = new THREE.Vector3();
  /** Aceleración externa (m/s², mundo) del último subpaso: la gravedad. */
  readonly external = new THREE.Vector3();
  /**
   * Gravedad en un punto (m/s², mundo), evaluada en cada subpaso (la pone la
   * vista de sistema con `gravityAt` de `@imperium/sim`). Sin ella, no hay gravedad.
   */
  gravity: ((pos: THREE.Vector3, out: THREE.Vector3) => void) | null = null;
  /** Proporción de empuje (0–1) para el brillo de los motores. */
  thrust = 0;
  /** Vuelo arcade: velocidad hacia el morro (m/s). */
  private arcadeSpeed = 0;
  private wasArcade = false;
  /**
   * Arcade: sin teclas, ¿sigue a la velocidad de crucero o se queda parada? Empieza
   * parada (al tomar los mandos, tras el piloto automático o tras `stop`); W la pone
   * en crucero y S la para hasta volver a pulsar W.
   */
  private arcadeCruising = false;
  /** Lo que piden los mandos ahora (para los propulsores de maniobra del modelo). */
  readonly maneuver: Maneuver = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  pulseLimit = 0;
  /** Tope de la velocidad de maniobra aquí (m/s): lo pone la vista según los cuerpos cercanos y el combustible. */
  maneuverCap = Infinity;
  /**
   * Piloto automático de crucero: si lo hay, sus mandos sustituyen a los del
   * teclado y del ratón (misma física; la asistencia de vuelo va siempre puesta)
   * y el pulso no pasa de `pulseCap`.
   */
  autopilot: CruiseCommand | null = null;
  /**
   * Motores encendidos. Apagados (o arrancando) no hay empuje, giros ni pulso:
   * la nave solo sigue con su inercia y la gravedad.
   */
  powered = true;
  private pulseOn = false;
  private pulseSpeed = 0;
  /** Cursor sobre la vista, relativo al centro (−1 a 1 en media altura), para el vuelo con ratón; null si está fuera. */
  private cursor: { x: number; y: number } | null = null;
  /** Giro pedido con el ratón ahora (−1 a 1; x cabeceo, y guiñada), para la retícula del HUD. */
  readonly mouseStick = new THREE.Vector2();
  private input = new THREE.Vector3();
  private turn = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(
    private ship: THREE.Object3D,
    private dom: HTMLElement,
    private keyboard: Keyboard,
  ) {
    dom.addEventListener("pointermove", this.onMove);
    dom.addEventListener("pointerleave", this.onLeave);
    window.addEventListener("pointerdown", this.onButtons);
    window.addEventListener("pointerup", this.onButtons);
    document.addEventListener("pointerlockchange", this.onLockChange);
    window.addEventListener("keydown", this.onAlt);
  }

  /** Alt suelta el ratón atrapado (para usar la interfaz); un clic en la vista lo vuelve a atrapar. */
  private onAlt = (e: KeyboardEvent) => {
    if ((e.code === "AltLeft" || e.code === "AltRight") && document.pointerLockElement === this.dom) document.exitPointerLock();
  };

  /** Se quiere el ratón atrapado (vuelo con ratón, motores en marcha, a mano): lo decide `update`. */
  private lockWanted = false;
  /** Cursor virtual que se dibuja mientras el puntero está bloqueado. */
  private ghost: HTMLDivElement | null = null;

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.dom;
    lockedPointer.active = locked;
    if (locked) {
      this.cursor ??= { x: 0, y: 0 };
      this.ghost ??= Object.assign(document.createElement("div"), { className: "virtual-cursor" });
      document.body.appendChild(this.ghost);
      this.placeGhost();
    } else {
      this.ghost?.remove();
    }
  };

  /** Coloca el cursor virtual (y la posición que leen clics y selección). */
  private placeGhost(): void {
    if (!this.cursor) return;
    const r = this.dom.getBoundingClientRect();
    const half = Math.max(1, r.height / 2);
    lockedPointer.x = r.left + r.width / 2 + this.cursor.x * half;
    lockedPointer.y = r.top + r.height / 2 + this.cursor.y * half;
    if (this.ghost) this.ghost.style.transform = `translate(${lockedPointer.x}px, ${lockedPointer.y}px)`;
  }

  /** Atrapa o suelta el ratón según `lockWanted` (atraparlo pide un clic: lo hace `onButtons`). */
  private syncLock(): void {
    if (!this.lockWanted && document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  get speed(): number {
    return this.velocity.length();
  }

  /** ¿Pulso pedido? (encendido o cargándose: pedirlo otra vez lo cancela). */
  get pulse(): boolean {
    return this.pulseOn || this.pulseCharge !== null;
  }

  /** ¿Pulso encendido de verdad (no cargándose)? */
  get pulseActive(): boolean {
    return this.pulseOn;
  }

  /** Carga del pulso (0–1), o null si no se está cargando. */
  get pulseCharging(): number | null {
    return this.pulseCharge === null ? null : 1 - this.pulseCharge / PULSE_CHARGE_SEC;
  }

  /** Pide o apaga el pulso: se carga `PULSE_CHARGE_SEC` y luego arranca desde la velocidad que se lleve. */
  set pulse(on: boolean) {
    if (!on) {
      this.pulseOn = false;
      this.pulseCharge = null;
      return;
    }
    if (!this.pulseOn && this.pulseCharge === null) this.pulseCharge = PULSE_CHARGE_SEC;
  }

  /** Segundos que faltan de la carga del pulso (null: no se está cargando). */
  private pulseCharge: number | null = null;

  /** Cursor sobre la vista (relativo al centro, en medias alturas), o null si está fuera. */
  get cursorAt(): { x: number; y: number } | null {
    return this.cursor ? { ...this.cursor } : null;
  }

  /** ¿Se está pilotando con el ratón ahora mismo (modo de vuelo con ratón y cursor fuera de la zona muerta)? */
  get mouseSteering(): boolean {
    return this.mouseStick.lengthSq() > 0;
  }

  // Vuelo con ratón: retícula virtual. Se guarda dónde está el cursor respecto al
  // centro de la vista; sin arrastrar, la distancia al centro marca la velocidad de giro.
  private onMove = (e: PointerEvent) => {
    const r = this.dom.getBoundingClientRect();
    const half = Math.max(1, r.height / 2);
    if (lockedPointer.active) {
      // Mirando alrededor con el botón derecho, el ratón mueve la cámara, no el cursor de mando.
      if ((e.buttons & 2) !== 0) return;
      // Ratón atrapado: el cursor virtual se mueve con el ratón y no sale del círculo de mando.
      const c = (this.cursor ??= { x: 0, y: 0 });
      c.x += e.movementX / half;
      c.y += e.movementY / half;
      const R = FLIGHT_MODEL.mouseReticleRadius;
      const len = Math.hypot(c.x, c.y);
      if (len > R) {
        c.x *= R / len;
        c.y *= R / len;
      }
      this.placeGhost();
      return;
    }
    this.cursor = { x: (e.clientX - r.left - r.width / 2) / half, y: (e.clientY - r.top - r.height / 2) / half };
  };

  /** Dónde está el cursor sobre la vista en coordenadas normalizadas (−1…1), o null si está fuera. */
  cursorNdc(): { x: number; y: number } | null {
    if (!this.cursor) return null;
    const r = this.dom.getBoundingClientRect();
    return { x: (this.cursor.x * r.height) / Math.max(1, r.width), y: -this.cursor.y };
  }

  private onLeave = () => {
    if (!lockedPointer.active) this.cursor = null;
  };

  /** Giro que pide el cursor (zona muerta, sensibilidad y eje invertido de los ajustes). */
  private stickFromCursor(): void {
    const f = settingsStore.getState().prefs.flight;
    const stick = this.mouseStick.set(0, 0);
    // Mirando alrededor (botón derecho) no se dirige; con el izquierdo sí (se dispara mientras se vira).
    if (!f.mouseFlight || !this.cursor || (this.buttons & 2) !== 0) return;
    const R = FLIGHT_MODEL.mouseReticleRadius;
    const dead = f.mouseDeadzone * R;
    const len = Math.hypot(this.cursor.x, this.cursor.y);
    if (len <= dead) return;
    // Fuera de la zona muerta, el giro crece desde 0 hasta 1 en el radio de la retícula.
    const k = Math.min(1, ((len - dead) / Math.max(1e-6, R - dead)) * f.mouseSensitivity) / len;
    stick.set(-this.cursor.y * k * (f.mouseInvertY ? -1 : 1), -this.cursor.x * k);
  }

  /** Botones del ratón pulsados sobre la vista. */
  private buttons = 0;
  private onButtons = (e: PointerEvent) => {
    this.buttons = e.buttons;
    // Un clic sobre la vista con el vuelo con ratón atrapa el ratón (el navegador lo pide con un gesto). Sale donde estaba el cursor.
    if (e.type === "pointerdown" && e.target === this.dom && this.lockWanted && !lockedPointer.active && !e.altKey) {
      const r = this.dom.getBoundingClientRect();
      const half = Math.max(1, r.height / 2);
      this.cursor = { x: (e.clientX - r.left - r.width / 2) / half, y: (e.clientY - r.top - r.height / 2) / half };
      const R = FLIGHT_MODEL.mouseReticleRadius;
      const len = Math.hypot(this.cursor.x, this.cursor.y);
      if (len > R) this.cursor = { x: (this.cursor.x * R) / len, y: (this.cursor.y * R) / len };
      void Promise.resolve(this.dom.requestPointerLock()).catch(() => undefined);
    }
  };

  /** Detiene la nave en seco (al cambiar de modo o teletransportar). */
  stop(): void {
    this.velocity.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.pulseSpeed = 0;
    this.arcadeSpeed = 0;
    this.arcadeCruising = false;
  }

  /** Mueve la nave `dt` segundos (con subpasos fijos); devuelve el desplazamiento. */
  /**
   * `realDt`: tiempo real transcurrido. Las cargas (pulso) cuentan con él para
   * durar lo mismo aunque el ordenador vaya a pocos FPS (el `dt` del vuelo tiene tope).
   */
  update(dt: number, realDt: number = dt): THREE.Vector3 {
    const kb = this.keyboard;
    const prefs = settingsStore.getState().prefs.flight;
    const M = FLIGHT_MODEL;
    if (!this.powered) {
      this.pulseOn = false;
      this.pulseCharge = null;
    }
    // Carga del pulso: al terminar, arranca desde la velocidad que se lleve.
    if (this.pulseCharge !== null) {
      this.pulseCharge -= realDt;
      if (this.pulseCharge <= 0) {
        this.pulseCharge = null;
        this.pulseOn = true;
        this.pulseSpeed = this.velocity.length();
      }
    }
    const live = this.enabled && this.powered;
    const auto = live ? this.autopilot : null;
    this.lockWanted = live && prefs.mouseFlight && !auto && !uiOpen();
    this.syncLock();
    // Vuelo arcade (tipo No Man's Sky) a mano; el piloto automático vuela siempre con el modelo newtoniano.
    // Solo con los mandos y los motores: sin ellos (apagados, acoplada) la nave deriva con su inercia y la gravedad.
    const arcade = prefs.flightModel === "arcade" && !auto && live;
    // Al pasar a arcade (tras el pulso, el piloto automático o al cambiar de modelo) se parte de la velocidad que se lleve,
    // sin acelerar sola después (la que pase de la máxima se pierde enseguida, abajo).
    if (arcade && !this.wasArcade) {
      this.arcadeSpeed = Math.max(0, this.velocity.dot(this.tmp.set(0, 0, -1).applyQuaternion(this.ship.quaternion)));
      this.arcadeCruising = false;
    }
    // Lo que haya frenado a la nave desde fuera (choques, correcciones del servidor) también frena el acelerador.
    if (arcade && this.wasArcade) this.arcadeSpeed = Math.min(this.arcadeSpeed, Math.max(0, this.velocity.dot(this.tmp.set(0, 0, -1).applyQuaternion(this.ship.quaternion))));
    this.wasArcade = arcade && !this.pulseOn;

    // Mandos de giro (−1 a 1 por eje).
    const turn = this.turn.set(0, 0, 0);
    this.mouseStick.set(0, 0);
    if (auto) {
      turn.set(auto.pitch, auto.yaw, auto.roll);
      // El cursor no gira la nave, pero se mide (moverlo fuera de la zona muerta cancela el piloto automático).
      this.stickFromCursor();
    } else if (live) {
      if (kb.action("pitchUp")) turn.x += 1;
      if (kb.action("pitchDown")) turn.x -= 1;
      if (kb.action("turnLeft")) turn.y += 1;
      if (kb.action("turnRight")) turn.y -= 1;
      if (kb.action("rollLeft")) turn.z += 1;
      if (kb.action("rollRight")) turn.z -= 1;
      // Arcade: A/D giran (en vez de desplazarse de lado).
      if (arcade) {
        if (kb.action("strafeLeft")) turn.y += 1;
        if (kb.action("strafeRight")) turn.y -= 1;
      }
      this.stickFromCursor();
      if (this.mouseStick.lengthSq() > 0) {
        turn.x += this.mouseStick.x;
        turn.y += this.mouseStick.y;
        turn.clampScalar(-1, 1);
      }
      if (arcade && turn.z === 0) {
        // Se inclina al girar y, sin girar, se nivela sola (respecto al plano del sistema).
        const rightY = this.tmp.set(1, 0, 0).applyQuaternion(this.ship.quaternion).y;
        turn.z = Math.max(-1, Math.min(1, (Math.sin(turn.y * 0.55) - rightY) * 2.5));
      }
    }
    // Mandos de traslación, en ejes de la nave (−Z es delante).
    const input = this.input.set(0, 0, 0);
    if (auto) input.set(auto.x, auto.y, auto.z);
    else if (live) {
      if (kb.action("forward")) input.z -= 1;
      if (kb.action("back")) input.z += 1;
      if (kb.action("strafeLeft")) input.x -= 1;
      if (kb.action("strafeRight")) input.x += 1;
      if (kb.action("up")) input.y += 1;
      if (kb.action("down")) input.y -= 1;
    }
    const boost = auto ? auto.boost : live && kb.action("boost");
    Object.assign(this.maneuver, { x: input.x, y: input.y, z: input.z, pitch: turn.x, yaw: turn.y, roll: turn.z });

    const accelK = prefs.accel * this.performance.accel;
    const maxSpeed = Math.min(this.maneuverCap, M.maxSpeed * prefs.maxSpeed * (boost ? M.boostFactor : 1));
    const steps = Math.max(1, Math.min(16, Math.ceil(dt / M.substep)));
    const h = dt / steps;
    const start = this.ship.position.clone();
    for (let i = 0; i < steps; i++) {
      // Rotación: velocidad angular hacia la pedida, con aceleración angular limitada.
      const rates = [M.pitchRate, M.yawRate, M.rollRate].map((r) => r * this.performance.turn);
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
        const limit = auto && auto.pulseCap > 0 ? Math.min(this.pulseLimit, auto.pulseCap) : this.pulseLimit;
        this.pulseSpeed = stepPulseSpeed(this.pulseSpeed, limit, h);
        this.velocity.set(0, 0, -1).applyQuaternion(this.ship.quaternion).multiplyScalar(this.pulseSpeed);
      } else if (arcade) {
        // Arcade: la velocidad sigue al acelerador con suavidad (unos 5 s hasta la máxima, sea cual sea) y va siempre
        // hacia el morro, sin derrapar; sin teclas se queda en una velocidad de crucero. La gravedad no tira (como en NMS).
        const top = maxSpeed;
        // Sin marcha atrás: S frena hasta pararse (los motores solo empujan hacia delante).
        if (input.z < 0) this.arcadeCruising = true;
        else if (input.z > 0) this.arcadeCruising = false;
        const throttle = input.z < 0 ? 1 : input.z > 0 || !this.arcadeCruising ? 0 : ARCADE_CRUISE;
        const want = throttle * top;
        if (this.arcadeSpeed > top) {
          // Más rápido que la máxima (al salir del pulso o del crucero): se pierde enseguida, como al apagar el pulso.
          this.arcadeSpeed = Math.max(want, top + (this.arcadeSpeed - top) * Math.exp(-M.pulseDumpRate * h));
        } else {
          const rate = (M.maxSpeed * prefs.maxSpeed * (want > this.arcadeSpeed && boost ? M.boostFactor : 1) * prefs.accel) / ARCADE_SECONDS_TO_MAX;
          const diff = want - this.arcadeSpeed;
          this.arcadeSpeed += Math.sign(diff) * Math.min(Math.abs(diff), rate * h * (diff < 0 ? 1.4 : 1));
        }
        this.velocity.set(0, 0, -1).applyQuaternion(this.ship.quaternion).multiplyScalar(this.arcadeSpeed);
      } else {
        if (this.powered) this.stepThrust(input, prefs.assist || auto !== null, maxSpeed, accelK * (boost ? M.boostAccelFactor : 1) * thrustScale(prefs.maxSpeed), prefs.inertia, h);
        if (this.gravity) this.gravity(this.ship.position, this.external);
        else this.external.set(0, 0, 0);
        this.velocity.addScaledVector(this.external, h);
      }
      // Semi-implícito: primero la velocidad, luego la posición con la velocidad nueva.
      this.ship.position.addScaledVector(this.velocity, h);
    }
    const target = !this.powered ? 0 : this.pulseOn ? 1 : input.lengthSq() > 0 ? (boost ? 1 : 0.55) : 0.08;
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
    const cap = M.maxSpeed * Math.max(1, settingsStore.getState().prefs.flight.maxSpeed) * M.boostFactor * 1.2;
    const speed = this.velocity.length();
    if (speed > cap) this.velocity.multiplyScalar((cap + (speed - cap) * Math.exp(-M.pulseDumpRate * h)) / speed);
    if (assist && input.lengthSq() === 0 && this.velocity.lengthSq() < 0.01 && this.external.lengthSq() === 0) this.velocity.set(0, 0, 0);
  }

  dispose(): void {
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerleave", this.onLeave);
    window.removeEventListener("pointerdown", this.onButtons);
    window.removeEventListener("pointerup", this.onButtons);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    window.removeEventListener("keydown", this.onAlt);
    this.lockWanted = false;
    this.syncLock();
    this.ghost?.remove();
    lockedPointer.active = false;
  }
}
