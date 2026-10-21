import * as THREE from "three";
import { distance, IMPACT_CAUSE, isDeepId, translate, type I18nKey, type SectorCoord, type StarSystemSummary, type WorldPosition } from "@imperium/shared";
import { isTravelling, positionAt, quantumFuelCost, regenFuel } from "@imperium/sim";
import { STAR_CLASSES } from "@imperium/procgen";
import { spaceStore } from "../net/space";
import { serverNow, worldStore } from "../net/world";
import { authStore } from "../state/auth";
import { unexploredDetail } from "../state/details";
import { findSystemSummary, gameStore } from "../state/store";
import { GalaxyView } from "./GalaxyView";
import { Keyboard } from "./input";
import { isBound, keyLabel, pixelRatioFor, settingsStore } from "../state/settings";
import { SystemView } from "./SystemView";
import { TunnelView } from "./TunnelView";
import { playQuantumJump, playQuantumTear } from "../audio/quantumSfx";
import { QuantumRift } from "./fx/quantumRift";
import { telemetry } from "./telemetry";
import type { View } from "./View";

/**
 * Motor del cliente. Vive fuera de React: tiene su propio bucle de dibujo y
 * se comunica con la interfaz solo a través del store (estado) y de sus
 * métodos públicos (órdenes de la interfaz).
 */
