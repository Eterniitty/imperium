import * as THREE from "three";
import { FLAGSHIP_LENGTH_M } from "@imperium/content";
import { settingsStore } from "../state/settings";
import { serverNow } from "../net/world";
import { createFlagship, disposeShip, SHIP_SCALE, shipRig } from "./shipModel";
import { createShipModel, shipLength } from "./shipFactory";
import { glowTexture } from "./textures";
import type { View } from "./View";

/** Medidas del túnel en esloras de la nave (así no cambian si cambia su tamaño). */
const L = FLAGSHIP_LENGTH_M;
const RADIUS = L * 2.4;
const LENGTH = L * 150;
const NEAR = L * 8;
/** Separación entre anillos de energía y velocidad con la que pasan (m/s de la escena). */
const RING_SPACING = L * 9;
const SCROLL_SPEED = L * 70;
/** El desplazamiento da la vuelta en un múltiplo exacto de la separación de los anillos (no se nota el salto). */
const SCROLL_WRAP = RING_SPACING * 400;
const STREAKS = 420;
/**
 * Cuánto se tuerce el túnel al fondo (en esloras). Por debajo de un par de
 * radios del túnel: más, y el fondo se dobla sobre sí mismo y sus tramos se
 * ven superpuestos.
 */
const BEND_X = 4.5;
const BEND_Y = 3;
/** Las frecuencias del ruido y de la curva se pensaron para una nave de 46 m: se escalan con la eslora. */
const ZS = 46 / L;

/**
 * Curva del túnel: a lo lejos se tuerce despacio (se nota que avanza y gira).
 * La misma en el sombreador de las paredes y en las estelas.
 */
const BEND_GLSL = /* glsl */ `
vec2 bend(float z, float t) {
  float d = clamp(-z / ${LENGTH.toFixed(1)}, 0.0, 1.0);
  float k = d * d;
  return vec2(sin(t * 0.21 + z * ${(0.0009 * ZS).toExponential(4)}) * ${(L * BEND_X).toFixed(1)}, cos(t * 0.17 + z * ${(0.0007 * ZS).toExponential(4)}) * ${(L * BEND_Y).toFixed(1)}) * k;
}
`;
function bend(z: number, t: number, out: THREE.Vector2): THREE.Vector2 {
  const d = Math.min(1, Math.max(0, -z / LENGTH));
  const k = d * d;
  return out.set(Math.sin(t * 0.21 + z * 0.0009 * ZS) * L * BEND_X * k, Math.cos(t * 0.17 + z * 0.0007 * ZS) * L * BEND_Y * k);
}

