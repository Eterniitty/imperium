/**
 * Recetas de las naves humanas (ciencia ficción industrial y militar) y de los
 * Carroñeros (la misma ingeniería, pero recompuesta con chatarra: asimétrica,
 * con placas soldadas, púas y motores desparejados). Cada familia
 * (`ShipArchetype`: exploradores, cazas, transportes, mineros, fragatas y naves
 * capitales; más la insignia del Emperador) monta los módulos del kit con su
 * propia disposición. Nada de alas de avión: los brazos laterales son pilones
 * de armas, soportes de propulsores o radiadores.
 */
import * as THREE from "three";
import { HULL_PROPORTIONS, TURRET_BARREL, type Offset3, type ShipArchetype } from "@imperium/content";
import {
  antenna,
  block,
  cargoPod,
  dish,
  gunPod,
  launcher,
  loft,
  mainEngine,
  pipe,
  radiator,
  radiatorFin,
  rcsBlock,
  sensorDome,
  tube,
  turret,
  windows,
  type Parts,
  type Ring,
  type Slot,
} from "./kit";
import type { ShipLook } from "./look";

/** Receta: una familia de diseño o la insignia del Emperador. */
export type Recipe = ShipArchetype | "flagship";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = v(0, 1, 0);
const DOWN = v(0, -1, 0);
const FWD = v(0, 0, -1);
const AFT = v(0, 0, 1);
const RED = 0xff2a22;
const GREEN = 0x2bff6a;
const WHITE = 0xffffff;
const AMBER = 0xffb347;

/** Receta de una clase según sus pistas de modelo. */
export function recipeOf(look: ShipLook): Recipe {
  const m = look.model;
  if (m.archetype) return m.archetype;
  if (m.wings || m.lengthM < 24) return "fighter";
  if (m.pods && m.lengthM < 120) return "transport";
  if (m.lengthM >= 100 || (m.turrets ?? 0) >= 4) return "capital";
  if (m.dish) return "scout";
  return "frigate";
}

class Builder {
  /** Secciones del casco principal (para saber dónde está su superficie). */
  profile: Ring[] = [];
  readonly W: number;
  readonly H: number;

  constructor(
    readonly parts: Parts,
    readonly look: ShipLook,
    readonly rnd: () => number,
    readonly scrap: boolean,
    size?: { W: number; H: number },
  ) {
    const p = HULL_PROPORTIONS[look.model.hullShape];
    this.W = size?.W ?? p.width;
    this.H = size?.H ?? p.height;
  }

  m(meters: number): number {
    return this.parts.m(meters);
  }

  /** Casco principal (queda como perfil de referencia). */
  hull(rings: Ring[], slot: Slot = "hull"): void {
    this.profile = rings;
    this.parts.add(slot, loft(this.jitter(rings)), {}, true);
  }

  /** Otra sección de casco (módulo, superestructura…) desplazada en x. */
  section(rings: Ring[], slot: Slot = "hull", x = 0, coarse = true): void {
    this.parts.add(slot, loft(this.jitter(rings)), { p: [x, 0, 0] }, coarse);
  }

  /** Los Carroñeros deforman un poco cada sección: nada encaja del todo. */
  private jitter(rings: Ring[]): Ring[] {
    if (!this.scrap) return rings;
    return rings.map((r) => ({ ...r, w: r.w * (0.92 + this.rnd() * 0.16), h: r.h * (0.92 + this.rnd() * 0.16), y: (r.y ?? 0) + (this.rnd() - 0.5) * r.h * 0.08 }));
  }

  /** Sección del perfil interpolada en z. */
  at(z: number): Required<Ring> {
    const p = this.profile;
    const def = (r: Ring): Required<Ring> => ({ z: r.z, w: r.w, h: r.h, y: r.y ?? 0, c: r.c ?? 0.28, t: r.t ?? 1 });
    if (z <= p[0]!.z) return def(p[0]!);
    for (let i = 0; i < p.length - 1; i++) {
      const a = def(p[i]!);
      const b = def(p[i + 1]!);
      if (z <= b.z) {
        const k = (z - a.z) / Math.max(1e-6, b.z - a.z);
        const l = (x: number, y: number) => x + (y - x) * k;
        return { z, w: l(a.w, b.w), h: l(a.h, b.h), y: l(a.y, b.y), c: l(a.c, b.c), t: l(a.t, b.t) };
      }
    }
    return def(p[p.length - 1]!);
  }

  top(z: number): number {
    const r = this.at(z);
    return r.y + r.h / 2;
  }

  bottom(z: number): number {
    const r = this.at(z);
    return r.y - r.h / 2;
  }

  half(z: number): number {
    return this.at(z).w / 2;
  }

  /** Boca de fuego de los datos (metros) → normalizada. */
  hp(o: Offset3): THREE.Vector3 {
    const L = this.look.model.lengthM;
    return v(o[0] / L, o[1] / L, o[2] / L);
  }

  /** A ambos lados; los Carroñeros a veces se dejan uno sin montar. */
  sym(fn: (side: 1 | -1) => void, optional = false): void {
    for (const side of [1, -1] as const) {
      if (optional && this.scrap && this.rnd() < 0.35) continue;
      fn(side);
    }
  }

  /**
   * Motores principales en la popa, repartidos en un rectángulo de semiejes
   * `hw`×`hh` centrado en `yc`; las toberas salen desde `z` hacia atrás.
   */
  engines(n: number, z: number, hw: number, hh: number, yc = 0, x0 = 0): void {
    if (n <= 0) return;
    const layout: Array<[number, number, number]> =
      n === 1
        ? [[0, 0, 1]]
        : n === 2
          ? [[-0.5, 0, 1], [0.5, 0, 1]]
          : n === 3
            ? [[-0.5, -0.38, 1], [0.5, -0.38, 1], [0, 0.5, 0.85]]
            : n === 4
              ? [[-0.5, -0.48, 1], [0.5, -0.48, 1], [-0.5, 0.48, 1], [0.5, 0.48, 1]]
              : n === 5
                ? [[-0.5, -0.48, 1], [0.5, -0.48, 1], [-0.5, 0.48, 1], [0.5, 0.48, 1], [0, 0, 0.6]]
                : [[-0.66, -0.48, 1], [0, -0.48, 1], [0.66, -0.48, 1], [-0.66, 0.48, 1], [0, 0.48, 1], [0.66, 0.48, 1]];
    const cols = n === 1 ? 1 : n === 6 ? 3 : 2;
    const rows = n <= 2 ? 1 : 2;
    const r = Math.min(hw / cols, hh / rows) * 0.92;
    // Placa de montaje de los motores.
    this.parts.add("dark", block(hw * 2.05, hh * 2.05, this.m(0.8) + r * 0.3, 0.2), { p: [x0, yc, z - r * 0.1] }, true);
    for (const [fx, fy, k] of layout) {
      const rr = r * k * (this.scrap ? 0.75 + this.rnd() * 0.4 : 1);
      mainEngine(this.parts, x0 + fx * hw, yc + fy * hh, z, rr, rr * 2.1);
    }
  }

  /**
   * Cuatro bloques de maniobra (proa y popa a cada lado) con boquillas arriba,
   * abajo, hacia fuera y hacia delante o atrás: cubren los seis ejes.
   */
  rcs(zFore: number, zAft: number, size: number, foreX?: number, aftX?: number, foreY?: number, aftY?: number): void {
    for (const side of [1, -1] as const) {
      const out = v(side, 0, 0);
      const fx = foreX ?? this.half(zFore);
      const ax = aftX ?? this.half(zAft);
      rcsBlock(this.parts, v(side * (fx + size * 0.45), foreY ?? this.at(zFore).y, zFore), [UP, DOWN, out, FWD], size);
      rcsBlock(this.parts, v(side * (ax + size * 0.45), aftY ?? this.at(zAft).y, zAft), [UP, DOWN, out, AFT], size);
    }
  }

