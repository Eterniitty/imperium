import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Rng, STAR_CLASSES, hashString } from "@imperium/procgen";
import type { StarSystemDetail } from "@imperium/shared";
import { planetAngle, systemLayout, type PlanetLayout, type SystemLayout } from "@imperium/sim";
import { serverNow } from "../net/world";
import { isBound } from "../state/settings";
import { gameStore } from "../state/store";
import { Backdrop } from "./Backdrop";
import { FlightController } from "./FlightController";
import type { Keyboard } from "./input";
import { createFlagship, disposeShip } from "./shipModel";
import { glowTexture, planetTexture, ringTexture } from "./textures";
import type { View } from "./View";

interface PlanetVisual {
  index: number;
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
}

/** Velocidades de pilotaje, en unidades de sistema por segundo. */
const PILOT_SPEED = 18;
const PILOT_BOOST = 5;
/** Cámara de persecución (tercera persona): detrás y algo por encima de la nave. */
const CHASE_OFFSET = new THREE.Vector3(0, 2.4, 10);
/** Cámara de cabina (primera persona): en el puente, mirando al frente. */
const COCKPIT_OFFSET = new THREE.Vector3(0, 0.55, -0.4);

/**
 * Vista de un sistema estelar, con la disposición de `@imperium/sim` (distancias
 * comprimidas, igual en cliente y servidor). Dos modos:
 * - observar: cámara orbital, para inspeccionar planetas;
 * - pilotar: la nave del Emperador, con cámara de persecución. Salir volando
 *   más allá del borde lleva al espacio interestelar sin pantallas intermedias.
 */
