import * as THREE from "three";
import { fbm3, hashString } from "@imperium/procgen";
import type { PlanetType } from "@imperium/shared";

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

type Stop = [number, [number, number, number]];

/** Paletas por tipo de planeta: valor de ruido → color. */
const PALETTES: Record<PlanetType, Stop[]> = {
  lava: [[0, [20, 10, 8]], [0.55, [45, 22, 18]], [0.68, [180, 50, 10]], [0.78, [255, 150, 40]], [1, [255, 230, 120]]],
  barren: [[0, [70, 68, 66]], [0.5, [120, 116, 110]], [1, [190, 185, 178]]],
  rocky: [[0, [70, 55, 45]], [0.45, [120, 100, 80]], [0.6, [95, 110, 80]], [1, [170, 160, 140]]],
  desert: [[0, [140, 95, 55]], [0.5, [205, 160, 100]], [1, [240, 210, 160]]],
  ocean: [[0, [10, 30, 80]], [0.52, [25, 80, 150]], [0.56, [200, 190, 140]], [0.62, [60, 120, 60]], [0.8, [40, 85, 45]], [1, [120, 110, 95]]],
  toxic: [[0, [70, 80, 20]], [0.5, [150, 165, 40]], [1, [220, 230, 120]]],
  ice: [[0, [120, 150, 180]], [0.5, [200, 220, 240]], [1, [250, 252, 255]]],
  gas_giant: [[0, [120, 70, 40]], [0.3, [200, 140, 90]], [0.55, [235, 210, 170]], [0.8, [170, 100, 60]], [1, [240, 225, 200]]],
  ice_giant: [[0, [40, 90, 140]], [0.5, [90, 170, 210]], [1, [190, 235, 250]]],
};

function samplePalette(stops: Stop[], v: number): [number, number, number] {
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i]!;
    const [p0, c0] = stops[i - 1]!;
    if (v <= p1) {
      const t = (v - p0) / (p1 - p0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1]![1];
}

const planetCache = new Map<string, THREE.Texture>();

/**
 * Textura procedural de planeta (equirectangular, sin costuras). El ruido se
 * muestrea sobre un cilindro para que el borde izquierdo y el derecho encajen.
 */
export function planetTexture(type: PlanetType, key: string): THREE.Texture {
  const cacheKey = `${type}:${key}`;
  const cached = planetCache.get(cacheKey);
  if (cached) return cached;

  const w = 192;
  const h = 96;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const seed = hashString(cacheKey);
  const palette = PALETTES[type];
  const banded = type === "gas_giant" || type === "ice_giant";

  for (let y = 0; y < h; y++) {
    const lat = y / h;
    for (let x = 0; x < w; x++) {
      const a = (x / w) * Math.PI * 2;
      const cx = Math.cos(a);
      const sz = Math.sin(a);
      let v: number;
      if (banded) {
        const turb = fbm3(seed, cx * 1.5, lat * 6, sz * 1.5, 3);
        v = fbm3(seed + 7, 0, lat * 9 + turb * 1.6, 0, 3);
      } else {
        v = fbm3(seed, cx * 1.6, lat * 3.2, sz * 1.6, 4);
        v = Math.min(1, Math.max(0, (v - 0.5) * 1.8 + 0.5));
      }
      let [r, g, b] = samplePalette(palette, v);
      // Casquetes polares en mundos templados y fríos.
      if ((type === "ocean" || type === "rocky" || type === "ice") && (lat < 0.08 || lat > 0.92)) {
        r = g = b = 240;
      }
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  planetCache.set(cacheKey, tex);
  return tex;
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