  /** Cañones (torretas o barquillas fijas) y lanzadores en las bocas de fuego de los datos. */
  weapons(gunLen: number, deckTop?: (z: number) => number, sizes: { gun?: number; launcher?: number } = {}): void {
    const turrets = (this.look.model.turrets ?? 0) > 0;
    for (const o of this.look.hardpoints.cannon) {
      const tip = this.hp(o);
      if (turrets) {
        const cz = tip.z + TURRET_BARREL;
        const size = Math.min(TURRET_BARREL * 0.45, Math.max(this.m(1.6), 0.016));
        turret(this.parts, tip, deckTop ? deckTop(cz) : this.top(cz), size, TURRET_BARREL);
      } else {
        gunPod(this.parts, tip, this.half(tip.z + gunLen * 0.78), gunLen, sizes.gun ?? Math.max(this.m(0.7), 0.012));
      }
    }
    for (const o of this.look.hardpoints.missile) {
      const at = this.hp(o);
      launcher(this.parts, at, this.half(at.z + 0.03), sizes.launcher ?? Math.max(this.m(1.1), 0.014));
    }
  }

  /** Luces de navegación: roja a babor, verde a estribor, destellos blancos arriba y abajo. */
  navLights(port: THREE.Vector3, zStrobe: number): void {
    this.parts.light(port, RED, "steady");
    this.parts.light(v(-port.x, port.y, port.z), GREEN, "steady");
    this.parts.light(v(0, this.top(zStrobe) + this.m(0.3), zStrobe), WHITE, "strobe");
    this.parts.light(v(0, this.bottom(zStrobe) - this.m(0.3), zStrobe), WHITE, "strobe");
  }

  /** Placas, cajas de equipos y tuberías sobre el lomo y los costados. */
  greebles(z0: number, z1: number, n: number): void {
    const { parts, rnd } = this;
    for (let i = 0; i < n; i++) {
      const z = z0 + rnd() * (z1 - z0);
      const r = this.at(z);
      const w = this.m(0.8 + rnd() * 2.4);
      const h = this.m(0.25 + rnd() * 0.6);
      const d = this.m(1 + rnd() * 3.5);
      const slot: Slot = rnd() < 0.55 ? "dark" : "plate";
      if (rnd() < 0.65) {
        const x = (rnd() - 0.5) * r.w * r.t * 0.6;
        parts.add(slot, block(w, h, d, 0.3), { p: [x, r.y + r.h / 2 + h * 0.35, z] });
      } else {
        const side = rnd() < 0.5 ? 1 : -1;
        parts.add(slot, block(h, w * 0.7, d, 0.3), { p: [side * (r.w / 2 + h * 0.3), r.y + (rnd() - 0.5) * r.h * 0.4, z] });
      }
    }
    // Tuberías por los costados.
    this.sym((side) => {
      const za = z0 + (z1 - z0) * 0.15;
      const zb = z1;
      const ra = this.at(za);
      const rb = this.at(zb);
      const y = ra.y + ra.h * 0.18;
      pipe(parts, v(side * (ra.w / 2 + this.m(0.25)), y, za), v(side * (rb.w / 2 + this.m(0.25)), rb.y + rb.h * 0.18, zb), this.m(0.18));
    }, true);
  }

  /** Bandas del color del dueño atravesando el lomo. */
  band(z: number, len: number): void {
    const r = this.at(z);
    this.parts.add("trim", new THREE.BoxGeometry(r.w * r.t * 0.75, this.m(0.08), len), { p: [0, r.y + r.h / 2 + this.m(0.03), z] });
  }

  /** Puente de mando acorazado (no una burbuja): módulo elevado con franja de ventanas en rendija. */
  bridge(z0: number, z1: number, w: number, h: number): void {
    const y0 = this.top((z0 + z1) / 2) - h * 0.15;
    this.section(
      [
        { z: z0, w: w * 0.55, h: h * 0.4, y: y0 + h * 0.2, t: 0.75 },
        { z: z0 + (z1 - z0) * 0.22, w, h, y: y0 + h * 0.5, t: 0.72 },
        { z: z1 - (z1 - z0) * 0.1, w, h, y: y0 + h * 0.5, t: 0.8 },
        { z: z1, w: w * 0.8, h: h * 0.7, y: y0 + h * 0.4, t: 0.8 },
      ],
      "plate",
    );
    const zf = z0 + (z1 - z0) * 0.11;
    windows(this.parts, v(0, y0 + h * 0.62, zf), w * 0.62, h * 0.18, this.m(0.2), [-0.95, 0, 0]);
    this.sym((side) => windows(this.parts, v(side * w * 0.47, y0 + h * 0.62, (z0 + z1) / 2), this.m(0.15), h * 0.16, (z1 - z0) * 0.55));
    this.parts.light(v(0, y0 + h + this.m(0.2), z1 - (z1 - z0) * 0.3), AMBER, "steady");
  }

  /** Chatarra soldada: placas torcidas, púas y vigas sueltas. */
  scrapify(): void {
    if (!this.scrap) return;
    const { parts, rnd } = this;
    const n = 8 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) {
      const z = -0.4 + rnd() * 0.75;
      const r = this.at(z);
      const side = rnd() < 0.5 ? 1 : -1;
      const onTop = rnd() < 0.5;
      const w = this.m(2 + rnd() * 5);
      parts.add(rnd() < 0.5 ? "plate" : "dark", new THREE.BoxGeometry(onTop ? w : this.m(0.4), onTop ? this.m(0.4) : w * 0.6, this.m(2 + rnd() * 6)), {
        p: [onTop ? (rnd() - 0.5) * r.w * 0.6 : side * (r.w / 2 + this.m(0.15)), onTop ? r.y + r.h / 2 + this.m(0.15) : r.y + (rnd() - 0.5) * r.h * 0.5, z],
        r: [(rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.5],
      }, i < 4);
    }
    // Espolón con púas en la proa.
    const nose = this.at(-0.45);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * nose.w * 0.35;
      parts.add("dark", new THREE.ConeGeometry(this.m(0.5), this.m(4 + rnd() * 4), 5), { p: [x, nose.y + (rnd() - 0.5) * nose.h * 0.5, -0.48], r: [-Math.PI / 2 + (rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3] });
    }
    // Viga de remolque suelta a un lado.
    const side = rnd() < 0.5 ? 1 : -1;
    const z = -0.1 + rnd() * 0.3;
    parts.beam("metal", v(side * this.half(z) * 0.9, this.at(z).y, z - 0.1), v(side * (this.half(z) + this.m(3)), this.at(z).y - this.m(1), z + 0.12), this.m(0.6), true);
  }
}

// --- Recetas ---

/**
 * Insignia del Emperador: nave de mando y colonia de 320 m (`FLAGSHIP_LENGTH_M`)
 * para 500 personas. Proa acorazada con cañones en barquillas, puente elevado,
 * dos módulos de hábitat a los costados con cubiertas de ventanas iluminadas y
 * un lanzador de misiles en la proa de cada uno (las bocas de
 * `FLAGSHIP_HARDPOINTS`), hangar ventral con la boca iluminada, sección de
 * ingeniería con radiadores, tres toberas principales y dos auxiliares.
 */
