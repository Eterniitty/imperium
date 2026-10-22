import * as THREE from "three";
import { escapeJustUnlocked, pointerXY } from "./pointerLock";
import { flightSound, playCruiseArrive } from "../audio/flightSfx";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Rng, STAR_CLASSES, hashString } from "@imperium/procgen";
import type { FlagshipStatus, Fleet, I18nKey, ServerMessage, StarSystemDetail, StarSystemSummary, ShipDesignSnapshot, WeaponKind, WorldPosition } from "@imperium/shared";
import { ARRIVAL_EDGE, deepLayout, designStats, starHeatDps, defaultPark, moonOffset, parkedPosition, parkAt, PULSE_MAX_SPEED, planetAngle, planetSpinAngle, pulseLimitAt, sanitizePark, gravityAt, type GravitySource, systemLayout, type CelestialBody, type MoonLayout, type ParkedOrbit, type PlanetLayout, type SystemLayout } from "@imperium/sim";
import { resetSpace, shipName, spaceStore, type SelectedWeapon } from "../net/space";
import { TargetAssist, relationOf, type CannonAim } from "./TargetAssist";
import { telemetry, type FlightTelemetry } from "./telemetry";
import { authStore } from "../state/auth";
import { connection, serverNow } from "../net/world";
import { RemoteShips } from "./RemoteShips";
import { FleetScene } from "./FleetScene";
import { createDesignModel, createShipModel, designLook, shipLength } from "./shipFactory";
import { ShieldDome } from "./fx/shieldDome";
import { Effects } from "./Effects";
import { worldStore } from "../net/world";
import { BODY_COLLISION, EMPEROR_FLAGSHIP, FLIGHT_MODEL, FLAGSHIP_HIT_RADIUS_M, FLAGSHIP_LENGTH_M, FLAGSHIP_SUPPLIES, MINING, QUANTUM_ALIGN_RAD_PER_SEC, QUANTUM_CHARGE_SEC, QUANTUM_RIFT, SHIP_COLLISION, STAR_HEAT_LETHAL_DPS, FLAGSHIP_DOCK } from "@imperium/content";
import { playQuantumCharge, playQuantumTear, stopQuantumCharge } from "../audio/quantumSfx";
import { playEngineStart, playEngineStop, stopEngineSound } from "../audio/engineSfx";
import { RiftField } from "./fx/riftPortal";
import { playMiningPulse } from "../audio/miningSfx";
import { DeepField } from "./DeepField";
import { distanceGain, playCannon, playExplosion, playHit, playMissile } from "../audio/combatSfx";
import { isBound, settingsStore, SPEED_MODES, type Action } from "../state/settings";
import { gameStore } from "../state/store";
import { Backdrop } from "./Backdrop";
import { ShipController, type Maneuver } from "./ShipController";
import { ChaseCamera } from "./ChaseCamera";
import type { Keyboard } from "./input";
import { createFlagship, disposeShip, SHIP_SCALE, shipRig } from "./shipModel";
import { createCockpit } from "./cockpit";
import { glowTexture, labelTexture, ringTexture } from "./textures";
import { BLACK_HOLE_SHELL, CORONA_SCALE, FLAME_SCALE, STAR_SPIN_PERIOD_SEC, createBlackHoleMaterial, createStarFlameMaterial, createAtmosphereMaterial, createBodyUniforms, createCoronaMaterial, createPlanetMaterial, createRingMaterial, createStarSurfaceMaterial } from "./bodyMaterials";
import { bodyDetailFor, bodySegments, planetLook } from "./planetLook";
import { claimsStore } from "../state/claims";
import { ownColonyAt, planetLabel } from "../ui/colonies";
import type { View } from "./View";
import { Autopilot, cruiseCatalog, type CruiseObstacle, type CruiseSources, type CruiseSpot } from "./Autopilot";
import { keyLabel } from "../state/settings";
import { translate, type AnomalyType } from "@imperium/shared";

/** Mandos manuales que desactivan el piloto automático. */
const MANUAL_ACTIONS: Action[] = ["forward", "back", "strafeLeft", "strafeRight", "up", "down", "rollLeft", "rollRight", "turnLeft", "turnRight", "pitchUp", "pitchDown", "boost"];

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
  onQuantumJump(target: StarSystemSummary, near: string | null): void;
  /** La nave cruzó el borde del sistema: pasar al espacio interestelar. `direction` es hacia dónde salió. */
  onLeave(direction: THREE.Vector3): void;
  /** Aviso breve; `keyAction` añade como parámetro `key` la tecla de esa acción. */
  notify(key: I18nKey, keyAction?: Action): void;
}

/** Cada cuánto se envía la posición propia al servidor mientras se pilota. */
const POSE_INTERVAL = 0.125;
/** Apertura de la cámara del sistema sin efectos (grados). */
const BASE_FOV = 50;
/** Aceleración (m/s²) y giro (°/s) de un diseño del Astillero que equivalen al vuelo normal (`FLIGHT_MODEL`). */
const DESIGN_REF_ACCEL = 6;
const DESIGN_REF_TURN = 45;