const WALL_VERTEX = /* glsl */ `
uniform float uTime;
varying vec3 vPos;
${BEND_GLSL}
void main() {
  vPos = position;
  vec3 p = position;
  p.xy += bend(p.z, uTime);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const WALL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uScroll;
uniform float uReduce;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uDest;
varying vec3 vPos;

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.07 + 13.3;
    a *= 0.5;
  }
  return v;
}

void main() {
  const float TAU = 6.28318;
  float a = atan(vPos.y, vPos.x) / TAU + 0.5;
  float z = vPos.z;
  float zz = (z - uScroll) * ${ZS.toExponential(4)};
  // Torsión: las estructuras giran en espiral a lo largo del túnel.
  float tw = a + zz * 0.00012 + uTime * 0.015;
  // Nubes de energía que fluyen (el ruido se repite alrededor sin costura).
  vec2 cuv = vec2(tw * 6.0, zz * 0.0011);
  float cloud = fbm(cuv + vec2(0.0, fbm(cuv * 0.7 + uTime * 0.05) * 2.0));
  // Filamentos largos, retorcidos y finos.
  float wob = fbm(vec2(tw * 9.0, zz * 0.0016)) * 4.0;
  float fil = pow(1.0 - abs(sin((tw * 24.0 + wob) * 3.14159)), 22.0);
  float fil2 = pow(1.0 - abs(sin((tw * 7.0 - wob * 0.6) * 3.14159)), 9.0) * 0.45;
  // Costillas: la estructura del túnel.
  float ribs = smoothstep(0.86, 1.0, abs(sin(tw * 3.14159 * 32.0))) * 0.18;
  // Anillos de energía que pasan (algunos más brillantes).
  float rp = (z - uScroll) / ${RING_SPACING.toFixed(1)};
  float ri = floor(rp);
  float rd = (fract(rp) - 0.5) * ${RING_SPACING.toFixed(1)};
  float ring = exp(-rd * rd / ${(L * L * 0.35).toFixed(1)}) * (0.5 + 0.8 * step(0.7, hash2(vec2(ri, 3.0))));
  ring *= 0.75 + 0.25 * sin(tw * 3.14159 * 16.0 + uTime * 4.0 * (1.0 - uReduce));

  vec3 col = mix(uColA, uColB, smoothstep(0.25, 0.8, cloud)) * (0.18 + 1.1 * cloud * cloud);
  col += mix(uColB, vec3(1.0), 0.35) * fil * (0.6 + cloud);
  col += uColA * fil2 * cloud;
  col += vec3(0.6, 0.7, 1.0) * ribs * cloud;
  // A lo lejos se funde con el resplandor del destino; muy cerca, se apaga.
  float far = smoothstep(${(-LENGTH * 0.35).toFixed(1)}, ${(-LENGTH).toFixed(1)}, z);
  // Los anillos lejanos se desvanecen (si no, al fondo se amontonan en círculos concéntricos).
  col += mix(uDest, vec3(1.0), 0.4) * ring * 1.3 * (1.0 - smoothstep(${(-LENGTH * 0.12).toFixed(1)}, ${(-LENGTH * 0.45).toFixed(1)}, z));
  col = mix(col, uDest * 0.9, far);
  float fade = smoothstep(${NEAR.toFixed(1)}, ${(NEAR * 0.2).toFixed(1)}, z) * smoothstep(${(-LENGTH).toFixed(1)}, ${(-LENGTH * 0.9).toFixed(1)}, z);
  gl_FragColor = vec4(col * fade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Colores de las paredes según la estrella (origen al principio, destino al final). */
function paletteFor(star: number): { a: THREE.Color; b: THREE.Color; dest: THREE.Color } {
  const c = new THREE.Color(star);
  return {
    a: new THREE.Color(0x2a4dff).lerp(c, 0.25),
    b: new THREE.Color(0x9a5cff).lerp(c, 0.35),
    dest: c.clone().lerp(new THREE.Color(0xffffff), 0.2),
  };
}

/**
 * Vista del viaje cuántico: la nave del Emperador vuela, vista desde fuera y
 * con los motores encendidos, por un túnel de energía que se retuerce a lo
 * lejos: nubes que fluyen, filamentos, costillas y anillos que pasan a toda
 * velocidad (y la iluminan al pasar), estelas y, al fondo, el resplandor de la
 * estrella de destino. Los colores pasan de los de la estrella de origen a los
 * del destino a medida que avanza el viaje. Es solo un decorado: el viaje
 * (destino, duración, llegada) lo lleva el servidor. Solo se dibuja mientras se
 * viaja: fuera del túnel no cuesta nada.
 */
export class TunnelView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.5, LENGTH * 2);
  private ship: THREE.Group;
  private readonly tunnel: THREE.Mesh;
  private readonly uniforms = {
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uReduce: { value: 0 },
    uColA: { value: new THREE.Color(0x3a6dff) },
    uColB: { value: new THREE.Color(0xc792ff) },
    uDest: { value: new THREE.Color(0xfff1c4) },
  };
  private readonly streaks: THREE.LineSegments;
  private readonly streakPos: Float32Array;
  private readonly streakBase: Float32Array;
  private readonly destGlow: THREE.Sprite;
  private readonly ringLight = new THREE.PointLight(0xffffff, 0, RADIUS * 3, 2);
  private readonly keyLight = new THREE.PointLight(0xffffff, 0, 0, 2);
  private time = 0;
  private scroll = 0;
  private journey: { from: { a: THREE.Color; b: THREE.Color; dest: THREE.Color }; to: { a: THREE.Color; b: THREE.Color; dest: THREE.Color }; departAt: number; arriveAt: number } | null = null;
  private tmp2 = new THREE.Vector2();
  private camPos = new THREE.Vector3(0, L * 0.55, L * 2.4);
  /** Qué nave se dibuja: "flagship" o la clase de la nodriza en la que va acoplado. */
  private vessel = "flagship";

  constructor() {
    this.scene.background = new THREE.Color(0x01020a);
    this.scene.add(new THREE.AmbientLight(0x6070a0, 0.6));
    this.scene.add(this.ringLight, this.keyLight);

    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, LENGTH + NEAR, 96, 160, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -(LENGTH - NEAR) / 2);
    this.tunnel = new THREE.Mesh(
      geo,
      // Con profundidad: donde el túnel se curva, el tramo cercano tapa al lejano (sin ella se veían superpuestos).
      new THREE.ShaderMaterial({ uniforms: this.uniforms, side: THREE.BackSide, vertexShader: WALL_VERTEX, fragmentShader: WALL_FRAGMENT }),
    );
    this.tunnel.renderOrder = -1;
    this.tunnel.frustumCulled = false;
    this.scene.add(this.tunnel);

    // Estelas: rayas de luz que pasan junto a la nave (más largas cuanto más cerca de la pared).
    this.streakPos = new Float32Array(STREAKS * 6);
    this.streakBase = new Float32Array(STREAKS * 4);
    const colors = new Float32Array(STREAKS * 6);
    for (let i = 0; i < STREAKS; i++) {
      this.placeStreak(i, NEAR - Math.random() * LENGTH);
      // Cabeza brillante, cola apagada.
      colors.set([0.75, 0.85, 1.0, 0.0, 0.0, 0.05], i * 6);
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(this.streakPos, 3));
    sgeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.streaks = new THREE.LineSegments(sgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);

    // El resplandor del destino, dentro del túnel al fondo (las paredes que se interponen lo tapan).
    this.destGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1c4, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.destGlow.renderOrder = 1;
    this.scene.add(this.destGlow);

    this.ship = createFlagship(0xc792ff);
    this.ship.scale.setScalar(SHIP_SCALE);
    this.scene.add(this.ship);
    shipRig(this.ship).setThrust(1, true);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(0, 0, -L * 6);
  }

  /**
   * Viaje que se muestra: colores de las estrellas de origen y destino y
   * horas de salida y llegada (del servidor) para el avance.
   */
  setJourney(fromStar: number, toStar: number, departAt: number, arriveAt: number): void {
    this.journey = { from: paletteFor(fromStar), to: paletteFor(toStar), departAt, arriveAt };
  }

  /**
   * Nave que viaja por el túnel: la del Emperador o, si va acoplado en el hangar
   * de una nodriza, la nodriza (escalada para que quepa a la vista como la suya).
   */
  setVessel(classId: string | null): void {
    const key = classId ?? "flagship";
    if (this.vessel === key) return;
    this.vessel = key;
    const model = classId ? createShipModel(classId) : null;
    const next = model ?? createFlagship(0xc792ff);
    if (model) next.scale.setScalar((L * 1.15) / Math.max(1, shipLength(classId!) ?? L));
    else next.scale.setScalar(SHIP_SCALE);
    this.scene.remove(this.ship);
    disposeShip(this.ship);
    this.ship = next;
    this.scene.add(this.ship);
    shipRig(this.ship).setThrust(1, true);
  }

  /** Radio aleatorio (más cerca de la pared que del centro), ángulo y largo de una estela. */
  private placeStreak(i: number, z: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = RADIUS * (0.35 + 0.6 * Math.sqrt(Math.random()));
    this.streakBase.set([Math.cos(a) * r, Math.sin(a) * r, z, L * (0.6 + 2.4 * (r / RADIUS) ** 2)], i * 4);
  }

  activate(): void {}

  deactivate(): void {}

  update(dt: number): void {
    const reduce = settingsStore.getState().prefs.reduceEffects;
    this.time += dt;
    this.scroll = (this.scroll + SCROLL_SPEED * dt) % SCROLL_WRAP;
    const u = this.uniforms;
    u.uTime.value = this.time % 1000;
    u.uScroll.value = this.scroll;
    u.uReduce.value = reduce ? 1 : 0;

    // Colores: de la estrella de origen a la de destino según el avance.
    const j = this.journey;
    const k = j ? Math.min(1, Math.max(0, (serverNow() - j.departAt) / Math.max(1, j.arriveAt - j.departAt))) : 0.5;
    if (j) {
      u.uColA.value.copy(j.from.a).lerp(j.to.a, k);
      u.uColB.value.copy(j.from.b).lerp(j.to.b, k);
      u.uDest.value.copy(j.to.dest);
    }

    // Estelas: corren hacia la cámara siguiendo la curva del túnel.
    const b = this.tmp2;
    for (let i = 0; i < STREAKS; i++) {
      let z = (this.streakBase[i * 4 + 2]! += SCROLL_SPEED * 1.6 * dt);
      if (z > NEAR) {
        this.placeStreak(i, -LENGTH * (0.7 + Math.random() * 0.3));
        z = this.streakBase[i * 4 + 2]!;
      }
      const x = this.streakBase[i * 4]!;
      const y = this.streakBase[i * 4 + 1]!;
      const len = this.streakBase[i * 4 + 3]!;
      bend(z, this.time % 1000, b);
      this.streakPos.set([x + b.x, y + b.y, z], i * 6);
      bend(z - len, this.time % 1000, b);
      this.streakPos.set([x + b.x, y + b.y, z - len], i * 6 + 3);
    }
    this.streaks.geometry.attributes.position!.needsUpdate = true;

    // Resplandor del destino al fondo: crece al acercarse.
    bend(-LENGTH * 0.95, this.time % 1000, b);
    this.destGlow.position.set(b.x, b.y, -LENGTH * 0.95);
    // Del ancho del túnel: más grande, las paredes lo recortarían con un borde duro.
    this.destGlow.scale.setScalar(RADIUS * (2.2 + 1.6 * k));
    this.destGlow.material.color.copy(u.uDest.value);
    this.destGlow.material.opacity = 0.5 + 0.4 * k;

    // Luces: los anillos iluminan la nave al pasar; el destino, de frente.
    const ringPhase = (((-this.scroll) % RING_SPACING) + RING_SPACING) % RING_SPACING;
    const ringZ = ringPhase - RING_SPACING / 2;
    this.ringLight.position.set(0, RADIUS * 0.6, ringZ);
    this.ringLight.color.copy(u.uDest.value).lerp(u.uColB.value, 0.4);
    this.ringLight.intensity = Math.exp(-((ringZ / (L * 2)) ** 2)) * (RADIUS * 1.2) ** 2 * (reduce ? 3 : 6);
    this.keyLight.position.set(0, L * 0.8, -L * 5);
    this.keyLight.color.copy(u.uDest.value);
    this.keyLight.intensity = (L * 5) ** 2 * (0.8 + 1.2 * k);

    // La nave se mece y alabea suave; el túnel la envuelve.
    this.ship.position.set(Math.sin(this.time * 0.7) * L * 0.09, Math.sin(this.time * 0.9) * L * 0.065, 0);
    this.ship.rotation.set(Math.sin(this.time * 0.6) * 0.03, Math.sin(this.time * 0.4) * 0.04, Math.sin(this.time * 0.5) * 0.1);
    const rig = shipRig(this.ship);
    rig.setThrust(1, true);
    rig.tick(this.time, dt, 0);

    // Cámara en tercera persona que gira despacio alrededor de la nave; temblor y respiración del campo de visión.
    const orbit = Math.sin(this.time * 0.07) * 0.55;
    const lift = 0.45 + 0.2 * Math.sin(this.time * 0.05);
    this.camPos.set(Math.sin(orbit) * L * 2.4, L * lift, Math.cos(orbit) * L * 2.4);
    const shake = reduce ? 0 : L * 0.006;
    this.camera.position.copy(this.camPos).add(new THREE.Vector3(Math.sin(this.time * 31) * shake, Math.sin(this.time * 27) * shake, 0));
    this.camera.lookAt(this.ship.position.x * 0.5, this.ship.position.y * 0.5, -L * 4);
    const fov = 62 + (reduce ? 0 : 3 * Math.exp(-((ringZ / (L * 3)) ** 2)));
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
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
    this.destGlow.material.dispose();
    disposeShip(this.ship);
  }
}