function flagship(b: Builder): void {
  const { parts } = b;
  b.hull([
    { z: -0.5, w: 0.03, h: 0.014, y: -0.01, c: 0.3 },
    { z: -0.46, w: 0.07, h: 0.034, y: -0.008, t: 0.85 },
    { z: -0.38, w: 0.11, h: 0.06, y: -0.004, t: 0.8 },
    { z: -0.28, w: 0.13, h: 0.085, y: 0, t: 0.82 },
    { z: -0.14, w: 0.13, h: 0.09, y: 0.002, t: 0.85 },
    { z: -0.08, w: 0.11, h: 0.08, y: 0.002, t: 0.9 },
    { z: 0.1, w: 0.11, h: 0.08, y: 0.002, t: 0.9 },
    { z: 0.16, w: 0.15, h: 0.1, y: 0, t: 0.85 },
    { z: 0.38, w: 0.15, h: 0.1, y: 0, t: 0.85 },
    { z: 0.4, w: 0.13, h: 0.09, y: 0, t: 0.85 },
  ]);
  // Coraza de proa (placa superpuesta con su labio).
  b.section(
    [
      { z: -0.47, w: 0.05, h: 0.01, y: 0.004, t: 0.8 },
      { z: -0.38, w: 0.105, h: 0.025, y: 0.026, t: 0.75 },
      { z: -0.26, w: 0.125, h: 0.025, y: 0.042, t: 0.75 },
      { z: -0.2, w: 0.11, h: 0.018, y: 0.046, t: 0.75 },
    ],
    "plate",
  );
  b.bridge(-0.19, -0.09, 0.06, 0.028);
  // Cubiertas de la proa: dos filas de ventanas por costado (tramos con mamparos).
  const deckRow = (x: (z: number) => number, y: number, z0: number, z1: number, seg = 0.024) => {
    for (let z = z0; z + seg * 0.75 <= z1; z += seg) {
      const zc = z + seg * 0.375;
      b.sym((side) => windows(parts, v(side * (x(zc) + 0.0006), y, zc), 0.0025, 0.0032, seg * 0.75));
    }
  };
  deckRow((z) => b.half(z) * 0.99, -0.02, -0.34, -0.15);
  deckRow((z) => b.half(z) * 0.97, -0.006, -0.32, -0.15);
  deckRow(() => 0.075, -0.024, 0.18, 0.36, 0.03);
  deckRow(() => 0.0745, -0.01, 0.18, 0.36, 0.03);

  // Módulos de hábitat a los costados, con cuatro cubiertas iluminadas cada uno.
  const HX = 0.118;
  const HY = 0.004;
  b.sym((side) => {
    b.section(
      [
        { z: -0.09, w: 0.05, h: 0.05, y: HY, t: 0.9 },
        { z: -0.07, w: 0.075, h: 0.075, y: HY },
        { z: 0.1, w: 0.075, h: 0.075, y: HY },
        { z: 0.13, w: 0.055, h: 0.055, y: HY },
      ],
      "hull",
      side * HX,
    );
    for (const y of [-0.012, -0.004, 0.004, 0.012]) {
      for (let z = -0.06; z < 0.09; z += 0.03) windows(parts, v(side * (HX + 0.0378), HY + y, z + 0.012), 0.0025, 0.003, 0.022);
    }
    parts.add("trim", new THREE.BoxGeometry(0.003, 0.005, 0.16), { p: [side * (HX + 0.0378), HY + 0.022, 0.015] });
    parts.add("plate", block(0.05, 0.006, 0.15, 0.3), { p: [side * HX, HY + 0.0395, 0.015] });
    // Pilones que unen el módulo al casco.
    for (const z of [-0.04, 0.07]) parts.add("dark", block(0.06, 0.022, 0.032, 0.3), { p: [side * 0.08, HY, z] }, true);
    // Motor auxiliar en la popa del módulo.
    mainEngine(parts, side * HX, HY, 0.13, 0.02, 0.045);
    rcsBlock(parts, v(side * (HX + 0.045), HY, 0.0), [UP, DOWN, v(side, 0, 0)], 0.016);
  });

  // Hangar ventral: bloque bajo la sección de ingeniería con la boca iluminada hacia proa.
  b.section(
    [
      { z: 0.14, w: 0.11, h: 0.05, y: -0.07, c: 0.2 },
      { z: 0.34, w: 0.11, h: 0.05, y: -0.07, c: 0.2 },
      { z: 0.37, w: 0.08, h: 0.035, y: -0.064 },
    ],
    "dark",
  );
  parts.add("glass", new THREE.BoxGeometry(0.085, 0.03, 0.002), { p: [0, -0.072, 0.1395] });
  parts.add("plate", new THREE.BoxGeometry(0.095, 0.004, 0.008), { p: [0, -0.0545, 0.142] });
  parts.add("plate", new THREE.BoxGeometry(0.095, 0.004, 0.008), { p: [0, -0.0895, 0.142] });
  for (const x of [-0.045, -0.015, 0.015, 0.045]) parts.light(v(x, -0.0925, 0.138), AMBER, "steady");
  b.sym((side) => parts.light(v(side * 0.053, -0.072, 0.138), side > 0 ? GREEN : RED, "steady"));

  // Motores principales: dos abajo y uno arriba.
  parts.add("dark", block(0.15, 0.1, 0.02, 0.25), { p: [0, 0.002, 0.395] }, true);
  for (const [x, y, r, len] of [
    [-0.042, -0.022, 0.034, 0.08],
    [0.042, -0.022, 0.034, 0.08],
    [0, 0.028, 0.03, 0.07],
  ] as const) mainEngine(parts, x, y, 0.4, r, len);
  // Radiadores en ángulo en la sección de ingeniería.
  let portTip = v(-0.2, 0.06, 0.27);
  b.sym((side) => {
    const tip = radiator(parts, v(side * 0.075, 0.03, 0.27), 0.13, 0.12, 0.3, side);
    if (side < 0) portTip = tip;
  });
  // Lomo: conducto, tuberías, mástiles, plato y cúpula de sensores bajo el morro.
  parts.add("dark", block(0.035, 0.015, 0.3, 0.3), { p: [0, b.top(0.25) + 0.004, 0.25] });
  pipe(parts, v(0.024, b.top(-0.06) + 0.003, -0.06), v(0.024, b.top(0.35) + 0.004, 0.36), 0.004);
  pipe(parts, v(-0.024, b.top(-0.06) + 0.003, -0.06), v(-0.024, b.top(0.35) + 0.004, 0.36), 0.004);
  antenna(parts, v(0.018, b.top(-0.05) + 0.004, -0.05), 0.06, 0.02);
  antenna(parts, v(-0.025, b.top(0.3) + 0.006, 0.3), 0.04);
  dish(parts, v(-0.02, b.top(0.06) + 0.025, 0.06), 0.02, v(0.3, 1, -0.8));
  parts.beam("dark", v(-0.02, b.top(0.06), 0.06), v(-0.02, b.top(0.06) + 0.025, 0.06), 0.005);
  sensorDome(parts, v(0, b.bottom(-0.3) + 0.002, -0.3), 0.018, true);
  b.band(-0.07, 0.01);
  b.band(-0.045, 0.005);
  b.band(0.2, 0.01);
  b.weapons(0.12, undefined, { gun: 0.011, launcher: 0.028 });
  b.rcs(-0.34, 0.35, 0.02);
  b.navLights(portTip, 0.33);

  // Silueta (petición del usuario: «las naves son un poco simples»): volúmenes grandes que se leen de lejos.
  // Superestructura escalonada sobre la sección de ingeniería, con ventanas y su propio mástil.
  const deck = b.top(0.17) + 0.012;
  b.section(
    [
      { z: 0.1, w: 0.03, h: 0.012, y: deck, t: 0.7 },
      { z: 0.125, w: 0.062, h: 0.03, y: deck + 0.008, t: 0.75 },
      { z: 0.22, w: 0.062, h: 0.03, y: deck + 0.008, t: 0.75 },
      { z: 0.245, w: 0.045, h: 0.02, y: deck + 0.004, t: 0.8 },
    ],
    "plate",
  );
  b.section(
    [
      { z: 0.14, w: 0.02, h: 0.01, y: deck + 0.026, t: 0.7 },
      { z: 0.155, w: 0.036, h: 0.018, y: deck + 0.03, t: 0.7 },
      { z: 0.2, w: 0.036, h: 0.018, y: deck + 0.03, t: 0.7 },
      { z: 0.21, w: 0.028, h: 0.012, y: deck + 0.028 },
    ],
    "hull",
  );
  b.sym((side) => {
    for (let z = 0.135; z < 0.215; z += 0.02) windows(parts, v(side * 0.0312, deck + 0.012, z), 0.0022, 0.0028, 0.014);
    for (let z = 0.16; z < 0.2; z += 0.014) windows(parts, v(side * 0.0182, deck + 0.032, z), 0.002, 0.0024, 0.01);
  });
  antenna(parts, v(0, deck + 0.039, 0.18), 0.05, 0.016);
  parts.light(v(0, deck + 0.089, 0.18), RED, "beacon");

  // Faldones de blindaje por los costados, bajo las cubiertas: placas superpuestas con juntas.
  b.sym((side) => {
    for (const [z0, z1] of [
      [-0.36, -0.29],
      [-0.285, -0.215],
      [-0.21, -0.15],
      [0.17, 0.24],
      [0.245, 0.31],
      [0.315, 0.375],
    ] as const) {
      const zc = (z0 + z1) / 2;
      const x = b.half(zc) + 0.002;
      parts.add("plate", block(0.006, 0.016, z1 - z0, 0.4), { p: [side * x, b.at(zc).y - b.at(zc).h * 0.32, zc] });
    }
  });

  // Quilla bajo la proa: una aleta fina que alarga la silueta.
  b.section(
    [
      { z: -0.29, w: 0.004, h: 0.004, y: b.bottom(-0.29) - 0.002, c: 0.1 },
      { z: -0.22, w: 0.008, h: 0.03, y: b.bottom(-0.22) - 0.012, c: 0.1 },
      { z: -0.12, w: 0.008, h: 0.026, y: b.bottom(-0.12) - 0.01, c: 0.1 },
      { z: -0.09, w: 0.004, h: 0.004, y: b.bottom(-0.09) - 0.002, c: 0.1 },
    ],
    "dark",
  );

  // Anillos en las toberas principales.
  for (const [x, y, r] of [
    [-0.042, -0.022, 0.034],
    [0.042, -0.022, 0.034],
    [0, 0.028, 0.03],
  ] as const) {
    parts.add("metal", new THREE.TorusGeometry(r * 1.12, r * 0.1, 8, 28), { p: [x, y, 0.415] });
    parts.add("trim", new THREE.TorusGeometry(r * 1.02, r * 0.035, 6, 28), { p: [x, y, 0.43] });
  }
  b.greebles(-0.3, 0.38, 110);
}

