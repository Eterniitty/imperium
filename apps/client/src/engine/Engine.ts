import * as THREE from "three";
import type { SectorCoord, StarSystemSummary } from "@imperium/shared";
import { generateSystemDetail } from "@imperium/procgen";
import { UNIVERSE_SEED } from "../config";
import { positionAt } from "@imperium/sim";
import { serverNow, worldStore } from "../net/world";
import { authStore } from "../state/auth";
import { findSystemSummary, gameStore } from "../state/store";
import { GalaxyView } from "./GalaxyView";
import { Keyboard } from "./input";
import { SystemView } from "./SystemView";
import type { View } from "./View";

/**
 * Motor del cliente. Vive fuera de React: tiene su propio bucle de dibujo y
 * se comunica con la interfaz solo a través del store (estado) y de sus
 * métodos públicos (órdenes de la interfaz).
 */
export class Engine {
  private renderer: THREE.WebGLRenderer;
  private keyboard: Keyboard;
  private galaxy: GalaxyView;
  private system: SystemView;
  private active: View;
  private timer = new THREE.Timer();
  private frameId = 0;
  private resizeObserver: ResizeObserver;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private lastHover = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    // Limitar la densidad de píxeles protege a los equipos modestos y a las pantallas 4K.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x02030a);
    container.appendChild(this.renderer.domElement);

    const dom = this.renderer.domElement;
    dom.tabIndex = 0;
    this.keyboard = new Keyboard((code) => this.active.onKey(code));
    this.galaxy = new GalaxyView(dom, this.keyboard, (s) => this.enterSystem(s));
    this.system = new SystemView(dom, () => this.exitSystem());
    this.active = this.galaxy;
    this.active.activate();

    dom.addEventListener("pointerdown", this.handlePointerDown);
    dom.addEventListener("pointerup", this.handlePointerUp);
    dom.addEventListener("pointermove", this.handlePointerMove);
    dom.addEventListener("dblclick", this.handleDoubleClick);
    dom.addEventListener("contextmenu", (e) => e.preventDefault());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  // --- Órdenes desde la interfaz ---

  focusSelected(): void {
    this.galaxy.focusSelected();
  }

  enterSelected(): void {
    this.galaxy.enterSelected();
  }

  toggleFlight(): void {
    if (this.active === this.galaxy) this.galaxy.setFlightMode(!this.galaxy.isFlying);
  }

  goToSector(c: SectorCoord): void {
    if (this.active === this.system) this.exitSystem();
    this.galaxy.goToSector(c);
  }

  /** Centra la vista en el sistema donde está el Emperador y lo selecciona. */
  goToEmperor(): void {
    const emperor = authStore.getState().emperor;
    if (!emperor) return;
    if (this.active === this.system) this.exitSystem();
    // Si viaja, a donde está ahora; el sistema seleccionado es el de destino.
    this.galaxy.goTo(positionAt(emperor, serverNow()), 30);
    gameStore.getState().select(findSystemSummary((emperor.travel?.to ?? emperor.location).systemId));
  }

  /** Centra la vista en una flota propia y selecciona su sistema (o su destino, si viaja). */
  goToFleet(fleetId: string): void {
    const fleet = worldStore.getState().fleets[fleetId];
    if (!fleet) return;
    if (this.active === this.system) this.exitSystem();
    this.galaxy.goTo(positionAt(fleet, serverNow()), 30);
    gameStore.getState().select(findSystemSummary((fleet.travel?.to ?? fleet.location).systemId));
  }

  enterSystem(s: StarSystemSummary): void {
    const store = gameStore.getState();
    store.select(s);
    const detail = store.detail ?? generateSystemDetail(UNIVERSE_SEED, s);
    this.system.build(detail);
    this.switchTo(this.system);
    store.setView("system");
  }

  exitSystem(): void {
    this.switchTo(this.galaxy);
    gameStore.getState().setView("galaxy");
  }

  // --- Interno ---

  private switchTo(view: View): void {
    if (view === this.active) return;
    this.active.deactivate();
    this.active = view;
    this.active.activate();
  }

  private toNdc(e: PointerEvent | MouseEvent): [number, number] {
    const r = this.renderer.domElement.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1];
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.renderer.domElement.focus();
  };

  private handlePointerUp = (e: PointerEvent) => {
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || e.button !== 0) return;
    // Un clic es un clic solo si no hubo arrastre (arrastrar gira la cámara).
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved < 5 && performance.now() - d.t < 450) {
      const [x, y] = this.toNdc(e);
      this.active.onClick(x, y);
    }
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (this.pointerDown) return;
    const now = performance.now();
    if (now - this.lastHover < 40) return;
    this.lastHover = now;
    const [x, y] = this.toNdc(e);
    this.active.onHover(x, y);
  };

  private handleDoubleClick = (e: MouseEvent) => {
    const [x, y] = this.toNdc(e);
    this.active.onDoubleClick(x, y);
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.galaxy.resize(w, h);
    this.system.resize(w, h);
  }

  private loop = (time?: number) => {
    this.frameId = requestAnimationFrame(this.loop);
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.active.update(dt);
    this.renderer.render(this.active.scene, this.active.camera);

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      gameStore.getState().setStats({
        fps: Math.round(this.fpsFrames / this.fpsAccum),
        loadedSectors: this.galaxy.sectors.sectorCount,
        loadedSystems: this.galaxy.sectors.systemCount,
      });
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.keyboard.dispose();
    this.galaxy.dispose();
    this.system.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
