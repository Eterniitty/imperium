import * as THREE from "three";

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let ringTex: THREE.Texture | null = null;
/** Anillo de selección: un círculo con marcas de mira. */
export function ringTexture(): THREE.Texture {
  ringTex ??= canvasTexture(128, (ctx, s) => {
    const c = s / 2;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c, c, s * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * s * 0.4, c + Math.sin(a) * s * 0.4);
      ctx.lineTo(c + Math.cos(a) * s * 0.48, c + Math.sin(a) * s * 0.48);
      ctx.stroke();
    }
  });
  return ringTex;
}

let glowTex: THREE.Texture | null = null;
/** Halo radial suave para estrellas y anomalías. */
export function glowTexture(): THREE.Texture {
  glowTex ??= canvasTexture(256, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.15, "rgba(255,255,255,0.6)");
    g.addColorStop(0.4, "rgba(255,255,255,0.15)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  return glowTex;
}

/** Rótulo de texto para un sprite: devuelve la textura y su proporción ancho/alto. */
export function labelTexture(text: string, color: string): { texture: THREE.Texture; aspect: number } {
  const font = "600 30px Rajdhani, system-ui, sans-serif";
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + 24;
  const height = 44;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Contorno oscuro: se lee sobre cualquier fondo de estrellas.
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(2, 3, 10, 0.85)";
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}
