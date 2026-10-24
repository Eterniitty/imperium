/**
 * Banco de la nave personalizable (solo desarrollo, no entra en la compilación):
 * `pnpm dev` y abrir `/dev/custom.html?view=<vista>`: una vista a pantalla
 * completa (ortográficas `top`, `side`, `front`, `rear`, `belly`, con cuadrícula
 * de 1 m y 5 m; de cerca `q1`, `q2`, `low`, `cockpit`, `nose`, `engine`,
 * `exhaust`, `gear`, `spine`; o `cam=x,y,z&at=x,y,z`).
 * Parámetros: `wings`, `engines`, `nose`, `extras` (separados por comas),
 * `pattern`, `interior=1`, `gear=0`, `fold=1`.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GUNSHIP, normalizeShipCustomization } from "@imperium/content";
import { animateCustomShip, createCustomShip, setShipPose } from "../src/engine/ship/customShip";

const q = new URLSearchParams(location.search);
const d = GUNSHIP.defaults;
const style = normalizeShipCustomization({
  ...d,
  pattern: q.get("pattern") ?? d.pattern,
  parts: {
    nose: q.get("nose") ?? d.parts.nose,
    wings: q.get("wings") ?? d.parts.wings,
    engines: q.get("engines") ?? d.parts.engines,
    extras: q.has("extras") ? q.get("extras")!.split(",").filter(Boolean) : d.parts.extras,
  },
});
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
sun.position.set(-6, 10, -4);
scene.add(sun, new THREE.AmbientLight(0x8090b0, 0.4));

const { group, info } = createCustomShip(style, { interior: q.get("interior") === "1", landed: true, pose: { gearDown: q.get("gear") !== "0", wingsOpen: q.get("fold") !== "1" } });
scene.add(group);
setShipPose(group, { gearDown: q.get("gear") !== "0", wingsOpen: q.get("fold") !== "1" });
// Deja las articulaciones en su postura final.
for (let i = 0; i < 400; i++) animateCustomShip(group, i * 0.05, 0.05);

const box = new THREE.Box3().setFromObject(group);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
(document.getElementById("tag") as HTMLElement).textContent =
  `eslora ${size.z.toFixed(1)} m · manga ${size.x.toFixed(1)} m · alto ${size.y.toFixed(1)} m · casco ${info.length.toFixed(1)} m`;

const grid = new THREE.GridHelper(80, 80, 0x3a4250, 0x2a303a);
scene.add(grid);
const grid5 = new THREE.GridHelper(80, 16, 0x5a6578, 0x5a6578);
grid5.position.y = 0.01;
scene.add(grid5);

// Una sola vista a pantalla completa (`view`), o una cámara libre (`cam=x,y,z&at=x,y,z`, en metros desde el centro).
const R = Math.max(size.x, size.z) * 0.55;
const aspect = innerWidth / innerHeight;
const view = q.get("view") ?? "q1";
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const parse = (v: string | null) => (v ? V(...(v.split(",").map(Number) as [number, number, number])) : null);
const ORTHO: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  top: [V(0, 1, 0), V(0, 0, -1)],
  side: [V(1, 0, 0), V(0, 1, 0)],
  front: [V(0, 0, -1), V(0, 1, 0)],
  rear: [V(0, 0, 1), V(0, 1, 0)],
  belly: [V(0, -1, 0), V(0, 0, -1)],
};
// Vistas de cerca: [posición, objetivo] relativas al centro de la nave.
const L = size.z;
const CLOSE: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  q1: [V(R * 0.95, R * 0.5, -R * 1.05), V(0, 0, -1)],
  q2: [V(-R * 1.0, R * 0.6, R * 1.0), V(0, 0, 1)],
  low: [V(R * 1.5, -R * 0.15, -R * 1.2), V(0, 0, -L * 0.05)],
  cockpit: [V(6, 5, -L / 2 - 2), V(0, 1, -L / 2 + 8)],
  nose: [V(-7, 0.5, -L / 2 - 4), V(0, 0, -L / 2 + 5)],
  engine: [V(10, 3, -2), V(4, 0, 4)],
  exhaust: [V(-8, 2, L / 2 + 8), V(-2, 0, 3)],
  gear: [V(7, -1.2, -3), V(0, -2.5, 2)],
  spine: [V(3, 7, 4), V(0, 1.5, 6)],
};
let cam: THREE.Camera;
const cp = parse(q.get("cam"));
if (ORTHO[view] && !cp) {
  const [dir, up] = ORTHO[view]!;
  const o = new THREE.OrthographicCamera(-R * aspect, R * aspect, R, -R, 0.1, 500);
  o.position.copy(center).addScaledVector(dir, 100);
  o.up.copy(up);
  o.lookAt(center);
  cam = o;
} else {
  const [pos, target] = cp ? [cp, parse(q.get("at")) ?? V(0, 0, 0)] : (CLOSE[view] ?? CLOSE.q1!);
  const p = new THREE.PerspectiveCamera(Number(q.get("fov") ?? 40), aspect, 0.05, 800);
  p.position.copy(center).add(pos);
  p.lookAt(center.clone().add(target));
  cam = p;
}
renderer.setScissorTest(false);
renderer.setClearColor(0x2a2f38);
renderer.render(scene, cam);
if (info.misfit.length) (document.getElementById("tag") as HTMLElement).textContent += " · NO CABEN: " + info.misfit.join(", ");
document.body.dataset.ready = "1";