/** Exploradores: módulo de sensores, celosía central, hábitat y bloque de motores; gran plato. */
function scout(b: Builder): void {
  const { parts, W, H } = b;
  b.hull([
    { z: -0.5, w: W * 0.2, h: H * 0.22 },
    { z: -0.46, w: W * 0.48, h: H * 0.6, t: 0.85 },
    { z: -0.36, w: W * 0.6, h: H * 0.75, t: 0.85 },
    { z: -0.24, w: W * 0.52, h: H * 0.65 },
    { z: -0.2, w: W * 0.25, h: H * 0.3 },
    { z: 0.1, w: W * 0.25, h: H * 0.3 },
    { z: 0.14, w: W * 0.75, h: H * 0.85, t: 0.85 },
    { z: 0.36, w: W * 0.8, h: H * 0.9, t: 0.85 },
    { z: 0.4, w: W * 0.68, h: H * 0.75, t: 0.85 },
  ]);
  // Anillo de sensores y antenas delanteras.
  parts.add("dark", new THREE.TorusGeometry(1, 0.1, 6, 20), { p: [0, 0, -0.41], s: [W * 0.32, H * 0.42, W * 0.3] }, true);
  b.sym((side) => parts.beam("metal", v(side * W * 0.12, H * 0.12, -0.45), v(side * W * 0.12, H * 0.12, -0.53), b.m(0.15), false, true));
  sensorDome(parts, v(0, b.bottom(-0.38), -0.38), W * 0.12, true);
  windows(parts, v(0, b.top(-0.4) - b.m(0.2), -0.43), W * 0.3, H * 0.08, b.m(0.2), [-0.8, 0, 0]);
  // Celosía del centro: largueros y diagonales.
  const s = W * 0.14;
  for (const [x, y] of [[s, s], [-s, s], [s, -s], [-s, -s]] as const) parts.beam("metal", v(x, y, -0.22), v(x, y, 0.13), b.m(0.35), true);
  for (let z = -0.2; z < 0.1; z += 0.06) {
    parts.beam("dark", v(s, s, z), v(-s, s, z + 0.06), b.m(0.2));
    parts.beam("dark", v(s, -s, z), v(s, s, z + 0.06), b.m(0.2));
    parts.beam("dark", v(-s, -s, z), v(-s, s, z + 0.06), b.m(0.2));
  }
  // Hábitat de la tripulación con ojos de buey.
  b.section([{ z: -0.13, w: W * 0.35, h: H * 0.5 }, { z: -0.1, w: W * 0.55, h: H * 0.75, t: 0.85 }, { z: 0.02, w: W * 0.55, h: H * 0.75, t: 0.85 }, { z: 0.05, w: W * 0.35, h: H * 0.5 }]);
  b.sym((side) => windows(parts, v(side * W * 0.276, 0, -0.04), b.m(0.15), H * 0.08, 0.08));
  // Plato grande sobre un brazo.
  parts.beam("dark", v(0, H * 0.35, -0.03), v(0, H * 0.35 + 0.08, -0.03), b.m(0.5));
  dish(parts, v(0, H * 0.35 + 0.08, -0.03), Math.max(0.07, W * 0.42), v(0, 0.6, -1));
  // Radiadores verticales arriba y abajo en la celosía.
  radiatorFin(parts, v(0, s, 0.07), H * 0.45, 0.08, 1);
  radiatorFin(parts, v(0, -s, 0.07), H * 0.45, 0.08, -1);
  b.sym((side) => radiator(parts, v(side * W * 0.38, 0, 0.27), W * 0.45, 0.12, -0.15, side), true);
  b.engines(b.look.model.engines, 0.4, W * 0.32, H * 0.28);
  antenna(parts, v(W * 0.15, b.top(0.25), 0.25), 0.06);
  b.weapons(0.12);
  b.rcs(-0.33, 0.33, b.m(0.9));
  b.navLights(v(-(W * 0.38 + W * 0.45), -W * 0.07, 0.27), 0.3);
  b.band(0.2, b.m(0.5));
  b.greebles(0.15, 0.38, 10);
}

