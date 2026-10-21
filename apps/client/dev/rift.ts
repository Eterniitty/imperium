/**
 * Banco de pruebas del efecto del salto cuántico (solo desarrollo):
 * `/dev/rift.html?phase=charge&k=0.6` · `phase=break&t=0.2` · `phase=arrive&t=0.5`
 * (`&reduce=1` para el modo de efectos reducidos). La nave insignia con la
 * cámara de persecución sobre un fondo de estrellas.
 */
import * as THREE from "three";
import { QuantumRift } from "../src/engine/fx/quantumRift";
import { createFlagship, SHIP_SCALE, shipRig } from "../src/engine/shipModel";

const q = new URLSearchParams(location.search);
const phase = q.get("phase") ?? "charge";
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

function starfield(color: number, count: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(5000);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color, size: 2, sizeAttenuation: false }));
}
function scene(tunnel: boolean): THREE.Scene {
  const s = new THREE.Scene();
  s.background = new THREE.Color(tunnel ? 0x0a0f30 : 0x02030a);
  s.add(starfield(tunnel ? 0x9fb8ff : 0xffffff, 3000));
  s.add(new THREE.AmbientLight(0x5a6688, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1dd, 3);
  sun.position.set(-1, 1, -0.5);
  s.add(sun);
  const ship = createFlagship(0xc792ff);
  ship.scale.setScalar(SHIP_SCALE);
  shipRig(ship).setThrust(1, phase !== "arrive");
  shipRig(ship).tick(0.1, 1, 0);
  if (!tunnel) s.add(ship);
  // Un planeta lejano para ver la lente.
  const planet = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.MeshStandardMaterial({ color: 0x4f7fb0, roughness: 0.8 }));
  planet.position.set(-700, 150, -2500);
  if (!tunnel) s.add(planet);
  return s;
}
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 1e6);
camera.position.set(0, 22, 75);
camera.lookAt(0, 0, -300);
const rift = new QuantumRift();
const r = rift as unknown as { breakT: number; arriveT: number; time: number };
const opts = { reduce: q.get("reduce") === "1", low: false };
const k = Number(q.get("k") ?? 0.6);
const t = Number(q.get("t") ?? 0.3);
if (phase === "charge") {
  rift.render(renderer, scene(false), camera, 0.016, k, opts);
} else if (phase === "break") {
  rift.render(renderer, scene(false), camera, 0.016, 1, opts);
  rift.jump();
  r.breakT = t;
  rift.render(renderer, scene(true), camera, 0, null, opts);
} else {
  rift.arrive();
  r.arriveT = t;
  rift.render(renderer, scene(false), camera, 0, null, opts);
}
(window as unknown as { __ready: boolean }).__ready = true;
