import * as THREE from "three";
import { withLogDepth } from "./logDepth";

/**
 * Cabina de la nave para la vista en primera persona: armazón de la cúpula
 * (montantes y arco superior), salpicadero con pantallas que brillan y consolas
 * laterales. Va colgada de la cámara (en metros, -Z hacia delante) y no tapa el
 * centro de la vista; los números de vuelo los dibuja la interfaz encima.
 */
export function createCockpit(): THREE.Group {
  const g = new THREE.Group();
  // Metal oscuro y satinado: el armazón se recorta contra el espacio sin brillar (la luz de relleno lo roza).
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b2029, metalness: 0.75, roughness: 0.38 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x141820, metalness: 0.35, roughness: 0.8 });
  const glowMat = (color: number, opacity = 0.9) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity });

  /** Tubo que sigue una curva (montantes y arcos de la cúpula). */
  const tube = (pts: Array<[number, number, number]>, radius: number, mat: THREE.Material) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 10, false), mat);
    g.add(m);
    return m;
  };

  // Montantes de la cúpula: curvos, por las esquinas de la vista, con un filo de luz por dentro.
  for (const side of [1, -1]) {
    const pillar: Array<[number, number, number]> = [
      [side * 1.32, -0.86, -1.3],
      [side * 1.14, -0.2, -1.38],
      [side * 0.86, 0.36, -1.36],
      [side * 0.5, 0.62, -1.26],
      [side * 0.18, 0.72, -1.1],
    ];
    tube(pillar, 0.045, frameMat);
    // El filo va algo por delante y hacia dentro del montante.
    tube(pillar.map(([x, y, z]) => [x - side * 0.03, y - 0.02, z + 0.04]), 0.0045, glowMat(0x5fd8ff, 0.55));
    // Barandilla baja de la cúpula (el borde del fuselaje), casi fuera de la vista.
    tube([[side * 1.32, -0.86, -1.3], [side * 1.18, -0.7, -0.7], [side * 1.1, -0.62, -0.1]], 0.05, frameMat);
  }
  // Arco de arriba, que une los montantes, y la espina que va hacia atrás por encima.
  tube([[-0.18, 0.72, -1.1], [0, 0.745, -1.06], [0.18, 0.72, -1.1]], 0.045, frameMat);
  tube([[0, 0.745, -1.06], [0, 0.82, -0.4], [0, 0.84, 0.2]], 0.04, frameMat);

  // Cristal de la cúpula: casi invisible, con brillo en los bordes (Fresnel) y un reflejo diagonal.
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 48, 24, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.18, Math.PI * 0.5),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      ...withLogDepth({
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          vN = normalize(normal);
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vP;
        void main() {
          vec3 d = normalize(vP);
          // Más brillo hacia los bordes de la vista; nada en el centro.
          float edge = smoothstep(0.55, 1.0, length(d.xy) / max(0.2, -d.z + 0.6));
          float streak = smoothstep(0.035, 0.0, abs(d.x * 0.55 + d.y - 0.42)) * 0.6;
          float a = edge * 0.05 + streak * 0.035;
          gl_FragColor = vec4(vec3(0.55, 0.75, 1.0) * a, a);
        }
      `,
      }),
    }),
  );
  glass.rotation.y = Math.PI;
  g.add(glass);

  // Salpicadero curvo bajo la vista, con un filo de luz por delante.
  const dashShape = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.34, 48, 1, false, -0.85, 1.7), panelMat);
  dashShape.rotation.y = Math.PI;
  dashShape.position.set(0, -0.66, 0.05);
  g.add(dashShape);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.255, 0.004, 6, 64, 1.5), glowMat(0x5fd8ff, 0.7));
  lip.rotation.x = Math.PI / 2;
  lip.rotation.z = -Math.PI / 2 - 0.75;
  lip.position.set(0, -0.49, 0.05);
  g.add(lip);

  // Pantallas del salpicadero: dibujos generados por código (radar, barras, cuadrícula).
  const screens: Array<[number, number, (ctx: CanvasRenderingContext2D, s: number) => void]> = [
    [-0.42, 0x5fd8ff, drawRadar],
    [0, 0x7ef0b0, drawBars],
    [0.42, 0xe8b64c, drawGrid],
  ];
  for (const [angle, color, draw] of screens) {
    const tex = screenTexture(color, draw);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9 }));
    // Sobre el salpicadero, siguiendo su curva e inclinadas hacia el piloto.
    screen.position.set(Math.sin(angle) * 1.12, -0.5, 0.05 - Math.cos(angle) * 1.12);
    screen.rotation.order = "YXZ";
    screen.rotation.y = -angle;
    screen.rotation.x = -0.9;
    g.add(screen);
  }

  // Consolas laterales con luces pequeñas.
  for (const side of [1, -1]) {
    const console = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 1.0), panelMat);
    console.position.set(side * 1.0, -0.66, -0.55);
    console.rotation.z = side * 0.3;
    g.add(console);
    for (let i = 0; i < 5; i++) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.03), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x7ef0b0 : 0xff9f5a }));
      light.position.set(side * (0.9 - i * 0.008), -0.44 - i * 0.012, -0.32 - i * 0.12);
      g.add(light);
    }
  }

  // Luz tenue de las pantallas sobre el salpicadero.
  const glow = new THREE.PointLight(0x9fd8ff, 0.8, 2.5, 2);
  glow.position.set(0, -0.3, -0.7);
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
