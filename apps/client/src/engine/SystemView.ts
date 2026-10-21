import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Rng, STAR_CLASSES, hashString } from "@imperium/procgen";
import type { I18nKey, ServerMessage, StarSystemDetail, StarSystemSummary, WeaponKind, WorldPosition } from "@imperium/shared";
import { ARRIVAL_EDGE, defaultPark, moonOffset, parkedPosition, planetAngle, planetSpinAngle, pulseLimitAt, sanitizePark, gravityAt, type GravitySource, systemLayout, type CelestialBody, type MoonLayout, type ParkedOrbit, type PlanetLayout, type SystemLayout } from "@imperium/sim";
import { resetSpace, shipName, spaceStore } from "../net/space";
import { telemetry, type FlightTelemetry } from "./telemetry";
import { connection, serverNow } from "../net/world";
import { RemoteShips } from "./RemoteShips";
import { FleetScene } from "./FleetScene";
import { Effects } from "./Effects";
import { worldStore } from "../net/world";
import { EMPEROR_FLAGSHIP, FLIGHT_MODEL, FLAGSHIP_LENGTH_M, FLAGSHIP_SUPPLIES, QUANTUM_ALIGN_RAD_PER_SEC, QUANTUM_CHARGE_SEC, QUANTUM_RIFT } from "@imperium/content";
import { playQuantumCharge, playQuantumTear, stopQuantumCharge } from "../audio/quantumSfx";
import { playEngineStart, playEngineStop, stopEngineSound } from "../audio/engineSfx";
import { RiftField } from "./fx/riftPortal";
import { distanceGain, playCannon, playExplosion, playHit, playMissile } from "../audio/combatSfx";
import { isBound, settingsStore, type Action } from "../state/settings";
import { gameStore } from "../state/store";
import { Backdrop } from "./Backdrop";
import { ShipController, type Maneuver } from "./ShipController";
import { ChaseCamera } from "./ChaseCamera";
import type { Keyboard } from "./input";
import { createFlagship, disposeShip, SHIP_SCALE, shipRig } from "./shipModel";
import { createCockpit } from "./cockpit";
import { glowTexture, labelTexture, ringTexture } from "./textures";
import { CORONA_SCALE, createAtmosphereMaterial, createBodyUniforms, createCoronaMaterial, createPlanetMaterial, createRingMaterial, createStarSurfaceMaterial } from "./bodyMaterials";
import { bodyDetailFor, bodySegments, planetLook } from "./planetLook";
import { claimsStore } from "../state/claims";
import { ownColonyAt, planetLabel } from "../ui/colonies";
import type { View } from "./View";

interface PlanetVisual {
  index: number;
  /** Designación del planeta (p. ej. «Velor III»); el rótulo usa el nombre personalizado si lo hay. */
  designation: string;
  /** Rótulo en la vista 3D y lo que muestra (para rehacerlo solo si cambia). */
  label: { sprite: THREE.Sprite; key: string } | null;
  layout: PlanetLayout;
  pivot: THREE.Object3D;
  mesh: THREE.Mesh;
  orbitLine: THREE.LineLoop;
  /** Lunas: cuerpos físicos (colisión, gravedad, pulso) con la órbita de `@imperium/sim`. */
  moons: Array<{ mesh: THREE.Mesh; layout: MoonLayout; name: string }>;
}

/** Avisos de la vista de sistema al motor. */
export interface SystemViewEvents {
  /** Esc en modo observar: volver al mapa. */
  onExit(): void;
  /** El motor cuántico terminó de cargar: hay que dar la orden de salto. */
  onQuantumJump(target: StarSystemSummary): void;
  /** La nave cruzó el borde del sistema: pasar al espacio interestelar. `direction` es hacia dónde salió. */
  onLeave(direction: THREE.Vector3): void;
  /** Aviso breve; `keyAction` añade como parámetro `key` la tecla de esa acción. */
  notify(key: I18nKey, keyAction?: Action): void;
}

/** Cada cuánto se envía la posición propia al servidor mientras se pilota. */
const POSE_INTERVAL = 0.125;


/**
 * Vista de un sistema estelar, con la disposición de `@imperium/sim` (distancias
 * comprimidas, igual en cliente y servidor). Dos modos:
 * - observar: cámara orbital, para inspeccionar planetas;
 * - pilotar: la nave del Emperador, con cámara de persecución. Salir volando
 *   más allá del borde lleva al espacio interestelar sin pantallas intermedias.
 */