/** Cazas e interceptores: módulo acorazado, cuerpo compacto y pilones laterales con armas y propulsores. */
function fighter(b: Builder): void {
  const { parts, W, H } = b;
  b.hull([
    { z: -0.5, w: W * 0.14, h: H * 0.15, y: -H * 0.08 },
    { z: -0.42, w: W * 0.42, h: H * 0.45, y: -H * 0.05, t: 0.8 },
    { z: -0.28, w: W * 0.7, h: H * 0.72, t: 0.75 },
    { z: -0.1, w: W * 0.88, h: H * 0.88, y: H * 0.03, t: 0.8 },
    { z: 0.12, w: W * 0.92, h: H * 0.92, y: H * 0.03, t: 0.85 },
    { z: 0.3, w: W * 0.84, h: H * 0.85, t: 0.85 },
    { z: 0.34, w: W * 0.7, h: H * 0.72, t: 0.85 },
  ]);
  // Capota blindada con rendija de visión.
  b.section(
    [
      { z: -0.38, w: W * 0.18, h: H * 0.06, y: b.top(-0.38) - H * 0.02, t: 0.7 },
      { z: -0.3, w: W * 0.46, h: H * 0.24, y: b.top(-0.3) + H * 0.04, t: 0.6 },
      { z: -0.1, w: W * 0.5, h: H * 0.28, y: b.top(-0.1) + H * 0.04, t: 0.65 },
      { z: 0.0, w: W * 0.36, h: H * 0.14, y: b.top(0) + H * 0.01, t: 0.7 },
    ],
    "plate",
  );
  windows(parts, v(0, b.top(-0.3) + H * 0.1, -0.29), W * 0.36, H * 0.07, b.m(0.12), [-1.0, 0, 0]);
  // Pilones: brazo con barquilla en la punta (propulsores, misiles, radiador).
  const podX = b.look.hardpoints.missile[0] ? Math.abs(b.hp(b.look.hardpoints.missile[0]).x) : W * 0.5 + 0.16;
  const podW = Math.max(b.m(1.6), 0.04);
  b.sym((side) => {
    const x0 = W * 0.4;
    parts.add("plate", block(podX - x0, H * 0.22, 0.15, 0.3, 1), { p: [side * (x0 + podX) / 2, H * 0.0, 0.03] }, true);
    b.section(
      [
        { z: -0.14, w: podW * 0.5, h: podW * 0.5 },
        { z: -0.09, w: podW, h: podW, t: 0.8 },
        { z: 0.15, w: podW, h: podW, t: 0.8 },
        { z: 0.19, w: podW * 0.7, h: podW * 0.7 },
      ],
      "hull",
      side * podX,
    );
    parts.add("trim", new THREE.BoxGeometry(podW * 1.02, podW * 0.15, 0.04), { p: [side * podX, podW * 0.3, -0.05] });
    radiatorFin(parts, v(side * podX, podW * 0.45, 0.06), H * 0.5, 0.12, 1);
    rcsBlock(parts, v(side * (podX + podW * 0.5 + b.m(0.25)), 0, 0.12), [UP, DOWN, v(side, 0, 0), AFT], b.m(0.55));
  });
  b.engines(b.look.model.engines, 0.34, W * 0.3, H * 0.3, 0);
  b.weapons(0.28);
  // Propulsores de proa.
  b.sym((side) => rcsBlock(parts, v(side * (b.half(-0.3) + b.m(0.25)), 0, -0.3), [UP, DOWN, v(side, 0, 0), FWD], b.m(0.5)));
  b.navLights(v(-(podX + podW * 0.5), 0, -0.1), 0.25);
  antenna(parts, v(-W * 0.12, b.top(0.2), 0.2), H * 0.5, 0.03);
  b.band(0.22, b.m(0.4));
  b.greebles(0.05, 0.3, 6);
}

/** Corbetas, fragatas y destructores: núcleo blindado, barquillas o tanques, torre de mando, radiadores. */
function frigate(b: Builder): void {
  const { parts, W, H } = b;
  const wc = Math.min(W * 0.5, 0.2);
  const Hc = H;
  b.hull([
    { z: -0.5, w: wc * 0.3, h: Hc * 0.32, y: -Hc * 0.12 },
    { z: -0.42, w: wc * 0.68, h: Hc * 0.62, y: -Hc * 0.06, t: 0.7 },
    { z: -0.26, w: wc, h: Hc * 0.85, t: 0.75 },
    { z: 0.1, w: wc, h: Hc * 0.9, t: 0.8 },
    { z: 0.36, w: wc * 0.95, h: Hc * 0.85, t: 0.85 },
    { z: 0.4, w: wc * 0.82, h: Hc * 0.72, t: 0.85 },
  ]);
  // Coraza de proa.
  b.section(
    [
      { z: -0.46, w: wc * 0.5, h: Hc * 0.1, y: b.top(-0.46) - Hc * 0.02, t: 0.8 },
      { z: -0.3, w: wc * 0.95, h: Hc * 0.14, y: b.top(-0.3) + Hc * 0.03, t: 0.75 },
      { z: -0.14, w: wc * 1.03, h: Hc * 0.12, y: b.top(-0.14) + Hc * 0.03, t: 0.75 },
      { z: -0.1, w: wc * 0.9, h: Hc * 0.08, y: b.top(-0.1) + Hc * 0.02, t: 0.75 },
    ],
    "plate",
  );
  const wide = W > wc * 1.4;
  let outer = wc / 2;
  if (wide) {
    // Barquillas blindadas a los lados: dan la planta en cuña.
    const sw = ((W - wc) / 2) * 0.78;
    const sx = wc / 2 + sw / 2 - 0.004;
    outer = sx + sw / 2;
    b.sym((side) => {
      b.section(
        [
          { z: -0.24, w: sw * 0.35, h: Hc * 0.3, y: -Hc * 0.12 },
          { z: -0.12, w: sw, h: Hc * 0.55, y: -Hc * 0.1, t: 0.8 },
          { z: 0.3, w: sw, h: Hc * 0.6, y: -Hc * 0.1, t: 0.8 },
          { z: 0.37, w: sw * 0.85, h: Hc * 0.5, y: -Hc * 0.1, t: 0.8 },
        ],
        "hull",
        side * sx,
      );
      parts.add("trim", new THREE.BoxGeometry(sw * 0.7, b.m(0.1), 0.03), { p: [side * sx, -Hc * 0.1 + Hc * 0.3 + b.m(0.04), -0.08] });
      mainEngine(parts, side * sx, -Hc * 0.1, 0.37, Math.min(sw * 0.3, Hc * 0.2), Math.min(sw * 0.3, Hc * 0.2) * 2);
      radiator(parts, v(side * (sx - sw * 0.2), -Hc * 0.1 + Hc * 0.3, 0.2), sw * 0.9, 0.14, 0.22, side);
      for (let i = 0; i < 4; i++) windows(parts, v(side * (sx + sw / 2 + b.m(0.02)), -Hc * 0.06, -0.05 + i * 0.07), b.m(0.1), Hc * 0.07, 0.04);
    }, false);
  } else {
    // Tanques de propelente a los costados y radiadores en V sobre el lomo.
    const r = Hc * 0.2;
    outer = wc / 2 + r * 2;
    b.sym((side) => {
      parts.add("plate", tube(r * 0.6, r, 0.05), { p: [side * (wc / 2 + r * 0.9), -Hc * 0.15, -0.1] }, true);
      parts.add("plate", tube(r, r, 0.3), { p: [side * (wc / 2 + r * 0.9), -Hc * 0.15, 0.075] }, true);
      parts.add("plate", tube(r, r * 0.6, 0.05), { p: [side * (wc / 2 + r * 0.9), -Hc * 0.15, 0.25] }, true);
      for (const z of [-0.02, 0.1, 0.2]) parts.add("dark", new THREE.TorusGeometry(r * 1.02, r * 0.07, 4, 16), { p: [side * (wc / 2 + r * 0.9), -Hc * 0.15, z] });
      radiator(parts, v(side * wc * 0.3, b.top(0.25), 0.25), Hc * 0.75, 0.14, 1.05, side);
    }, true);
  }
  b.bridge(0.04, 0.24, wc * 0.5, Hc * 0.32);
  const towerTop = b.top(0.14) + Hc * 0.32;
  antenna(parts, v(wc * 0.1, towerTop, 0.18), Hc * 0.6);
  antenna(parts, v(-wc * 0.12, towerTop - Hc * 0.05, 0.21), Hc * 0.4);
  dish(parts, v(-wc * 0.05, towerTop + b.m(0.6), 0.12), Math.max(b.m(1.5), 0.012), v(0, 1, -0.6));
  sensorDome(parts, v(0, b.bottom(-0.35), -0.35), wc * 0.12, true);
  b.engines(b.look.model.engines, 0.4, wc * 0.38, Hc * 0.32);
  b.weapons(0.16);
  b.rcs(-0.33, 0.33, Math.max(b.m(0.9), 0.016), undefined, wide ? outer : undefined, undefined, wide ? -Hc * 0.1 : undefined);
  b.navLights(v(-(outer + b.m(0.3)), wide ? -Hc * 0.1 : 0, 0.0), 0.32);
  b.band(-0.2, b.m(0.6));
  b.band(-0.17, b.m(0.3));
  b.greebles(-0.08, 0.36, 14);
}