function smoothstep(a: number, b: number, x: number): number {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** Acciones del piloto que se pueden hacer con una tecla o con un botón (`SystemView.runAction`). */
export const PILOT_ACTIONS = [
  "cruise",
  "follow",
  "dock",
  "engines",
  "pulse",
  "cameraReset",
  "flightAssist",
  "mouseFlight",
  "lockTarget",
  "targetNext",
  "targetPrev",
  "targetNearest",
  "autoFire",
  "weaponCannon",
  "weaponMissile",
  "weaponLaser",
  "fireMissile",
  "speedMode",
] as const satisfies readonly Action[];
export type PilotAction = (typeof PILOT_ACTIONS)[number];

/** Aparcamiento local (hasta que llegue el del servidor): como `parkAt` del servidor, con ancla, orientación y motores. */
function localPark(layout: SystemLayout | null, p: [number, number, number], q: [number, number, number, number], engines: boolean): FlagshipStatus["park"] {
  const k = parkAt(layout, p, serverNow(), { q, engines });
  return { p: [k.p[0], k.p[1], k.p[2]], at: k.at, ...(k.anchor ? { anchor: k.anchor } : {}), q, engines };
}

/** Margen de alineación antes de la carga al adelantar un salto en segundo plano (s). */
const QUANTUM_ALIGN_MAX_SEC = 9;

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
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 1e11);
  readonly controls: OrbitControls;

  private content = new THREE.Group();
  // Más lejos que cualquier planeta o estrella del sistema (km): si no, las estrellas del fondo tapan los planetas.
  private backdrop = new Backdrop(5e10, 4242);
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
  /** La estrella del sistema: su superficie (giro), su corona y el resplandor que crece al acercarse. */
  private starFx: { surface: THREE.ShaderMaterial; corona: THREE.ShaderMaterial; radius: number; flames: THREE.Mesh | null; blackHole: THREE.Mesh | null } | null = null;
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
  private quantum: {
    target: StarSystemSummary;
    /** Compañero junto al que se quiere llegar (memoria de posición), o null. */
    near: string | null;
    dir: THREE.Vector3;
    phase: "align" | "charge" | "sent" | "depart";
    t: number;
    riftSent: boolean;
    onDeparted?: () => void;
    /** Hora real (performance.now) en que se pidió el salto: en segundo plano, la preparación se cumple por reloj. */
    startedAt: number;
  } | null = null;
  /**
   * Llegada de un salto: la nave sale de una grieta abierta en `spawn` (donde
   * aparece), desde `L` esloras por detrás; los mandos esperan a que salga.
   */
  private arrival: { t: number; spawn: THREE.Vector3; dir: THREE.Vector3; q: THREE.Quaternion } | null = null;
  /** Grietas del salto cuántico (la propia y las de otras naves), en el mundo. */
  readonly rifts = new RiftField();
  /** Naves ajenas que llegan de un salto y aún no se dibujan: saldrán de su grieta como un rayo. */
  private pendingEmerge = new Map<string, { at: THREE.Vector3; t: number }>();
  /** Sacudida de la cámara aplicada en el último fotograma (se deshace antes de colocarla). */
  private shakeQ = new THREE.Quaternion();
  /** Eslora y radio de impacto de la nave propia (la insignia, o la nave de flota pilotada a distancia). */
  private ownLength = FLAGSHIP_LENGTH_M;
  private ownRadius = FLAGSHIP_HIT_RADIUS_M;
  /** Se pilota a distancia una nave de flota (no salta, no aparca ni mina). */
  private remotePiloting = false;
  /** Acoplada pero sin ver aún su nodriza (recién llegada de un viaje con la flota). */
  private dockMissingSince: number | null = null;
  /** Cúpula del escudo propio y el escudo que tenía en el fotograma anterior (para ver los impactos). */
  private dome: ShieldDome | null = null;
  private lastShield = -1;
  /** Sacudida por un choque (0–1); se apaga en medio segundo. */
  private impactShake = 0;
  /** Retroceso de los disparos propios (0–1): sacude y empuja la cámara un instante. */
  private fireKick = 0;
  /** Fase del piloto automático en el fotograma anterior (para avisar al entrar en órbita). */
  private lastCruisePhase = "";
  /** Naves cuya grieta de llegada anunciada ya se usó (para no cerrarla a destiempo). */
  private arrivedRifts = new Set<string>();
  /**
   * Motores de la nave propia: al tomar los mandos están apagados y hay que
   * arrancarlos (tecla «engines»); `t` es el tiempo en el estado actual.
   */
  private engines: { state: "off" | "starting" | "on" | "stopping"; t: number; from: number } = { state: "off", t: 0, from: 0 };
  /** Para no repetir el aviso de «motores apagados» a cada fotograma. */
  private enginesHintAt = 0;
  /** Asistencia de puntería: marcadores, fijar blanco, adelanto y puntería automática del cañón. */
  private assist: TargetAssist;
  /** Puntería del cañón al blanco fijado en este fotograma (null sin blanco). */
  private cannonAim: CannonAim | null = null;
  /** Botón izquierdo pulsado disparando el arma seleccionada (no mueve la cámara ni selecciona). */
  private mouseFiring = false;
  /** El último clic izquierdo fue un disparo: no selecciona planeta al soltarlo. */
  private clickWasShot = false;
  /** Cadencia local del cañón: no se envían disparos que el servidor rechazaría. */
  private cannonReadyAt = 0;
  /** Flotas propias paradas y batallas de flotas en 3D (solo se dibujan). */
  private fleetScene = new FleetScene((at) => this.effects.explode(at));
  /** Batalla a la que llevar la cámara en cuanto se dibuje. */
  private pendingBattleFocus: string | null = null;
  /** Espacio profundo: la región que se ve (o null en un sistema estelar), sus asteroides y la minería. */
  private deepId: string | null = null;
  private deep = new DeepField();
  /** Asteroide que mina el láser propio (null: apagado), cuenta atrás del próximo pulso y de la puntería. */
  private miningAt: number | null = null;
  private mineTimer = 0;
  private aimTimer = 0;
  private outOfRangeWarned = false;
  /** Piloto automático de crucero (ir a un sitio o seguir a otra nave) y su marcador en el destino. */
  private autopilot = new Autopilot();
  private cruiseMarker: THREE.Sprite;
  /** Cursor al activar el piloto automático (en vuelo con ratón, moverlo lo cancela). */
  private cruiseCursor: { x: number; y: number } | null = null;
  /** Anomalía del sistema (destino del crucero). */
  private anomaly: { type: AnomalyType; at: THREE.Vector3 } | null = null;

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

    this.cruiseMarker = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color: 0x5fd3e6, depthTest: false, sizeAttenuation: false, transparent: true, opacity: 0.8 }),
    );
    this.cruiseMarker.scale.setScalar(0.045);
    this.cruiseMarker.visible = false;
    this.cruiseMarker.renderOrder = 11;
    this.scene.add(this.cruiseMarker);
    this.assist = new TargetAssist(dom);
    dom.addEventListener("pointerdown", this.onCombatDown);
    window.addEventListener("pointerup", this.onCombatUp);
    dom.addEventListener("wheel", this.onCombatWheel, { passive: false });
    this.scene.add(this.backdrop.object, this.content, this.selectRing, this.remote.group, this.effects.group, this.fleetScene.group, this.rifts.group, this.deep.group);
    this.scene.add(new THREE.AmbientLight(0x5a6688, 0.9));
    // Cabina en primera persona: cuelga de la cámara (por eso la cámara va en la escena).
    this.cockpit.visible = false;
    this.camera.add(this.cockpit);
    // Luz de relleno desde la cámara (algo por encima y a un lado): deja ver la cara de las naves que no da al
    // sol, sin borrar la sombra. Los planetas y lunas tienen su propia luz en el shader y no la reciben.
    const fill = new THREE.DirectionalLight(0xd0d4dc, 0.6);
    fill.position.set(-0.4, 0.5, 0);
    fill.target.position.set(0, 0, -1);
    this.camera.add(fill, fill.target);
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
      this.pendingEmerge.clear();
      this.arrival = null;
    }
    this.layout = layout;
    this.systemId = summary.id;
    // Cada sistema, su cielo (nebulosas y galaxias), siempre el mismo.
    this.backdrop.setSeed(hashString(summary.id));
    this.backdrop.setGalaxyPosition(summary.position);
    this.fleetScene.setSystem(summary.id, layout);
    this.starName = summary.name;

    // Estrella: superficie con granulado y manchas, y corona que no tapa el disco.
    const isBlackHole = summary.starClass === "BH";
    const starRadius = layout.starRadius;
    // Semilla propia (no consume `rng`, para no alterar el resto del sistema).
    const starRng = new Rng(hashString(`star:${summary.id}`));
    const starSeed = new THREE.Vector3(starRng.range(-50, 50), starRng.range(-50, 50), starRng.range(-50, 50));
    this.bodyUniforms.uSunColor.value.copy(starColor).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(isBlackHole ? 0.35 : 1);
    const surface = createStarSurfaceMaterial(starColor, starSeed, isBlackHole, this.bodyUniforms);
    const star = new THREE.Mesh(this.sphereLevel(starRadius, 64), surface);
    this.content.add(star);
    this.trackLod(star, starRadius);
    const coronaMat = createCoronaMaterial(isBlackHole ? new THREE.Color(0xb98cff) : starColor, starRadius, starSeed, isBlackHole, this.bodyUniforms);
    const corona = new THREE.Mesh(new THREE.SphereGeometry(starRadius * CORONA_SCALE, 64, 32), coronaMat);
    corona.renderOrder = 1;
    this.content.add(corona);
    // Llamas en 3D: salen de la superficie y rompen la silueta (no en los agujeros negros).
    let flames: THREE.Mesh | null = null;
    if (!isBlackHole) {
      flames = new THREE.Mesh(new THREE.SphereGeometry(starRadius * FLAME_SCALE, 64, 32), createStarFlameMaterial(starColor, starRadius, starSeed, surface.uniforms.uSpin as THREE.IUniform<number>, this.bodyUniforms));
      flames.renderOrder = 2;
      this.content.add(flames);
    }
    this.starFx = { surface, corona: coronaMat, radius: starRadius, flames, blackHole: null };

    // Agujero negro: sombra, disco de acreción con lente gravitatoria y anillo de fotones (BLACK_HOLE_FRAGMENT).
    if (isBlackHole) {
      let blackHole: THREE.Mesh;
      corona.visible = false;
      blackHole = new THREE.Mesh(new THREE.SphereGeometry(starRadius * BLACK_HOLE_SHELL, 96, 48), createBlackHoleMaterial(starRadius, starSeed, this.bodyUniforms));
      blackHole.renderOrder = 3;
      this.content.add(blackHole);
      if (this.starFx) this.starFx.blackHole = blackHole;
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
      this.anomaly = { type: detail.anomaly, at: anomaly.position };
    }

    // Cámara inicial: ver todo el sistema en diagonal.
    const extent = Math.max(40, radius);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, extent * 0.55, extent * 1.15);
    this.controls.maxDistance = extent * 3;
    this.controls.update();
  }

  /**
   * Región de espacio profundo (salida del túnel a mitad de viaje): sin
   * estrella ni planetas, solo el fondo y, si los hay, los asteroides que
   * manda el servidor al subir a bordo (mensaje `field`).
   */
  buildDeep(regionId: string): void {
    this.clear();
    const layout = deepLayout();
    this.layout = layout;
    this.systemId = regionId;
    this.deepId = regionId;
    this.backdrop.setSeed(hashString(regionId));
    this.deep.light.visible = true;
    this.fleetScene.setSystem(regionId, layout);
    this.starName = "";
    this.bodyUniforms.uSunColor.value.setRGB(0.8, 0.85, 1);
    const field = spaceStore.getState().field;
    if (field?.regionId === regionId) this.deep.set(field);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 6_000, 14_000);
    this.controls.maxDistance = 200_000;
    this.controls.update();
  }

  /** ¿Se está viendo una región de espacio profundo? */
  get inDeepSpace(): boolean {
    return this.deepId !== null;
  }

  /**
   * Láser de minería: mientras se mantiene su tecla (sin pulso ni salto), un
   * pulso al servidor por intervalo con el asteroide al que apunta el morro,
   * si está a tiro. Dibuja los láseres (el propio y los de los demás).
   */
  private updateMining(dt: number): void {
    const field = spaceStore.getState().field;
    if (field && field.regionId === this.deepId) this.deep.set(field);
    this.deep.update(dt);
    const ship = this.ship;
    if (!ship || !this.flight) {
      this.deep.setBeams([]);
      return;
    }
    const fwd = this.forward();
    // Distancia desde el casco (radio de impacto de la nave), como la mide el servidor.
    const hit = this.deep.aim(ship.position, fwd, MINING.rangeM * 6 + FLAGSHIP_HIT_RADIUS_M);
    const aim = hit ? { index: hit.index, distance: Math.max(0, hit.distance - FLAGSHIP_HIT_RADIUS_M) } : null;
    this.aimTimer -= dt;
    if (this.aimTimer <= 0) {
      this.aimTimer = 0.15;
      const prev = spaceStore.getState().aim;
      const next = aim ? { index: aim.index, distance: Math.round(aim.distance / 10) * 10 } : null;
      if (prev?.index !== next?.index || prev?.distance !== next?.distance) spaceStore.setState({ aim: next });
    }
    const pressed = (this.keyboard.action("mine") || (this.mouseFiring && spaceStore.getState().weapon === "laser")) && !this.flight.pulse && !this.quantum;
    // El láser se alimenta del reactor: con los motores apagados no hay minería.
    const wants = pressed && this.engines.state === "on";
    if (pressed && !wants && this.time - this.enginesHintAt > 4) {
      this.enginesHintAt = this.time;
      this.events.notify("pilot.enginesOffShort", "engines");
    }
    if (wants) {
      this.mineTimer -= dt;
      if (this.mineTimer <= 0) {
        this.mineTimer = MINING.tickSec;
        if (aim && aim.distance <= MINING.rangeM) {
          connection.send({ t: "mine", asteroid: aim.index });
          this.miningAt = aim.index;
          this.outOfRangeWarned = false;
          playMiningPulse(1);
        } else {
          this.stopMining();
          this.mineTimer = MINING.tickSec;
          if (!this.outOfRangeWarned) {
            this.outOfRangeWarned = true;
            this.events.notify(aim ? "mining.outOfRange" : "mining.noTarget");
          }
        }
      }
    } else {
      this.outOfRangeWarned = false;
      this.stopMining();
    }
    if (spaceStore.getState().mining !== (this.miningAt !== null)) spaceStore.setState({ mining: this.miningAt !== null });
    // Láseres: el propio (salvo si el servidor acaba de rechazar el pulso) y los de las demás naves.
    const beams: Array<{ id: string; from: THREE.Vector3; asteroid: number }> = [];
    const fail = spaceStore.getState().mineFail;
    if (this.miningAt !== null && !(fail && Date.now() - fail.at < 700)) beams.push({ id: "self", from: ship.position.clone().addScaledVector(fwd, FLAGSHIP_LENGTH_M * 0.5), asteroid: this.miningAt });
    for (const [id, asteroid] of Object.entries(spaceStore.getState().beams)) {
      const from = this.remote.positionOf(id);
      if (from) beams.push({ id, from, asteroid });
    }
    this.deep.setBeams(beams);
  }

  /** Apaga el láser propio (y se lo dice al servidor). */
  private stopMining(): void {
    this.mineTimer = 0;
    if (this.miningAt === null) return;
    this.miningAt = null;
    connection.send({ t: "mine", asteroid: null });
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
    this.deep.clear();
    this.deep.light.visible = false;
    this.deepId = null;
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
    this.starFx = null;
    this.content.clear();
    this.planets = [];
    this.anomaly = null;
    this.selectRing.visible = false;
    this.hoveredPlanet = null;
  }

  get isPiloting(): boolean {
    return this.ship !== null;
  }

  /** Se pilota a distancia una nave de flota (ver `Engine.pilotFleetShip`). */
  get isRemote(): boolean {
    return this.remotePiloting;
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
  pilot(_from?: THREE.Vector3 | null, remote?: { classId: string; fleetId: string; design?: ShipDesignSnapshot }): void {
    this.stopPiloting();
    if (!this.layout) return;
    let ship: THREE.Group;
    if (remote) {
      // Nave de una flota pilotada a distancia: sale de donde se dibuja su flota.
      ship = (remote.design ? createDesignModel(remote.design) : createShipModel(remote.classId)) ?? createFlagship(0xc792ff);
      const length = (remote.design ? designLook(remote.design)?.model.lengthM : shipLength(remote.classId)) ?? FLAGSHIP_LENGTH_M;
      this.ownLength = length;
      this.ownRadius = Math.max(30, length * 0.45);
      this.fleetScene.hide(remote.fleetId, remote.classId, remote.design);
      ship.position.copy(this.fleetScene.fleetPosition(remote.fleetId) ?? this.fleetScene.anchor(new THREE.Vector3())).add(new THREE.Vector3(0, length * 2, length * 4));
    } else {
      ship = createFlagship(0xc792ff);
      ship.scale.setScalar(SHIP_SCALE);
      this.ownLength = FLAGSHIP_LENGTH_M;
      this.ownRadius = FLAGSHIP_HIT_RADIUS_M;
      ship.position.set(...parkedPosition(this.parkHere(), serverNow(), this.layout));
    }
    this.remotePiloting = !!remote;
    this.dome?.dispose();
    if (this.dome) this.scene.remove(this.dome.mesh);
    this.dome = new ShieldDome(this.ownLength);
    this.scene.add(this.dome.mesh);
    this.lastShield = -1;
    // Sin explorar, el sistema se dibuja sin planetas y su borde parece más cercano que el real:
    // la nave que llega de un salto (en el borde real) no debe salir nada más aparecer.
    this.boundary = Math.max(this.layout.boundary, ship.position.length() / ARRIVAL_EDGE + 1000);
    ship.lookAt(0, 0, 0);
    // lookAt orienta +Z hacia el objetivo; la nave mira hacia -Z.
    ship.rotateY(Math.PI);
    // Aparcada con su orientación guardada: sale mirando hacia donde se dejó.
    const parkQ = remote ? undefined : this.parkHere().q;
    if (parkQ) ship.quaternion.set(parkQ[0], parkQ[1], parkQ[2], parkQ[3]).normalize();
    this.content.add(ship);
    this.ship = ship;
    const flight = new ShipController(ship, this.dom, this.keyboard);
    flight.enabled = true;
    // Nave del Astillero pilotada a distancia: aceleración y giro de sus piezas (fase E4).
    if (remote?.design) {
      const st = designStats(remote.design);
      flight.performance = { accel: THREE.MathUtils.clamp(st.accel / DESIGN_REF_ACCEL, 0.4, 1.8), turn: THREE.MathUtils.clamp(st.turnDegPerSec / DESIGN_REF_TURN, 0.4, 1.8) };
    } else if (remote) {
      // Nave de una clase: la masa se nota. Los cazas aceleran y giran mucho más que la insignia de 320 m; las capitales, menos.
      const k = Math.sqrt(FLAGSHIP_LENGTH_M / Math.max(10, this.ownLength));
      flight.performance = { accel: THREE.MathUtils.clamp(k, 0.6, 2.5), turn: THREE.MathUtils.clamp(k, 0.5, 3) };
    }
    // Gravedad de los cuerpos cercanos (esferas de influencia), en cada subpaso de la física.
    flight.gravity = (pos, out) => {
      const g = gravityAt([pos.x, pos.y, pos.z], this.gravitySources);
      out.set(g.acc[0], g.acc[1], g.acc[2]);
    };
    this.flight = flight;
    // Al tomar los mandos, los motores están como se dejaron al aparcar (al llegar de un salto, encendidos: ver `arriveFromJump`).
    const enginesOn = !remote && this.parkHere().engines === true;
    this.engines = enginesOn ? { state: "on", t: 0, from: 1 } : { state: "off", t: 0, from: 0 };
    flight.powered = enginesOn;
    this.leaving = false;
    this.controls.enabled = false;
    this.chase.reset();
    // Se volvió a dibujar el sistema en plena llegada (llegó su detalle): la salida de la grieta sigue.
    if (this.arrival) this.placeArrival();
    this.placeChaseCamera(1);
    gameStore.getState().setFlight(true, 0);
    // Iba en crucero sin piloto (se cerró la pestaña) y aún no ha llegado: se reanuda hacia el mismo sitio.
    const travel = remote ? undefined : this.parkHere();
    if (travel?.travel && travel.anchor && serverNow() < travel.travel.until) {
      const pl = this.layout.planets[travel.anchor.planet];
      const moon = travel.anchor.moon !== undefined ? pl?.moons[travel.anchor.moon] : undefined;
      const id = moon && pl ? `moon:${pl.index}:${moon.index}` : pl ? `planet:${pl.index}` : null;
      if (id) window.setTimeout(() => this.ship && this.cruiseTo(id), 0);
    }
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
    // Un rayo de luz sale de la grieta y se convierte en la nave.
    this.rifts.emerge(ship, this.arrival.spawn, QUANTUM_RIFT.arriveBeamDelaySec, reduce);
    const { position: p, quaternion: q } = ship;
    connection.send({ t: "rift", phase: "arrive", at: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] });
    this.placeArrival();
    if (gameStore.getState().cameraView !== "first") this.chase.setOrbit(Math.PI * 0.82, 0.18);
    this.placeChaseCamera(1);
  }

  /**
   * Posición de la nave en la salida de la grieta: aparece (como un rayo, ver
   * `RiftField.emerge`) algo por delante y sigue deslizándose, frenando.
   */
  private placeArrival(): void {
    const a = this.arrival;
    const ship = this.ship;
    if (!a || !ship) return;
    const L = FLAGSHIP_LENGTH_M;
    const from = QUANTUM_RIFT.arriveBeamDelaySec;
    const k = Math.max(0, Math.min(1, (a.t - from) / (QUANTUM_RIFT.arriveShipSec - from)));
    const ease = 1 - (1 - k) ** 3;
    ship.position.copy(a.spawn).addScaledVector(a.dir, 1.2 * L + 1.2 * L * ease);
    ship.quaternion.copy(a.q);
  }

  private updateArrival(dt: number): void {
    const a = this.arrival;
    if (!a || !this.ship || !this.flight) return;
    a.t += dt;
    this.flight.stop();
    this.placeArrival();
    const T = QUANTUM_RIFT.arriveShipSec;
    shipRig(this.ship).setThrust(a.t < T * 0.7 ? 1 : 0.4, a.t < T * 0.5);
    if (a.t > T * 0.6) this.chase.reset();
    if (a.t >= T) this.arrival = null;
  }

  /**
   * Empieza la secuencia de salto cuántico hacia `target` desde la estrella en
   * `from` (coordenadas de la galaxia, que en la vista de sistema se usan como
   * direcciones): alinear la nave, cargar el motor y saltar.
   */
  startQuantum(target: StarSystemSummary, from: WorldPosition, near: string | null = null): void {
    if (!this.ship || !this.flight) return;
    this.cancelQuantum();
    this.cancelCruise();
    const dir = new THREE.Vector3(target.position.x - from.x, target.position.y - from.y, target.position.z - from.z).normalize();
    this.flight.pulse = false;
    this.quantum = { target, near, dir, phase: "align", t: 0, riftSent: false, startedAt: performance.now() };
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
      // Giro suave: arranca y frena poco a poco (aproximación exponencial con tope de velocidad).
      const left = ship.quaternion.angleTo(target);
      const step = Math.min(QUANTUM_ALIGN_RAD_PER_SEC * dt, left * (1 - Math.exp(-dt * 3.2)) + 0.002 * dt);
      ship.quaternion.rotateTowards(target, step);
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
        this.events.onQuantumJump(q.target, q.near);
      }
    } else if (q.phase === "depart") {
      q.t += dt;
      shipRig(ship).setThrust(1, true);
      // Ya dentro: un instante para ver cerrarse la grieta y al túnel.
      if (q.t >= QUANTUM_RIFT.departSec + 0.25 && q.onDeparted) {
        const done = q.onDeparted;
        q.onDeparted = undefined;
        done();
      }
    }
  }

  /**
   * Pestaña en segundo plano (el navegador no da fotogramas): la secuencia del
   * salto no puede depender de la animación. Se salta lo que falte: si aún se
   * alineaba o cargaba, se da ya la orden de salto (con la grieta anunciada a
   * los demás); si ya se entraba en la grieta, se pasa al túnel. El servidor
   * lleva el viaje por su cuenta y, al volver, se dibuja el estado real.
   */
  skipQuantumAhead(): void {
    const q = this.quantum;
    const ship = this.ship;
    if (!q) return;
    if (q.phase === "align" || q.phase === "charge") {
      // Nunca antes de tiempo: un tirón de más de un segundo (sin fotogramas) no debe saltarse la preparación.
      // Solo cuando, por reloj, ya habría acabado la carga (con un margen para la alineación).
      if (performance.now() - q.startedAt < (QUANTUM_CHARGE_SEC + QUANTUM_ALIGN_MAX_SEC) * 1000) return;
      if (!q.riftSent && ship) {
        const at = RiftField.ahead(ship.position, ship.quaternion);
        const r = ship.quaternion;
        connection.send({ t: "rift", phase: "charge", at: [at.x, at.y, at.z], q: [r.x, r.y, r.z, r.w] });
        q.riftSent = true;
      }
      stopQuantumCharge();
      telemetry.quantumAlign = null;
      telemetry.quantumCharge = null;
      q.phase = "sent";
      this.events.onQuantumJump(q.target, q.near);
    } else if (q.phase === "depart" && q.onDeparted) {
      const done = q.onDeparted;
      q.onDeparted = undefined;
      done();
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
    this.rifts.swallow("self", ship, reduce, (s) => {
      s.visible = false;
    });
  }

  /** Deja de pilotar y vuelve a la cámara orbital. */
  stopPiloting(): void {
    this.backgroundCruise = false;
    if (!this.ship) return;
    this.cancelQuantum();
    this.cancelCruise();
    this.undoShake();
    flightSound.stop();
    this.pendingEmerge.clear();
    if (this.camera.fov !== BASE_FOV) {
      this.camera.fov = BASE_FOV;
      this.camera.updateProjectionMatrix();
    }
    stopEngineSound();
    this.stopMining();
    this.deep.setBeams([]);
    // Deja de pilotar: la nave se queda aparcada aquí, orbitando (el servidor lo confirma por el tema `me`).
    connection.send({ t: "leave" });
    const flagship = worldStore.getState().flagship;
    // Solo si el servidor la tenía a los mandos (si no, su aparcamiento no ha cambiado).
    if (!this.remotePiloting && flagship && flagship.systemId === this.systemId && spaceStore.getState().systemId === this.systemId) {
      const p = this.ship.position;
      const q = this.ship.quaternion;
      worldStore.setState({ flagship: { ...flagship, park: localPark(this.layout, [p.x, p.y, p.z], [q.x, q.y, q.z, q.w], this.engines.state === "on" || this.engines.state === "starting") } });
    }
    resetSpace();
    this.remote.clear();
    this.effects.clear();
    this.assist.hideAll();
    this.mouseFiring = false;
    this.chase.armed = false;
    this.flight?.dispose();
    this.flight = null;
    this.content.remove(this.ship);
    disposeShip(this.ship);
    this.ship = null;
    this.remotePiloting = false;
    this.fleetScene.hide(null, null);
    if (this.dome) {
      this.scene.remove(this.dome.mesh);
      this.dome.dispose();
      this.dome = null;
    }
    if (spaceStore.getState().docked) spaceStore.setState({ docked: null, undocked: false });
    this.controls.enabled = true;
    this.cockpit.visible = false;
    this.dom.style.cursor = "";
    gameStore.getState().setFlight(false, 0);
  }

  /** Coloca la cámara del piloto; con `k` = 1, de golpe (al empezar o tras una corrección). */
  private placeChaseCamera(k: number): void {
    const ship = this.ship!;
    const first = gameStore.getState().cameraView === "first";
    if (k >= 1) this.chase.snap(ship, first);
    else this.chase.place(ship, first, k);
    // En primera persona el casco taparía la vista: se oculta la nave y se ve la cabina (al acabar el vuelo de la cámara).
    const moving = this.chase.transitioning;
    ship.visible = !first || moving;
    this.cockpit.visible = first && !moving;
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
    if (!flight.pulse && telemetry.heat.lethal && this.headingToStar()) return this.events.notify("pilot.heatPulseOff");
    flight.pulse = !flight.pulse;
  }

  // --- Acople en la nave nodriza de una flota propia (`flagship.dock`) ---

  /** Tecla de acoplar: se desacopla si ya lo está; si no, en la nave nodriza más cercana a su alcance. */
  private async dockKey(): Promise<void> {
    if (!this.ship || this.remotePiloting) return;
    if (spaceStore.getState().docked) return this.undock(true);
    const fleets = Object.values(worldStore.getState().fleets) as Fleet[];
    let best: { fleet: Fleet; d: number; reach: number } | null = null;
    for (const f of fleets) {
      const m = this.fleetScene.mothership(f.id);
      if (!m) continue;
      const d = m.at.distanceTo(this.ship.position);
      if (!best || d < best.d) best = { fleet: f, d, reach: FLAGSHIP_DOCK.rangeM + m.lengthM };
    }
    if (!best) return this.events.notify("dock.noMothership");
    if (best.d > best.reach) return gameStore.getState().notify("dock.tooFar", { km: Math.round(best.reach / 1000) });
    const error = await connection.command("flagship.dock", { fleetId: best.fleet.id });
    if (error) return this.events.notify(error);
    this.cancelCruise();
    if (this.flight) {
      this.flight.pulse = false;
      this.flight.stop();
      this.flight.enabled = false;
    }
    spaceStore.setState({ docked: { fleetId: best.fleet.id, number: best.fleet.number }, undocked: false });
    gameStore.getState().notify("dock.docked", { n: best.fleet.number });
  }

  /** Suelta la nave de la nave nodriza (a mano, o porque el servidor la desacopló) y la empuja hacia delante. */
  private undock(tellServer: boolean): void {
    if (tellServer) void connection.command("flagship.undock", {});
    spaceStore.setState({ docked: null, undocked: false });
    if (this.flight) {
      this.flight.enabled = true;
      this.flight.velocity.copy(this.forward()).multiplyScalar(40);
    }
  }

  /** Acoplada: la nave sigue a su nave nodriza (dentro de su hangar). */
  private followDock(): void {
    const { docked, undocked } = spaceStore.getState();
    if (undocked) {
      this.undock(false);
      return this.events.notify("dock.released");
    }
    if (!docked || !this.ship) return;
    // Acoplada (también al llegar de un viaje con la flota): los mandos, quietos.
    if (this.flight?.enabled) {
      this.flight.pulse = false;
      this.flight.stop();
      this.flight.enabled = false;
    }
    const m = this.fleetScene.mothership(docked.fleetId);
    if (!m) {
      // Al llegar de un viaje acoplado la flota tarda un momento en aparecer parada: se espera un poco.
      this.dockMissingSince ??= performance.now();
      if (performance.now() - this.dockMissingSince < 20_000) return;
      this.dockMissingSince = null;
      this.undock(true);
      return this.events.notify("dock.released");
    }
    this.dockMissingSince = null;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.q);
    this.ship.position.copy(m.at).addScaledVector(up, m.lengthM * 0.04);
    this.ship.quaternion.copy(m.q);
    this.flight?.velocity.set(0, 0, 0);
  }

  /** ¿Apunta el morro hacia la estrella (está en el origen del sistema)? */
  private headingToStar(): boolean {
    return this.forward().dot(this.ship!.position.clone().negate()) > 0;
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
  private toggleFlightPref(key: "assist" | "mouseFlight" | "autoFire", on: I18nKey, off: I18nKey): void {
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
    const out: Array<{ name: string; center: THREE.Vector3; radius: number; planetIndex: number | null; body: CelestialBody }> = [];
    // En el espacio profundo no hay estrella (ni gravedad ni límite del pulso).
    if (this.layout.starRadius > 0) out.push({ name: this.starName, center: new THREE.Vector3(), radius: this.layout.starRadius, planetIndex: null, body: this.layout.star });
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
      g: flight.pulseActive ? 0 : grav.g,
      region: grav.region,
      body: grav.dominant ? (bodies.find((b) => b.body === grav.dominant)?.name ?? null) : null,
    };
    const heading = [fwd.x, fwd.y, fwd.z];
    // Calor de la estrella (el daño lo pone el servidor): en la zona mortal, el pulso se corta si se va hacia ella.
    const heat = this.layout && !this.deepId ? starHeatDps(this.layout, pos.length()) : 0;
    const lethal = heat >= STAR_HEAT_LETHAL_DPS;
    telemetry.heat = { dps: heat, lethal, blackHole: this.layout?.starClass === "BH" };
    if (lethal && flight.pulse && this.headingToStar()) {
      flight.pulse = false;
      this.events.notify("pilot.heatPulseOff");
    }
    const near = bodies.map((b) => ({ center: [b.center.x, b.center.y, b.center.z] as [number, number, number], radius: b.radius }));
    flight.pulseLimit = pulseLimitAt([pos.x, pos.y, pos.z], heading, near);
    // Maniobra rápida (Ajustes, hasta 400 km/s): cerca de los cuerpos, como mucho lo que deja el pulso (lo que valida el
    // servidor) y, sin combustible (por encima del impulso el servidor la cobra como pulso), solo el impulso normal.
    const normalTop = FLIGHT_MODEL.maxSpeed * FLIGHT_MODEL.boostFactor;
    flight.maneuverCap = this.outOfFuel() ? normalTop : Math.max(normalTop, pulseLimitAt([pos.x, pos.y, pos.z], null, near));

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
    telemetry.pulse = flight.pulseActive;
    telemetry.pulseCharge = flight.pulseCharging;
    telemetry.pulseLimit = flight.pulseLimit;
    telemetry.thrust = flight.thrust;
    flightSound.update({ power: this.enginePower(), thrust: flight.thrust, speed: flight.speed, pulse: flight.pulseActive, charge: flight.pulseCharging, pulseMax: PULSE_MAX_SPEED });
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
    if (this.flight?.pulse) return;
    const manual = this.keyboard.action("fireCannon") || (this.mouseFiring && spaceStore.getState().weapon === "cannon");
    // Fuego automático: con el blanco fijado (no compañero) a tiro y dentro del arco de los montajes.
    const aim = this.cannonAim;
    const auto = settingsStore.getState().prefs.flight.autoFire && aim !== null && aim.relation !== "ally" && aim.inArc && aim.inRange;
    if (!manual && !auto) return;
    // Seguro de armas puesto: no se dispara (se avisa si se intenta a mano).
    if (settingsStore.getState().prefs.flight.weaponsSafe) {
      if (manual && this.time - this.enginesHintAt > 4) {
        this.enginesHintAt = this.time;
        this.events.notify("combat.weaponsSafe");
      }
      return;
    }
    // Sin motores no hay armas.
    if (this.engines.state !== "on") {
      if (manual && this.time - this.enginesHintAt > 4) {
        this.enginesHintAt = this.time;
        this.events.notify("pilot.enginesOffShort", "engines");
      }
      return;
    }
    // Sin proyectiles o sin energía, el servidor no dispararía: no se envía ni se dibuja.
    const { weapons, supplies } = spaceStore.getState();
    if (weapons.find((w) => w.kind === "cannon")?.ammo === 0) return;
    if (supplies && supplies.energy < FLAGSHIP_SUPPLIES.cannonEnergy) return;
    const now = performance.now();
    if (now < this.cannonReadyAt) return;
    const cannon = EMPEROR_FLAGSHIP.combat.weapons.find((w) => w.kind === "cannon");
    if (!cannon) return;
    this.cannonReadyAt = now + cannon.cooldownSec * 1000;
    // Puntería automática: los montajes giran hacia el punto de adelanto si cabe en su arco; si no, al frente.
    const f = aim ? aim.dir.clone() : this.forward();
    connection.send({ t: "fire", weapon: "cannon", dir: [f.x, f.y, f.z] });
    // Se dibuja ya, desde la boca del cañón, con la velocidad de la nave sumada (como en el servidor).
    const muzzle = this.ownMuzzle("cannon", this.cannonIndex++);
    const speed = cannon.speedU + Math.max(0, this.flight!.velocity.dot(f));
    if (muzzle) this.effects.fireLocal(muzzle, f, speed, cannon.rangeU, serverNow());
    this.fireKick = Math.min(1, this.fireKick + 0.22);
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
      const target = s.target;
      const from = new THREE.Vector3(...s.from);
      const strength = s.weapon === "missile" ? 1.2 : 0.4;
      setTimeout(() => {
        playHit(hitGain);
        // El escudo de una nave ajena se enciende con el impacto (no se sabe cuánto le queda).
        if (target && target !== myId) this.remote.shieldHit(target, from, strength, settingsStore.getState().prefs.reduceEffects);
      }, Math.max(0, s.hitAt - serverNow()));
    }
  }

  /** Boca de un arma de la nave propia, en el mundo. */
  private ownMuzzle(weapon: WeaponKind, index: number): THREE.Vector3 | null {
    return this.ship ? shipRig(this.ship).muzzle(weapon, index, new THREE.Vector3()) : null;
  }

  /** Lanza un misil al objetivo fijado (el servidor comprueba alcance, ángulo y munición). */
  private fireMissile(): void {
    if (settingsStore.getState().prefs.flight.weaponsSafe) return this.events.notify("combat.weaponsSafe");
    if (this.engines.state !== "on") return this.events.notify("pilot.enginesOffShort", "engines");
    const target = spaceStore.getState().targetId;
    if (!target) return this.events.notify("combat.noMissileTarget", "lockTarget");
    const f = this.forward();
    connection.send({ t: "fire", weapon: "missile", dir: [f.x, f.y, f.z], target });
    this.fireKick = Math.min(1, this.fireKick + 0.6);
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
        if (this.ship) {
          const g = distanceGain(this.ship.position.distanceTo(new THREE.Vector3(...e)));
          playExplosion(g);
          // Una explosión cerca se siente: la onda sacude la cámara.
          this.impactShake = Math.max(this.impactShake, g * 0.9);
        }
      }
      spaceStore.setState({ shots: [], explosions: [] });
    }
    const myId = worldStore.getState().myEmperorId;
    this.effects.update(dt, serverNow(), (id) => (id === myId ? (this.ship?.position ?? null) : this.remote.positionOf(id)));
    // Asistencia de puntería: el blanco fijado desaparece si se va; marcadores y punto de adelanto.
    if (state.targetId && !state.ships[state.targetId]) spaceStore.setState({ targetId: null });
    const ship = this.ship;
    if (!ship || !this.flight) {
      this.cannonAim = null;
      this.assist.hideAll();
      return;
    }
    const aim = this.assist.aim(this.remote, ship.position, this.flight.velocity, this.forward());
    this.cannonAim = aim;
    this.assist.update(this.camera, this.remote, ship.position, aim ? { point: aim.point, ready: aim.inArc && aim.inRange } : null);
    this.chase.armed = this.weaponsArmed();
  }

  /** Motores encendidos y ratón para combatir: el clic izquierdo dispara y la rueda cambia de arma. */
  private weaponsArmed(): boolean {
    const f = settingsStore.getState().prefs.flight;
    return !!this.ship && this.engines.state === "on" && !this.quantum && !this.arrival && f.mouseFire && !f.weaponsSafe;
  }

  /** Armas seleccionables ahora (el láser de minería, solo en el espacio profundo). */
  private weaponList(): SelectedWeapon[] {
    return this.deepId ? ["cannon", "missile", "laser"] : ["cannon", "missile"];
  }

  private selectWeapon(w: SelectedWeapon): void {
    if (w === "laser" && !this.deepId) return this.events.notify("combat.laserDeepOnly");
    spaceStore.setState({ weapon: w });
  }

  /** Clic izquierdo: dispara el arma seleccionada (Alt + clic: seleccionar, como siempre). Clic central: fijar la nave del marcador. */
  private onCombatDown = (e: PointerEvent) => {
    if (!this.ship) return;
    if (e.button === 1) {
      e.preventDefault();
      const r = this.dom.getBoundingClientRect();
      const at = pointerXY(e);
      const id = this.assist.pickAt(at.x - r.left, at.y - r.top);
      if (id) this.onLocked(id);
      return;
    }
    if (e.button !== 0) return;
    this.clickWasShot = false;
    if (e.altKey || !this.weaponsArmed()) return;
    this.clickWasShot = true;
    const weapon = spaceStore.getState().weapon;
    if (weapon === "missile") this.fireMissile();
    else this.mouseFiring = true;
  };

  private onCombatUp = (e: PointerEvent) => {
    if (e.button === 0) this.mouseFiring = false;
  };

  /** Ctrl + rueda: cambia de arma (la rueda sola es el zoom de la cámara; Mayús es el impulso y no se toca). */
  private onCombatWheel = (e: WheelEvent) => {
    const delta = e.deltaY || e.deltaX;
    if (!e.ctrlKey || delta === 0) return;
    // Ctrl + rueda haría zoom de la página: aquí no.
    e.preventDefault();
    if (!this.weaponsArmed()) return;
    const list = this.weaponList();
    const i = Math.max(0, list.indexOf(spaceStore.getState().weapon));
    spaceStore.setState({ weapon: list[(i + (delta > 0 ? 1 : -1) + list.length) % list.length]! });
  };

  /** Tras fijar un blanco: aviso si es un compañero (hay fuego amigo). */
  private onLocked(id: string | null): void {
    if (!id) return this.events.notify("combat.noTargets");
    const s = spaceStore.getState().ships[id];
    if (s && relationOf(s.state) === "ally") this.events.notify(authStore.getState().emperor?.friendlyFire ? "combat.allyLocked" : "combat.allyLockedSafe");
  }

  /** Fija el blanco más cercano a la retícula: el cursor en vuelo con ratón; si no, la línea del morro. */
  private lockAtReticle(): void {
    const ship = this.ship!;
    const prefs = settingsStore.getState().prefs.flight;
    const cursor = prefs.mouseFlight ? this.flight?.cursorNdc() : null;
    let eye: THREE.Vector3;
    let dir: THREE.Vector3;
    if (cursor) {
      this.raycaster.setFromCamera(new THREE.Vector2(cursor.x, cursor.y), this.camera);
      eye = this.raycaster.ray.origin.clone();
      dir = this.raycaster.ray.direction.clone();
    } else {
      eye = ship.position.clone();
      dir = this.forward();
    }
    const id = this.assist.atReticle(this.remote, eye, dir) ?? this.assist.nearest(this.remote, ship.position);
    this.onLocked(id);
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
      else if (e.phase === "incoming") {
        // Llega una nave dentro de unos segundos: su grieta se abre ya donde aparecerá.
        const key = `${e.id}:arrive`;
        this.rifts.open(key, e.at, e.q, reduce);
        playQuantumTear(0.35 * gain);
        // Si al final no llega (salió del túnel antes, cayó), la grieta se cierra sola.
        window.setTimeout(() => {
          if (!this.pendingEmerge.has(e.id) && !this.arrivedRifts.has(e.id) && this.rifts.get(key)) this.rifts.close(key);
          this.arrivedRifts.delete(e.id);
        }, (QUANTUM_RIFT.incomingSec + 6) * 1000);
      }
      else if (e.phase === "cancel") this.rifts.close(e.id);
      else if (e.phase === "arrive") {
        this.arrivedRifts.add(e.id);
        this.rifts.open(`${e.id}:arrive`, e.at, e.q, reduce).arrive();
        playQuantumTear(0.5 * gain);
        // Su nave saldrá de la grieta como un rayo en cuanto se dibuje.
        this.pendingEmerge.set(e.id, { at: new THREE.Vector3(...e.at), t: this.time });
      } else {
        // Saltó: entra en su grieta (si no se vio cargar, se abre ahora delante de ella).
        const ship = this.remote.detach(e.id);
        const p = ship?.position.clone() ?? new THREE.Vector3(...e.at);
        const q = ship?.quaternion.clone() ?? new THREE.Quaternion(...e.q);
        if (!this.rifts.get(e.id) || this.rifts.get(e.id)!.closing) this.rifts.open(e.id, RiftField.ahead(p, q), q, reduce);
        playQuantumTear(gain);
        if (ship) {
          this.rifts.swallow(e.id, ship, reduce, (s) => this.remote.discard(s as THREE.Group));
        } else {
          this.rifts.get(e.id)!.burst();
          setTimeout(() => this.rifts.close(e.id), QUANTUM_RIFT.departSec * 1000);
        }
      }
    }
  }

  /** Las naves ajenas que llegan de un salto salen de su grieta como un rayo (en cuanto se dibujan). */
  private updateRemoteEmerge(): void {
    if (this.pendingEmerge.size === 0) return;
    const reduce = settingsStore.getState().prefs.reduceEffects;
    for (const [id, p] of this.pendingEmerge) {
      const elapsed = this.time - p.t;
      const ship = this.remote.shipOf(id);
      if (ship) {
        this.pendingEmerge.delete(id);
        this.rifts.emerge(ship, p.at, Math.max(0, QUANTUM_RIFT.arriveBeamDelaySec - elapsed), reduce);
      } else if (elapsed > 3) this.pendingEmerge.delete(id);
    }
  }

  /**
   * La cámara acompaña al salto: se abre (más campo de visión) al entrar en la
   * grieta y al salir del rayo, con una sacudida breve al condensarse la nave.
   * Con «reducir efectos», sin sacudida y con la mitad de apertura.
   */
  private updateCameraFx(dt: number): void {
    const reduce = settingsStore.getState().prefs.reduceEffects;
    let kick = 0;
    let shake = 0;
    const q = this.quantum;
    // Sin temblores en el salto (se notaban a tirones): solo se abre el campo de visión, con curvas suaves.
    if (q?.phase === "charge") {
      kick = 2.5 * smoothstep(0.3, 1, q.t / QUANTUM_CHARGE_SEC);
    } else if (q?.phase === "depart" || q?.phase === "sent") {
      const k = q.phase === "sent" ? 0 : q.t / QUANTUM_RIFT.departSec;
      kick = 2.5 + 7 * smoothstep(0, 1, k);
    } else if (this.arrival) {
      const tb = this.arrival.t - QUANTUM_RIFT.arriveBeamDelaySec;
      if (tb > 0) kick = 7 * smoothstep(0, 0.45, tb) * (1 - smoothstep(0.45, 1.9, tb));
    }
    if (this.impactShake > 0) {
      shake = Math.max(shake, this.impactShake * 1.6);
      this.impactShake = Math.max(0, this.impactShake - dt * 2);
    }
    if (this.fireKick > 0) {
      // Retroceso: un temblor corto y el campo de visión se cierra un poco (el golpe del disparo).
      shake = Math.max(shake, this.fireKick * 0.9);
      kick -= this.fireKick * 0.8;
      this.fireKick = Math.max(0, this.fireKick - dt * 5);
    }
    if (reduce) {
      kick *= 0.5;
      shake = 0;
    }
    const fov = BASE_FOV + kick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (shake > 0.01) {
      const a = 0.0035 * shake;
      this.shakeQ.setFromEuler(new THREE.Euler((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.5));
      this.camera.quaternion.multiply(this.shakeQ);
    } else this.shakeQ.identity();
  }

  /**
   * La estrella gira (rotación diferencial en el sombreador) y, cuanto más cerca
   * está la cámara, más brilla su corona alrededor del disco. Crece con la
   * distancia, sin saltos; con «reducir efectos», la mitad.
   */
  private updateStarFx(): void {
    const fx = this.starFx;
    if (!fx) return;
    // Fase del giro en [0, 2π) calculada en doble precisión (en el sombreador, un ángulo enorme pierde precisión).
    const sec = serverNow() / 1000;
    fx.surface.uniforms.uSpin!.value = ((sec % STAR_SPIN_PERIOD_SEC) / STAR_SPIN_PERIOD_SEC) * Math.PI * 2;
    fx.surface.uniforms.uShear!.value = 0.5 * Math.sin(((sec % 900) / 900) * Math.PI * 2);
    const d = this.camera.position.length();
    const r = fx.radius;
    const t = Math.min(1, Math.max(0, (d - r * 1.3) / (r * 20 - r * 1.3)));
    const near = (1 - t * t * (3 - 2 * t)) * (settingsStore.getState().prefs.reduceEffects ? 0.5 : 1);
    // El resplandor es el de la corona, que rodea el disco sin taparlo nunca (un brillo
    // delante del disco lo lavaba y, de cerca, se cortaba contra la esfera en un círculo).
    fx.corona.uniforms.uNear!.value = near;
    // Llamas: desde fuera, la cara delantera de su capa (y los planetas delante las tapan);
    // desde dentro de la capa, la trasera y sin profundidad (la superficie ya la recorta el rayo).
    if (fx.flames) {
      const m = fx.flames.material as THREE.ShaderMaterial;
      const inside = d < r * FLAME_SCALE * 1.01;
      m.side = inside ? THREE.BackSide : THREE.FrontSide;
      m.depthTest = !inside;
    }
    // Agujero negro: igual (desde dentro de su capa, la cara trasera).
    if (fx.blackHole) {
      const m = fx.blackHole.material as THREE.ShaderMaterial;
      const inside = d < r * BLACK_HOLE_SHELL * 1.01;
      m.side = inside ? THREE.BackSide : THREE.FrontSide;
      m.depthTest = !inside;
    }
  }

  /**
   * Cúpula del escudo propio: se enciende cuando el escudo pierde carga (por el
   * lado de la estrella si es calor; si no, hacia el blanco fijado o el
   * enemigo más cercano) y brilla mientras el calor de la estrella lo gasta.
   */
  private updateDome(dt: number): void {
    const dome = this.dome;
    const ship = this.ship;
    if (!dome || !ship) return;
    const self = spaceStore.getState().self;
    const reduce = settingsStore.getState().prefs.reduceEffects;
    const shield = self?.shield ?? 0;
    const towardStar = ship.position.clone().negate();
    const heat = telemetry.heat.dps;
    dome.setHeat(heat > 0 ? Math.min(1, 0.25 + heat / STAR_HEAT_LETHAL_DPS) : 0, towardStar, reduce);
    if (self && this.lastShield >= 0 && shield < this.lastShield - 0.5 && heat <= 0) {
      const { targetId } = spaceStore.getState();
      let from = targetId ? this.remote.positionOf(targetId) : null;
      if (!from) {
        let best = Infinity;
        for (const s of Object.values(spaceStore.getState().ships)) {
          const p = this.remote.positionOf(s.state.id);
          const d = p ? p.distanceTo(ship.position) : Infinity;
          if (p && d < best) {
            best = d;
            from = p;
          }
        }
      }
      dome.impact(from ? from.clone().sub(ship.position) : null, (this.lastShield - shield) / Math.max(1, self.shieldMax) * 4, reduce);
    }
    this.lastShield = self ? shield : -1;
    dome.update(dt, this.time, ship, shield > 0.5);
  }

  /** Deshace la sacudida del fotograma anterior (antes de volver a colocar la cámara). */
  private undoShake(): void {
    this.camera.quaternion.multiply(this.shakeQ.invert());
    this.shakeQ.identity();
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
      worldStore.setState({ flagship: { ...flagship, park: localPark(this.layout, [c.p[0], c.p[1], c.p[2]], [c.q[0], c.q[1], c.q[2], c.q[3]], flagship.park.engines ?? false) } });
    }
    // La cámara salta con la nave (si no, tardaría en alcanzarla y la nave se vería diminuta).
    this.placeChaseCamera(1);
  }

  /**
   * Hasta que el servidor acepta la nave en el sistema, se sigue la posición de
   * aparcamiento que diga (puede llegar después de empezar a pilotar).
   */
  private followParkUntilBoarded(): void {
    if (!this.ship || this.remotePiloting || spaceStore.getState().systemId === this.systemId) return;
    const flagship = worldStore.getState().flagship;
    if (!flagship || flagship.systemId !== this.systemId) return;
    const at = new THREE.Vector3(...parkedPosition(flagship.park, serverNow(), this.layout));
    if (at.distanceTo(this.ship.position) < 2000) return;
    this.ship.position.copy(at);
    this.ship.lookAt(0, 0, 0);
    this.ship.rotateY(Math.PI);
    const q = flagship.park.q;
    if (q) this.ship.quaternion.set(q[0], q[1], q[2], q[3]).normalize();
    if (flagship.park.engines && this.engines.state === "off") {
      this.engines = { state: "on", t: 0, from: 1 };
      if (this.flight) this.flight.powered = true;
    }
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
    connection.send({ t: "pose", systemId: this.systemId, p: [r(p.x), r(p.y), r(p.z)], q: [r(q.x), r(q.y), r(q.z), r(q.w)], v: [r(v.x), r(v.y), r(v.z)], e: this.engines.state === "on" || this.engines.state === "starting", ...this.cruiseIntent() });
  }

  /**
   * Crucero en curso hacia un planeta o una luna, para el servidor: si se cierra
   * la pestaña, la nave sigue hasta allí sin piloto (`c` de `pose`).
   */
  private cruiseIntent(): { c?: { planet: number; moon?: number; stop: number; eta: number } } {
    const target = this.autopilot.target;
    if (!target || this.remotePiloting || !this.layout || (target.mode !== "goto" && target.mode !== "orbit")) return {};
    const [kind, a, b] = target.id.split(":");
    const planet = Number(a);
    const pl = this.layout.planets[planet];
    if (!pl || (kind !== "planet" && kind !== "moon")) return {};
    const moon = kind === "moon" ? pl.moons.findIndex((m) => m.index === Number(b)) : undefined;
    if (moon === -1) return {};
    const spot = this.cruiseWorld().spots.find((s) => s.id === target.id);
    const stop = spot ? spot.stopRadius : (moon !== undefined ? pl.moons[moon]!.body.radius : pl.size) * 3;
    const tel = telemetry.cruise;
    const eta = tel?.seconds ?? this.autopilot.distance / Math.max(1, PULSE_MAX_SPEED * 0.5) + 10;
    return { c: { planet, ...(moon !== undefined ? { moon } : {}), stop, eta: Math.min(86_400, Math.max(0, eta)) } };
  }

  /**
   * Evita atravesar la estrella, los planetas y las lunas: la nave se queda
   * sobre su superficie (con el radio físico, el mismo de la gravedad) y pierde
   * la velocidad que llevaba hacia dentro. Un golpe fuerte sacude la cámara
   * (el daño lo pone el servidor: `BODY_COLLISION` y `SHIP_COLLISION`).
   */
  private collide(): void {
    const ship = this.ship!;
    const normal = new THREE.Vector3();
    let hit = 0;
    for (const b of this.bodies()) {
      // En un agujero negro no hay superficie: se cruza el horizonte (y el servidor destruye la nave).
      if (b.body.kind === "star" && this.layout?.starClass === "BH") continue;
      const radius = b.body.kind === "star" ? b.radius * 1.05 : b.radius + this.ownLength * 0.6;
      const d = ship.position.distanceTo(b.center);
      if (d >= radius || d === 0) continue;
      normal.copy(ship.position).sub(b.center).divideScalar(d);
      ship.position.copy(b.center).addScaledVector(normal, radius);
      const v = this.flight!.velocity;
      const inward = v.dot(normal);
      if (inward < 0) v.addScaledVector(normal, -inward);
      hit = Math.max(hit, -inward - BODY_COLLISION.minImpactMps);
    }
    // Asteroides del espacio profundo.
    if (this.deepId) hit = Math.max(hit, this.deep.collide(ship.position, this.flight!.velocity, this.ownRadius) - BODY_COLLISION.minImpactMps);
    // Otras naves.
    hit = Math.max(hit, this.remote.collide(ship.position, this.flight!.velocity, this.ownRadius) - SHIP_COLLISION.minClosingMps);
    // Sacudida según la fuerza del golpe (llena a partir de unos 200 m/s).
    if (hit > 0) this.impactShake = Math.max(this.impactShake, Math.min(1, 0.25 + hit / 200));
  }

  // --- Piloto automático de crucero (ver `Autopilot.ts`) ---

  /** Destinos posibles ahora y cuerpos que rodear. */
  private cruiseWorld(): { spots: CruiseSpot[]; obstacles: CruiseObstacle[] } {
    if (!this.ship || !this.layout) return { spots: [], obstacles: [] };
    const locale = gameStore.getState().locale;
    const colonies = worldStore.getState().colonies;
    const bodies: CruiseSources["bodies"] = [];
    for (const p of this.planets) {
      const own = this.systemId ? ownColonyAt(colonies, this.systemId, p.index) !== undefined : false;
      bodies.push({ id: `planet:${p.index}`, kind: "planet", name: p.label ? p.label.key.split("|")[0]! : p.designation, center: p.mesh.getWorldPosition(new THREE.Vector3()), radius: p.layout.size, own });
      for (const m of p.moons) bodies.push({ id: `moon:${p.index}:${m.layout.index}`, kind: "moon", name: m.name, center: m.mesh.position.clone(), radius: m.layout.body.radius });
    }
    const ships: CruiseSources["ships"] = [];
    for (const s of Object.values(spaceStore.getState().ships)) {
      const model = this.remote.shipOf(s.state.id);
      if (model) ships.push({ id: s.state.id, name: shipName(s.state, locale), ally: s.state.ally, pirate: s.state.kind === "pirate", at: model.position.clone(), q: model.quaternion.clone() });
    }
    const target = this.autopilot.target;
    const spots = cruiseCatalog({
      locale,
      shipPos: this.ship.position,
      bodies,
      belts: this.deepId ? [] : this.layout.belts,
      anomaly: this.anomaly,
      field: this.deepId ? spaceStore.getState().field : null,
      ships,
      point: target?.id === "point" ? (target.point ?? null) : null,
    });
    // Las nodrizas propias paradas aquí: se llega a su lado, a tiro de acoplarse (Enter).
    for (const f of Object.values(worldStore.getState().fleets) as Fleet[]) {
      const m = this.fleetScene.mothership(f.id);
      if (!m) continue;
      const radius = m.lengthM / 2;
      spots.push({ id: `mothership:${f.id}`, kind: "mothership", name: translate(locale, "cruise.mothership", { n: f.number }), center: m.at, radius, stopRadius: radius + FLAGSHIP_DOCK.rangeM * 0.5, own: true });
    }
    const obstacles: CruiseObstacle[] = bodies.map((b) => ({ id: b.id, center: b.center, radius: b.radius, star: false }));
    if (this.layout.starRadius > 0) obstacles.push({ id: "star", center: new THREE.Vector3(), radius: this.layout.starRadius, star: true });
    return { spots, obstacles };
  }

  /** Destinos para el panel de crucero, del más cercano al más lejano. */
  cruiseOptions(): Array<{ id: string; kind: CruiseSpot["kind"]; name: string; distance: number; ally?: boolean; pirate?: boolean; own?: boolean }> {
    const ship = this.ship;
    if (!ship) return [];
    return this.cruiseWorld()
      .spots.filter((s) => s.kind !== "point")
      .map((s) => ({ id: s.id, kind: s.kind, name: s.name, distance: Math.max(0, s.center.distanceTo(ship.position) - s.radius), ally: s.ally, pirate: s.pirate, own: s.own }))
      .sort((a, b) => a.distance - b.distance);
  }

  /** Destino del piloto automático en curso, o null. */
  get cruiseTarget(): { id: string; mode: "goto" | "follow" | "orbit"; name: string } | null {
    return this.autopilot.target;
  }

  /** Activa el piloto automático hacia un destino del catálogo (`ship:<id>` = seguir esa nave) o un punto del espacio. */
  cruiseTo(id: string, point?: THREE.Vector3, orbit = false): void {
    const ship = this.ship;
    if (!ship || !this.flight || this.quantum || this.arrival) return;
    const spot = id === "point" ? null : this.cruiseWorld().spots.find((s) => s.id === id);
    if (id !== "point" && !spot) return;
    const name = spot?.name ?? translate(gameStore.getState().locale, "cruise.point");
    // Orbitar solo planetas y lunas.
    const mode = spot?.kind === "ship" ? "follow" : orbit && (spot?.kind === "planet" || spot?.kind === "moon") ? "orbit" : "goto";
    this.autopilot.engage(id, mode, name, point);
    this.cruiseCursor = this.flight.cursorAt;
    gameStore.getState().setCruisePanel(false);
    // Sin motores no hay crucero: se arrancan solos.
    if (this.engines.state === "off" || this.engines.state === "stopping") this.startEngines();
    this.cruiseNotice(mode === "follow" ? "cruise.following" : mode === "orbit" ? "cruise.orbiting" : "cruise.engaged", { name });
  }

  /** Desactiva el piloto automático (con un aviso si se da el motivo). */
  cancelCruise(reason?: I18nKey): void {
    const target = this.autopilot.target;
    this.autopilot.cancel();
    if (this.flight) {
      this.flight.autopilot = null;
      // El pulso que encendió el piloto automático se apaga con él.
      if (target && this.flight.pulse) this.flight.pulse = false;
    }
    this.cruiseMarker.visible = false;
    telemetry.cruise = null;
    if (gameStore.getState().cruisePanel) gameStore.getState().setCruisePanel(false);
    if (target && reason) this.cruiseNotice(reason, { name: target.name });
  }

  private cruiseNotice(key: I18nKey, params: Record<string, string | number>): void {
    gameStore.getState().notify(key, params);
  }

  /** Tecla del crucero: con el piloto automático puesto, lo quita; si no, abre o cierra la lista de destinos. */
  private cruiseKey(): void {
    if (this.autopilot.active) return this.cancelCruise("cruise.cancelled");
    const st = gameStore.getState();
    st.setCruisePanel(!st.cruisePanel);
  }

  /**
   * Tecla de seguir: la nave fijada (X) o, si no hay, la siguiente nave
   * visible (primero los compañeros, de la más cercana a la más lejana).
   */
  private followKey(): void {
    const ship = this.ship;
    if (!ship) return;
    const ships = this.cruiseWorld().spots.filter((s) => s.kind === "ship");
    if (ships.length === 0) return this.cruiseNotice("cruise.noShips", {});
    const current = this.autopilot.target?.id;
    const locked = spaceStore.getState().targetId;
    if (locked && current !== `ship:${locked}` && ships.some((s) => s.id === `ship:${locked}`)) return this.cruiseTo(`ship:${locked}`);
    const rank = (s: CruiseSpot) => (s.ally ? 0 : s.pirate ? 2 : 1);
    ships.sort((a, b) => rank(a) - rank(b) || a.center.distanceTo(ship.position) - b.center.distanceTo(ship.position));
    const i = ships.findIndex((s) => s.id === current);
    this.cruiseTo(ships[(i + 1) % ships.length]!.id);
  }

  /**
   * Doble clic al pilotar: el cuerpo o la nave más cercana al cursor en la
   * pantalla; si no hay ninguno, el punto del plano del sistema bajo el cursor.
   */
  private cruiseAtScreen(x: number, y: number): void {
    if (!this.ship) return;
    const tanHalf = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    let best: { id: string; d: number } | null = null;
    const p = new THREE.Vector3();
    for (const s of this.cruiseWorld().spots) {
      if (s.kind === "belt" || s.kind === "point") continue;
      p.copy(s.center).project(this.camera);
      if (p.z > 1 || p.z < -1) continue;
      // Distancia en pantalla (en medias alturas) y tamaño aparente del objeto.
      const d = Math.hypot((p.x - x) * this.camera.aspect, p.y - y);
      const size = s.radius / Math.max(1, s.center.distanceTo(this.camera.position)) / tanHalf;
      if (d <= Math.max(0.05, size) && (!best || d < best.d)) best = { id: s.id, d };
    }
    if (best) return this.cruiseTo(best.id);
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!hit || hit.length() > this.boundary * 0.95) return this.cruiseNotice("cruise.noPoint", {});
    this.cruiseTo("point", hit);
  }

  /** Un paso del piloto automático: sus mandos para `ShipController`, el marcador y el HUD. */
  private updateCruise(dt: number): void {
    const flight = this.flight!;
    const ship = this.ship!;
    const ap = this.autopilot;
    const target = ap.target;
    if (!target) {
      flight.autopilot = null;
      return;
    }
    // Cualquier mando manual lo desactiva (en vuelo con ratón, también llevar el cursor fuera de la zona muerta).
    // Con el mapa abierto (crucero en segundo plano) las teclas y el ratón son del mapa: no cuentan.
    const cursor = this.backgroundCruise ? null : flight.cursorAt;
    const moved = cursor !== null && (!this.cruiseCursor || Math.hypot(cursor.x - this.cruiseCursor.x, cursor.y - this.cruiseCursor.y) > 0.15);
    if (!this.backgroundCruise && (MANUAL_ACTIONS.some((a) => this.keyboard.action(a)) || (flight.mouseSteering && moved))) return this.cancelCruise("cruise.manual");
    const { spots, obstacles } = this.cruiseWorld();
    const spot = spots.find((s) => s.id === target.id) ?? null;
    if (!spot) {
      // La nave seguida se fue: si saltó, su grieta está en la cola de eventos (aún sin dibujar en este fotograma).
      const shipId = target.id.startsWith("ship:") ? target.id.slice(5) : null;
      const jumped = shipId !== null && spaceStore.getState().rifts.some((r) => r.id === shipId && r.phase === "jump");
      return this.cancelCruise(jumped ? "cruise.lostJump" : "cruise.lost");
    }
    if (this.engines.state === "off" || this.engines.state === "stopping") this.startEngines();
    const status = ap.step(dt, { ship, velocity: flight.velocity, pulseOn: flight.pulseActive, powered: flight.powered, canPulse: !this.outOfFuel(), spot, obstacles });
    if (status === "arrived") {
      playCruiseArrive();
      return this.cancelCruise("cruise.arrived");
    }
    // Entra en órbita: aviso suave.
    if (ap.phase === "orbit" && this.lastCruisePhase !== "orbit") playCruiseArrive();
    this.lastCruisePhase = ap.phase;
    if (status === "lost") return this.cancelCruise("cruise.lost");
    const cmd = ap.command;
    if (cmd.pulse !== flight.pulse) flight.pulse = cmd.pulse && this.engines.state === "on";
    flight.autopilot = cmd;
    this.cruiseMarker.position.copy(spot.center);
    this.cruiseMarker.visible = true;
    telemetry.cruise = { mode: target.mode, name: target.name, phase: ap.phase, distance: ap.distance, seconds: ap.closing > 1 && target.mode === "goto" ? ap.distance / ap.closing : null };
  }

  activate(): void {
    this.controls.enabled = !this.ship;
    if (this.flight) this.flight.enabled = true;
  }

  deactivate(): void {
    this.controls.enabled = false;
    if (this.flight) {
      this.flight.enabled = false;
      // Con el crucero en segundo plano (mapa abierto) la nave sigue volando: no se para.
      if (this.backgroundCruise) this.flight.background = true;
      else this.flight.stop();
    }
    this.dom.style.cursor = "";
  }

  /**
   * Crucero en segundo plano: al abrir el mapa galáctico con el piloto automático
   * puesto, la nave sigue volando (el motor llama a `update` sin dibujar esta
   * vista). Al volver a los mandos (`resumeFromBackground`) se sigue desde donde vaya.
   */
  backgroundCruise = false;

  /** ¿Se puede dejar el crucero en segundo plano? (pilotando la propia nave, con el piloto automático y sin saltar) */
  get cruising(): boolean {
    return !!this.ship && !!this.flight && this.autopilot.active && !this.remotePiloting && !this.quantum && !this.arrival;
  }

  /** Vuelve a los mandos de la nave que seguía en crucero con el mapa abierto. */
  resumeFromBackground(): void {
    this.backgroundCruise = false;
    if (this.flight) this.flight.background = false;
  }

  /**
   * Tiempo real del último fotograma (con tope de 1 s). El `dt` de `update` tiene
   * un tope de 0,1 s para que la física no dé saltos; con menos de 10 FPS el
   * juego iría más despacio que el reloj. Las secuencias con duración (arranque
   * de motores, alineación y carga del salto, llegada, carga del pulso) usan
   * este para durar lo mismo en cualquier ordenador.
   */
  realDt = 0;

  update(dt: number): void {
    this.time += dt;
    // El tiempo de los shaders da la vuelta para no perder precisión en sesiones largas.
    this.bodyUniforms.uTime.value = this.time % 100_000;
    this.updateStarFx();
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
      this.undoShake();
      if (this.flight.pulse && this.outOfFuel()) {
        this.flight.pulse = false;
        this.events.notify("pilot.noFuel");
      }
      this.updateNavigation();
      const departing = this.quantum?.phase === "depart";
      const real = Math.max(dt, this.realDt);
      this.updateEngines(real);
      if (this.quantum) this.updateQuantum(real);
      else if (this.arrival) this.updateArrival(real);
      else {
        this.updateCruise(dt);
        this.flight.update(dt, real);
      }
      // Al entrar en el túnel (`onDeparted`) la nave puede haber salido ya de esta vista.
      if (!this.ship || !this.flight) return;
      if (!departing) {
        this.followDock();
        if (!spaceStore.getState().docked) this.collide();
        this.applyCorrection();
        this.followParkUntilBoarded();
        // Al saltar, el servidor ya la sacó del sistema: no se envían más posiciones.
        this.sendPose(dt);
      }
      this.updateRemoteRifts();
      this.remote.update(dt, this.time, this.ship.position);
      this.updateRemoteEmerge();
      const rig = shipRig(this.ship);
      if (!this.quantum && !this.arrival) rig.setThrust(this.flight.thrust, this.flight.pulseActive);
      // Propulsores de maniobra del modelo, si los tiene (lo expone el generador de naves).
      (rig as { setManeuver?: (m: Maneuver) => void }).setManeuver?.(this.flight.maneuver);
      rig.tick(this.time, dt, this.quantum || this.arrival ? 0 : Math.max(0, 1 - this.flight.speed / 20));
      if (!this.quantum && !this.arrival && !this.backgroundCruise) this.fireCannon();
      this.updateCombatVisuals(dt);
      // Al entrar en la grieta, la cámara exterior se queda quieta y la ve alejarse; en cabina, entra con ella.
      if (!departing || gameStore.getState().cameraView === "first") this.placeChaseCamera(1 - Math.exp(-dt * 8));
      this.updateCameraFx(dt);
      this.updateDome(dt);
      telemetry.freeCam = this.chase.free && gameStore.getState().cameraView !== "first";
      // Vuelo con ratón: el cursor es la retícula (una cruz); en cámara libre, el de siempre.
      if (!this.backgroundCruise) {
        const mouseFlight = settingsStore.getState().prefs.flight.mouseFlight;
        const cursor = mouseFlight ? "crosshair" : "";
        if (this.dom.style.cursor !== cursor) this.dom.style.cursor = cursor;
        gameStore.getState().setFlight(true, this.flight.speed, this.flight.pulseActive);
      }
      // Más allá del borde: espacio interestelar.
      if (!this.leaving && this.layout && this.ship.position.length() > this.boundary) {
        this.leaving = true;
        this.events.onLeave(this.ship.position.clone().normalize());
      }
    } else {
      this.controls.update();
    }
    this.rifts.update(dt, this.time, this.ship?.position ?? this.camera.position);
    if (this.deepId) this.updateMining(dt);
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
    // Pilotando con las armas a punto, el clic izquierdo fue un disparo (Alt + clic selecciona).
    if (this.ship && this.clickWasShot) return;
    gameStore.getState().selectPlanet(this.pickPlanet(x, y));
  }

  onDoubleClick(x: number, y: number): void {
    // Pilotando: doble clic en un cuerpo, una nave o el espacio = piloto automático hacia allí
    // (con las armas a punto, el clic izquierdo dispara: entonces Alt + doble clic).
    if (this.ship) return this.clickWasShot ? undefined : this.cruiseAtScreen(x, y);
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

  /**
   * Acción del piloto por su nombre: la misma con una tecla o con un botón de
   * la barra de acciones (`ActionBar`), porque no todo lleva tecla por defecto.
   */
  runAction(action: PilotAction): void {
    if (!this.ship || this.quantum) return;
    // Encender o apagar a mano el pulso o los motores es pilotar: el piloto automático se desactiva.
    if (this.autopilot.active && (action === "pulse" || action === "engines")) this.cancelCruise("cruise.manual");
    switch (action) {
      case "cruise":
        return this.cruiseKey();
      case "follow":
        return this.followKey();
      case "dock":
        return void this.dockKey();
      case "engines":
        return this.toggleEngines();
      case "pulse":
        return this.togglePulse();
      case "cameraReset":
        return this.chase.reset();
      case "flightAssist":
        return this.toggleFlightPref("assist", "pilot.assistOn", "pilot.assistOff");
      case "speedMode": {
        // Cercanía → normal → rápida → cercanía.
        const f = settingsStore.getState().prefs.flight;
        const next = SPEED_MODES[(SPEED_MODES.indexOf(f.speedMode) + 1) % SPEED_MODES.length]!;
        settingsStore.getState().setPrefs({ flight: { ...f, speedMode: next } });
        return this.events.notify(`pilot.speedMode.${next}`);
      }
      case "mouseFlight":
        return this.toggleFlightPref("mouseFlight", "pilot.mouseFlightOn", "pilot.mouseFlightOff");
      case "lockTarget":
        return this.lockAtReticle();
      case "targetNext":
        return this.onLocked(this.assist.cycle(this.remote, this.ship.position, 1));
      case "targetPrev":
        return this.onLocked(this.assist.cycle(this.remote, this.ship.position, -1));
      case "targetNearest":
        return this.onLocked(this.assist.nearest(this.remote, this.ship.position));
      case "autoFire":
        return this.toggleFlightPref("autoFire", "combat.autoFireOn", "combat.autoFireOff");
      case "weaponCannon":
        return this.selectWeapon("cannon");
      case "weaponMissile":
        return this.selectWeapon("missile");
      case "weaponLaser":
        return this.selectWeapon("laser");
      case "fireMissile":
        return this.fireMissile();
    }
  }

  onKey(code: string): void {
    // El Esc que suelta el ratón atrapado no cancela el salto ni el crucero.
    if (code === "Escape" && escapeJustUnlocked()) return;
    if (this.ship) {
      // Encender o apagar a mano el pulso o los motores es pilotar: el piloto automático se desactiva.
      if (this.autopilot.active && !this.quantum && (isBound("pulse", code) || isBound("engines", code))) this.cancelCruise("cruise.manual");
      if (isBound("cameraView", code)) gameStore.getState().toggleCameraView();
      else if (this.quantum && (code === "Escape" || isBound("jump", code))) {
        // Una vez dada la orden de salto ya no se puede cancelar (el servidor la tiene).
        if (this.quantum.phase === "align" || this.quantum.phase === "charge") this.cancelQuantum();
      }
      else if (this.quantum) return;
      else if (code === "Escape" && gameStore.getState().cruisePanel) gameStore.getState().setCruisePanel(false);
      else if (code === "Escape" && this.autopilot.active) this.cancelCruise("cruise.cancelled");
      else {
        const action = PILOT_ACTIONS.find((a) => isBound(a, code));
        if (action) this.runAction(action);
      }
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
    this.dom.removeEventListener("pointerdown", this.onCombatDown);
    window.removeEventListener("pointerup", this.onCombatUp);
    this.dom.removeEventListener("wheel", this.onCombatWheel);
    this.assist.dispose();
    this.deep.dispose();
  }
}
