import * as THREE from "three";
import { withLogDepth } from "./logDepth";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Rng, STAR_CLASSES, hashString } from "@imperium/procgen";
import type { I18nKey, StarSystemDetail } from "@imperium/shared";
import { PILOT_BOOST, PILOT_SPEED, PULSE_SAFE_RADII, PULSE_SPEED, planetAngle, systemLayout, type PlanetLayout, type SystemLayout } from "@imperium/sim";
import { resetSpace, spaceStore } from "../net/space";
import { connection, serverNow } from "../net/world";
import { RemoteShips } from "./RemoteShips";
import { Effects } from "./Effects";
import { worldStore } from "../net/world";
import { EMPEROR_FLAGSHIP } from "@imperium/content";
import { isBound, settingsStore, type Action } from "../state/settings";
import { gameStore } from "../state/store";
import { Backdrop } from "./Backdrop";
import { FlightController } from "./FlightController";
import type { Keyboard } from "./input";
import { createFlagship, disposeShip, SHIP_SCALE } from "./shipModel";
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
  moons: Array<{ mesh: THREE.Mesh; radius: number; speed: number; phase: number }>;
}

/** Avisos de la vista de sistema al motor. */
export interface SystemViewEvents {
  /** Esc en modo observar: volver al mapa. */
  onExit(): void;
  /** La nave cruzó el borde del sistema: pasar al espacio interestelar. `direction` es hacia dónde salió. */
  onLeave(direction: THREE.Vector3): void;
  /** Aviso breve; `keyAction` añade como parámetro `key` la tecla de esa acción. */
  notify(key: I18nKey, keyAction?: Action): void;
}

/** Cada cuánto se envía la posición propia al servidor mientras se pilota. */
const POSE_INTERVAL = 0.125;

/** Cámara de persecución (tercera persona): detrás y algo por encima de la nave. */
const CHASE_OFFSET = new THREE.Vector3(0, 24, 100);
/** Cámara de cabina (primera persona): en el puente, mirando al frente. */
const COCKPIT_OFFSET = new THREE.Vector3(0, 5.5, -4);

/**
 * Vista de un sistema estelar, con la disposición de `@imperium/sim` (distancias
 * comprimidas, igual en cliente y servidor). Dos modos:
 * - observar: cámara orbital, para inspeccionar planetas;
 * - pilotar: la nave del Emperador, con cámara de persecución. Salir volando
 *   más allá del borde lleva al espacio interestelar sin pantallas intermedias.
 */