/** Cruceros y portanaves: dos cubiertas, torre de mando, torretas, hangar, grandes radiadores. */
function capital(b: Builder): void {
  const { parts, W, H } = b;
  b.hull([
    { z: -0.5, w: W * 0.14, h: H * 0.3, y: -H * 0.14, c: 0.15, t: 0.8 },
    { z: -0.36, w: W * 0.62, h: H * 0.62, y: -H * 0.07, c: 0.15, t: 0.8 },
    { z: -0.2, w: W * 0.94, h: H * 0.8, c: 0.15, t: 0.85 },
    { z: 0.0, w: W * 0.86, h: H * 0.78, c: 0.15, t: 0.85 },
    { z: 0.12, w: W, h: H * 0.8, c: 0.15, t: 0.85 },
    { z: 0.34, w: W, h: H * 0.8, c: 0.15, t: 0.85 },
    { z: 0.42, w: W * 0.88, h: H * 0.7, c: 0.15, t: 0.85 },
  ]);
  const deck: Ring[] = [
    { z: -0.32, w: W * 0.46, h: H * 0.1, y: H * 0.4 },
    { z: -0.24, w: W * 0.62, h: H * 0.18, y: H * 0.45, t: 0.85 },
    { z: 0.3, w: W * 0.62, h: H * 0.18, y: H * 0.45, t: 0.85 },
    { z: 0.34, w: W * 0.5, h: H * 0.1, y: H * 0.42 },
  ];
  b.section(deck, "plate");
  const deckTop = (z: number) => (z > -0.24 && z < 0.3 ? H * 0.54 : b.top(z));
  b.section([{ z: -0.36, w: W * 0.28, h: H * 0.1, y: -H * 0.42 }, { z: 0.3, w: W * 0.42, h: H * 0.14, y: -H * 0.44 }], "dark");
  // Espolón de proa y bloque de ingeniería, más ancho que el casco, a popa.
  b.section([{ z: -0.5, w: W * 0.2, h: H * 0.12, y: -H * 0.27 }, { z: -0.4, w: W * 0.55, h: H * 0.2, y: -H * 0.3, t: 0.9 }, { z: -0.24, w: W * 0.62, h: H * 0.18, y: -H * 0.33 }], "plate");
  b.section([{ z: 0.25, w: W * 1.04, h: H * 0.7, t: 0.85 }, { z: 0.29, w: W * 1.16, h: H * 0.86, t: 0.85 }, { z: 0.41, w: W * 1.16, h: H * 0.86, t: 0.85 }, { z: 0.44, w: W * 1.02, h: H * 0.74, t: 0.85 }], "plate");
  if (!b.look.model.pods) {
    // Cinturones de blindaje por módulos en los costados.
    b.sym((side) => {
      for (let i = 0; i < 4; i++) {
        const z0 = -0.3 + i * 0.135;
        b.section([{ z: z0, w: W * 0.07, h: H * 0.3, y: -H * 0.08, t: 0.8 }, { z: z0 + 0.12, w: W * 0.07, h: H * 0.3, y: -H * 0.08, t: 0.8 }], i % 2 ? "plate" : "dark", side * W * 0.52);
      }
    });
  }
  // Torre de mando a popa.
  const y0 = H * 0.54;
  b.section(
    [
      { z: 0.14, w: W * 0.22, h: H * 0.14, y: y0 + H * 0.06, t: 0.75 },
      { z: 0.18, w: W * 0.3, h: H * 0.24, y: y0 + H * 0.11, t: 0.75 },
      { z: 0.3, w: W * 0.3, h: H * 0.24, y: y0 + H * 0.11, t: 0.8 },
      { z: 0.32, w: W * 0.24, h: H * 0.16, y: y0 + H * 0.08 },
    ],
    "hull",
  );
  b.section(
    [
      { z: 0.19, w: W * 0.16, h: H * 0.06, y: y0 + H * 0.25, t: 0.7 },
      { z: 0.21, w: W * 0.22, h: H * 0.12, y: y0 + H * 0.28, t: 0.7 },
      { z: 0.29, w: W * 0.22, h: H * 0.12, y: y0 + H * 0.28, t: 0.8 },
    ],
    "plate",
  );
  windows(parts, v(0, y0 + H * 0.29, 0.203), W * 0.17, H * 0.03, b.m(0.3), [-0.9, 0, 0]);
  windows(parts, v(0, y0 + H * 0.14, 0.177), W * 0.26, H * 0.03, b.m(0.3), [-0.9, 0, 0]);
  antenna(parts, v(W * 0.04, y0 + H * 0.34, 0.25), H * 0.45);
  antenna(parts, v(-W * 0.06, y0 + H * 0.34, 0.27), H * 0.3);
  dish(parts, v(-W * 0.08, y0 + H * 0.36, 0.22), Math.max(b.m(2), 0.012), v(0.3, 1, -0.5));
  // Filas de ventanas en los costados.
  b.sym((side) => {
    for (let i = 0; i < 6; i++) windows(parts, v(side * (W / 2 + b.m(0.03)), H * 0.15, -0.25 + i * 0.09), b.m(0.1), H * 0.04, 0.05);
  });
  if (b.look.model.hangar) {
    // Cubierta de vuelo y bocas de hangar con luz.
    parts.add("dark", new THREE.BoxGeometry(W * 0.55, b.m(0.3), 0.5), { p: [0, H * 0.54 + b.m(0.15), -0.02] }, true);
    parts.add("trim", new THREE.BoxGeometry(b.m(0.4), b.m(0.1), 0.48), { p: [0, H * 0.54 + b.m(0.35), -0.02] });
    for (let i = 0; i < 6; i++) parts.light(v(0, H * 0.54 + b.m(0.4), -0.24 + i * 0.09), AMBER, "steady");
    b.sym((side) => {
      parts.add("dark", new THREE.BoxGeometry(b.m(0.6), H * 0.3, 0.16), { p: [side * (W / 2 + b.m(0.1)), -H * 0.15, -0.12] }, true);
      parts.add("glow", new THREE.BoxGeometry(b.m(0.7), b.m(0.3), 0.15), { p: [side * (W / 2 + b.m(0.15)), -H * 0.29, -0.12] });
    });
    parts.add("dark", new THREE.BoxGeometry(W * 0.4, H * 0.28, b.m(0.6)), { p: [0, -H * 0.08, -0.425] });
    parts.add("glow", new THREE.BoxGeometry(W * 0.36, b.m(0.3), b.m(0.7)), { p: [0, -H * 0.2, -0.425] });
  }
  if (b.look.model.pods) {
    const n = b.look.model.pods;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const z = -0.15 + Math.floor(i / 2) * 0.16;
      cargoPod(parts, v(side * (W / 2 + W * 0.12), -H * 0.1, z), W * 0.22, H * 0.45, 0.13, b.rnd() < 0.5 ? "plate" : "dark");
    }
  }
  // Radiadores en dos alturas.
  b.sym((side) => {
    radiator(parts, v(side * W * 0.56, H * 0.22, 0.34), W * 0.55, 0.1, 0.12, side);
    radiator(parts, v(side * W * 0.56, -H * 0.12, 0.34), W * 0.45, 0.09, -0.12, side);
  }, true);
  b.engines(b.look.model.engines, 0.44, W * 0.4, H * 0.32);
  b.weapons(0.1, deckTop);
  b.rcs(-0.36, 0.36, Math.max(b.m(1.4), 0.012));
  b.navLights(v(-(W * 0.56 + W * 0.55 * Math.cos(0.12)), H * 0.22 + W * 0.55 * Math.sin(0.12), 0.34), 0.38);
  b.band(-0.28, b.m(1.2));
  b.band(-0.25, b.m(0.6));
  if (b.look.model.lengthM >= 1000) mothershipExtras(b);
  b.greebles(-0.3, 0.38, b.look.model.lengthM >= 1000 ? 90 : 40);
}

