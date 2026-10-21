import { describe, expect, it } from "vitest";
import { generateSector, generateSystemDetail } from "@imperium/procgen";
import type { StarSystemDetail } from "@imperium/shared";
import { bodiesAt, moonOffset, planetPosition, systemLayout } from "../src/systemLayout";
import { pulseLimitAt, stepPulseSpeed } from "../src/flight";

/** Sistemas generados de verdad (varias clases de estrella), con semillas de prueba. */
function sampleSystems(): StarSystemDetail[] {
  const out: StarSystemDetail[] = [];
  for (let x = -3; x <= 3; x++) {
    for (const s of generateSector(12345, { x, y: 0, z: 1 }).systems) out.push(generateSystemDetail(12345, s, 777 + x));
  }
  return out;
}

const SHIP = 45;

describe("escala astronómica", () => {
  const systems = sampleSystems();

  it("hay sistemas suficientes para la prueba", () => {
    expect(systems.length).toBeGreaterThan(20);
    expect(systems.some((s) => s.planets.some((p) => p.moons.length > 0))).toBe(true);
  });

  it("jerarquía: nave ≪ luna < planeta ≪ estrella", () => {
    for (const d of systems) {
      const l = systemLayout(d);
      for (const p of l.planets) {
        expect(p.size).toBeGreaterThan(SHIP * 2000);
        if (d.summary.starClass !== "WD" && d.summary.starClass !== "NS" && d.summary.starClass !== "BH") expect(l.starRadius).toBeGreaterThan(p.size * 1.8);
        for (const m of p.moons) {
          expect(m.body.radius).toBeGreaterThan(SHIP * 300);
          expect(m.body.radius).toBeLessThan(p.size * 0.5);
          // Fuera del planeta y sin chocar con la luna anterior.
          expect(m.orbitRadius - m.body.radius).toBeGreaterThan(p.size * 2);
        }
        for (let i = 1; i < p.moons.length; i++) {
          const a = p.moons[i - 1]!;
          const b = p.moons[i]!;
          expect(b.orbitRadius - a.orbitRadius).toBeGreaterThan(a.body.radius + b.body.radius);
        }
        expect(p.body.influenceRadius).toBeGreaterThan(p.moons.at(-1)?.orbitRadius ?? 0);
      }
    }
  });

  it("las esferas de influencia no se solapan y todo cabe dentro del borde", () => {
    for (const d of systems) {
      const l = systemLayout(d);
      let edge = l.star.influenceRadius;
      for (const p of l.planets) {
        expect(p.orbitRadius - p.body.influenceRadius).toBeGreaterThan(edge);
        edge = Math.max(edge, p.orbitRadius + p.body.influenceRadius);
      }
      expect(l.boundary).toBeGreaterThan(edge);
      // Cabe en la precisión del dibujo (coordenadas de hasta unos 10⁹–10¹⁰ m).
      expect(l.boundary).toBeLessThan(2e10);
    }
  });

  it("es determinista y las lunas giran con la hora del servidor", () => {
    const d = systems.find((s) => s.planets.some((p) => p.moons.length > 0))!;
    expect(systemLayout(d)).toEqual(systemLayout(d));
    const p = systemLayout(d).planets.find((x) => x.moons.length > 0)!;
    const a = moonOffset(p.moons[0]!, 0);
    const b = moonOffset(p.moons[0]!, 3_600_000);
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(p.moons[0]!.orbitRadius, 0);
    // Despacio: decenas de m/s como mucho.
    const v = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 3600;
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(30);
    expect(bodiesAt(systemLayout(d), 0).length).toBe(1 + d.planets.length + d.planets.reduce((n, x) => n + x.moons.length, 0));
  });

  it("los planetas se mueven despacio (una nave que maniobra siempre los alcanza)", () => {
    for (const d of systems) {
      for (const p of systemLayout(d).planets) expect(p.angularSpeed * p.orbitRadius).toBeLessThan(40);
    }
  });

  /** Segundos que tarda el pulso de `from` a `to` (en línea recta), parando a `stopAt` m del destino. */
  function cruise(bodies: ReturnType<typeof bodiesAt>, from: number[], to: number[], stopAt: number): number {
    const dir = [to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!];
    const len = Math.hypot(...dir);
    const u = dir.map((c) => c / len);
    let s = 0;
    let v = 0;
    let t = 0;
    const dt = 1 / 10;
    while (s < len - stopAt && t < 900) {
      v = stepPulseSpeed(v, pulseLimitAt([from[0]! + u[0]! * s, from[1]! + u[1]! * s, from[2]! + u[2]! * s], u, bodies), dt);
      s += v * dt;
      t += dt;
    }
    return t;
  }

  it("con el pulso se va de un planeta al vecino en menos de un minuto y del borde al centro del sistema en menos de dos", () => {
    const hops: number[] = [];
    const crossings: number[] = [];
    for (const d of systems) {
      const l = systemLayout(d);
      if (l.planets.length === 0) continue;
      const bodies = bodiesAt(l, 0);
      const pos = l.planets.map((p) => planetPosition(p, 0));
      for (let i = 1; i < l.planets.length; i++) {
        const a = pos[i - 1]!;
        const b = pos[i]!;
        // Solo los tramos que no pasan junto a la estrella (la nave la rodearía).
        const ab = [b.x - a.x, b.z - a.z];
        const t = Math.max(0, Math.min(1, -(a.x * ab[0]! + a.z * ab[1]!) / (ab[0]! ** 2 + ab[1]! ** 2)));
        if (Math.hypot(a.x + ab[0]! * t, a.z + ab[1]! * t) < l.star.influenceRadius * 1.5) continue;
        const from = [a.x, a.y, a.z].map((c, k) => c + ([b.x, b.y, b.z][k]! - c) * ((l.planets[i - 1]!.size + 2000) / Math.hypot(ab[0]!, ab[1]!)));
        hops.push(cruise(bodies, from, [b.x, b.y, b.z], l.planets[i]!.size * 3));
      }
      // Desde el borde (donde se llega de un salto) hasta el planeta más interior, en línea recta.
      const inner = pos[0]!;
      const r = Math.hypot(inner.x, inner.z);
      const edge = [(inner.x / r) * l.boundary * 0.97, 0, (inner.z / r) * l.boundary * 0.97];
      crossings.push(cruise(bodies, edge, [inner.x, inner.y, inner.z], l.planets[0]!.size * 3));
    }
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
    const worst = (xs: number[]) => Math.max(...xs);
    expect(median(hops)).toBeGreaterThan(15);
    expect(median(hops)).toBeLessThan(60);
    expect(median(crossings)).toBeGreaterThan(25);
    expect(median(crossings)).toBeLessThan(120);
    expect(worst(crossings)).toBeLessThan(240);
  });
});