export class SystemView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20000);
  readonly controls: OrbitControls;

  private content = new THREE.Group();
  private backdrop = new Backdrop(9000, 4242);
  private planets: PlanetVisual[] = [];
  private starMaterial: THREE.ShaderMaterial | null = null;
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

  constructor(
    dom: HTMLElement,
    private keyboard: Keyboard,
    private events: SystemViewEvents,
  ) {
    this.dom = dom;
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 600;
    this.controls.enabled = false;

    this.selectRing = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color: 0xe8b64c, depthTest: false, sizeAttenuation: false, transparent: true }),
    );
    this.selectRing.scale.setScalar(0.07);
    this.selectRing.visible = false;
    this.selectRing.renderOrder = 10;

    this.scene.add(this.backdrop.object, this.content, this.selectRing);
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

    // Estrella.
    const isBlackHole = summary.starClass === "BH";
    const starRadius = layout.starRadius;
    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: starColor }, uTime: { value: 0 }, uDark: { value: isBlackHole ? 1 : 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal; varying vec3 vPos;
        void main() { vNormal = normalize(normalMatrix * normal); vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime; uniform float uDark;
        varying vec3 vNormal; varying vec3 vPos;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main() {
          float rim = 1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
          float grain = h(floor(vPos * 6.0 + uTime * 0.6)) * 0.12;
          vec3 hot = mix(uColor, vec3(1.0), 0.25);
          vec3 col = (mix(hot, uColor * 0.75, rim) + grain) * 0.85;
          if (uDark > 0.5) col = uColor * pow(rim, 3.0) * 1.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const star = new THREE.Mesh(new THREE.SphereGeometry(starRadius, 48, 32), this.starMaterial);
    this.content.add(star);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: starColor, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    glow.scale.setScalar(starRadius * (isBlackHole ? 6 : 9));
    this.content.add(glow);

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
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(size, 40, 24),
        new THREE.MeshStandardMaterial({ map: planetTexture(p.type, `${summary.id}:${p.index}`), roughness: 0.9, metalness: 0 }),
      );
      mesh.userData.planetIndex = p.index;
      mesh.rotation.z = rng.range(-0.4, 0.4);

      const pivot = new THREE.Object3D();
      pivot.rotation.y = planetAngle(pl, serverNow());
      mesh.position.set(radius, 0, 0);
      pivot.add(mesh);

      // Anillos en algunos gigantes.
      if ((p.type === "gas_giant" || p.type === "ice_giant") && rng.chance(0.45)) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(size * 1.4, size * 2.2, 64),
          new THREE.MeshBasicMaterial({ color: 0xd8c8a8, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false }),
        );
        ring.rotation.x = Math.PI / 2 + rng.range(-0.3, 0.3);
        mesh.add(ring);
      }

      const moons: PlanetVisual["moons"] = [];
      p.moons.forEach((m, mi) => {
        const moon = new THREE.Mesh(
          new THREE.SphereGeometry(0.25 + rng.range(0, 0.25), 16, 12),
          new THREE.MeshStandardMaterial({ map: planetTexture(m.type, `${summary.id}:${p.index}:m${mi}`), roughness: 1 }),
        );
        mesh.add(moon);
        moons.push({ mesh: moon, radius: size + 1.2 + mi * 0.9, speed: rng.range(0.4, 1.2), phase: rng.range(0, Math.PI * 2) });
      });

      const orbitLine = this.makeOrbit(radius);
      this.content.add(orbitLine, pivot);
      this.planets.push({ index: p.index, layout: pl, pivot, mesh, orbitLine, moons });
      radius += size * 2 + 7;
    }

    if (detail.anomaly) {
      const anomaly = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb57bff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      const a = rng.range(0, Math.PI * 2);
      anomaly.position.set(Math.cos(a) * (radius + 6), rng.range(-4, 4), Math.sin(a) * (radius + 6));
      anomaly.scale.setScalar(6);
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
      const r = radius + rng.bell() * 2.2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rng.bell() * 0.6;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9a8f80, size: 0.35, sizeAttenuation: true }));
  }

  private clear(): void {
    this.stopPiloting();
    this.content.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        // Las texturas de planeta están en caché y se reutilizan: no se liberan aquí.
        for (const m of mats) m.dispose();
      }
    });
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
    const dir = from && from.lengthSq() > 0 ? from.clone().normalize() : new THREE.Vector3(0.2, 0.15, 1).normalize();
    ship.position.copy(dir.multiplyScalar(this.layout.boundary * 0.8));
    ship.lookAt(0, 0, 0);
    // lookAt orienta +Z hacia el objetivo; la nave mira hacia -Z.
    ship.rotateY(Math.PI);
    this.content.add(ship);
    this.ship = ship;
    const flight = new FlightController(ship, this.dom, this.keyboard);
    flight.baseSpeed = PILOT_SPEED;
    flight.boostFactor = PILOT_BOOST;
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
    this.chaseTarget.copy(new THREE.Vector3(0, 0, -30).applyQuaternion(ship.quaternion).add(ship.position));
    this.camera.lookAt(this.chaseTarget);
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
    pushOut(new THREE.Vector3(), layout.starRadius * 1.6);
    const tmp = new THREE.Vector3();
    for (const p of this.planets) pushOut(p.mesh.getWorldPosition(tmp), p.layout.size + 0.8);
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
    if (this.starMaterial) this.starMaterial.uniforms.uTime!.value = this.time;
    const now = serverNow();
    const selected = gameStore.getState().selectedPlanet;
    for (const p of this.planets) {
      p.pivot.rotation.y = planetAngle(p.layout, now);
      p.mesh.rotation.y += dt * 0.25;
      for (const m of p.moons) {
        const a = m.phase + this.time * m.speed;
        m.mesh.position.set(Math.cos(a) * m.radius, Math.sin(a * 0.7) * 0.3, Math.sin(a) * m.radius);
      }
      const mat = p.orbitLine.material as THREE.LineBasicMaterial;
      mat.opacity = p.index === selected ? 0.55 : p.index === this.hoveredPlanet ? 0.32 : 0.14;
      mat.color.setHex(p.index === selected ? 0xe8b64c : 0x3fd0ff);
    }
    const sel = this.planets.find((p) => p.index === selected);
    if (sel) {
      sel.mesh.getWorldPosition(this.selectRing.position);
      this.selectRing.visible = true;
    } else {
      this.selectRing.visible = false;
    }
    if (this.ship && this.flight) {
      this.flight.update(dt);
      this.collide();
      this.placeChaseCamera(1 - Math.exp(-dt * 8));
      gameStore.getState().setFlight(true, this.flight.speed);
      // Más allá del borde: espacio interestelar.
      if (!this.leaving && this.layout && this.ship.position.length() > this.layout.boundary) {
        this.leaving = true;
        this.events.onLeave(this.ship.position.clone().normalize());
      }
    } else {
      this.controls.update();
    }
    this.backdrop.follow(this.camera);
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
