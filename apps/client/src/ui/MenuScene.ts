import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { ShipCustomization } from "@imperium/content";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { animateCustomShip, createCustomShip, disposeCustomShip, setShipPose, type ShipPose } from "../engine/ship/customShip";

/**
 * Hangar en 3D del menú principal y del editor de la nave: la nave del jugador
 * (la cañonera personalizada, `engine/ship/customShip.ts`) flotando sobre su
 * plataforma, con la compuerta abierta al espacio. Todo generado aquí, sin
 * texturas ni archivos.
 *
 * En metros. En el modo editor la cámara se mueve con el ratón (arrastrar para
 * girar, rueda para acercar) y se puede ver el interior.
 */
export class MenuScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 6000);
  private ship: THREE.Group;
  private style: ShipCustomization;
  private interior = false;
  private mode: "menu" | "editor" = "menu";
  /** Cámara del editor: ángulos y distancia alrededor de la nave. */
  private orbit = { yaw: 0.8, pitch: 0.2, distance: 62 };
  private drag: { x: number; y: number } | null = null;
  private readonly dust: THREE.Points;
  private readonly planetMaterial: THREE.ShaderMaterial;
  private readonly padRings: THREE.Mesh[] = [];
  private readonly envTarget: THREE.WebGLRenderTarget;
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly smaa: SMAAPass;
  private pose: ShipPose = { gearDown: true, wingsOpen: true };
  private frame = 0;
  private last = performance.now();
  private readonly start = performance.now();

  constructor(
    private readonly container: HTMLElement,
    private readonly still: boolean,
    style: ShipCustomization,
  ) {
    this.style = style;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.setClearColor(0x02040a, 1);
    // Sombras suaves de los focos del techo.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Reflejos suaves en los metales (entorno de estudio generado).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.35;
    this.scene.fog = new THREE.Fog(0x05070d, 80, 480);

    // Posproceso: oclusión ambiental (rincones y uniones), resplandor de las luces y suavizado.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1 });
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.4, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);

    this.buildHangar();
    this.buildOutside();

    // La nave, flotando sobre la plataforma.
    this.ship = this.makeShip();
    this.scene.add(this.ship);

    // Polvo que flota en la luz.
    const count = 600;
    const dustPos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) dustPos.set([(Math.random() - 0.5) * 70, Math.random() * 26, (Math.random() - 0.5) * 80], i * 3);
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.08, transparent: true, opacity: 0.35, depthWrite: false }));
    this.scene.add(this.dust);

    this.planetMaterial = this.makePlanetMaterial();
    const planet = new THREE.Mesh(new THREE.SphereGeometry(140, 96, 64), this.planetMaterial);
    planet.position.set(-120, -40, -900);
    planet.rotation.z = 0.35;
    this.scene.add(planet);

    this.resize();
    window.addEventListener("resize", this.resize);
    const canvas = this.renderer.domElement;
    canvas.style.pointerEvents = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.loop();
  }

  private makeShip(): THREE.Group {
    const { group } = createCustomShip(this.style, { interior: this.interior, landed: true, pose: { ...this.pose } });
    group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o.material instanceof THREE.MeshBasicMaterial)) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // De tres cuartos: la proa hacia la cámara y la compuerta detrás.
    group.rotation.y = 2.3;
    return group;
  }

  /** Cambia la nave (personalización nueva o vista del interior). */
  setStyle(style: ShipCustomization, interior = this.interior): void {
    this.style = style;
    this.interior = interior;
    this.scene.remove(this.ship);
    disposeCustomShip(this.ship);
    this.ship = this.makeShip();
    this.scene.add(this.ship);
    if (this.still) this.loop();
  }

  /** Tren y alas (se animan hacia la postura pedida). */
  setPose(pose: Partial<ShipPose>): void {
    Object.assign(this.pose, pose);
    setShipPose(this.ship, pose);
  }

  /** Menú (cámara que flota sola) o editor (cámara con el ratón). */
  setMode(mode: "menu" | "editor"): void {
    this.mode = mode;
    const canvas = this.renderer.domElement;
    canvas.style.pointerEvents = mode === "editor" ? "auto" : "none";
    if (this.still) this.loop();
  }

  private readonly onDown = (e: PointerEvent) => {
    if (this.mode !== "editor") return;
    this.drag = { x: e.clientX, y: e.clientY };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private readonly onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    this.orbit.yaw -= (e.clientX - this.drag.x) * 0.006;
    this.orbit.pitch = Math.min(1.2, Math.max(-0.1, this.orbit.pitch + (e.clientY - this.drag.y) * 0.004));
    this.drag = { x: e.clientX, y: e.clientY };
    if (this.still) this.loop();
  };
  private readonly onUp = () => {
    this.drag = null;
  };
  private readonly onWheel = (e: WheelEvent) => {
    if (this.mode !== "editor") return;
    e.preventDefault();
    this.orbit.distance = Math.min(110, Math.max(20, this.orbit.distance * (1 + Math.sign(e.deltaY) * 0.08)));
    if (this.still) this.loop();
  };

  /** Suelo de placas, plataforma, columnas, techo con tiras de luz y marco de la compuerta. */
  private buildHangar(): void {
    const W = 96; // ancho (x)
    const L = 110; // largo (z); la compuerta en z = -L/2
    const H = 26; // alto

    // Suelo: placas oscuras con juntas y franjas de aviso, en una textura de lienzo.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#1a1d23";
    g.fillRect(0, 0, 1024, 1024);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const shade = 24 + Math.floor(Math.random() * 10);
        g.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
        g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
      }
    }
    g.strokeStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i <= 1024; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 1024);
      g.moveTo(0, i);
      g.lineTo(1024, i);
      g.stroke();
    }
    const floorTexture = new THREE.CanvasTexture(canvas);
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(2, 3);
    floorTexture.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.75, metalness: 0.45 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.buildMarkings();
    this.buildProps();

    // Franjas de aviso amarillas y negras junto a la compuerta.
    const hazard = document.createElement("canvas");
    hazard.width = 512;
    hazard.height = 32;
    const hg = hazard.getContext("2d")!;
    for (let i = -1; i < 18; i++) {
      hg.fillStyle = i % 2 ? "#e0a82e" : "#15161a";
      hg.beginPath();
      hg.moveTo(i * 32, 32);
      hg.lineTo(i * 32 + 32, 0);
      hg.lineTo(i * 32 + 64, 0);
      hg.lineTo(i * 32 + 32, 32);
      hg.fill();
    }
    const hazardTexture = new THREE.CanvasTexture(hazard);
    hazardTexture.colorSpace = THREE.SRGBColorSpace;
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.5), new THREE.MeshStandardMaterial({ map: hazardTexture, roughness: 0.7 }));
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.02, -L / 2 + 2);
    this.scene.add(stripe);

    // Plataforma: anillos de luz bajo la nave.
    for (const [inner, outer, color] of [
      [14, 14.6, 0x6fc8ff],
      [18, 18.3, 0x4fa8ff],
      [6, 6.4, 0xc792ff],
    ] as const) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      this.scene.add(ring);
      this.padRings.push(ring);
    }
    const padLight = new THREE.PointLight(0x6fb8ff, 50, 40, 2);
    padLight.position.set(0, 1.5, 0);
    this.scene.add(padLight);

    // Paredes, columnas y techo.
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8, metalness: 0.4 });
    const ribMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f49, roughness: 0.5, metalness: 0.7 });
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false });
    const accentMaterial = new THREE.MeshBasicMaterial({ color: 0x4fa8ff, toneMapped: false });
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1, H, L), wallMaterial);
      wall.position.set((side * W) / 2, H / 2, 0);
      this.scene.add(wall);
      for (let z = -L / 2 + 6; z <= L / 2 - 4; z += 10) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(2.2, H, 1.6), ribMaterial);
        rib.position.set((side * (W - 2.4)) / 2, H / 2, z);
        this.scene.add(rib);
        // Luz azul a media altura en cada columna.
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.4), accentMaterial);
        lamp.position.set((side * (W - 5)) / 2, 6, z);
        this.scene.add(lamp);
      }
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 1), wallMaterial);
    back.position.set(0, H / 2, L / 2);
    this.scene.add(back);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(W, 1, L), wallMaterial);
    ceiling.position.set(0, H, 0);
    this.scene.add(ceiling);
    for (const x of [-16, 0, 16]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, L - 12), glowMaterial);
      strip.position.set(x, H - 0.6, 4);
      this.scene.add(strip);
    }
    for (const [x, z] of [
      [-16, -20],
      [16, -20],
      [-16, 20],
      [16, 20],
    ] as const) {
      const light = new THREE.PointLight(0xfff0dc, 28, 60, 2);
      light.position.set(x, H - 2, z);
      this.scene.add(light);
    }
    // Dos focos sobre la plataforma que dan las sombras de la nave.
    for (const [x, z, k] of [
      [-10, 8, 420],
      [12, -10, 280],
    ] as const) {
      const spot = new THREE.SpotLight(0xfff2e0, k, 80, 0.62, 0.55, 1.6);
      spot.position.set(x, H - 1.5, z);
      spot.target.position.set(0, 0, 0);
      spot.castShadow = true;
      spot.shadow.mapSize.set(2048, 2048);
      spot.shadow.bias = -0.0002;
      spot.shadow.normalBias = 0.02;
      spot.shadow.radius = 4;
      this.scene.add(spot, spot.target);
    }

    // Marco de la compuerta con luces rojas de aviso.
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.4, metalness: 0.8 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(W, 4, 3), frameMaterial);
    top.position.set(0, H - 2, -L / 2);
    this.scene.add(top);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(4, H, 3), frameMaterial);
      post.position.set((side * (W - 4)) / 2, H / 2, -L / 2);
      this.scene.add(post);
      for (const y of [4, 12, 20]) {
        const warn = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xff3a2a, toneMapped: false }));
        warn.position.set((side * (W - 8)) / 2, y, -L / 2 + 1.6);
        this.scene.add(warn);
      }
    }
    // Campo de la compuerta: un velo azul casi transparente.
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 8, H - 4),
      new THREE.MeshBasicMaterial({ color: 0x4fa8ff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    field.position.set(0, (H - 4) / 2, -L / 2 - 0.5);
    this.scene.add(field);

    this.scene.add(new THREE.HemisphereLight(0x8aa4c8, 0x10131a, 0.35));
  }

  /** Marcas pintadas en el suelo: círculo de aterrizaje, esquinas naranjas, número de la plataforma y líneas de paso. */
  private buildMarkings(): void {
    const paint = (color: number, opacity = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1, transparent: true, opacity, polygonOffset: true, polygonOffsetFactor: -2 });
    const circle = new THREE.Mesh(new THREE.RingGeometry(21, 21.35, 128), paint(0xe8e6e0, 0.85));
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.02;
    circle.receiveShadow = true;
    this.scene.add(circle);
    // Trazos naranjas alrededor del círculo y en las esquinas del puesto.
    const orange = paint(0xe0782a);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 3.2), orange);
      dash.rotation.set(-Math.PI / 2, 0, a);
      dash.position.set(Math.cos(a) * 24, 0.021, Math.sin(a) * 24);
      dash.receiveShadow = true;
      this.scene.add(dash);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const [w, l, dx, dz] of [[6, 0.45, -3, 0], [0.45, 6, 0, -3]] as const) {
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, l), orange);
          bar.rotation.x = -Math.PI / 2;
          bar.position.set(sx * (28 + dx * sx), 0.021, sz * (30 + dz * sz));
          this.scene.add(bar);
        }
      }
    }
    // Número de la plataforma pintado en el suelo.
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "rgba(232,230,224,0.85)";
    g.font = "bold 200px 'Rajdhani', 'Arial Narrow', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("A-01", 256, 130);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.022, 27);
    this.scene.add(label);
    // Líneas de paso de los operarios, en amarillo.
    for (const sx of [-1, 1]) {
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 90), paint(0xd8b02a, 0.7));
      lane.rotation.x = -Math.PI / 2;
      lane.position.set(sx * 36, 0.021, 0);
      this.scene.add(lane);
    }
  }

  /** Atrezo: caja de herramientas, cajas y un foco portátil. */
  private buildProps(): void {
    const orange = new THREE.MeshStandardMaterial({ color: 0xd8682a, roughness: 0.55, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.35, metalness: 0.85 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.9 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    // Caja de herramientas con cajones.
    const tx = -18;
    const tz = 12;
    add(new THREE.BoxGeometry(2.6, 1.6, 1.2), orange, tx, 0.95, tz, -0.3);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(2.4, 0.04, 0.02), dark, tx, 0.5 + i * 0.32, tz + 0.61, -0.3);
    for (const dx of [-1.1, 1.1]) add(new THREE.CylinderGeometry(0.12, 0.12, 0.15, 12), rubber, tx + dx, 0.08, tz, -0.3);
    // Cajas apiladas junto a la pared.
    const crate = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.7, metalness: 0.4 });
    for (const [x, y, z, s, r] of [
      [-38, 1, -12, 2, 0.1],
      [-35.6, 1, -12.4, 2, -0.15],
      [-37, 3, -12.2, 2, 0.3],
      [-38, 0.75, -8, 1.5, 0],
      [38, 1.2, 20, 2.4, 0.2],
      [36, 0.8, 23, 1.6, -0.3],
    ] as const) {
      add(new THREE.BoxGeometry(s, s, s), crate, x, y, z, r);
      add(new THREE.BoxGeometry(s * 1.02, s * 0.08, s * 1.02), orange, x, y + s * 0.3, z, r);
    }
    // Foco portátil apuntando a la nave.
    add(new THREE.CylinderGeometry(0.05, 0.05, 3, 8), steel, -14, 1.5, -12);
    const head = add(new THREE.CylinderGeometry(0.45, 0.3, 0.6, 16).rotateX(Math.PI / 2), dark, -14, 3.1, -12, -0.9);
    head.rotation.x = 0.4;
    const lamp = new THREE.SpotLight(0xd8ecff, 140, 40, 0.45, 0.6, 1.5);
    lamp.position.set(-14, 3.2, -12);
    lamp.target.position.set(0, 2, 0);
    this.scene.add(lamp, lamp.target);
  }

  /** Lo que se ve por la compuerta: estrellas y el sol. */
  private buildOutside(): void {
    const count = 3000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Solo por delante (hacia −z), que es lo que se ve por la compuerta.
      const z = -Math.random();
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      positions.set([Math.cos(a) * r * 2500, Math.sin(a) * r * 2500, z * 2500 - 100], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xe8eeff, size: 1.6, sizeAttenuation: false, fog: false }));
    this.scene.add(stars);
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
    sun.position.set(-0.6, 0.4, -1);
    this.scene.add(sun);
  }

  /** Planeta lejano con océanos, continentes y borde de atmósfera (sombreador propio). */
  private makePlanetMaterial(): THREE.ShaderMaterial {
    const sun = new THREE.Vector3(-0.6, 0.4, 1).normalize();
    return new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sun } },
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vPos = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun;
        varying vec3 vPos;
        varying vec3 vNormal;
        varying vec3 vView;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          vec3 p = normalize(vPos);
          float h = fbm(p * 2.2 + 3.0);
          float land = smoothstep(0.5, 0.53, h);
          vec3 ocean = mix(vec3(0.02, 0.10, 0.28), vec3(0.08, 0.42, 0.62), smoothstep(0.35, 0.5, h));
          vec3 green = mix(vec3(0.13, 0.36, 0.16), vec3(0.55, 0.5, 0.32), smoothstep(0.55, 0.7, h));
          vec3 col = mix(ocean, green, land);
          col = mix(col, vec3(0.92, 0.95, 1.0), smoothstep(0.72, 0.82, abs(p.y) + (h - 0.5) * 0.3));
          float diffuse = max(dot(normalize(vNormal), uSun), 0.0);
          float rim = pow(1.0 - max(dot(normalize(vNormal), vView), 0.0), 3.0);
          vec3 lit = col * (0.03 + 1.1 * diffuse) + vec3(0.35, 0.65, 1.0) * rim * (0.2 + diffuse);
          gl_FragColor = vec4(lit, 1.0);
        }`,
    });
  }

  private readonly resize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private readonly loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t = this.still ? 8 : (now - this.start) / 1000;
    // La cámara recorre despacio un arco por el lado de la nave (el menú va a la izquierda).
    const wide = this.camera.aspect > 1;
    if (this.mode === "editor") {
      // El editor deja la nave a la derecha del panel de opciones (a la izquierda).
      const { yaw, pitch } = this.orbit;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      // La cámara nunca sale del hangar: se acorta la distancia hasta quedar dentro de las paredes.
      let distance = this.orbit.distance;
      const inside = (d: number) => Math.abs(dir.x * d) < 44 && Math.abs(dir.z * d) < 50 && 4.5 + dir.y * d < 23 && 4.5 + dir.y * d > 1;
      while (distance > 12 && !inside(distance)) distance *= 0.95;
      this.camera.position.set(dir.x * distance, 4.5 + dir.y * distance, dir.z * distance);
      const right = new THREE.Vector3().subVectors(new THREE.Vector3(0, 4.5, 0), this.camera.position).cross(new THREE.Vector3(0, 1, 0)).normalize();
      const target = new THREE.Vector3(0, 4.5, 0).addScaledVector(right, wide ? -distance * 0.16 : 0);
      this.camera.lookAt(target);
    } else {
      const angle = 0.75 + Math.sin(t * 0.04) * 0.25;
      const radius = wide ? 46 : 62;
      this.camera.position.set(Math.sin(angle) * radius, 8 + Math.sin(t * 0.06) * 1.5, Math.cos(angle) * radius);
      this.camera.lookAt(wide ? -12 : 0, 4, -4);
    }
    animateCustomShip(this.ship, t, dt);
    this.dust.rotation.y = t * 0.01;
    this.dust.position.y = Math.sin(t * 0.1) * 0.5;
    const pulse = 0.65 + 0.25 * Math.sin(t * 1.6);
    for (const ring of this.padRings) (ring.material as THREE.MeshBasicMaterial).opacity = pulse;
    this.composer.render(dt);
    if (!this.still) this.frame = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("wheel", this.onWheel);
    this.scene.remove(this.ship);
    disposeCustomShip(this.ship);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    this.envTarget.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
