import * as THREE from "three";

/**
 * Cabina de la nave para la vista en primera persona: armazón de la cúpula
 * (montantes y arco superior), salpicadero con pantallas que brillan y consolas
 * laterales. Va colgada de la cámara (en metros, -Z hacia delante) y no tapa el
 * centro de la vista; los números de vuelo los dibuja la interfaz encima.
 */
export function createCockpit(): THREE.Group {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x46506a, metalness: 0.6, roughness: 0.45 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x2a3142, metalness: 0.4, roughness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xc792ff, emissive: 0xc792ff, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.5 });

  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  // Salpicadero inclinado en la parte de abajo, con un borde de color.
  const dash = box(2.2, 0.36, 0.6, panelMat, 0, -0.69, -1.15);
  // Inclinado hacia el piloto (la cara de arriba mira a la cámara).
  dash.rotation.x = 0.5;
  const lip = box(2.2, 0.006, 0.02, trimMat, 0, -0.383, -1.33);
  lip.rotation.x = 0.5;

  // Pantallas del salpicadero: dibujos generados por código (radar, barras, cuadrícula).
  const screens: Array<[number, number, (ctx: CanvasRenderingContext2D, s: number) => void]> = [
    [-0.5, 0x5fd8ff, drawRadar],
    [0, 0x7ef0b0, drawBars],
    [0.5, 0xe8b64c, drawGrid],
  ];
  for (const [x, color, draw] of screens) {
    const tex = screenTexture(color, draw);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92 }));
    // Sobre la cara de arriba del salpicadero.
    screen.position.set(x, -0.525, -1.06);
    screen.rotation.x = -(Math.PI / 2 - 0.5);
    g.add(screen);
  }

  // Consolas laterales.
  for (const side of [1, -1]) {
    const console = box(0.35, 0.5, 1.2, panelMat, side * 1.05, -0.62, -0.7);
    console.rotation.z = side * 0.25;
    for (let i = 0; i < 4; i++) {
      const light = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.012, 0.04),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0x7ef0b0 : 0xff9f5a }),
      );
      light.position.set(side * (0.98 - i * 0.012), -0.36 - i * 0.015, -0.45 - i * 0.14);
      g.add(light);
    }
  }

  // Armazón de la cúpula: dos montantes en diagonal y el arco de arriba.
  for (const side of [1, -1]) {
    const pillar = box(0.05, 1.6, 0.05, frameMat, side * 0.86, 0.12, -1.35);
    pillar.rotation.z = side * 0.38;
    pillar.rotation.x = -0.12;
    const upper = box(0.04, 0.04, 1.4, frameMat, side * 0.62, 0.62, -0.9);
    upper.rotation.y = side * -0.12;
  }
  box(1.6, 0.05, 0.05, frameMat, 0, 0.66, -1.6);
  // Visor del arco con un filo de color.
  box(1.6, 0.012, 0.012, trimMat, 0, 0.63, -1.58);

  // Luz tenue de las pantallas sobre el salpicadero y el armazón.
  const glow = new THREE.PointLight(0x9fd8ff, 1.5, 4, 2);
  glow.position.set(0, -0.1, -0.6);
  g.add(glow);

  g.userData.dispose = () => {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.MeshBasicMaterial;
        m.map?.dispose();
        m.dispose();
      }
    });
  };
  return g;
}

function screenTexture(color: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = Math.round(s * 0.6);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(4,10,18,0.95)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 1.5;
  draw(ctx, s);
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawRadar(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  const cy = s * 0.3;
  for (const r of [10, 20, 30]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + 28, cy - 12);
  ctx.stroke();
  ctx.fillRect(cx - 14, cy + 6, 3, 3);
  ctx.fillRect(cx + 18, cy - 4, 3, 3);
}

function drawBars(ctx: CanvasRenderingContext2D, s: number): void {
  const heights = [40, 28, 34, 18, 44, 30, 22, 36];
  heights.forEach((h, i) => ctx.fillRect(10 + i * 14, s * 0.55 - h, 8, h));
}

function drawGrid(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.globalAlpha = 0.5;
  for (let x = 8; x < s; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 4);
    ctx.lineTo(x, s * 0.6 - 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (let x = 0; x < s; x += 4) ctx.lineTo(x, s * 0.3 + Math.sin(x / 9) * 14);
  ctx.stroke();
}
