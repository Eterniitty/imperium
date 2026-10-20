import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  SECTOR_SIZE,
  sectorOrigin,
  worldToSector,
  type SectorCoord,
  type StarSystemSummary,
  type WorldPosition,
} from "@imperium/shared";
import { REBASE_DISTANCE } from "../config";
import { gameStore } from "../state/store";
import { Backdrop } from "./Backdrop";
import { FlightController } from "./FlightController";
import type { Keyboard } from "./input";
import { SectorManager } from "./SectorManager";
import { ringTexture } from "./textures";
import type { View } from "./View";

interface FlyAnimation {
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromDist: number;
  toDist: number;
  t: number;
  duration: number;
  onDone?: () => void;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Mapa estelar 3D. Usa un "origen flotante": la escena se mantiene centrada
 * cerca de la cámara y las posiciones absolutas (que pueden ser enormes) se
 * guardan aparte en `origin`. Así la GPU nunca trabaja con coordenadas de
 * millones de años luz, que perderían precisión.
 */
export class GalaxyView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 20000);
  readonly controls: OrbitControls;
  readonly sectors = new SectorManager();

  private origin: WorldPosition;
  private backdrop = new Backdrop();
  private sectorBox: THREE.LineSegments;
  private selectRing: THREE.Sprite;
  private hoverRing: THREE.Sprite;
  private link: THREE.Line;
  private fly: FlyAnimation | null = null;
  private lastSector: SectorCoord | null = null;
  private navTimer = 0;
  private height = 1;
  private flight: FlightController;
  private flightMode = false;

  constructor(
    dom: HTMLElement,
    private keyboard: Keyboard,
    private onEnterSystem: (s: StarSystemSummary) => void,
  ) {
    const start = gameStore.getState().focusWorld;
    this.origin = { ...start };

    this.camera.position.set(90, 70, 150);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 900;
    this.controls.zoomSpeed = 1.2;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 0, 0);
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enabled = false;
    this.flight = new FlightController(this.camera, dom, keyboard);

    this.sectors.setOrigin(this.origin);
    this.scene.add(this.backdrop.object, this.sectors.group);

    // Caja del sector actual: da referencia espacial en 3D.
    this.sectorBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(SECTOR_SIZE, SECTOR_SIZE, SECTOR_SIZE)),
      new THREE.LineBasicMaterial({ color: 0x3fd0ff, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    this.scene.add(this.sectorBox);

    this.selectRing = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color: 0xe8b64c, depthTest: false, sizeAttenuation: false, transparent: true }),
    );
    this.selectRing.scale.setScalar(0.055);
    this.selectRing.visible = false;
    this.selectRing.renderOrder = 10;

    this.hoverRing = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color: 0x9fe8ff, depthTest: false, sizeAttenuation: false, transparent: true, opacity: 0.6 }),
    );
    this.hoverRing.scale.setScalar(0.04);
    this.hoverRing.visible = false;
    this.hoverRing.renderOrder = 10;

    // Línea del foco a la selección: muestra distancia y dirección.
    const linkGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.link = new THREE.Line(
      linkGeo,
      new THREE.LineDashedMaterial({ color: 0xe8b64c, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.5, depthTest: false }),
    );
    this.link.visible = false;
    this.link.frustumCulled = false;

    this.scene.add(this.selectRing, this.hoverRing, this.link);
  }

  activate(): void {
    this.controls.enabled = !this.flightMode;
    this.flight.enabled = this.flightMode;
  }

  deactivate(): void {
    this.controls.enabled = false;
    this.flight.enabled = false;
    this.flight.stop();
    this.hoverRing.visible = false;
  }

  get isFlying(): boolean {
    return this.flightMode;
  }

  /**
   * Alterna entre el modo órbita (mapa estratégico) y el modo vuelo (nave).
   * Al volver a órbita, el punto de giro se coloca delante de la nave.
   */
  setFlightMode(on: boolean): void {
    if (on === this.flightMode) return;
    this.flightMode = on;
    this.fly = null;
    this.flight.stop();
    if (on) {
      this.controls.enabled = false;
      this.flight.enabled = true;
    } else {
      this.flight.enabled = false;
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      this.controls.target.copy(this.camera.position).addScaledVector(forward, 40);
      // Quitar el alabeo: el modo órbita necesita el "arriba" del mundo.
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.controls.target);
      this.controls.enabled = true;
    }
    gameStore.getState().setFlight(on, 0);
  }

  /** Posición absoluta del foco de la cámara. */
  focusWorld(): WorldPosition {
    const t = this.controls.target;
    return { x: this.origin.x + t.x, y: this.origin.y + t.y, z: this.origin.z + t.z };
  }

  private rebaseIfNeeded(): void {
    const t = this.controls.target;
    if (this.fly || t.length() < REBASE_DISTANCE) return;
    const delta = t.clone();
    this.origin = { x: this.origin.x + delta.x, y: this.origin.y + delta.y, z: this.origin.z + delta.z };
    this.camera.position.sub(delta);
    this.controls.target.sub(delta);
    this.sectors.setOrigin(this.origin);
  }

  /** Vuela suavemente hasta una posición absoluta. */
  flyTo(target: WorldPosition, distance?: number, onDone?: () => void): void {
    const to = this.sectors.toScene(target);
    const fromDist = this.camera.position.distanceTo(this.controls.target);
    const travel = to.distanceTo(this.controls.target);
    this.fly = {
      from: this.controls.target.clone(),
      to,
      fromDist,
      toDist: distance ?? Math.min(fromDist, 60),
      t: 0,
      duration: Math.min(1.6, 0.5 + travel / 400),
      onDone,
    };
  }

  /** Salta a un sector (si está muy lejos, teletransporta sin animación). */
  goToSector(c: SectorCoord): void {
    this.setFlightMode(false);
    const o = sectorOrigin(c);
    const center = { x: o.x + SECTOR_SIZE / 2, y: o.y + SECTOR_SIZE / 2, z: o.z + SECTOR_SIZE / 2 };
    const f = this.focusWorld();
    const dist = Math.hypot(center.x - f.x, center.y - f.y, center.z - f.z);
    if (dist < SECTOR_SIZE * 6) {
      this.flyTo(center, 160);
      return;
    }
    this.fly = null;
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(160);
    this.origin = center;
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(offset);
    this.sectors.clear();
    this.sectors.setOrigin(this.origin);
    gameStore.getState().select(null);
  }

  focusSelected(): void {
    const sel = gameStore.getState().selected;
    if (!sel) return;
    this.setFlightMode(false);
    this.flyTo(sel.position, 30);
  }

  enterSelected(): void {
    const sel = gameStore.getState().selected;
    if (!sel) return;
    this.setFlightMode(false);
    this.flyTo(sel.position, 10, () => this.onEnterSystem(sel));
  }

  update(dt: number): void {
    if (this.flightMode) {
      this.flight.update(dt);
      // El "foco" en vuelo es un punto justo delante de la nave: lo usan la
      // carga de sectores, el desvanecimiento y el origen flotante.
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      this.controls.target.copy(this.camera.position).addScaledVector(forward, 20);
    } else {
      this.updateFlight(dt);
      this.updateKeyboardMovement(dt);
      this.controls.update();
    }
    this.rebaseIfNeeded();

    const focus = this.focusWorld();
    const sector = worldToSector(focus);
    this.sectors.update(sector);
    this.sectors.material.uniforms.uFocus!.value.copy(this.controls.target);
    this.sectors.material.uniforms.uScale!.value = this.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));

    if (!this.lastSector || this.lastSector.x !== sector.x || this.lastSector.y !== sector.y || this.lastSector.z !== sector.z) {
      this.lastSector = sector;
      const o = sectorOrigin(sector);
      this.sectorBox.position.copy(
        this.sectors.toScene({ x: o.x + SECTOR_SIZE / 2, y: o.y + SECTOR_SIZE / 2, z: o.z + SECTOR_SIZE / 2 }),
      );
    }

    // La interfaz no necesita la posición a 60 Hz.
    this.navTimer -= dt;
    if (this.navTimer <= 0) {
      this.navTimer = 0.2;
      gameStore.getState().setNavigation(focus, sector);
      if (this.flightMode) gameStore.getState().setFlight(true, this.flight.speed);
    }

    this.updateMarkers();
    this.backdrop.follow(this.camera);
  }

  private updateFlight(dt: number): void {
    const f = this.fly;
    if (!f) return;
    f.t = Math.min(1, f.t + dt / f.duration);
    const k = smoothstep(f.t);
    const newTarget = f.from.clone().lerp(f.to, k);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = f.fromDist + (f.toDist - f.fromDist) * k;
    this.controls.target.copy(newTarget);
    this.camera.position.copy(newTarget).addScaledVector(dir, dist);
    if (f.t >= 1) {
      this.fly = null;
      f.onDone?.();
    }
  }

  private updateKeyboardMovement(dt: number): void {
    const kb = this.keyboard;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const move = new THREE.Vector3();
    if (kb.isDown("KeyW") || kb.isDown("ArrowUp")) move.add(forward);
    if (kb.isDown("KeyS") || kb.isDown("ArrowDown")) move.sub(forward);
    if (kb.isDown("KeyD") || kb.isDown("ArrowRight")) move.add(right);
    if (kb.isDown("KeyA") || kb.isDown("ArrowLeft")) move.sub(right);
    if (kb.isDown("KeyE")) move.add(this.camera.up);
    if (kb.isDown("KeyQ")) move.sub(this.camera.up);
    if (move.lengthSq() === 0) return;
    this.fly = null;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const boost = kb.isDown("ShiftLeft") || kb.isDown("ShiftRight") ? 4 : 1;
    const speed = Math.max(15, dist * 0.9) * boost;
    move.normalize().multiplyScalar(speed * dt);
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  private updateMarkers(): void {
    const { selected, hovered } = gameStore.getState();
    if (selected) {
      const p = this.sectors.toScene(selected.position);
      this.selectRing.position.copy(p);
      this.selectRing.visible = true;
      const pos = this.link.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, this.controls.target.x, this.controls.target.y, this.controls.target.z);
      pos.setXYZ(1, p.x, p.y, p.z);
      pos.needsUpdate = true;
      this.link.computeLineDistances();
      this.link.visible = p.distanceTo(this.controls.target) > 1;
    } else {
      this.selectRing.visible = false;
      this.link.visible = false;
    }
    if (hovered && hovered.id !== selected?.id && this.controls.enabled) {
      this.hoverRing.position.copy(this.sectors.toScene(hovered.position));
      this.hoverRing.visible = true;
    } else {
      this.hoverRing.visible = false;
    }
  }

  resize(width: number, height: number): void {
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private size(): [number, number] {
    return [this.height * this.camera.aspect, this.height];
  }

  onClick(x: number, y: number): void {
    const [w, h] = this.size();
    const hit = this.sectors.pick(this.camera, x, y, w, h);
    gameStore.getState().select(hit ? hit.system : null);
  }

  onDoubleClick(x: number, y: number): void {
    const [w, h] = this.size();
    const hit = this.sectors.pick(this.camera, x, y, w, h);
    if (!hit) return;
    gameStore.getState().select(hit.system);
    this.enterSelected();
  }

  onHover(x: number, y: number): void {
    const [w, h] = this.size();
    const hit = this.sectors.pick(this.camera, x, y, w, h);
    gameStore.getState().setHovered(hit ? hit.system : null);
  }

  onKey(code: string): void {
    if (code === "KeyV") this.setFlightMode(!this.flightMode);
    else if (code === "KeyF") this.focusSelected();
    else if (code === "Enter" || code === "NumpadEnter") this.enterSelected();
    else if (code === "Escape") gameStore.getState().select(null);
  }

  dispose(): void {
    this.flight.dispose();
    this.controls.dispose();
    this.sectors.clear();
  }
}
