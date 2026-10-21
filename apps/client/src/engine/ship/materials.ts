/**
 * Materiales PBR de las naves por estilo de facción y color de acento. Se
 * crean una vez por combinación y se comparten entre todas las naves; solo el
 * brillo de las toberas («engine») es propio de cada nave, porque sigue a su empuje.
 */
import * as THREE from "three";
import type { Slot } from "./kit";
import { hullMaps, radiatorTexture, windowTexture } from "./textures";

/** Estilo visual: humano (industrial militar), Carroñeros o la silueta de una especie. */
export type ShipStyle = "human" | "brutalist_scrap" | "organic" | "crystalline" | "geometric" | "angular" | "ethereal";

export interface Palette {
  hull: number;
  plate: number;
  dark: number;
  metal: number;
  /** Color de la llama y de la garganta de las toberas. */
  engine: number;
  /** Luz propia (núcleos, pústulas, bandas) de las especies. */
  emissive: number;
  /** 0 limpio, 1 chatarra; sin textura en las especies de casco liso. */
  wear: number | null;
  roughness: number;
  metalness: number;
}

export function paletteFor(style: ShipStyle, primary: number, secondary: number, emissive: number): Palette {
  switch (style) {
    case "human":
      return { hull: 0xb4bac2, plate: 0x6a717b, dark: 0x2a2f37, metal: 0x9aa0a8, engine: 0x8fdcff, emissive: 0x8fdcff, wear: 0.25, roughness: 1, metalness: 0.45 };
    case "brutalist_scrap": {
      const rust = new THREE.Color(primary).lerp(new THREE.Color(0x8a4b2a), 0.35).getHex();
      return { hull: primary, plate: rust, dark: secondary, metal: 0x77716a, engine: 0xff7a3c, emissive, wear: 1, roughness: 1, metalness: 0.6 };
    }
    case "angular":
    case "geometric":
      return { hull: primary, plate: new THREE.Color(primary).lerp(new THREE.Color(secondary), 0.45).getHex(), dark: secondary, metal: 0xa8b0b8, engine: emissive, emissive, wear: 0, roughness: 0.75, metalness: 0.7 };
    default:
      return { hull: primary, plate: new THREE.Color(primary).lerp(new THREE.Color(secondary), 0.5).getHex(), dark: secondary, metal: 0x8a8f99, engine: emissive, emissive, wear: null, roughness: style === "organic" ? 0.75 : 0.35, metalness: style === "organic" ? 0.1 : 0.5 };
  }
}

const cache = new Map<string, Record<Slot, THREE.Material>>();

/** Materiales compartidos de un estilo, paleta y acento. */
export function slotMaterials(style: ShipStyle, pal: Palette, accent: number): Record<Slot, THREE.Material> {
  const key = `${style}|${pal.hull}|${pal.plate}|${pal.dark}|${pal.emissive}|${accent}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const maps = pal.wear === null ? null : hullMaps(pal.wear);
  const crystal = style === "crystalline";
  const textured = (color: number, normalScale: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({
      color,
      map: maps?.map ?? null,
      normalMap: maps?.normalMap ?? null,
      normalScale: new THREE.Vector2(normalScale, normalScale),
      roughnessMap: maps?.ormMap ?? null,
      metalnessMap: maps?.ormMap ?? null,
      roughness: maps ? pal.roughness : pal.roughness,
      metalness: pal.metalness,
      ...extra,
    });
  const radiator = radiatorTexture();
  const win = windowTexture();
  const m: Record<Slot, THREE.Material> = {
    hull: textured(pal.hull, 0.7, crystal ? { emissive: pal.emissive, emissiveIntensity: 0.25, transparent: true, opacity: 0.85 } : {}),
    plate: textured(pal.plate, 0.9),
    dark: textured(pal.dark, 0.6, { metalness: Math.min(1, pal.metalness + 0.1) }),
    metal: new THREE.MeshStandardMaterial({ color: pal.metal, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide }),
    trim: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.45, metalness: 0.3, roughness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0d1218, map: win, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 1.3, metalness: 0.4, roughness: 0.15 }),
    radiator: new THREE.MeshStandardMaterial({ color: 0xc8c2b8, map: radiator, emissive: 0xff6a2a, emissiveMap: radiator, emissiveIntensity: 0.12, metalness: 0.6, roughness: 0.5 }),
    engine: new THREE.MeshBasicMaterial({ color: pal.engine }),
    glow: new THREE.MeshBasicMaterial({ color: pal.emissive }),
    aura: new THREE.MeshBasicMaterial({ color: pal.emissive, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
  };
  cache.set(key, m);
  return m;
}
