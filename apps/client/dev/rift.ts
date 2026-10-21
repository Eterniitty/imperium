/**
 * Banco de pruebas de la grieta del salto cuántico (solo desarrollo):
 * `/dev/rift.html?phase=charge&k=0.6` · `phase=open&t=0.8` (entrando) ·
 * `phase=arrive&t=1` · `&view=side` (desde un lado, como la ve otro jugador) ·
 * `&reduce=1` (efectos reducidos) · `&low=1` (sin refracción).
 */
import * as THREE from "three";
import { RiftField } from "../src/engine/fx/riftPortal";
import { createFlagship, SHIP_SCALE, shipRig } from "../src/engine/shipModel";
import { FLAGSHIP_LENGTH_M } from "@imperium/content";

const q = new URLSearchParams(location.search);
const phase = q.get("phase") ?? "charge";
const reduce = q.get("reduce") === "1";
const low = q.get("low") === "1";
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
const pos = new Float32Array(4000 * 3);
for (let i = 0; i < 4000; i++) {
  const v = new THREE.Vector3().randomDirection().multiplyScalar(50_000);
  pos.set([v.x, v.y, v.z], i * 3);
}
const sg = new THREE.BufferGeometry();
sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false })));
scene.add(new THREE.AmbientLight(0x5a6688, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dd, 3);
sun.position.set(-1, 1, -0.5);
scene.add(sun);
const planet = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), new THREE.MeshStandardMaterial({ color: 0x4f7fb0, roughness: 0.8 }));
planet.position.set(-3000, 800, -30_000);
scene.add(planet);

const ship = createFlagship(0xc792ff);
ship.scale.setScalar(SHIP_SCALE);
scene.add(ship);
const rig = shipRig(ship);
const field = new RiftField();
scene.add(field.group);

const L = FLAGSHIP_LENGTH_M;
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 1e7);
if (q.get("view") === "side") {
  camera.position.set(L * 7, L * 1.5, -L * 1.5);
  camera.lookAt(0, 0, -L * 1.8);
} else if (phase === "arrive") {
  camera.position.set(L * 0.6, L * 0.5, -L * 4);
  camera.lookAt(0, 0, 0);
} else {
  camera.position.set(0, L * 0.52, L * 2.2);
  camera.lookAt(0, 0, -L * 3);
}

const k = Number(q.get("k") ?? 0.6);
const t = Number(q.get("t") ?? 0.6);
const step = 1 / 60;
let time = 0;
const advance = (sec: number) => {
  for (let s = 0; s < sec; s += step) {
    time += step;
    field.update(step, time, camera.position);
    rig.tick(time, step, 0);
  }
};
if (phase === "charge") {
  const r = field.open("self", RiftField.ahead(ship.position, ship.quaternion), ship.quaternion, reduce);
  rig.setThrust(0.3 + 0.7 * k, k > 0.5);
  // La carga sube hasta k.
  for (let s = 0; s < 3; s += step) {
    r.setCharge(k * Math.min(1, s / 2));
    advance(step);
  }
} else if (phase === "open") {
  const r = field.open("self", RiftField.ahead(ship.position, ship.quaternion), ship.quaternion, reduce);
  r.setCharge(1);
  advance(2);
  rig.setThrust(1, true);
  field.swallow("self", ship, (s) => (s.visible = false));
  advance(t);
} else {
  field.open("arrive", new THREE.Vector3(), ship.quaternion, reduce).arrive();
  // La nave sale de detrás de la grieta.
  const ease = 1 - (1 - Math.min(1, Math.max(0, (t - 0.35) / 1.85))) ** 3;
  ship.position.set(0, 0, 1.6 * L - 2.2 * L * ease);
  rig.setThrust(1, true);
  advance(t);
}
camera.updateMatrixWorld();
field.capture(renderer, scene, camera, low);
renderer.render(scene, camera);
(window as unknown as { __ready: boolean }).__ready = true;