export class SystemView implements View {
  readonly scene = new THREE.Scene();
  // De medio metro a decenas de millones de km: lo permite el búfer de profundidad logarítmico.
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1e11);
  readonly controls: OrbitControls;

  private content = new THREE.Group();
  private backdrop = new Backdrop(9000, 4242);
  private planets: PlanetVisual[] = [];
  /** Uniformes comunes de planetas, lunas y estrella (tiempo, detalle, luz de la estrella). */
  private bodyUniforms = createBodyUniforms();
  /**
   * Cuerpos con nivel de detalle: su esfera cambia de segmentos según la
   * distancia a la cámara (en radios) para que la silueta no se vea poligonal
   * de cerca sin pagar de lejos. Las esferas de cada nivel se crean al usarlas.
   */
  private lodBodies: Array<{ mesh: THREE.Mesh; radius: number; levels: Map<number, THREE.SphereGeometry> }> = [];
  private selectRing: THREE.Sprite;
  private raycaster = new THREE.Raycaster();
  private time = 0;
  private hoveredPlanet: number | null = null;
  private dom: HTMLElement;
  private layout: SystemLayout | null = null;
  private ship: THREE.Group | null = null;
  private flight: ShipController | null = null;
  /** Cuerpos con su posición en este fotograma (para la gravedad). */
  private gravitySources: GravitySource[] = [];
  /** Cámara del piloto (exterior orbital o cabina), independiente de la orientación de la nave. */
  private chase: ChaseCamera;
  private leaving = false;
  private systemId: string | null = null;
  private starName = "";
  /** Radio a partir del cual se sale al espacio interestelar (ver `pilot`). */
  private boundary = 0;
  private poseTimer = 0;
  private remote = new RemoteShips();
  private effects = new Effects(
    () => worldStore.getState().myEmperorId,
    (id, weapon, index) => (id === worldStore.getState().myEmperorId ? this.ownMuzzle(weapon, index) : this.remote.muzzleOf(id, weapon, index)),
  );
  /** Siguiente cañón propio (se alternan, igual que en el servidor). */
  private cannonIndex = 0;
  private cockpit = createCockpit();
  /**
   * Salto cuántico en preparación: la nave se alinea con el destino (`align`),
   * carga el motor (`charge`) y espera la confirmación del servidor (`sent`).
   */
  private quantum: { target: StarSystemSummary; dir: THREE.Vector3; phase: "align" | "charge" | "sent" | "depart"; t: number; riftSent: boolean; onDeparted?: () => void } | null = null;
  /**
   * Llegada de un salto: la nave sale de una grieta abierta en `spawn` (donde
   * aparece), desde `L` esloras por detrás; los mandos esperan a que salga.
   */
  private arrival: { t: number; spawn: THREE.Vector3; dir: THREE.Vector3; q: THREE.Quaternion } | null = null;
  /** Grietas del salto cuántico (la propia y las de otras naves), en el mundo. */
  readonly rifts = new RiftField();
  /**
   * Motores de la nave propia: al tomar los mandos están apagados y hay que
   * arrancarlos (tecla «engines»); `t` es el tiempo en el estado actual.
   */
  private engines: { state: "off" | "starting" | "on" | "stopping"; t: number; from: number } = { state: "off", t: 0, from: 0 };
  /** Para no repetir el aviso de «motores apagados» a cada fotograma. */
  private enginesHintAt = 0;
  private targetRing: THREE.Sprite;
  /** Cadencia local del cañón: no se envían disparos que el servidor rechazaría. */
  private cannonReadyAt = 0;
  /** Flotas propias paradas y batallas de flotas en 3D (solo se dibujan). */
  private fleetScene = new FleetScene((at) => this.effects.explode(at));
  /** Batalla a la que llevar la cámara en cuanto se dibuje. */
  private pendingBattleFocus: string | null = null;

  constructor(
    dom: HTMLElement,
    private keyboard: Keyboard,
    private events: SystemViewEvents,
  ) {
    this.dom = dom;
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 200;
    this.controls.maxDistance = 600;
    this.controls.enabled = false;
    this.chase = new ChaseCamera(this.camera, dom);

    this.selectRing = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color: 0xe8b64c, depthTest: false, sizeAttenuation: false, transparent: true }),
    );
    this.selectRing.scale.setScalar(0.07);
    this.selectRing.visible = false;
    this.selectRing.renderOrder = 10;

    this.targetRing = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color: 0xff5a5a, depthTest: false, sizeAttenuation: false, transparent: true }),
    );
    this.targetRing.scale.setScalar(0.06);
    this.targetRing.visible = false;
    this.targetRing.renderOrder = 11;
    this.scene.add(this.backdrop.object, this.content, this.selectRing, this.remote.group, this.effects.group, this.targetRing, this.fleetScene.group, this.rifts.group);
    this.scene.add(new THREE.AmbientLight(0x5a6688, 0.9));
    // Cabina en primera persona: cuelga de la cámara (por eso la cámara va en la escena).
    this.cockpit.visible = false;
    this.camera.add(this.cockpit);
    this.scene.add(this.camera);
  }

  /** Construye la representación del sistema a partir de su detalle generado. */
  build(detail: StarSystemDetail): void {
    this.clear();
    const { summary } = detail;
    const info = STAR_CLASSES[summary.starClass];
    const starColor = new THREE.Color(info.color);
    const rng = new Rng(hashString(summary.id));

    const layout = systemLayout(detail);
    // Las grietas son del sistema: al cambiar de sistema se van (si se vuelve a dibujar el mismo, siguen).
    if (this.systemId !== summary.id) {
      this.rifts.clear();
      this.arrival = null;
    }
    this.layout = layout;
    this.systemId = summary.id;
    this.fleetScene.setSystem(summary.id, layout);
    this.starName = summary.name;

    // Estrella: superficie con granulado y manchas, y corona que no tapa el disco.
    const isBlackHole = summary.starClass === "BH";
    const starRadius = layout.starRadius;
    // Semilla propia (no consume `rng`, para no alterar el resto del sistema).
    const starRng = new Rng(hashString(`star:${summary.id}`));
    const starSeed = new THREE.Vector3(starRng.range(-50, 50), starRng.range(-50, 50), starRng.range(-50, 50));
    this.bodyUniforms.uSunColor.value.copy(starColor).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(isBlackHole ? 0.35 : 1);
    const star = new THREE.Mesh(this.sphereLevel(starRadius, 64), createStarSurfaceMaterial(starColor, starSeed, isBlackHole, this.bodyUniforms));
    this.content.add(star);
    this.trackLod(star, starRadius);
    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(starRadius * CORONA_SCALE, 64, 32),
      createCoronaMaterial(isBlackHole ? new THREE.Color(0xb98cff) : starColor, starRadius, starSeed, isBlackHole, this.bodyUniforms),
    );
    corona.renderOrder = 1;
    this.content.add(corona);

    if (isBlackHole) {
      const disk = new THREE.Mesh(
        new THREE.RingGeometry(starRadius * 1.4, starRadius * 3.2, 96),
        new THREE.MeshBasicMaterial({ color: 0xc98bff, side: THREE.DoubleSide, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      disk.rotation.x = Math.PI / 2.3;
      this.content.add(disk);
    }

    const light = new THREE.PointLight(starColor, isBlackHole ? 1.5 : 4.5, 0, 0);
    this.content.add(light);

    for (const belt of layout.belts) this.content.add(this.makeBelt(belt.orbitRadius, belt.halfWidth, rng));

    let radius = starRadius * 3;
    for (const pl of layout.planets) {
      const p = detail.planets.find((x) => x.index === pl.index)!;
      const size = pl.size;
      radius = pl.orbitRadius;
      // Superficie procedural en el shader, determinista por planeta (id del sistema e índice).
      const look = planetLook(p.type, `${summary.id}:${p.index}`);
      const mesh = new THREE.Mesh(this.sphereLevel(size, 32), createPlanetMaterial(look, size, this.bodyUniforms));
      this.trackLod(mesh, size);
      mesh.userData.planetIndex = p.index;
      mesh.rotation.z = rng.range(-0.4, 0.4);
      if (look.atmosphere) {
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(size * (1 + look.atmosphere.thickness), 128, 64),
          createAtmosphereMaterial(look, size, this.bodyUniforms),
        );
        mesh.add(shell);
      }

      const pivot = new THREE.Object3D();
      pivot.rotation.y = planetAngle(pl, serverNow());
      mesh.position.set(radius, 0, 0);
      pivot.add(mesh);

      // Anillos en algunos gigantes.
      if ((p.type === "gas_giant" || p.type === "ice_giant") && rng.chance(0.45)) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(size * 1.4, size * 2.2, 256, 1),
          createRingMaterial(
            {
              inner: 1.4,
              outer: 2.2,
              radius: size,
              color: new THREE.Color(p.type === "ice_giant" ? 0xb8c8d8 : 0xd8c8a8),
              seed: look.seed,
              gap: 0.55 + (look.freq - 2) * 0.3,
            },
            this.bodyUniforms,
          ),
        );
        ring.rotation.x = Math.PI / 2 + rng.range(-0.3, 0.3);
        mesh.add(ring);
      }

      const moons: PlanetVisual["moons"] = [];
      for (const m of pl.moons) {
        // Radio y órbita físicos (los mismos de las colisiones y la gravedad), de `@imperium/sim`.
        const moonRadius = m.body.radius;
        const moon = new THREE.Mesh(
          this.sphereLevel(moonRadius, 32),
          createPlanetMaterial(planetLook(m.type, `${summary.id}:${p.index}:m${m.index}`), moonRadius, this.bodyUniforms, false),
        );
        this.trackLod(moon, moonRadius);
        this.content.add(moon);
        moons.push({ mesh: moon, layout: m, name: `${p.name} ${String.fromCharCode(97 + m.index)}` });
      }

      const orbitLine = this.makeOrbit(radius);
      this.content.add(orbitLine, pivot);
      this.planets.push({ index: p.index, designation: p.name, label: null, layout: pl, pivot, mesh, orbitLine, moons });
    }
    radius = Math.max(radius, layout.boundary * 0.9);

    if (detail.anomaly) {
      const anomaly = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb57bff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      const a = rng.range(0, Math.PI * 2);
      anomaly.position.set(Math.cos(a) * radius, rng.range(-1, 1) * 200_000, Math.sin(a) * radius);
      anomaly.scale.setScalar(400_000);
      anomaly.userData.anomaly = true;
      this.content.add(anomaly);
    }

    // Cámara inicial: ver todo el sistema en diagonal.
    const extent = Math.max(40, radius);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, extent * 0.55, extent * 1.15);
    this.controls.maxDistance = extent * 3;
    this.controls.update();
  }

  /** Esfera de `radius` metros con `segments` segmentos (la mitad en vertical). */
  private sphereLevel(radius: number, segments: number): THREE.SphereGeometry {
    return new THREE.SphereGeometry(radius, segments, Math.max(8, segments / 2));
  }

  private trackLod(mesh: THREE.Mesh, radius: number): void {
    const geometry = mesh.geometry as THREE.SphereGeometry;
    this.lodBodies.push({ mesh, radius, levels: new Map([[geometry.parameters.widthSegments, geometry]]) });
  }

  /** Detalle según la calidad elegida y la distancia: segmentos de cada esfera y octavas del ruido. */
  private updateLod(): void {
    const detail = bodyDetailFor(settingsStore.getState().prefs.quality);
    this.bodyUniforms.uMaxOctaves.value = detail.maxOctaves;
    const center = new THREE.Vector3();
    for (const body of this.lodBodies) {
      const distance = this.camera.position.distanceTo(body.mesh.getWorldPosition(center)) / body.radius;
      const segments = bodySegments(distance, detail);
      if ((body.mesh.geometry as THREE.SphereGeometry).parameters.widthSegments === segments) continue;
      let geometry = body.levels.get(segments);
      if (!geometry) {
        geometry = this.sphereLevel(body.radius, segments);
        body.levels.set(segments, geometry);
      }
      body.mesh.geometry = geometry;
    }
  }

  private makeOrbit(radius: number): THREE.LineLoop {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x3fd0ff, transparent: true, opacity: 0.14, depthWrite: false }),
    );
  }

  private makeBelt(radius: number, halfWidth: number, rng: Rng): THREE.Points {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = radius + rng.bell() * halfWidth * 0.5;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rng.bell() * halfWidth * 0.12;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9a8f80, size: halfWidth * 0.004, sizeAttenuation: true }));
  }

  private clear(): void {
    this.stopPiloting();
    this.content.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    // Niveles de detalle que no estaban en uso (el actual ya se liberó arriba).
    for (const body of this.lodBodies) for (const g of body.levels.values()) g.dispose();
    this.lodBodies = [];
    this.content.clear();
    this.planets = [];
    this.selectRing.visible = false;
    this.hoveredPlanet = null;
  }

  get isPiloting(): boolean {
    return this.ship !== null;
  }

  /**
   * Órbita de aparcamiento de la nave propia en este sistema: la que dice el
   * servidor (tema `me`) o, si aún no ha llegado, la de por defecto.
   */
  private parkHere(): ParkedOrbit {
    const flagship = worldStore.getState().flagship;
    if (flagship && flagship.systemId === this.systemId) return sanitizePark(this.layout!, flagship.park);
    return defaultPark(this.layout!);
  }

  /**
   * Pone la nave del Emperador en el sistema y pasa a pilotarla. Sale de donde
   * está aparcada (orbitando la estrella; tras un salto, en el borde del sistema),
   * mirando a la estrella.
   */
  pilot(_from?: THREE.Vector3 | null): void {
    this.stopPiloting();
    if (!this.layout) return;
    const ship = createFlagship(0xc792ff);
    ship.scale.setScalar(SHIP_SCALE);
    ship.position.set(...parkedPosition(this.parkHere(), serverNow()));
    // Sin explorar, el sistema se dibuja sin planetas y su borde parece más cercano que el real:
    // la nave que llega de un salto (en el borde real) no debe salir nada más aparecer.
    this.boundary = Math.max(this.layout.boundary, ship.position.length() / ARRIVAL_EDGE + 1000);
    ship.lookAt(0, 0, 0);
    // lookAt orienta +Z hacia el objetivo; la nave mira hacia -Z.
    ship.rotateY(Math.PI);
    this.content.add(ship);
    this.ship = ship;
    const flight = new ShipController(ship, this.dom, this.keyboard);
    flight.enabled = true;
    // Gravedad de los cuerpos cercanos (esferas de influencia), en cada subpaso de la física.
    flight.gravity = (pos, out) => {
      const g = gravityAt([pos.x, pos.y, pos.z], this.gravitySources);
      out.set(g.acc[0], g.acc[1], g.acc[2]);
    };
    this.flight = flight;
    // Al tomar los mandos, los motores están apagados (salvo al llegar de un salto: ver `arriveFromJump`).
    this.engines = { state: "off", t: 0, from: 0 };
    flight.powered = false;
    this.leaving = false;
    this.controls.enabled = false;
    this.chase.reset();
    // Se volvió a dibujar el sistema en plena llegada (llegó su detalle): la salida de la grieta sigue.
    if (this.arrival) this.placeArrival();
    this.placeChaseCamera(1);
    gameStore.getState().setFlight(true, 0);
  }

  /**
   * La nave llega de un salto cuántico: se abre una grieta donde aparece y la
   * nave sale de ella (los demás del sistema la ven: se anuncia al servidor).
   * La cámara la recibe de frente y luego vuelve detrás.
   */
  arriveFromJump(): void {
    const ship = this.ship;
    if (!ship) return;
    const dir = this.forward();
    // Llega del túnel con los motores en marcha.
    this.engines = { state: "on", t: 0, from: 1 };
    if (this.flight) this.flight.powered = true;
    this.arrival = { t: 0, spawn: ship.position.clone(), dir, q: ship.quaternion.clone() };
    const reduce = settingsStore.getState().prefs.reduceEffects;
    this.rifts.open("self:arrive", ship.position, ship.quaternion, reduce).arrive();
    const { position: p, quaternion: q } = ship;
    connection.send({ t: "rift", phase: "arrive", at: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] });
    this.placeArrival();
    if (gameStore.getState().cameraView !== "first") this.chase.setOrbit(Math.PI * 0.82, 0.18);
    this.placeChaseCamera(1);
  }

  /** Posición de la nave en la salida de la grieta (sale despacio, frenando). */
  private placeArrival(): void {
    const a = this.arrival;
    const ship = this.ship;
    if (!a || !ship) return;
    const L = FLAGSHIP_LENGTH_M;
    const T = QUANTUM_RIFT.arriveSec;
    // Primero se abre la grieta; luego la nave sale y frena.
    const k = Math.max(0, Math.min(1, (a.t - 0.35) / (T - 0.35)));
    const ease = 1 - (1 - k) ** 3;
    ship.position.copy(a.spawn).addScaledVector(a.dir, -1.6 * L + 2.2 * L * ease);
    ship.quaternion.copy(a.q);
  }

  private updateArrival(dt: number): void {
    const a = this.arrival;
    if (!a || !this.ship || !this.flight) return;
    a.t += dt;
    this.flight.stop();
    this.placeArrival();
    shipRig(this.ship).setThrust(a.t < QUANTUM_RIFT.arriveSec * 0.7 ? 1 : 0.4, a.t < QUANTUM_RIFT.arriveSec * 0.5);
    if (a.t > QUANTUM_RIFT.arriveSec * 0.55) this.chase.reset();
    if (a.t >= QUANTUM_RIFT.arriveSec) this.arrival = null;
  }

  /**
   * Empieza la secuencia de salto cuántico hacia `target` desde la estrella en
   * `from` (coordenadas de la galaxia, que en la vista de sistema se usan como
   * direcciones): alinear la nave, cargar el motor y saltar.
   */
  startQuantum(target: StarSystemSummary, from: WorldPosition): void {
    if (!this.ship || !this.flight) return;
    this.cancelQuantum();
    const dir = new THREE.Vector3(target.position.x - from.x, target.position.y - from.y, target.position.z - from.z).normalize();
    this.flight.pulse = false;
    this.quantum = { target, dir, phase: "align", t: 0, riftSent: false };
    gameStore.getState().setQuantumTarget(target);
  }

  /** Interrumpe la secuencia de salto (o la limpia tras saltar). */
  cancelQuantum(): void {
    const q = this.quantum;
    if (!q) return;
    this.quantum = null;
    stopQuantumCharge();
    // Cancelado antes de saltar: la grieta se cierra (también para los demás).
    if (q.phase !== "depart") {
      this.rifts.close("self");
      if (q.riftSent && this.ship) {
        const { position: p, quaternion: r } = this.ship;
        connection.send({ t: "rift", phase: "cancel", at: [p.x, p.y, p.z], q: [r.x, r.y, r.z, r.w] });
      }
    }
    telemetry.quantumCharge = null;
    telemetry.quantumAlign = null;
    gameStore.getState().setQuantumTarget(null);
  }

  get quantumActive(): boolean {
    return this.quantum !== null;
  }

  /** Paso de la secuencia de salto: gira la nave hacia el destino, carga y avisa al motor. */
  private updateQuantum(dt: number): void {
    const q = this.quantum;
    const ship = this.ship;
    if (!q || !ship || !this.flight) return;
    // Mientras tanto la nave se detiene y no responde a los mandos.
    this.flight.stop();
    const fwd = this.forward();
    if (q.phase === "align" && this.engines.state !== "on") {
      // Sin motores no hay salto: se arrancan solos y luego se alinea.
      if (this.engines.state !== "starting") this.startEngines();
      return;
    }
    if (q.phase === "align") {
      const target = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), q.dir);
      ship.quaternion.rotateTowards(target, QUANTUM_ALIGN_RAD_PER_SEC * dt);
      const cos = fwd.dot(q.dir);
      telemetry.quantumAlign = (cos + 1) / 2;
      if (cos > Math.cos((1.5 * Math.PI) / 180)) {
        q.phase = "charge";
        q.t = 0;
        telemetry.quantumAlign = null;
        playQuantumCharge(QUANTUM_CHARGE_SEC);
        // La grieta se abre delante del morro, en el mundo: la ven todos los del sistema.
        const at = RiftField.ahead(ship.position, ship.quaternion);
        this.rifts.open("self", at, ship.quaternion, settingsStore.getState().prefs.reduceEffects);
        const r = ship.quaternion;
        connection.send({ t: "rift", phase: "charge", at: [at.x, at.y, at.z], q: [r.x, r.y, r.z, r.w] });
        q.riftSent = true;
      }
    } else if (q.phase === "charge") {
      q.t += dt;
      const k = Math.min(1, q.t / QUANTUM_CHARGE_SEC);
      telemetry.quantumCharge = k;
      this.rifts.get("self")?.setCharge(k);
      shipRig(ship).setThrust(0.3 + 0.7 * k, k > 0.5);
      if (k >= 1) {
        q.phase = "sent";
        this.events.onQuantumJump(q.target);
      }
    } else if (q.phase === "depart") {
      q.t += dt;
      shipRig(ship).setThrust(1, true);
      // Ya dentro: un instante para ver cerrarse la grieta y al túnel.
      if (q.t >= QUANTUM_RIFT.departSec + 0.35 && q.onDeparted) {
        const done = q.onDeparted;
        q.onDeparted = undefined;
        done();
      }
    }
  }

  /**
   * El servidor aceptó el salto: la grieta se abre del todo y la nave entra en
   * ella (los demás la ven entrar); al cruzarla, `onDeparted` (el túnel).
   */
  departQuantum(onDeparted: () => void): void {
    const q = this.quantum;
    const ship = this.ship;
    if (!q || !ship) return onDeparted();
    q.phase = "depart";
    q.t = 0;
    q.onDeparted = onDeparted;
    telemetry.quantumCharge = null;
    if (!this.rifts.get("self")) this.rifts.open("self", RiftField.ahead(ship.position, ship.quaternion), ship.quaternion, settingsStore.getState().prefs.reduceEffects);
    const reduce = settingsStore.getState().prefs.reduceEffects;
    this.rifts.swallow("self", ship, (s) => {
      s.visible = false;
      if (!reduce) this.effects.flash(s.position.clone(), FLAGSHIP_LENGTH_M * 8, 0.6, 0xbfd0ff);
    });
  }

  /** Deja de pilotar y vuelve a la cámara orbital. */
  stopPiloting(): void {
    if (!this.ship) return;
    this.cancelQuantum();
    stopEngineSound();
    // Deja de pilotar: la nave se queda aparcada aquí, orbitando (el servidor lo confirma por el tema `me`).
    connection.send({ t: "leave" });
    const flagship = worldStore.getState().flagship;
    // Solo si el servidor la tenía a los mandos (si no, su aparcamiento no ha cambiado).
    if (flagship && flagship.systemId === this.systemId && spaceStore.getState().systemId === this.systemId) {
      const p = this.ship.position;
      worldStore.setState({ flagship: { ...flagship, park: { p: [p.x, p.y, p.z], at: serverNow() } } });
    }
    resetSpace();
    this.remote.clear();
    this.effects.clear();
    this.targetRing.visible = false;
    this.flight?.dispose();
    this.flight = null;
    this.content.remove(this.ship);
    disposeShip(this.ship);
    this.ship = null;
    this.controls.enabled = true;
    this.cockpit.visible = false;
    this.dom.style.cursor = "";
    gameStore.getState().setFlight(false, 0);
  }

  /** Coloca la cámara del piloto; con `k` = 1, de golpe (al empezar o tras una corrección). */
  private placeChaseCamera(k: number): void {
    const ship = this.ship!;
    const first = gameStore.getState().cameraView === "first";
    // En primera persona el casco taparía la vista: se oculta la nave y se ve la cabina.
    ship.visible = !first;
    this.cockpit.visible = first;
    if (k >= 1) this.chase.snap(ship, first);
    else this.chase.place(ship, first, k);
  }

  /** Morro de la nave propia (vector unitario). */
  private forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship!.quaternion).normalize();
  }

  /** Enciende o apaga el motor de pulso. Se puede encender siempre: cerca de un cuerpo, simplemente va despacio. */
  private togglePulse(): void {
    const flight = this.flight;
    if (!flight) return;
    if (this.engines.state !== "on") return this.events.notify("pilot.enginesOffShort", "engines");
    if (!flight.pulse && this.outOfFuel()) return this.events.notify("pilot.noFuel");
    flight.pulse = !flight.pulse;
  }

  /** Potencia de los motores (0–1) según su estado. */
  private enginePower(): number {
    const e = this.engines;
    const M = FLIGHT_MODEL;
    if (e.state === "on") return 1;
    if (e.state === "off") return 0;
    if (e.state === "starting") return Math.min(1, e.from + e.t / M.engineStartSec);
    return Math.max(0, e.from - e.t / M.engineStopSec);
  }

  /** Arranca los motores (desde apagados o mientras se apagan). */
  private startEngines(): void {
    if (this.engines.state === "on" || this.engines.state === "starting") return;
    const from = this.enginePower();
    this.engines = { state: "starting", t: 0, from };
    playEngineStart(FLIGHT_MODEL.engineStartSec * (1 - from));
  }

  /** Tecla de los motores: arrancar o apagar. */
  private toggleEngines(): void {
    if (this.engines.state === "off" || this.engines.state === "stopping") return this.startEngines();
    const from = this.enginePower();
    if (this.flight) this.flight.pulse = false;
    this.engines = { state: "stopping", t: 0, from };
    playEngineStop(FLIGHT_MODEL.engineStopSec);
  }

  /** Avanza el arranque o el apagado y lo aplica a los mandos, el modelo y el HUD. */
  private updateEngines(dt: number): void {
    const e = this.engines;
    e.t += dt;
    const power = this.enginePower();
    if (e.state === "starting" && power >= 1) this.engines = { state: "on", t: 0, from: 1 };
    else if (e.state === "stopping" && power <= 0) this.engines = { state: "off", t: 0, from: 0 };
    const on = this.engines.state === "on";
    if (this.flight) this.flight.powered = on;
    telemetry.engines = this.engines.state;
    telemetry.enginePower = power;
    if (this.ship) {
      // Durante el arranque, la potencia titubea un poco (bombas y encendido).
      const jitter = this.engines.state === "starting" && power > 0.2 && power < 0.95 ? 0.85 + 0.15 * Math.sin(this.time * 31) : 1;
      shipRig(this.ship).setPower(power * jitter);
    }
    // Se intenta mover la nave con los motores apagados: se recuerda cómo arrancarlos.
    if (!on && this.engines.state !== "starting" && !this.quantum && !this.arrival && (["forward", "back", "boost", "pitchUp", "pitchDown", "turnLeft", "turnRight"] as const).some((a) => this.keyboard.action(a))) {
      if (this.time - this.enginesHintAt > 4) {
        this.enginesHintAt = this.time;
        this.events.notify("pilot.enginesOffShort", "engines");
      }
    }
  }

  /** Cambia un ajuste de pilotaje (asistencia, pilotaje con ratón) y lo avisa. */
  private toggleFlightPref(key: "assist" | "mouseFlight", on: I18nKey, off: I18nKey): void {
    const st = settingsStore.getState();
    const value = !st.prefs.flight[key];
    st.setPrefs({ flight: { ...st.prefs.flight, [key]: value } });
    // Al pasar a vuelo con ratón, la cámara vuelve detrás de la nave.
    if (key === "mouseFlight" && value) this.chase.reset();
    this.events.notify(value ? on : off);
  }

  /** Sin combustible (según el servidor) no hay pulso. */
  private outOfFuel(): boolean {
    const supplies = spaceStore.getState().supplies;
    return supplies !== null && supplies.fuel < 0.5;
  }

  /** Estrella, planetas y lunas con su posición actual (pulso, altímetro, gravedad y colisiones). */
  private bodies(): Array<{ name: string; center: THREE.Vector3; radius: number; planetIndex: number | null; body: CelestialBody }> {
    if (!this.layout) return [];
    const out = [{ name: this.starName, center: new THREE.Vector3(), radius: this.layout.starRadius, planetIndex: null as number | null, body: this.layout.star }];
    for (const p of this.planets) {
      out.push({ name: p.label ? p.label.key.split("|")[0]! : p.designation, center: p.mesh.getWorldPosition(new THREE.Vector3()), radius: p.layout.size, planetIndex: p.index, body: p.layout.body });
      for (const m of p.moons) out.push({ name: m.name, center: m.mesh.position.clone(), radius: m.layout.body.radius, planetIndex: null, body: m.layout.body });
    }
    return out;
  }

  /**
   * Límite del pulso según el rumbo y los cuerpos cercanos, y telemetría de
   * navegación: cuerpo más cercano y distancia y tiempo estimado hasta el
   * objetivo (planeta seleccionado, nave fijada o cuerpo que se tiene de frente).
   */
  private updateNavigation(): void {
    const flight = this.flight;
    const ship = this.ship;
    if (!flight || !ship) return;
    const pos = ship.position;
    const fwd = this.forward();
    const bodies = this.bodies();
    this.gravitySources = bodies.map((b) => ({ center: [b.center.x, b.center.y, b.center.z], body: b.body }));
    const grav = gravityAt([pos.x, pos.y, pos.z], this.gravitySources);
    telemetry.gravity = {
      g: flight.pulse ? 0 : grav.g,
      region: grav.region,
      body: grav.dominant ? (bodies.find((b) => b.body === grav.dominant)?.name ?? null) : null,
    };
    const heading = [fwd.x, fwd.y, fwd.z];
    flight.pulseLimit = pulseLimitAt([pos.x, pos.y, pos.z], heading, bodies.map((b) => ({ center: [b.center.x, b.center.y, b.center.z], radius: b.radius })));

    let nearest: FlightTelemetry["nearest"] = null;
    let ahead: { name: string; distance: number; at: THREE.Vector3 } | null = null;
    let bestAlign = Math.cos((8 * Math.PI) / 180);
    const selected = gameStore.getState().selectedPlanet;
    let target: { name: string; distance: number; at: THREE.Vector3 } | null = null;
    for (const b of bodies) {
      const surface = b.center.distanceTo(pos) - b.radius;
      if (!nearest || surface < nearest.distance) nearest = { name: b.name, distance: Math.max(0, surface) };
      const dir = b.center.clone().sub(pos).normalize();
      const align = dir.dot(fwd);
      if (align > bestAlign) {
        bestAlign = align;
        ahead = { name: b.name, distance: Math.max(0, surface), at: b.center };
      }
      if (b.planetIndex !== null && b.planetIndex === selected) target = { name: b.name, distance: Math.max(0, surface), at: b.center };
    }
    const locked = spaceStore.getState().targetId;
    const lockedAt = locked ? this.remote.positionOf(locked) : null;
    if (!target && locked && lockedAt) {
      const s = spaceStore.getState().ships[locked];
      target = { name: s ? shipName(s.state, gameStore.getState().locale) : "", distance: lockedAt.distanceTo(pos), at: lockedAt };
    }
    target ??= ahead;
    let eta: FlightTelemetry["eta"] = null;
    if (target) {
      const closing = flight.velocity.dot(target.at.clone().sub(pos).normalize());
      eta = { name: target.name, distance: target.distance, seconds: closing > 1 ? target.distance / closing : null };
    }
    telemetry.nearest = nearest;
    telemetry.eta = eta;
    telemetry.speed = flight.speed;
    telemetry.pulse = flight.pulse;
    telemetry.pulseLimit = flight.pulseLimit;
    telemetry.thrust = flight.thrust;
    // Actitud respecto al plano orbital (y = arriba) y rumbo respecto a la estrella.
    const up = new THREE.Vector3(0, 1, 0);
    telemetry.pitch = Math.asin(Math.max(-1, Math.min(1, fwd.dot(up))));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
    telemetry.roll = Math.atan2(-right.y, new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion).y);
    const toStar = pos.clone().negate().setY(0);
    const flat = fwd.clone().setY(0);
    telemetry.heading = toStar.lengthSq() > 0 && flat.lengthSq() > 0 ? Math.atan2(toStar.clone().cross(flat).y, toStar.dot(flat)) : 0;
  }

  /** Mantener la tecla dispara el cañón a su cadencia, hacia donde apunta el morro. */
  private fireCannon(): void {
    if (!this.keyboard.action("fireCannon") || this.flight?.pulse) return;
    // Sin proyectiles o sin energía, el servidor no dispararía: no se envía ni se dibuja.
    const { weapons, supplies } = spaceStore.getState();
    if (weapons.find((w) => w.kind === "cannon")?.ammo === 0) return;
    if (supplies && supplies.energy < FLAGSHIP_SUPPLIES.cannonEnergy) return;
    const now = performance.now();
    if (now < this.cannonReadyAt) return;
    const cannon = EMPEROR_FLAGSHIP.combat.weapons.find((w) => w.kind === "cannon");
    if (!cannon) return;
    this.cannonReadyAt = now + cannon.cooldownSec * 1000;
    const f = this.forward();
    connection.send({ t: "fire", weapon: "cannon", dir: [f.x, f.y, f.z] });
    // Se dibuja ya, desde la boca del cañón, con la velocidad de la nave sumada (como en el servidor).
    const muzzle = this.ownMuzzle("cannon", this.cannonIndex++);
    const speed = cannon.speedU + Math.max(0, this.flight!.velocity.dot(f));
    if (muzzle) this.effects.fireLocal(muzzle, f, speed, cannon.rangeU, serverNow());
    playCannon(1, true);
  }

  /** Sonido de un disparo según quién dispara y a qué distancia (el cañón propio ya sonó al pulsar). */
  private playShot(s: Extract<ServerMessage, { t: "shot" }>): void {
    if (!this.ship) return;
    const own = s.id === worldStore.getState().myEmperorId;
    const gain = own ? 1 : distanceGain(this.ship.position.distanceTo(new THREE.Vector3(...s.from)));
    if (s.weapon === "missile") playMissile(gain);
    else if (!own) playCannon(gain, false);
    if (s.hitAt !== null) {
      // El impacto, cuando llega, donde tenga sentido oírlo: cerca de la nave propia o del tirador.
      const myId = worldStore.getState().myEmperorId;
      const hitGain = s.target === myId ? 1 : gain;
      setTimeout(() => playHit(hitGain), Math.max(0, s.hitAt - serverNow()));
    }
  }

  /** Boca de un arma de la nave propia, en el mundo. */
  private ownMuzzle(weapon: WeaponKind, index: number): THREE.Vector3 | null {
    return this.ship ? shipRig(this.ship).muzzle(weapon, index, new THREE.Vector3()) : null;
  }

  /** Lanza un misil al objetivo fijado (el servidor comprueba alcance, ángulo y munición). */
  private fireMissile(): void {
    const target = spaceStore.getState().targetId;
    if (!target) return this.events.notify("combat.noMissileTarget", "lockTarget");
    const f = this.forward();
    connection.send({ t: "fire", weapon: "missile", dir: [f.x, f.y, f.z], target });
  }

  /** Fija el siguiente enemigo, del más cercano al más lejano. */
  private cycleTarget(): void {
    const { ships, targetId } = spaceStore.getState();
    const me = this.ship!.position;
    const enemies = Object.values(ships)
      .filter((s) => !s.state.ally)
      .map((s) => ({ id: s.state.id, d: this.remote.positionOf(s.state.id)?.distanceTo(me) ?? Infinity }))
      .sort((a, b) => a.d - b.d);
    if (enemies.length === 0) return spaceStore.setState({ targetId: null });
    const i = enemies.findIndex((e) => e.id === targetId);
    spaceStore.setState({ targetId: enemies[(i + 1) % enemies.length]!.id });
  }

  /** Disparos, explosiones y recuadro del objetivo. */
  private updateCombatVisuals(dt: number): void {
    const state = spaceStore.getState();
    if (state.shots.length || state.explosions.length) {
      for (const s of state.shots) {
        this.effects.add(s, serverNow());
        this.playShot(s);
      }
      for (const e of state.explosions) {
        this.effects.explode(e);
        if (this.ship) playExplosion(distanceGain(this.ship.position.distanceTo(new THREE.Vector3(...e))));
      }
      spaceStore.setState({ shots: [], explosions: [] });
    }
    const myId = worldStore.getState().myEmperorId;
    this.effects.update(dt, serverNow(), (id) => (id === myId ? (this.ship?.position ?? null) : this.remote.positionOf(id)));
    const target = state.targetId ? this.remote.positionOf(state.targetId) : null;
    this.targetRing.visible = target !== null;
    if (target) this.targetRing.position.copy(target);
  }

  /**
   * Grietas de otras naves del sistema: se abren al cargar, se cierran si
   * cancelan, se las ve entrar al saltar (su nave acelera hacia la grieta y
   * desaparece) y se abre otra cuando llegan.
   */
  private updateRemoteRifts(): void {
    const events = spaceStore.getState().rifts;
    if (events.length === 0) return;
    spaceStore.setState({ rifts: [] });
    const reduce = settingsStore.getState().prefs.reduceEffects;
    const me = this.ship?.position;
    for (const e of events) {
      const gain = me ? distanceGain(me.distanceTo(new THREE.Vector3(...e.at))) : 0.3;
      if (e.phase === "charge") this.rifts.open(e.id, e.at, e.q, reduce);
      else if (e.phase === "cancel") this.rifts.close(e.id);
      else if (e.phase === "arrive") {
        this.rifts.open(`${e.id}:arrive`, e.at, e.q, reduce).arrive();
        playQuantumTear(0.5 * gain);
      } else {
        // Saltó: entra en su grieta (si no se vio cargar, se abre ahora delante de ella).
        const ship = this.remote.detach(e.id);
        const p = ship?.position.clone() ?? new THREE.Vector3(...e.at);
        const q = ship?.quaternion.clone() ?? new THREE.Quaternion(...e.q);
        if (!this.rifts.get(e.id) || this.rifts.get(e.id)!.closing) this.rifts.open(e.id, RiftField.ahead(p, q), q, reduce);
        playQuantumTear(gain);
        if (ship) {
          this.rifts.swallow(e.id, ship, (s) => {
            if (!reduce) this.effects.flash(s.position.clone(), FLAGSHIP_LENGTH_M * 8, 0.6, 0xbfd0ff);
            this.remote.discard(s as THREE.Group);
          });
        } else {
          this.rifts.get(e.id)!.burst();
          setTimeout(() => this.rifts.close(e.id), QUANTUM_RIFT.departSec * 1000);
        }
      }
    }
  }

  /** La nave propia ha caído: explosión donde estaba. El motor la hace renacer. */
  explodeOwnShip(): void {
    if (!this.ship) return;
    this.effects.explode(this.ship.position.clone());
  }

  /**
   * Rótulos de los planetas: su nombre (el que les puso su dueño, si lo hay) en
   * dorado si son tuyos, en naranja si son de otro y en gris si están libres. A
   * esta escala, de lejos los planetas son puntos: el rótulo ayuda a orientarse.
   */
  private updatePlanetLabels(): void {
    const { claims, systemId } = claimsStore.getState();
    const colonies = worldStore.getState().colonies;
    const tmp = new THREE.Vector3();
    for (const p of this.planets) {
      const own = this.systemId ? ownColonyAt(colonies, this.systemId, p.index) : undefined;
      const claim = systemId === this.systemId ? claims[p.index] : undefined;
      const name = planetLabel({ name: p.designation, index: p.index }, claim, own);
      const color = own ? "#e8b64c" : claim ? "#ff9f5a" : "#b9c3d6";
      const key = `${name}|${color}`;
      if (p.label?.key !== key) {
        if (p.label) {
          this.content.remove(p.label.sprite);
          p.label.sprite.material.map?.dispose();
          p.label.sprite.material.dispose();
        }
        const { texture, aspect } = labelTexture(name, color);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: false, transparent: true, opacity: 0.85 }));
        sprite.scale.set(0.024 * aspect, 0.024, 1);
        sprite.center.set(0.5, -0.9);
        sprite.renderOrder = 9;
        this.content.add(sprite);
        p.label = { sprite, key };
      }
      p.label.sprite.position.copy(p.mesh.getWorldPosition(tmp));
    }
  }

  /** El servidor rechazó una posición imposible: la nave vuelve a la última válida. */
  private applyCorrection(): void {
    const c = spaceStore.getState().correction;
    if (!c || !this.ship) return;
    spaceStore.setState({ correction: null });
    this.ship.position.set(...c.p);
    this.ship.quaternion.set(...c.q);
    this.flight?.stop();
    // Aún sin subir a bordo: el servidor dice dónde está aparcada la nave (manda sobre lo que se creía).
    const flagship = worldStore.getState().flagship;
    if (flagship && flagship.systemId === this.systemId && spaceStore.getState().systemId !== this.systemId) {
      worldStore.setState({ flagship: { ...flagship, park: { p: [...c.p], at: serverNow() } } });
    }
    // La cámara salta con la nave (si no, tardaría en alcanzarla y la nave se vería diminuta).
    this.placeChaseCamera(1);
  }

  /**
   * Hasta que el servidor acepta la nave en el sistema, se sigue la posición de
   * aparcamiento que diga (puede llegar después de empezar a pilotar).
   */
  private followParkUntilBoarded(): void {
    if (!this.ship || spaceStore.getState().systemId === this.systemId) return;
    const flagship = worldStore.getState().flagship;
    if (!flagship || flagship.systemId !== this.systemId) return;
    const at = new THREE.Vector3(...parkedPosition(flagship.park, serverNow()));
    if (at.distanceTo(this.ship.position) < 2000) return;
    this.ship.position.copy(at);
    this.ship.lookAt(0, 0, 0);
    this.ship.rotateY(Math.PI);
    this.flight?.stop();
    this.boundary = Math.max(this.layout?.boundary ?? 0, at.length() / ARRIVAL_EDGE + 1000);
    this.placeChaseCamera(1);
  }

  /** Envía la posición propia unas 8 veces por segundo. */
  private sendPose(dt: number): void {
    this.poseTimer -= dt;
    if (this.poseTimer > 0 || !this.ship || !this.systemId || !this.flight) return;
    this.poseTimer = POSE_INTERVAL;
    const { position: p, quaternion: q } = this.ship;
    const v = this.flight.velocity;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    connection.send({ t: "pose", systemId: this.systemId, p: [r(p.x), r(p.y), r(p.z)], q: [r(q.x), r(q.y), r(q.z), r(q.w)], v: [r(v.x), r(v.y), r(v.z)] });
  }

  /**
   * Evita atravesar la estrella, los planetas y las lunas: la nave se queda
   * sobre su superficie (con el radio físico, el mismo de la gravedad) y pierde
   * la velocidad que llevaba hacia dentro.
   */
  private collide(): void {
    const ship = this.ship!;
    const normal = new THREE.Vector3();
    for (const b of this.bodies()) {
      const radius = b.body.kind === "star" ? b.radius * 1.05 : b.radius + FLAGSHIP_LENGTH_M * 0.6;
      const d = ship.position.distanceTo(b.center);
      if (d >= radius || d === 0) continue;
      normal.copy(ship.position).sub(b.center).divideScalar(d);
      ship.position.copy(b.center).addScaledVector(normal, radius);
      const v = this.flight!.velocity;
      const inward = v.dot(normal);
      if (inward < 0) v.addScaledVector(normal, -inward);
    }
  }

  activate(): void {
    this.controls.enabled = !this.ship;
    if (this.flight) this.flight.enabled = true;
  }

  deactivate(): void {
    this.controls.enabled = false;
    if (this.flight) {
      this.flight.enabled = false;
      this.flight.stop();
    }
    this.dom.style.cursor = "";
  }

  update(dt: number): void {
    this.time += dt;
    // El tiempo de los shaders da la vuelta para no perder precisión en sesiones largas.
    this.bodyUniforms.uTime.value = this.time % 100_000;
    const now = serverNow();
    const selected = gameStore.getState().selectedPlanet;
    const center = new THREE.Vector3();
    for (const p of this.planets) {
      p.pivot.rotation.y = planetAngle(p.layout, now);
      // Rotación sobre su eje con la hora del servidor (periodos de 14 a 60 h).
      p.mesh.rotation.y = planetSpinAngle(p.layout, now);
      p.pivot.updateMatrixWorld(true);
      p.mesh.getWorldPosition(center);
      for (const m of p.moons) {
        const o = moonOffset(m.layout, now);
        m.mesh.position.set(center.x + o.x, center.y + o.y, center.z + o.z);
      }
      const mat = p.orbitLine.material as THREE.LineBasicMaterial;
      mat.opacity = p.index === selected ? 0.55 : p.index === this.hoveredPlanet ? 0.32 : 0.14;
      mat.color.setHex(p.index === selected ? 0xe8b64c : 0x3fd0ff);
    }
    this.updatePlanetLabels();
    const sel = this.planets.find((p) => p.index === selected);
    if (sel) {
      sel.mesh.getWorldPosition(this.selectRing.position);
      this.selectRing.visible = true;
    } else {
      this.selectRing.visible = false;
    }
    if (this.ship && this.flight) {
      if (this.flight.pulse && this.outOfFuel()) {
        this.flight.pulse = false;
        this.events.notify("pilot.noFuel");
      }
      this.updateNavigation();
      const departing = this.quantum?.phase === "depart";
      this.updateEngines(dt);
      if (this.quantum) this.updateQuantum(dt);
      else if (this.arrival) this.updateArrival(dt);
      else this.flight.update(dt);
      if (!departing) {
        this.collide();
        this.applyCorrection();
        this.followParkUntilBoarded();
        // Al saltar, el servidor ya la sacó del sistema: no se envían más posiciones.
        this.sendPose(dt);
      }
      this.updateRemoteRifts();
      this.remote.update(dt, this.time);
      const rig = shipRig(this.ship);
      if (!this.quantum && !this.arrival) rig.setThrust(this.flight.thrust, this.flight.pulse);
      // Propulsores de maniobra del modelo, si los tiene (lo expone el generador de naves).
      (rig as { setManeuver?: (m: Maneuver) => void }).setManeuver?.(this.flight.maneuver);
      rig.tick(this.time, dt, this.quantum || this.arrival ? 0 : Math.max(0, 1 - this.flight.speed / 20));
      if (!this.quantum && !this.arrival) this.fireCannon();
      this.updateCombatVisuals(dt);
      // Al entrar en la grieta, la cámara exterior se queda quieta y la ve alejarse; en cabina, entra con ella.
      if (!departing || gameStore.getState().cameraView === "first") this.placeChaseCamera(1 - Math.exp(-dt * 8));
      telemetry.freeCam = this.chase.free && gameStore.getState().cameraView !== "first";
      // Vuelo con ratón: el cursor es la retícula (una cruz); en cámara libre, el de siempre.
      const mouseFlight = settingsStore.getState().prefs.flight.mouseFlight;
      const cursor = mouseFlight ? "crosshair" : "";
      if (this.dom.style.cursor !== cursor) this.dom.style.cursor = cursor;
      gameStore.getState().setFlight(true, this.flight.speed, this.flight.pulse);
      // Más allá del borde: espacio interestelar.
      if (!this.leaving && this.layout && this.ship.position.length() > this.boundary) {
        this.leaving = true;
        this.events.onLeave(this.ship.position.clone().normalize());
      }
    } else {
      this.controls.update();
    }
    this.rifts.update(dt, this.time, this.ship?.position ?? this.camera.position);
    this.fleetScene.update(dt, this.time);
    if (this.pendingBattleFocus && !this.ship) {
      const at = this.fleetScene.battlePosition(this.pendingBattleFocus);
      if (at) {
        this.pendingBattleFocus = null;
        this.controls.target.copy(at);
        this.camera.position.set(at.x + 3000, at.y + 2200, at.z + 5200);
        this.controls.update();
      }
    }
    this.backdrop.follow(this.camera);
    this.updateLod();
  }

  /** Lleva la cámara (modo observar) a una batalla de flotas de este sistema en cuanto se dibuje. */
  focusBattle(battleId: string): void {
    this.pendingBattleFocus = battleId;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private pickPlanet(x: number, y: number): number | null {
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hits = this.raycaster.intersectObjects(this.planets.map((p) => p.mesh), false);
    const first = hits[0];
    return first ? (first.object.userData.planetIndex as number) : null;
  }

  onClick(x: number, y: number): void {
    gameStore.getState().selectPlanet(this.pickPlanet(x, y));
  }

  onDoubleClick(x: number, y: number): void {
    const idx = this.pickPlanet(x, y);
    const p = this.planets.find((pl) => pl.index === idx);
    if (!p) return;
    const pos = new THREE.Vector3();
    p.mesh.getWorldPosition(pos);
    this.controls.target.copy(pos);
  }

  onHover(x: number, y: number): void {
    this.hoveredPlanet = this.pickPlanet(x, y);
    // En vuelo con ratón el cursor es la retícula.
    if (this.ship && settingsStore.getState().prefs.flight.mouseFlight) return;
    this.dom.style.cursor = this.hoveredPlanet !== null ? "pointer" : "";
  }

  onKey(code: string): void {
    if (this.ship) {
      if (isBound("cameraView", code)) gameStore.getState().toggleCameraView();
      else if (this.quantum && (code === "Escape" || isBound("jump", code))) {
        // Una vez dada la orden de salto ya no se puede cancelar (el servidor la tiene).
        if (this.quantum.phase === "align" || this.quantum.phase === "charge") this.cancelQuantum();
      }
      else if (this.quantum) return;
      else if (isBound("engines", code)) this.toggleEngines();
      else if (isBound("pulse", code)) this.togglePulse();
      else if (isBound("cameraReset", code)) this.chase.reset();
      else if (isBound("flightAssist", code)) this.toggleFlightPref("assist", "pilot.assistOn", "pilot.assistOff");
      else if (isBound("mouseFlight", code)) this.toggleFlightPref("mouseFlight", "pilot.mouseFlightOn", "pilot.mouseFlightOff");
      else if (isBound("lockTarget", code)) this.cycleTarget();
      else if (isBound("fireMissile", code)) this.fireMissile();
      return;
    }
    if (code === "Escape" || code === "Backspace") this.events.onExit();
  }

  dispose(): void {
    this.stopPiloting();
    this.rifts.dispose();
    this.fleetScene.clear();
    this.clear();
    this.controls.dispose();
    this.chase.dispose();
  }
}