/** Si se vuelve a la pestaña más tarde que esto tras la llegada (ms), no se repite la salida de la grieta. */
const ARRIVAL_REPLAY_MS = 10_000;

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private keyboard: Keyboard;
  private galaxy: GalaxyView;
  private system: SystemView;
  /** Viaje cuántico: el túnel por el que va la nave mientras viaja. */
  private tunnel = new TunnelView();
  /** Efecto de la realidad que se rompe al cargar, saltar y llegar (posprocesado solo mientras dura). */
  private rift = new QuantumRift();
  private active: View;
  private timer = new THREE.Timer();
  private frameId = 0;
  /** Hora (performance.now) del último fotograma: si el navegador deja de dar fotogramas, la pestaña está en segundo plano. */
  private lastFrameAt = performance.now();
  /** Vigilante que hace avanzar el salto sin fotogramas (pestaña oculta o ventana tapada). */
  private readonly watchdog: ReturnType<typeof setInterval>;
  private resizeObserver: ResizeObserver;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private lastHover = 0;
  private unsubscribeSettings: () => void;
  /** Salto en curso seguido por la cámara: origen y destino, para entrar al llegar por el lado correcto. */
  private jumping: { from: WorldPosition; to: WorldPosition } | null = null;
  private destroyedShown = false;
  /** Fase 10: el Emperador propio estaba muerto (gestándose) en el fotograma anterior, y desde cuándo. */
  private deadSince: number | null = null;
  /** Sistema dibujado en la vista de sistema y si se dibujó sin explorar (solo la estrella). */
  private shown: { id: string; explored: boolean } | null = null;
  /** Lado por el que entró la nave la última vez que se pilotó. */
  private lastPilotFrom: THREE.Vector3 | null = null;
  private unsubscribeDetail: () => void;

  constructor(private container: HTMLElement) {
    // Profundidad logarítmica: en un sistema conviven naves de cientos de metros y estrellas a miles de km.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
    // La densidad de píxeles sale de la calidad elegida en los ajustes (protege a los
    // equipos modestos y a las pantallas 4K) y se actualiza si se cambia.
    this.renderer.setPixelRatio(pixelRatioFor(settingsStore.getState().prefs.quality, window.devicePixelRatio));
    this.unsubscribeSettings = settingsStore.subscribe((st, prev) => {
      if (st.prefs.quality !== prev.prefs.quality) this.applyQuality();
    });
    // El detalle llega del servidor (niebla de guerra), quizá después de entrar en el sistema.
    this.unsubscribeDetail = gameStore.subscribe((st, prev) => {
      if (st.detail !== prev.detail) this.onDetail();
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x02030a);
    container.appendChild(this.renderer.domElement);

    const dom = this.renderer.domElement;
    dom.tabIndex = 0;
    this.keyboard = new Keyboard((code) => this.onKey(code));
    this.galaxy = new GalaxyView(dom, this.keyboard, (s) => this.enterSystem(s));
    this.system = new SystemView(dom, this.keyboard, {
      onExit: () => this.exitSystem(),
      onLeave: (direction) => this.leaveSystem(direction),
      onQuantumJump: (target, near) => void this.quantumJump(target, near),
      notify: (key, action) => {
        const code = action ? settingsStore.getState().bindings[action][0] : undefined;
        this.notify(key, action ? { key: code ? keyLabel(code, gameStore.getState().locale) : "—" } : undefined);
      },
    });
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
    // El salto no depende de que la pestaña esté a la vista (ver `inBackground`).
    this.watchdog = setInterval(this.backgroundTick, 1000);
    document.addEventListener("visibilitychange", this.backgroundTick);
    // Como en No Man's Sky: se empieza a los mandos de la nave, en el sistema del Emperador
    // (o en el túnel cuántico, si está de viaje).
    if (!this.pilot(null) && this.emperor()?.travel) this.enterTunnel();
  }

  private applyQuality(): void {
    this.renderer.setPixelRatio(pixelRatioFor(settingsStore.getState().prefs.quality, window.devicePixelRatio));
    this.resize();
  }

  // --- Pilotaje ---

  /**
   * Teclas globales (mapa, salto); el resto, a la vista activa. J en el mapa
   * salta a la estrella elegida; al pilotar abre el selector de destinos (o, si
   * el motor ya se está cargando, lo interrumpe).
   */
  private onKey(code: string): void {
    if (isBound("toggleMap", code)) return this.toggleMap();
    if (isBound("dropOut", code) && this.jumping) return void this.dropOut();
    if (isBound("jump", code) && this.active === this.galaxy) return void this.jumpToSelected();
    if (isBound("jump", code) && this.active === this.system && this.system.isPiloting && !this.system.quantumActive) {
      const store = gameStore.getState();
      return store.setQuantumPanel(!store.quantumPanel);
    }
    if (code === "Escape" && gameStore.getState().quantumPanel) return gameStore.getState().setQuantumPanel(false);
    this.active.onKey(code);
  }

  /** Emperador propio con su viaje resuelto, o null si no hay sesión con Emperador. */
  private emperor() {
    return authStore.getState().emperor;
  }

  /**
   * Entra en el sistema donde está el Emperador y lo pilota. `from` es la
   * dirección por la que llega (la nave aparece en ese lado del borde).
   * Si el Emperador está viajando, no hace nada.
   */
  pilot(from: THREE.Vector3 | null): boolean {
    const emperor = this.emperor();
    const now = serverNow();
    // Fase 10: caído y gestándose, no hay nave que pilotar.
    if (!emperor || emperor.gestating || isTravelling(emperor, now)) return false;
    const here = emperor.travel ? emperor.travel.to : emperor.location;
    const store = gameStore.getState();
    // Espacio profundo: salió del túnel a mitad de viaje (no hay sistema; los asteroides los manda el servidor).
    if (isDeepId(here.systemId)) {
      this.galaxy.follow(null);
      this.jumping = null;
      store.select(null);
      this.system.buildDeep(here.systemId);
      this.shown = { id: here.systemId, explored: true };
      this.switchTo(this.system);
      store.setView("system");
      this.lastPilotFrom = from?.clone() ?? null;
      this.system.pilot(from);
      return true;
    }
    const summary = findSystemSummary(here.systemId);
    if (!summary) return false;
    this.galaxy.follow(null);
    this.jumping = null;
    store.select(summary);
    this.buildSystem(summary);
    this.switchTo(this.system);
    store.setView("system");
    this.lastPilotFrom = from?.clone() ?? null;
    this.system.pilot(from);
    return true;
  }

  /**
   * Alterna entre el mapa galáctico y los mandos de la nave. Durante un viaje
   * cuántico, entre el túnel y el mapa (que sigue a la nave).
   */
  toggleMap(): void {
    gameStore.getState().setQuantumPanel(false);
    if (this.active === this.tunnel) {
      this.showTravelOnMap();
    } else if (this.active === this.system) {
      this.system.stopPiloting();
      this.exitSystem();
    } else if (!this.pilot(null)) {
      if (this.emperor()?.gestating) this.notify("lineage.cannotPilot");
      else if (this.emperor()?.travel && isTravelling(this.emperor()!, serverNow())) this.enterTunnel();
      else this.notify("pilot.cannotWhileJumping");
    }
  }

  get isTravelling(): boolean {
    return this.active === this.tunnel;
  }

  get isPiloting(): boolean {
    return this.active === this.system && this.system.isPiloting;
  }

  /** La nave cruzó el borde del sistema: espacio interestelar, con la estrella a la espalda. */
  private leaveSystem(direction: THREE.Vector3): void {
    const star = gameStore.getState().selected;
    this.system.stopPiloting();
    this.switchTo(this.galaxy);
    gameStore.getState().setView("galaxy");
    if (star) this.galaxy.placeAround(star.position, direction, 14);
    gameStore.getState().select(null);
    const jumpKey = settingsStore.getState().bindings.jump[0];
    this.notify("pilot.leftSystem", { jump: jumpKey ? keyLabel(jumpKey, gameStore.getState().locale) : "—" });
  }

  /** Salto cuántico a la estrella seleccionada en el mapa: se vuelve a los mandos y empieza la secuencia. */
  async jumpToSelected(near: string | null = null): Promise<void> {
    const target = gameStore.getState().selected;
    if (target) this.startQuantum(target, near);
  }

  /**
   * Prepara el salto cuántico a `target`: a los mandos de la nave (si no lo
   * estaba), la nave se alinea con el destino y carga el motor; al terminar,
   * `quantumJump` da la orden al servidor (que comprueba combustible y alcance).
   */
  startQuantum(target: StarSystemSummary, near: string | null = null): void {
    const emperor = this.emperor();
    if (!emperor) return;
    gameStore.getState().setQuantumPanel(false);
    if (isTravelling(emperor, serverNow())) return this.notify("pilot.cannotWhileJumping");
    const here = emperor.travel ? emperor.travel.to : emperor.location;
    if (target.id === here.systemId) return this.notify("error.already_there");
    // Sin combustible para ese salto no tiene sentido alinear ni cargar: se avisa antes de la animación.
    if (this.fuelNow() < quantumFuelCost(distance(here.position, target.position))) return this.notify("error.insufficient_fuel");
    if (!(this.active === this.system && this.system.isPiloting) && !this.pilot(null)) return;
    this.system.startQuantum(target, here.position, near);
    // Ya en segundo plano (p. ej. se eligió el destino y se cambió de ventana): no se espera a la animación.
    if (this.inBackground()) this.system.skipQuantumAhead();
  }

  /** Piloto automático de crucero (al pilotar): destinos posibles, destino actual, activar y cancelar. */
  cruiseOptions() {
    return this.isPiloting ? this.system.cruiseOptions() : [];
  }

  get cruiseTarget() {
    return this.isPiloting ? this.system.cruiseTarget : null;
  }

  cruiseTo(id: string): void {
    if (this.isPiloting) this.system.cruiseTo(id);
  }

  cancelCruise(): void {
    this.system.cancelCruise("cruise.cancelled");
  }

  /** Combustible actual de la nave (en vivo si se pilota; si no, el guardado más lo regenerado). */
  private fuelNow(): number {
    const live = spaceStore.getState().supplies;
    if (live) return live.fuel;
    const flagship = worldStore.getState().flagship;
    return flagship ? regenFuel(flagship.supplies.fuel, (serverNow() - flagship.supplies.fuelAt) / 1000) : Infinity;
  }

  /** El motor cuántico está cargado: orden de salto; si el servidor la acepta, al túnel. */
  private async quantumJump(target: StarSystemSummary, near: string | null): Promise<void> {
    const error = await authStore.getState().moveEmperor(target.id, near);
    if (error) {
      this.system.cancelQuantum();
      return this.notify(error);
    }
    // La grieta se abre del todo y la nave entra (en el mundo: los demás lo ven); al cruzarla, el túnel.
    playQuantumTear(1);
    this.system.departQuantum(() => {
      playQuantumJump();
      this.rift.jump(this.renderer, this.system.scene, this.system.camera);
      this.enterTunnel();
    });
    // Sin fotogramas, la entrada en la grieta no avanzaría: al túnel directamente.
    if (this.inBackground()) this.system.skipQuantumAhead();
  }

  /**
   * ¿Está el juego en segundo plano? Pestaña oculta, o sin fotogramas desde hace
   * más de un segundo (ventana minimizada o tapada: algunos navegadores dejan
   * de dar fotogramas sin marcar la pestaña como oculta).
   */
  private inBackground(): boolean {
    return document.hidden || performance.now() - this.lastFrameAt > 1000;
  }

  /**
   * Cada segundo (los temporizadores sí corren en segundo plano, aunque más
   * despacio) y al ocultarse la pestaña: si no hay fotogramas, la secuencia del
   * salto se adelanta para que la orden llegue al servidor; el viaje y la
   * llegada los lleva el servidor por su cuenta.
   */
  private backgroundTick = (): void => {
    if (this.inBackground()) this.system.skipQuantumAhead();
  };

  /** Viaje en curso: la nave deja el sistema y se ve el túnel cuántico hasta llegar. */
  private enterTunnel(): void {
    const emperor = this.emperor();
    if (!emperor?.travel) return;
    if (this.active === this.system) this.system.stopPiloting();
    this.galaxy.follow(null);
    this.jumping = { from: emperor.location.position, to: emperor.travel.to.position };
    // Colores del túnel: de la estrella de origen a la de destino.
    const color = (id: string) => STAR_CLASSES[findSystemSummary(id)?.starClass ?? "G"].color;
    this.tunnel.setJourney(color(emperor.location.systemId), color(emperor.travel.to.systemId), emperor.travel.departAt, emperor.travel.arriveAt);
    this.switchTo(this.tunnel);
    gameStore.getState().setView("tunnel");
  }

  /**
   * Sale del túnel cuántico a mitad de viaje: el servidor deja la nave en la
   * región de espacio profundo de su posición. Al llegar el Emperador sin
   * viaje, `checkArrival` entra pilotando allí (como al llegar a un sistema).
   */
  async dropOut(): Promise<void> {
    const emperor = this.emperor();
    if (!emperor || !isTravelling(emperor, serverNow())) return;
    const error = await authStore.getState().dropEmperor();
    if (error) return this.notify(error);
    playQuantumTear(0.6);
    if (this.active !== this.tunnel) this.enterTunnel();
  }

  /** Durante el viaje, el mapa galáctico siguiendo a la nave (M vuelve al túnel). */
  private showTravelOnMap(): void {
    const emperor = this.emperor();
    if (!emperor?.travel) return;
    this.switchTo(this.galaxy);
    gameStore.getState().setView("galaxy");
    gameStore.getState().select(findSystemSummary(emperor.travel.to.systemId));
    this.galaxy.goTo(positionAt(emperor, serverNow()), 18);
    this.galaxy.follow(() => {
      const e = this.emperor();
      return e ? positionAt(e, serverNow()) : this.jumping!.to;
    });
  }

  private notify(key: I18nKey, params?: Record<string, string | number>): void {
    gameStore.getState().notify(key, params);
  }

  /**
   * Fase 10: si la nave propia cayó, explosión y aviso; unos segundos después
   * se deja de pilotar (la pantalla de la gestación cubre la interfaz). Al
   * renacer (o encarnarse en un Heredero), se vuelve a los mandos en el
   * sistema nuevo. Si el Emperador cambia de sistema mientras se pilota sin
   * viajar (encarnación), también.
   */
  private checkDestroyed(): void {
    const destroyed = spaceStore.getState().destroyed;
    if (destroyed && !this.destroyedShown) {
      this.destroyedShown = true;
      this.system.explodeOwnShip();
      if (destroyed.by === IMPACT_CAUSE) this.notify("combat.destroyedImpact");
      else this.notify("combat.destroyed", { by: destroyed.by || translate(gameStore.getState().locale, "npc.pirate") });
    }
    const emperor = this.emperor();
    const now = performance.now();
    if (emperor?.gestating) {
      this.deadSince ??= now;
      if (now - this.deadSince > 2500 && this.active === this.system && this.system.isPiloting) this.system.stopPiloting();
      return;
    }
    if (this.deadSince !== null) {
      // Ha renacido: a los mandos donde esté ahora.
      this.deadSince = null;
      spaceStore.setState({ destroyed: null });
      this.destroyedShown = false;
      if (this.active === this.system) this.system.stopPiloting();
      if (this.active !== this.tunnel) this.pilot(null);
      return;
    }
    if (destroyed && emperor && !emperor.gestating && this.destroyedShown && Date.now() - destroyed.at > 10_000) {
      // El servidor no llegó a registrar la muerte (p. ej. ya estaba muerto): se olvida el aviso.
      spaceStore.setState({ destroyed: null });
      this.destroyedShown = false;
    }
    // Encarnación estando vivo: la nave aparece en otro sistema.
    if (emperor && !emperor.travel && this.active === this.system && this.system.isPiloting && this.shown && this.shown.id !== emperor.location.systemId) {
      this.system.stopPiloting();
      this.pilot(null);
    }
  }

  /**
   * Cada fotograma: si la nave llegó de un salto y se estaba viendo el túnel (o
   * el mapa siguiéndola), se entra pilotando en el destino, en su borde.
   */
  private checkArrival(): void {
    if (!this.jumping || (this.active !== this.galaxy && this.active !== this.tunnel)) return;
    if (this.active === this.galaxy && !this.galaxy.isFollowing) {
      // El jugador movió la cámara: deja de seguir, pero no se le mete en el sistema.
      this.jumping = null;
      return;
    }
    const emperor = this.emperor();
    if (!emperor || isTravelling(emperor, serverNow())) return;
    // Volviendo a la pestaña mucho después de llegar: la nave ya está en el destino;
    // se entra pilotando allí sin repetir la salida de la grieta (los demás ya la ven aparcada).
    const late = serverNow() - (emperor.travel?.arriveAt ?? 0) > ARRIVAL_REPLAY_MS;
    const fromTunnel = this.active === this.tunnel && !late;
    if (this.pilot(null) && fromTunnel) {
      // Se abre una grieta en el destino y la nave sale de ella.
      this.system.arriveFromJump();
      this.rift.arrive();
      playQuantumTear(0.6);
    }
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
    if (this.active !== this.galaxy) this.exitSystem();
    this.galaxy.goToSector(c);
  }

  /** Centra la vista en el sistema donde está el Emperador y lo selecciona. */
  goToEmperor(): void {
    const emperor = authStore.getState().emperor;
    if (!emperor) return;
    if (this.active !== this.galaxy) this.exitSystem();
    // Si viaja, a donde está ahora; el sistema seleccionado es el de destino.
    this.galaxy.goTo(positionAt(emperor, serverNow()), 30);
    gameStore.getState().select(findSystemSummary((emperor.travel?.to ?? emperor.location).systemId));
  }

  /** Centra la vista en una flota propia y selecciona su sistema (o su destino, si viaja). */
  goToFleet(fleetId: string): void {
    const fleet = worldStore.getState().fleets[fleetId];
    if (!fleet) return;
    if (this.active !== this.galaxy) this.exitSystem();
    this.galaxy.goTo(positionAt(fleet, serverNow()), 30);
    gameStore.getState().select(findSystemSummary((fleet.travel?.to ?? fleet.location).systemId));
  }

  /**
   * Muestra en 3D una batalla de flotas: abre la vista de su sistema (si no se
   * está pilotando) y lleva la cámara hasta ella.
   */
  showBattle(battleId: string): void {
    const battle = worldStore.getState().battles[battleId];
    if (!battle || (this.active === this.system && this.system.isPiloting)) return;
    const summary = findSystemSummary(battle.systemId);
    if (!summary) return;
    if (this.active !== this.system || this.shown?.id !== summary.id) this.enterSystem(summary);
    this.system.focusBattle(battleId);
  }

  enterSystem(s: StarSystemSummary): void {
    const store = gameStore.getState();
    store.select(s);
    this.buildSystem(s);
    this.switchTo(this.system);
    store.setView("system");
  }

  exitSystem(): void {
    this.switchTo(this.galaxy);
    gameStore.getState().setView("galaxy");
  }

  // --- Interno ---

  /** Dibuja un sistema con su detalle si se conoce; si no (sin explorar o aún llegando), solo la estrella. */
  private buildSystem(s: StarSystemSummary): void {
    const detail = gameStore.getState().detail;
    const known = detail?.summary.id === s.id ? detail : null;
    this.system.build(known ?? unexploredDetail(s));
    this.shown = { id: s.id, explored: known !== null };
  }

  /** Llegó el detalle del sistema que se está viendo sin explorar: se vuelve a dibujar, con la nave si se pilotaba. */
  private onDetail(): void {
    const detail = gameStore.getState().detail;
    if (!detail || this.active !== this.system || !this.shown || this.shown.explored || this.shown.id !== detail.summary.id) return;
    const piloting = this.system.isPiloting;
    this.buildSystem(detail.summary);
    if (piloting) this.system.pilot(this.lastPilotFrom);
  }

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
    this.tunnel.resize(w, h);
  }

  private loop = (time?: number) => {
    this.frameId = requestAnimationFrame(this.loop);
    this.lastFrameAt = performance.now();
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.checkArrival();
    this.checkDestroyed();
    this.active.update(dt);
    const prefs = settingsStore.getState().prefs;
    const charge = this.active === this.system ? telemetry.quantumCharge : null;
    const low = prefs.quality === "low";
    if (this.active === this.system) {
      // Grietas del salto en el mundo: captura del fondo para su refracción (solo si hay alguna a la vista).
      this.system.camera.updateMatrixWorld();
      this.system.rifts.capture(this.renderer, this.system.scene, this.system.camera, low);
      this.rift.center = this.system.rifts.screenOf("self", this.system.camera);
    }
    if (!this.rift.render(this.renderer, this.active.scene, this.active.camera, dt, charge, { reduce: prefs.reduceEffects, low })) {
      this.renderer.render(this.active.scene, this.active.camera);
    }

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
    clearInterval(this.watchdog);
    document.removeEventListener("visibilitychange", this.backgroundTick);
    this.unsubscribeSettings();
    this.unsubscribeDetail();
    this.resizeObserver.disconnect();
    this.keyboard.dispose();
    this.galaxy.dispose();
    this.system.dispose();
    this.tunnel.dispose();
    this.rift.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