export class SystemView implements View {
  readonly scene = new THREE.Scene();
  // De medio metro a cientos de miles de km: lo permite el búfer de profundidad logarítmico.
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 5e8);
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
  private flight: FlightController | null = null;
  private chaseTarget = new THREE.Vector3();
  private leaving = false;
  private systemId: string | null = null;
  private poseTimer = 0;
  private remote = new RemoteShips();
  private effects = new Effects(() => worldStore.getState().myEmperorId);
  private targetRing: THREE.Sprite;
  /** Cadencia local del cañón: no se envían disparos que el servidor rechazaría. */
  private cannonReadyAt = 0;

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
    this.scene.add(this.backdrop.object, this.content, this.selectRing, this.remote.group, this.effects.group, this.targetRing);
    this.scene.add(new THREE.AmbientLight(0x5a6688, 0.9));
  }

  /** Construye la representación del sistema a partir de su detalle generado. */
  build(detail: StarSystemDetail): void {
    this.clear();
    const { summary } = detail;
    const info = STAR_CLASSES[summary.starClass];
    const starColor = new THREE.Color(info.color);
    const rng = new Rng(hashString(summary.id));

    const layout = systemLayout(detail);
    this.layout = layout;
    this.systemId = summary.id;

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

    for (const belt of layout.belts) this.content.add(this.makeBelt(belt.orbitRadius, rng));

    let radius = starRadius * 3 + 8;
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
      p.moons.forEach((m, mi) => {
        const moonRadius = size * (0.12 + rng.range(0, 0.12));
        const moon = new THREE.Mesh(
          this.sphereLevel(moonRadius, 32),
          createPlanetMaterial(planetLook(m.type, `${summary.id}:${p.index}:m${mi}`), moonRadius, this.bodyUniforms, false),
        );
        this.trackLod(moon, moonRadius);
        mesh.add(moon);
        // Las lunas: posiciones relativas a la malla del planeta (que no está escalada), en metros.
        moons.push({ mesh: moon, radius: size * (2.5 + mi * 1.2), speed: rng.range(0.004, 0.012), phase: rng.range(0, Math.PI * 2) });
      });

      const orbitLine = this.makeOrbit(radius);
      this.content.add(orbitLine, pivot);
      this.planets.push({ index: p.index, designation: p.name, label: null, layout: pl, pivot, mesh, orbitLine, moons });
      radius += size * 2 + 7;
    }

    if (detail.anomaly) {
      const anomaly = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb57bff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      const a = rng.range(0, Math.PI * 2);
      anomaly.position.set(Math.cos(a) * (radius + 60_000), rng.range(-4000, 4000), Math.sin(a) * (radius + 60_000));
      anomaly.scale.setScalar(60_000);
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

  private makeBelt(radius: number, rng: Rng): THREE.Points {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = radius + rng.bell() * 8000;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rng.bell() * 1500;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9a8f80, size: 900, sizeAttenuation: true }));
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
   * Pone la nave del Emperador en el sistema y pasa a pilotarla. Aparece en el
   * borde, del lado de `from` (dirección desde la que llega), mirando a la estrella.
   */
  pilot(from: THREE.Vector3 | null): void {
    this.stopPiloting();
    if (!this.layout) return;
    const ship = createFlagship(0xc792ff);
    ship.scale.setScalar(SHIP_SCALE);
    const dir = from && from.lengthSq() > 0 ? from.clone().normalize() : new THREE.Vector3(0.2, 0.15, 1).normalize();
    // Se llega cerca de la órbita del primer planeta (o de la estrella), no al borde lejano.
    const first = this.layout.planets[0]?.orbitRadius ?? this.layout.starRadius * 5;
    ship.position.copy(dir.multiplyScalar(first * 1.15));
    ship.lookAt(0, 0, 0);
    // lookAt orienta +Z hacia el objetivo; la nave mira hacia -Z.
    ship.rotateY(Math.PI);
    this.content.add(ship);
    this.ship = ship;
    const flight = new FlightController(ship, this.dom, this.keyboard);
    flight.baseSpeed = PILOT_SPEED;
    flight.boostFactor = PILOT_BOOST;
    flight.pulseSpeed = PULSE_SPEED;
    flight.enabled = true;
    this.flight = flight;
    this.leaving = false;
    this.controls.enabled = false;
    this.placeChaseCamera(1);
    gameStore.getState().setFlight(true, 0);
  }

  /** Deja de pilotar y vuelve a la cámara orbital. */
  stopPiloting(): void {
    if (!this.ship) return;
    // Deja de volar en el sistema compartido: los demás dejan de ver la nave.
    connection.send({ t: "leave" });
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
    gameStore.getState().setFlight(false, 0);
  }

  private placeChaseCamera(k: number): void {
    const ship = this.ship!;
    const first = gameStore.getState().cameraView === "first";
    // En primera persona el casco taparía la vista: se oculta la nave.
    ship.visible = !first;
    if (first) {
      this.camera.position.copy(COCKPIT_OFFSET).applyQuaternion(ship.quaternion).add(ship.position);
      this.camera.quaternion.copy(ship.quaternion);
      return;
    }
    const desired = CHASE_OFFSET.clone().applyQuaternion(ship.quaternion).add(ship.position);
    this.camera.position.lerp(desired, k);
    this.camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion));
    this.chaseTarget.copy(new THREE.Vector3(0, 0, -300).applyQuaternion(ship.quaternion).add(ship.position));
    this.camera.lookAt(this.chaseTarget);
  }

  /** Morro de la nave propia (vector unitario). */
  private forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship!.quaternion).normalize();
  }

  /** Enciende o apaga el motor de pulso. No arranca pegado a un planeta o a la estrella. */
  private togglePulse(): void {
    const flight = this.flight;
    if (!flight) return;
    if (flight.pulse) {
      flight.pulse = false;
      return;
    }
    if (this.nearestBodyClearance() < 1) return this.events.notify("pilot.pulseBlocked");
    flight.pulse = true;
  }

  /**
   * Cuánto falta para la zona de seguridad del cuerpo más cercano, en múltiplos
   * de esa zona (menos de 1: dentro). La zona es `PULSE_SAFE_RADII` radios.
   */
  private nearestBodyClearance(): number {
    if (!this.ship || !this.layout) return Infinity;
    const pos = this.ship.position;
    let best = pos.length() / (this.layout.starRadius * PULSE_SAFE_RADII);
    const tmp = new THREE.Vector3();
    for (const p of this.planets) best = Math.min(best, p.mesh.getWorldPosition(tmp).distanceTo(pos) / (p.layout.size * PULSE_SAFE_RADII));
    return best;
  }

  /** El pulso se apaga solo al entrar en la zona de seguridad de un planeta o de la estrella. */
  private checkPulse(): void {
    const flight = this.flight;
    if (!flight?.pulse) return;
    if (this.nearestBodyClearance() < 1) {
      flight.pulse = false;
      // Llega con poca velocidad: el pulso no se lleva por delante al planeta.
      flight.velocity.setLength(Math.min(flight.velocity.length(), PILOT_SPEED * PILOT_BOOST));
    }
  }

  /** Mantener la tecla dispara el cañón a su cadencia, hacia donde apunta el morro. */
  private fireCannon(): void {
    if (!this.keyboard.action("fireCannon") || this.flight?.pulse) return;
    const now = performance.now();
    if (now < this.cannonReadyAt) return;
    const cannon = EMPEROR_FLAGSHIP.combat.weapons.find((w) => w.kind === "cannon");
    if (!cannon) return;
    this.cannonReadyAt = now + cannon.cooldownSec * 1000;
    const f = this.forward();
    connection.send({ t: "fire", weapon: "cannon", dir: [f.x, f.y, f.z] });
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
      for (const s of state.shots) this.effects.add(s);
      for (const e of state.explosions) this.effects.explode(e);
      spaceStore.setState({ shots: [], explosions: [] });
    }
    const myId = worldStore.getState().myEmperorId;
    this.effects.update(dt, serverNow(), (id) => (id === myId ? (this.ship?.position ?? null) : this.remote.positionOf(id)));
    const target = state.targetId ? this.remote.positionOf(state.targetId) : null;
    this.targetRing.visible = target !== null;
    if (target) this.targetRing.position.copy(target);
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

  /** Evita atravesar la estrella y los planetas: la nave se queda en su superficie. */
  private collide(): void {
    const ship = this.ship!;
    const layout = this.layout!;
    const pushOut = (center: THREE.Vector3, radius: number) => {
      const d = ship.position.distanceTo(center);
      if (d >= radius || d === 0) return;
      ship.position.sub(center).setLength(radius).add(center);
      this.flight!.velocity.multiplyScalar(0.3);
    };
    pushOut(new THREE.Vector3(), layout.starRadius * 1.05);
    const tmp = new THREE.Vector3();
    for (const p of this.planets) pushOut(p.mesh.getWorldPosition(tmp), p.layout.size + 40);
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
    for (const p of this.planets) {
      p.pivot.rotation.y = planetAngle(p.layout, now);
      // Rotación lenta: a esta escala, la superficie de un planeta de varios km se movería deprisa.
      p.mesh.rotation.y += dt * 0.005;
      for (const m of p.moons) {
        const a = m.phase + this.time * m.speed;
        m.mesh.position.set(Math.cos(a) * m.radius, Math.sin(a * 0.7) * m.radius * 0.05, Math.sin(a) * m.radius);
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
      this.flight.update(dt);
      this.checkPulse();
      this.collide();
      this.applyCorrection();
      this.sendPose(dt);
      this.remote.update();
      this.fireCannon();
      this.updateCombatVisuals(dt);
      this.placeChaseCamera(1 - Math.exp(-dt * 8));
      gameStore.getState().setFlight(true, this.flight.speed, this.flight.pulse);
      // Más allá del borde: espacio interestelar.
      if (!this.leaving && this.layout && this.ship.position.length() > this.layout.boundary) {
        this.leaving = true;
        this.events.onLeave(this.ship.position.clone().normalize());
      }
    } else {
      this.controls.update();
    }
    this.backdrop.follow(this.camera);
    this.updateLod();
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
    this.dom.style.cursor = this.hoveredPlanet !== null ? "pointer" : "";
  }

  onKey(code: string): void {
    if (this.ship) {
      if (isBound("cameraView", code)) gameStore.getState().toggleCameraView();
      else if (isBound("pulse", code)) this.togglePulse();
      else if (isBound("lockTarget", code)) this.cycleTarget();
      else if (isBound("fireMissile", code)) this.fireMissile();
      return;
    }
    if (code === "Escape" || code === "Backspace") this.events.onExit();
  }

  dispose(): void {
    this.stopPiloting();
    this.clear();
    this.controls.dispose();
  }
}
