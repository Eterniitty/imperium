import * as THREE from "three";
import { createFlagship, disposeShip, SHIP_SCALE, shipRig } from "./shipModel";
import { glowTexture } from "./textures";
import type { View } from "./View";

const TUNNEL_LENGTH = 6000;
const TUNNEL_RADIUS = 90;
const STREAKS = 700;
const STREAK_SPEED = 1400;

/**
 * Vista del viaje cuántico: la nave del Emperador vuela por un túnel de luz
 * que se arremolina, con estelas que pasan a gran velocidad. Es solo un
 * decorado: el viaje (destino, duración, llegada) lo lleva el servidor.
 */
export class TunnelView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.5, 20_000);
  private readonly ship: THREE.Group;
  private readonly tunnel: THREE.Mesh;
  private readonly uniforms = { uTime: { value: 0 }, uColorA: { value: new THREE.Color(0x3a6dff) }, uColorB: { value: new THREE.Color(0xc792ff) } };
  private readonly streaks: THREE.Points;
  private readonly positions: Float32Array;
  private time = 0;

  constructor() {
    this.scene.background = new THREE.Color(0x01020a);
    this.scene.add(new THREE.AmbientLight(0x8090c0, 1.2));
    const light = new THREE.PointLight(0xa0c0ff, 3, 0, 0);
    light.position.set(0, 40, -200);
    this.scene.add(light);

    // Túnel: cilindro visto por dentro con un sombreado que dibuja remolinos que avanzan.
    const geo = new THREE.CylinderGeometry(TUNNEL_RADIUS, TUNNEL_RADIUS, TUNNEL_LENGTH, 64, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -TUNNEL_LENGTH / 2 + 400);
    this.tunnel = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec3 vPos;
          void main() {
            float a = atan(vPos.y, vPos.x);
            float z = vPos.z;
            // Bandas en espiral que corren hacia la cámara.
            float spiral = sin(a * 6.0 + z * 0.004 + uTime * 1.6);
            float rings = sin(z * 0.02 + uTime * 9.0 + sin(a * 3.0 + uTime) * 1.5);
            float streak = pow(max(0.0, sin(a * 23.0 + z * 0.001)), 24.0);
            float v = 0.35 + 0.35 * spiral * rings + streak * 0.9;
            // Se apaga a lo lejos y muy cerca, para que no se vea el final del tubo.
            float fade = smoothstep(${(-TUNNEL_LENGTH + 400).toFixed(1)}, -1500.0, z) * smoothstep(400.0, 0.0, z);
            vec3 col = mix(uColorA, uColorB, 0.5 + 0.5 * spiral);
            gl_FragColor = vec4(col * v * fade, 1.0);
          }`,
      }),
    );
    this.tunnel.renderOrder = -1;
    this.tunnel.frustumCulled = false;
    this.scene.add(this.tunnel);

    // Estelas: puntos que pasan a toda velocidad junto a la nave.
    this.positions = new Float32Array(STREAKS * 3);
    for (let i = 0; i < STREAKS; i++) this.placeStreak(i, -Math.random() * TUNNEL_LENGTH);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.streaks = new THREE.Points(
      sgeo,
      new THREE.PointsMaterial({ map: glowTexture(), color: 0xbfd8ff, size: 9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);

    this.ship = createFlagship(0xc792ff);
    this.ship.scale.setScalar(SHIP_SCALE);
    this.scene.add(this.ship);
    shipRig(this.ship).setThrust(1, true);
    this.camera.position.set(0, 26, 110);
    this.camera.lookAt(0, 0, -250);
  }

  private placeStreak(i: number, z: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * (TUNNEL_RADIUS - 20);
    this.positions[i * 3] = Math.cos(a) * r;
    this.positions[i * 3 + 1] = Math.sin(a) * r;
    this.positions[i * 3 + 2] = z;
  }

  activate(): void {}

  deactivate(): void {}

  update(dt: number): void {
    this.time += dt;
    this.uniforms.uTime.value = this.time % 1000;
    for (let i = 0; i < STREAKS; i++) {
      const k = i * 3 + 2;
      this.positions[k]! += STREAK_SPEED * dt;
      if (this.positions[k]! > 300) this.placeStreak(i, -TUNNEL_LENGTH + Math.random() * 400);
    }
    this.streaks.geometry.attributes.position!.needsUpdate = true;
    // La nave se mece suavemente y el túnel gira despacio alrededor.
    this.ship.position.set(Math.sin(this.time * 0.7) * 4, Math.sin(this.time * 0.9) * 3, 0);
    this.ship.rotation.z = Math.sin(this.time * 0.5) * 0.08;
    this.tunnel.rotation.z = this.time * 0.15;
    shipRig(this.ship).tick(this.time, dt, 0);
    // Un temblor leve de la cámara: se nota la velocidad.
    this.camera.position.set(Math.sin(this.time * 31) * 0.4, 26 + Math.sin(this.time * 27) * 0.4, 110);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  onClick(): void {}
  onDoubleClick(): void {}
  onHover(): void {}
  onKey(): void {}

  dispose(): void {
    this.tunnel.geometry.dispose();
    (this.tunnel.material as THREE.Material).dispose();
    this.streaks.geometry.dispose();
    (this.streaks.material as THREE.Material).dispose();
    disposeShip(this.ship);
  }
}
