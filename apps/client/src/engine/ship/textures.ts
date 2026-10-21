/**
 * Texturas procedurales de las naves (dibujadas en un lienzo una sola vez y
 * compartidas por todas): placas del casco con juntas, remaches, escotillas,
 * rejillas, marcas de fabricación y desgaste; su relieve (mapa de normales),
 * su rugosidad/metalicidad; aletas de radiador y ventanas iluminadas.
 * Se aplican con coordenadas proyectadas por caras (`kit.ts`): un mosaico
 * cubre `TILE_M` metros, así las placas tienen el mismo tamaño en todas las naves.
 */
import * as THREE from "three";

/** Metros que cubre un mosaico de la textura del casco. */
export const TILE_M = 16;
const SIZE = 512;

function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvas(size = SIZE): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

function texture(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export interface HullMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** Rugosidad en el canal verde y metalicidad en el azul. */
  ormMap: THREE.Texture;
}

const hullCache = new Map<number, HullMaps>();

/** Placas del casco; `wear` de 0 (limpio, de fábrica) a 1 (chatarra recompuesta). */
export function hullMaps(wear: number): HullMaps {
  const key = Math.round(wear * 10);
  const cached = hullCache.get(key);
  if (cached) return cached;
  const rnd = seeded(91 + key * 7);
  const [ac, a] = canvas();
  const [hc, h] = canvas();
  const [rc, r] = canvas();
  a.fillStyle = "#bdbdbd";
  a.fillRect(0, 0, SIZE, SIZE);
  h.fillStyle = "#808080";
  h.fillRect(0, 0, SIZE, SIZE);
  r.fillStyle = "rgb(0,135,150)";
  r.fillRect(0, 0, SIZE, SIZE);

  // Placas: partición recursiva en rectángulos alineados a 16 px.
  const panels: Array<[number, number, number, number]> = [];
  const split = (x: number, y: number, w: number, hh: number, depth: number) => {
    const canSplitW = w >= 96;
    const canSplitH = hh >= 96;
    if (depth > 5 || (!canSplitW && !canSplitH) || (depth > 2 && rnd() < 0.25)) {
      panels.push([x, y, w, hh]);
      return;
    }
    if (canSplitW && (!canSplitH || rnd() < 0.5)) {
      const cut = 16 * Math.max(2, Math.min(w / 16 - 2, Math.round((w / 16) * (0.3 + rnd() * 0.4))));
      split(x, y, cut, hh, depth + 1);
      split(x + cut, y, w - cut, hh, depth + 1);
    } else {
      const cut = 16 * Math.max(2, Math.min(hh / 16 - 2, Math.round((hh / 16) * (0.3 + rnd() * 0.4))));
      split(x, y, w, cut, depth + 1);
      split(x, y + cut, w, hh - cut, depth + 1);
    }
  };
  split(0, 0, SIZE, SIZE, 0);

  for (const [x, y, w, hh] of panels) {
    const shade = 182 + Math.floor(rnd() * 32) - (rnd() < 0.08 ? 34 : 0);
    a.fillStyle = `rgb(${shade},${shade},${shade + 3})`;
    a.fillRect(x, y, w, hh);
    const rough = 95 + Math.floor(rnd() * 90 + wear * 40);
    const metal = 110 + Math.floor(rnd() * 90);
    r.fillStyle = `rgb(0,${Math.min(255, rough)},${metal})`;
    r.fillRect(x, y, w, hh);
    // Placa algo elevada; junta hundida.
    const v = 140 + Math.floor(rnd() * 30);
    h.fillStyle = `rgb(${v},${v},${v})`;
    h.fillRect(x + 2, y + 2, w - 4, hh - 4);
    h.strokeStyle = "#202020";
    h.lineWidth = 2;
    h.strokeRect(x + 1, y + 1, w - 2, hh - 2);
    a.strokeStyle = "rgba(30,34,40,0.6)";
    a.lineWidth = 1.5;
    a.strokeRect(x + 1, y + 1, w - 2, hh - 2);
    // Remaches en algunos bordes.
    if (rnd() < 0.55) {
      a.fillStyle = "rgba(40,44,50,0.7)";
      h.fillStyle = "#e0e0e0";
      for (let i = x + 6; i < x + w - 4; i += 8) {
        for (const yy of [y + 5, y + hh - 6]) {
          a.fillRect(i, yy, 2, 2);
          h.fillRect(i, yy, 2, 2);
        }
      }
    }
    const kind = rnd();
    if (kind < 0.12 && w >= 48 && hh >= 48) {
      // Rejilla de ventilación.
      const gx = x + 8;
      const gw = w - 16;
      for (let yy = y + 10; yy < y + hh - 10; yy += 5) {
        a.fillStyle = "rgba(25,28,34,0.8)";
        a.fillRect(gx, yy, gw, 2);
        h.fillStyle = "#303030";
        h.fillRect(gx, yy, gw, 2);
      }
    } else if (kind < 0.24 && w >= 40 && hh >= 40) {
      // Escotilla de servicio con tirador.
      const m = 8;
      h.strokeStyle = "#383838";
      h.lineWidth = 2;
      h.strokeRect(x + m, y + m, w - 2 * m, hh - 2 * m);
      a.strokeStyle = "rgba(35,38,44,0.55)";
      a.strokeRect(x + m, y + m, w - 2 * m, hh - 2 * m);
      a.fillStyle = "rgba(60,64,70,0.8)";
      a.fillRect(x + w / 2 - 6, y + hh - m - 7, 12, 3);
    } else if (kind < 0.32) {
      // Marcas de fabricación: barras de rótulo y algún número.
      a.fillStyle = rnd() < 0.5 ? "rgba(240,240,235,0.55)" : "rgba(30,30,30,0.5)";
      const bx = x + 6;
      const by = y + 6;
      for (let i = 0; i < 3; i++) a.fillRect(bx + i * 7, by, 5, 3);
      a.font = "bold 10px monospace";
      a.fillText(`${String.fromCharCode(65 + Math.floor(rnd() * 26))}-${Math.floor(rnd() * 90 + 10)}`, bx, by + 14);
    } else if (kind < 0.36 && w >= 48) {
      // Franja de peligro (amarilla y negra).
      const sw = Math.min(64, w - 12);
      a.save();
      a.beginPath();
      a.rect(x + 6, y + hh - 14, sw, 8);
      a.clip();
      a.fillStyle = "rgba(225,180,40,0.85)";
      a.fillRect(x + 6, y + hh - 14, sw, 8);
      a.fillStyle = "rgba(20,20,20,0.85)";
      for (let i = -8; i < sw; i += 10) {
        a.beginPath();
        a.moveTo(x + 6 + i, y + hh - 6);
        a.lineTo(x + 6 + i + 5, y + hh - 6);
        a.lineTo(x + 6 + i + 13, y + hh - 14);
        a.lineTo(x + 6 + i + 8, y + hh - 14);
        a.fill();
      }
      a.restore();
    }
  }

  // Desgaste: churretes de suciedad, roces claros en los bordes y quemaduras.
  const streaks = 30 + Math.floor(wear * 90);
  for (let i = 0; i < streaks; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const len = 20 + rnd() * 90;
    const g = a.createLinearGradient(x, y, x, y + len);
    const alpha = 0.06 + wear * 0.16;
    g.addColorStop(0, `rgba(40,34,28,${alpha})`);
    g.addColorStop(1, "rgba(40,34,28,0)");
    a.fillStyle = g;
    a.fillRect(x, y, 2 + rnd() * 6, len);
  }
  const scratches = 200 + Math.floor(wear * 900);
  for (let i = 0; i < scratches; i++) {
    const x = Math.floor(rnd() * SIZE);
    const y = Math.floor(rnd() * SIZE);
    a.fillStyle = `rgba(235,235,230,${0.12 + rnd() * 0.25})`;
    a.fillRect(x, y, 1 + Math.floor(rnd() * 3), 1);
    r.fillStyle = "rgb(0,90,210)";
    r.fillRect(x, y, 2, 1);
  }
  if (wear > 0.5) {
    // Óxido y parches de otra chapa.
    for (let i = 0; i < 40 * wear; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      const rad = 6 + rnd() * 26;
      const g = a.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(120,60,25,0.55)");
      g.addColorStop(1, "rgba(120,60,25,0)");
      a.fillStyle = g;
      a.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      r.fillStyle = "rgba(0,230,40,0.6)";
      r.beginPath();
      r.arc(x, y, rad * 0.6, 0, Math.PI * 2);
      r.fill();
    }
  }

  // Relieve → mapa de normales (Sobel sobre la altura).
  const src = h.getImageData(0, 0, SIZE, SIZE).data;
  const [nc, n] = canvas();
  const out = n.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) => src[(((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)) * 4]! / 255;
  const strength = 2.2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      out.data[i] = (0.5 - dx / len / 2) * 255;
      out.data[i + 1] = (0.5 + dy / len / 2) * 255;
      out.data[i + 2] = (0.5 + 0.5 / len) * 255;
      out.data[i + 3] = 255;
    }
  }
  n.putImageData(out, 0, 0);

  const maps: HullMaps = { map: texture(ac, true), normalMap: texture(nc, false), ormMap: texture(rc, false) };
  hullCache.set(key, maps);
  return maps;
}