/**
 * Lo que distingue a la nave nodriza (más de 1000 m) de un portanaves: dos
 * cascos laterales con sus motores unidos por pilones, una gran boca de hangar
 * iluminada en la proa y una segunda torre en el lomo.
 */
function mothershipExtras(b: Builder): void {
  const { parts, W, H } = b;
  const OX = W * 0.86;
  b.sym((side) => {
    b.section(
      [
        { z: -0.34, w: W * 0.08, h: H * 0.12, y: -H * 0.02, c: 0.2, t: 0.8 },
        { z: -0.26, w: W * 0.22, h: H * 0.34, y: 0, c: 0.2, t: 0.85 },
        { z: 0.3, w: W * 0.22, h: H * 0.34, y: 0, c: 0.2, t: 0.85 },
        { z: 0.4, w: W * 0.18, h: H * 0.28, y: 0, c: 0.2 },
      ],
      "hull",
      side * OX,
    );
    // Franja de blindaje y cubiertas iluminadas a lo largo del casco lateral.
    b.section([{ z: -0.2, w: W * 0.235, h: H * 0.06, y: H * 0.12 }, { z: 0.26, w: W * 0.235, h: H * 0.06, y: H * 0.12 }], "plate", side * OX);
    for (let i = 0; i < 9; i++) windows(parts, v(side * (OX + W * 0.111), -H * 0.02, -0.2 + i * 0.05), b.m(0.1), H * 0.035, 0.03);
    // Pilones que los unen al casco central.
    for (const z of [-0.12, 0.08, 0.26]) parts.add("dark", block(OX - W * 0.5, H * 0.12, 0.05, 0.3), { p: [side * (W * 0.5 + (OX - W * 0.5) / 2), -H * 0.02, z] }, true);
    // Sus motores, y una luz de posición en la proa de cada uno.
    mainEngine(parts, side * OX, H * 0.06, 0.4, W * 0.06, 0.06);
    mainEngine(parts, side * OX, -H * 0.08, 0.4, W * 0.06, 0.06);
    parts.light(v(side * OX, H * 0.08, -0.33), side > 0 ? GREEN : RED, "steady");
  });
  // Boca del hangar principal en la proa: un portón enorme con luz.
  parts.add("dark", new THREE.BoxGeometry(W * 0.5, H * 0.34, b.m(1)), { p: [0, -H * 0.02, -0.37] }, true);
  parts.add("glow", new THREE.BoxGeometry(W * 0.44, H * 0.04, b.m(1.2)), { p: [0, -H * 0.16, -0.37] });
  parts.add("glow", new THREE.BoxGeometry(W * 0.44, H * 0.02, b.m(1.2)), { p: [0, H * 0.12, -0.37] });
  for (const x of [-0.18, -0.06, 0.06, 0.18]) parts.light(v(W * x, -H * 0.19, -0.372), AMBER, "steady");
  // Segunda torre en el lomo, hacia proa.
  const y0 = H * 0.54;
  b.section(
    [
      { z: -0.16, w: W * 0.16, h: H * 0.1, y: y0 + H * 0.05, t: 0.75 },
      { z: -0.13, w: W * 0.22, h: H * 0.18, y: y0 + H * 0.09, t: 0.75 },
      { z: -0.04, w: W * 0.22, h: H * 0.18, y: y0 + H * 0.09, t: 0.8 },
      { z: -0.02, w: W * 0.16, h: H * 0.1, y: y0 + H * 0.05 },
    ],
    "plate",
  );
  windows(parts, v(0, y0 + H * 0.12, -0.132), W * 0.18, H * 0.03, b.m(0.3), [-0.9, 0, 0]);
  antenna(parts, v(0, y0 + H * 0.18, -0.08), H * 0.5);
}

/** Transportes: carga en contenedores, tropas o colonos. */
function transport(b: Builder): void {
  const m = b.look.model;
  if (m.habitat) return colonizer(b);
  if (m.pods) return freighter(b);
  return troopship(b);
}

/** Carguero: módulo de mando, espina de celosía con contenedores y bloque de motores con tanques. */
function freighter(b: Builder, miner = false): void {
  const { parts, W, H } = b;
  const spine = W * 0.09;
  b.hull([
    { z: -0.5, w: W * 0.3, h: H * 0.3, y: H * 0.08 },
    { z: -0.45, w: W * 0.55, h: H * 0.48, y: H * 0.08, t: 0.8 },
    { z: -0.34, w: W * 0.6, h: H * 0.52, y: H * 0.08, t: 0.85 },
    { z: -0.31, w: W * 0.45, h: H * 0.38, y: H * 0.05 },
    { z: -0.29, w: spine * 2, h: spine * 2 },
    { z: 0.27, w: spine * 2, h: spine * 2 },
    { z: 0.29, w: W * 0.5, h: H * 0.48 },
    { z: 0.32, w: W * 0.62, h: H * 0.56, t: 0.85 },
    { z: 0.42, w: W * 0.62, h: H * 0.56, t: 0.85 },
    { z: 0.44, w: W * 0.5, h: H * 0.46 },
  ]);
  windows(parts, v(0, b.top(-0.42) + b.m(0.05), -0.43), W * 0.32, H * 0.06, b.m(0.3), [-0.7, 0, 0]);
  b.sym((side) => windows(parts, v(side * (W * 0.3 + b.m(0.03)), H * 0.12, -0.39), b.m(0.1), H * 0.05, 0.07));
  // Largueros de la espina.
  for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) parts.beam("metal", v(x * spine * 1.4, y * spine * 1.4, -0.3), v(x * spine * 1.4, y * spine * 1.4, 0.28), b.m(0.4), true);
  // Contenedores.
  const pods = b.look.model.pods ?? 4;
  const perRow = pods <= 6 ? 2 : 4;
  const rows = Math.ceil(pods / perRow);
  const len = 0.56 / rows;
  let placed = 0;
  for (let row = 0; row < rows; row++) {
    const z = -0.27 + len * (row + 0.5);
    const slots: Array<[number, number]> = perRow === 2 ? [[1, 0], [-1, 0]] : [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [sx, sy] of slots) {
      if (placed >= pods) break;
      placed++;
      const w = W * 0.4;
      const h = perRow === 2 ? H * 0.8 : H * 0.42;
      const slot: Slot = b.rnd() < 0.5 ? "plate" : "hull";
      cargoPod(parts, v(sx * (spine + w / 2 + b.m(0.2)), sy * (h / 2 + b.m(0.15)), z), w, h, len * 0.88, slot);
    }
  }
  // Tanques esféricos ante el bloque de motores.
  b.sym((side) => parts.add("metal", new THREE.SphereGeometry(W * 0.12, 14, 10), { p: [side * W * 0.17, H * 0.12, 0.27] }, true));
  b.sym((side) => radiator(parts, v(side * W * 0.31, H * 0.12, 0.37), W * 0.4, 0.07, 0.4, side), true);
  b.engines(b.look.model.engines, 0.44, W * 0.27, H * 0.24);
  antenna(parts, v(W * 0.1, b.top(-0.4), -0.38), H * 0.5);
  sensorDome(parts, v(0, b.bottom(-0.4), -0.4), W * 0.08, true);
  if (miner) {
    // Cabezal de minería: brazos con garras, taladro y focos.
    b.sym((side) => {
      parts.beam("plate", v(side * W * 0.25, -H * 0.05, -0.36), v(side * W * 0.2, -H * 0.15, -0.53), b.m(1.2), true);
      parts.add("dark", block(b.m(2.2), b.m(2.2), b.m(3), 0.3, 0.7), { p: [side * W * 0.18, -H * 0.15, -0.54] }, true);
      parts.light(v(side * W * 0.25, -H * 0.05, -0.44), AMBER, "steady");
    });
    parts.add("metal", new THREE.ConeGeometry(W * 0.1, 0.1, 10), { p: [0, -H * 0.12, -0.55], r: [-Math.PI / 2, 0, 0] }, true);
    parts.add("dark", tube(W * 0.12, W * 0.12, 0.05), { p: [0, -H * 0.12, -0.49] }, true);
  }
  b.weapons(0.1);
  b.rcs(-0.4, 0.38, Math.max(b.m(1.1), 0.014));
  b.navLights(v(-(W * 0.31 + W * 0.4 * Math.cos(0.4)), H * 0.12 + W * 0.4 * Math.sin(0.4), 0.37), 0.4);
  b.band(-0.4, b.m(0.6));
  b.greebles(0.3, 0.42, 8);
}

