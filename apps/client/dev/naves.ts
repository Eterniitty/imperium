/**
 * Banco de pruebas de los modelos de nave (solo desarrollo, no entra en la
 * compilación): `pnpm dev` y abrir `/dev/naves.html?id=<clase>` (o
 * `?id=flagship`, `?arch=miner&len=60`). Dibuja la nave desde ocho ángulos
 * con la luz del juego. `&rcs=1` enciende los propulsores de maniobra.
 */
import * as THREE from "three";
import { createArchetypeModel, createShipModel } from "../src/engine/shipFactory";
import { createFlagship, SHIP_SCALE, shipRig } from "../src/engine/shipModel";
import type { ShipArchetype } from "@imperium/content";

const q = new URLSearchParams(location.search);
const id = q.get("id") ?? (q.get("arch") ? `arch:${q.get("arch")}` : "flagship");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070b);
scene.add(new THREE.AmbientLight(0x5a6688, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
sun.position.set(-1, 1.4, -0.8);
scene.add(sun);

let ship: THREE.Group;
let L: number;
if (id === "flagship") {
  ship = createFlagship(0xc792ff);
  ship.scale.setScalar(SHIP_SCALE);
  L = 46;
} else if (q.get("arch")) {
  L = Number(q.get("len") ?? 60);
  ship = createArchetypeModel(q.get("arch") as ShipArchetype, L, { pods: 4 });
} else {
  ship = createShipModel(id, { noLod: true })!;
  L = ship.userData.lengthM as number;
}
scene.add(ship);
const rig = shipRig(ship);
rig.setThrust(Number(q.get("thrust") ?? 0.6));
if (q.get("rcs")) rig.setManeuver({ pitch: 1, x: 0.6 });
rig.tick(0.03, 1, 0);

const views: Array<[string, THREE.Vector3, THREE.Vector3?]> = [
  ["3/4 delante", new THREE.Vector3(-1.3, 0.8, -1.4)],
  ["3/4 detrás", new THREE.Vector3(1.0, 0.55, 1.6)],
  ["arriba", new THREE.Vector3(0, 2, 0.001), new THREE.Vector3(0, 0, -1)],
  ["abajo", new THREE.Vector3(0, -2, 0.001), new THREE.Vector3(0, 0, -1)],
  ["delante", new THREE.Vector3(0, 0.05, -2)],
  ["detrás", new THREE.Vector3(0, 0.05, 2)],
  ["babor", new THREE.Vector3(-2, 0.05, 0)],
  ["estribor", new THREE.Vector3(2, 0.05, 0)],
];
const cam = new THREE.PerspectiveCamera(30, 1, L * 0.01, L * 50);
const cols = 4;
const rows = 2;
const w = Math.floor(innerWidth / cols);
const h = Math.floor(innerHeight / rows);
cam.aspect = w / h;
cam.updateProjectionMatrix();
renderer.info.autoReset = false;
views.forEach(([, dir, up], i) => {
  const x = (i % cols) * w;
  const y = innerHeight - (Math.floor(i / cols) + 1) * h;
  cam.position.copy(dir).normalize().multiplyScalar(L * Number(q.get("dist") ?? 1.9));
  cam.up.copy(up ?? new THREE.Vector3(0, 1, 0));
  cam.lookAt(0, 0, 0);
  renderer.setViewport(x, y, w, h);
  renderer.setScissor(x, y, w, h);
  renderer.render(scene, cam);
});
const label = document.createElement("div");
label.style.cssText = "position:fixed;left:8px;top:6px;color:#9ab;font:12px monospace";
label.textContent = `${id} · ${L} m · llamadas: ${renderer.info.render.calls / views.length}`;
document.body.appendChild(label);
(window as unknown as { __ready: boolean }).__ready = true;
