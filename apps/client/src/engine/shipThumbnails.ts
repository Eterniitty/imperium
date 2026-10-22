/**
 * Miniaturas de las naves para la interfaz (lista de construcción, flotas,
 * batallas): el mismo modelo procedural del motor 3D, dibujado una vez por
 * clase en un lienzo propio y guardado como imagen. Un solo renderizador
 * pequeño para todas; si el navegador no tiene WebGL, no hay miniaturas.
 */
import * as THREE from "three";
import type { ShipDesignSnapshot } from "@imperium/shared";
import { createDesignModel, createShipModel, designLook, shipLength } from "./shipFactory";

const WIDTH = 320;
const HEIGHT = 192;

let renderer: THREE.WebGLRenderer | null | undefined;
const cache = new Map<string, string | null>();

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer !== undefined) return renderer;
  try {
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch {
    renderer = null;
  }
  return renderer;
}

/** Imagen (data URL) de una clase de nave vista de tres cuartos, o null si no se puede dibujar. */
export function shipThumbnail(classId: string): string | null {
  return thumbnail(classId, shipLength(classId), () => createShipModel(classId, { noLod: true }));
}

/** Miniatura de una nave del Astillero (con el aspecto de sus piezas). */
export function designThumbnail(design: Pick<ShipDesignSnapshot, "hullId" | "parts">): string | null {
  const look = designLook(design);
  return look ? thumbnail(look.classId, look.model.lengthM, () => createDesignModel(design, { noLod: true })) : null;
}

function thumbnail(key: string, L: number | null, make: () => THREE.Group | null): string | null {
  const classId = key;
  if (cache.has(classId)) return cache.get(classId)!;
  const r = getRenderer();
  const ship = r && L ? make() : null;
  if (!r || !L || !ship) {
    cache.set(classId, null);
    return null;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-1, 2, -1.5);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x88aaff, 1.2);
  rim.position.set(2, -0.5, 2);
  scene.add(rim);
  scene.add(ship);
  const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, L * 0.05, L * 20);
  // De tres cuartos, desde delante, arriba y a un lado; el morro apunta a la izquierda.
  camera.position.set(-L * 2.0, L * 0.95, -L * 1.25);
  camera.lookAt(0, 0, 0);
  const rig = ship.userData.rig as { setThrust(k: number): void; tick(t: number, dt: number, idle: number): void };
  rig.setThrust(0.6);
  rig.tick(0, 0, 0);
  let url: string | null = null;
  try {
    r.setClearColor(0x000000, 0);
    r.render(scene, camera);
    url = r.domElement.toDataURL("image/png");
  } catch {
    url = null;
  }
  cache.set(classId, url);
  return url;
}