let radiatorTex: THREE.Texture | null = null;
/** Paneles de radiador: aletas paralelas con marco (sirve también de mapa de emisión del calor). */
export function radiatorTexture(): THREE.Texture {
  if (radiatorTex) return radiatorTex;
  const [c, x] = canvas(128);
  x.fillStyle = "#3a3d42";
  x.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    const g = x.createLinearGradient(0, y, 0, y + 8);
    g.addColorStop(0, "#9a9fa6");
    g.addColorStop(0.5, "#5b6068");
    g.addColorStop(1, "#24272c");
    x.fillStyle = g;
    x.fillRect(0, y + 1, 128, 6);
  }
  x.fillStyle = "#1b1d21";
  for (let i = 0; i < 128; i += 32) x.fillRect(i, 0, 3, 128);
  radiatorTex = texture(c, true);
  return radiatorTex;
}

let windowTex: THREE.Texture | null = null;
/** Ventanas: filas de luces cálidas y frías, algunas apagadas (mapa de color y de emisión). */
export function windowTexture(): THREE.Texture {
  if (windowTex) return windowTex;
  const [c, x] = canvas(256);
  const rnd = seeded(4242);
  x.fillStyle = "#07090c";
  x.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    for (let i = 0; i < 256; i += 12) {
      const on = rnd();
      if (on < 0.18) continue;
      x.fillStyle = on < 0.3 ? "#5f87b8" : on < 0.9 ? "#ffd9a0" : "#ffffff";
      x.globalAlpha = 0.65 + rnd() * 0.35;
      x.fillRect(i + 1, y + 2, 9, 12);
    }
  }
  x.globalAlpha = 1;
  windowTex = texture(c, true);
  return windowTex;
}
