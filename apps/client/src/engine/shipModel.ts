import * as THREE from "three";

/** El modelo mide ~4,5 unidades de largo: a escala ×10, la nave mide unos 45 m (las distancias de los sistemas van en metros). */
export const SHIP_SCALE = 10;

/**
 * Nave insignia del Emperador, generada por código: casco alargado, alas en
 * flecha, puente y motores con brillo. Mira hacia -Z (el "delante" de Three.js)
 * y mide unas 4 unidades de largo. `accent` colorea los detalles: morado la
 * propia, naranja las ajenas.
 */
export function createFlagship(accent: THREE.ColorRepresentation): THREE.Group {
  const ship = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc9d2e3, metalness: 0.6, roughness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a4256, metalness: 0.7, roughness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.4 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x8fe9ff });

  // Casco: proa afilada y cuerpo octogonal.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.8, 8), hullMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.9;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 2.4, 8), hullMat);
  body.rotation.x = -Math.PI / 2;
  body.position.z = 0.2;
  ship.add(nose, body);

  // Puente de mando, elevado sobre el casco.
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.9), darkMat);
  bridge.position.set(0, 0.45, 0.3);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.2), accentMat);
  visor.position.set(0, 0.5, -0.12);
  ship.add(bridge, visor);

  // Alas en flecha con bordes de color.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(1.9, 1.2);
  wingShape.lineTo(1.9, 1.75);
  wingShape.lineTo(0, 1.3);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: false });
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(wingGeo, darkMat);
    // El perfil se dibuja en XY; se tumba para que quede en el plano XZ.
    wing.rotation.x = Math.PI / 2;
    wing.scale.x = side;
    wing.position.set(side * 0.35, 0, -0.6);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.65), accentMat);
    tip.position.set(side * 2.25, 0, 0.85);
    ship.add(wing, tip);
  }

  // Motores: tres toberas con brillo.
  for (const x of [-0.32, 0, 0.32]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 10), darkMat);
    nozzle.rotation.x = -Math.PI / 2;
    nozzle.position.set(x, x === 0 ? 0.12 : -0.08, 1.55);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), glowMat);
    glow.position.set(x, x === 0 ? 0.12 : -0.08, 1.76);
    ship.add(nozzle, glow);
  }

  ship.userData.dispose = () => {
    ship.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of [hullMat, darkMat, accentMat, glowMat]) m.dispose();
  };
  return ship;
}

/** Libera la geometría y los materiales de una nave creada con `createFlagship`. */
export function disposeShip(ship: THREE.Object3D): void {
  (ship.userData.dispose as (() => void) | undefined)?.();
}