/** Transporte de tropas: casco acorazado con bahías de cápsulas de desembarco. */
function troopship(b: Builder): void {
  const { parts, W, H } = b;
  b.hull([
    { z: -0.5, w: W * 0.4, h: H * 0.38, y: -H * 0.08, t: 0.8 },
    { z: -0.4, w: W * 0.85, h: H * 0.75, y: -H * 0.03, t: 0.8 },
    { z: -0.3, w: W, h: H * 0.85, t: 0.88 },
    { z: 0.35, w: W, h: H * 0.85, t: 0.88 },
    { z: 0.42, w: W * 0.85, h: H * 0.7, t: 0.88 },
  ]);
  b.bridge(-0.34, -0.12, W * 0.42, H * 0.22);
  b.sym((side) => {
    for (let i = 0; i < 5; i++) {
      const z = -0.2 + i * 0.11;
      parts.add("dark", new THREE.BoxGeometry(b.m(0.5), H * 0.35, 0.07), { p: [side * (W / 2 + b.m(0.12)), -H * 0.08, z] }, i % 2 === 0);
      parts.add("trim", new THREE.BoxGeometry(b.m(0.55), b.m(0.25), 0.07), { p: [side * (W / 2 + b.m(0.18)), H * 0.12, z] });
      parts.light(v(side * (W / 2 + b.m(0.4)), H * 0.12, z - 0.03), AMBER, "steady");
    }
    for (let i = 0; i < 5; i++) windows(parts, v(side * (W / 2 + b.m(0.03)), H * 0.25, -0.25 + i * 0.12), b.m(0.1), H * 0.05, 0.08);
  });
  if (b.look.model.hangar) {
    parts.add("dark", new THREE.BoxGeometry(W * 0.5, b.m(0.5), 0.2), { p: [0, b.bottom(0.2) - b.m(0.2), 0.2] }, true);
    parts.add("glow", new THREE.BoxGeometry(W * 0.44, b.m(0.3), b.m(0.4)), { p: [0, b.bottom(0.2) - b.m(0.3), 0.1] });
  }
  b.sym((side) => radiator(parts, v(side * W * 0.5, H * 0.1, 0.28), W * 0.45, 0.12, 0.2, side), true);
  b.engines(b.look.model.engines, 0.42, W * 0.36, H * 0.3);
  antenna(parts, v(W * 0.1, b.top(-0.2) + H * 0.22, -0.2), H * 0.5);
  sensorDome(parts, v(0, b.bottom(-0.42), -0.42), W * 0.08, true);
  b.weapons(0.12);
  b.rcs(-0.38, 0.36, Math.max(b.m(1.1), 0.014));
  b.navLights(v(-(W * 0.5 + W * 0.45 * Math.cos(0.2)), H * 0.1 + W * 0.45 * Math.sin(0.2), 0.28), 0.38);
  b.band(-0.42, b.m(0.8));
  b.greebles(-0.1, 0.38, 22);
}

/** Colonizador: núcleo largo, anillo habitable con ventanas y cúpulas de cultivo. */
function colonizer(b: Builder): void {
  const { parts, W, H } = b;
  b.hull([
    { z: -0.5, w: W * 0.3, h: H * 0.3 },
    { z: -0.42, w: W * 0.6, h: H * 0.6, t: 0.85 },
    { z: -0.3, w: W * 0.65, h: H * 0.65, t: 0.9 },
    { z: 0.3, w: W * 0.65, h: H * 0.65, t: 0.9 },
    { z: 0.4, w: W * 0.55, h: H * 0.55 },
  ]);
  const R = Math.max(W, H) * 0.5 + 0.13;
  parts.add("hull", new THREE.TorusGeometry(R, 0.035, 8, 40), { p: [0, 0, 0.02], s: [1, 1, 1.4] }, true);
  parts.add("glass", new THREE.TorusGeometry(R + 0.03, 0.008, 4, 40), { p: [0, 0, 0.02], s: [1, 1, 1.5] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.beam("dark", v(Math.cos(a) * W * 0.3, Math.sin(a) * H * 0.3, 0.02), v(Math.cos(a) * R, Math.sin(a) * R, 0.02), b.m(1.2));
  }
  for (let i = 0; i < 3; i++) sensorDome(parts, v(0, b.top(-0.25 + i * 0.12), -0.25 + i * 0.12), W * 0.12);
  b.sym((side) => {
    for (let i = 0; i < 6; i++) windows(parts, v(side * (W * 0.325 + b.m(0.03)), H * 0.1, -0.35 + i * 0.1), b.m(0.1), H * 0.06, 0.06);
  });
  b.bridge(-0.44, -0.32, W * 0.35, H * 0.16);
  b.sym((side) => radiator(parts, v(side * W * 0.32, 0, 0.3), W * 0.5, 0.12, 0, side), true);
  b.engines(b.look.model.engines, 0.4, W * 0.28, H * 0.26);
  b.weapons(0.1);
  b.rcs(-0.38, 0.36, Math.max(b.m(1), 0.014));
  b.navLights(v(-(R + 0.04), 0, 0.02), 0.36);
  b.band(0.2, b.m(0.8));
  b.greebles(0.15, 0.38, 14);
}

/** Construye una nave humana o de los Carroñeros con su receta. */
export function buildHuman(parts: Parts, look: ShipLook, rnd: () => number, recipe: Recipe = recipeOf(look)): void {
  const scrap = look.style === "brutalist_scrap";
  const b = new Builder(parts, look, rnd, scrap, recipe === "flagship" ? { W: 0.2, H: 0.14 } : undefined);
  switch (recipe) {
    case "flagship":
      flagship(b);
      break;
    case "scout":
      scout(b);
      break;
    case "fighter":
      fighter(b);
      break;
    case "frigate":
      frigate(b);
      break;
    case "capital":
      capital(b);
      break;
    case "transport":
      transport(b);
      break;
    case "miner":
      freighter(b, true);
      break;
  }
  b.scrapify();
}
