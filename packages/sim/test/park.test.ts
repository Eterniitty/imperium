import { describe, expect, it } from "vitest";
import { arrivalPark, defaultPark, parkedPosition, parkedVelocity } from "../src/park";
import { planetPosition, type PlanetLayout, type SystemLayout } from "../src/systemLayout";

const planet: PlanetLayout = { index: 0, orbitRadius: 1_500_000, size: 5000, angularSpeed: 2 * Math.PI / (3 * 24 * 3600 * Math.pow(1.5, 1.5)), phase: 0.7 };
const layout: SystemLayout = { starRadius: 120_000, planets: [planet], belts: [], boundary: 3_000_000 };

describe("nave aparcada", () => {
  it("orbita con la misma ley que los planetas: aparcada junto a uno, sigue a su lado", () => {
    const t0 = 1_800_000_000_000;
    const c = planetPosition(planet, t0);
    const park = { p: [c.x, c.y, c.z] as const, at: t0 };
    for (const dt of [1000, 3_600_000, 86_400_000 * 5]) {
      const p = parkedPosition(park, t0 + dt);
      const q = planetPosition(planet, t0 + dt);
      expect(Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z)).toBeLessThan(1);
    }
  });

  it("conserva la distancia a la estrella y la altura, y no se mueve en el instante de aparcar", () => {
    const park = { p: [800_000, 12_000, -300_000] as const, at: 5000 };
    expect(parkedPosition(park, 5000)).toEqual([800_000, 12_000, -300_000].map((v, i) => expect.closeTo(v, i === 1 ? 6 : 3)));
    const later = parkedPosition(park, 5000 + 3_600_000);
    expect(Math.hypot(later[0], later[2])).toBeCloseTo(Math.hypot(800_000, 300_000), 3);
    expect(later[1]).toBe(12_000);
    // Despacio: decenas de m/s, sin prisa.
    const v = parkedVelocity(park, 5000);
    expect(Math.hypot(...v)).toBeGreaterThan(1);
    expect(Math.hypot(...v)).toBeLessThan(100);
  });

  it("la llegada de un salto aparece en el borde, del lado del origen; sin datos, junto al primer planeta", () => {
    const a = arrivalPark(layout, [10, 0, 0], 42);
    expect(a.at).toBe(42);
    expect(a.p[0]).toBeCloseTo(3_000_000 * 0.97);
    const d = defaultPark(layout);
    expect(Math.hypot(...d.p)).toBeCloseTo(1_500_000 * 1.15);
  });
});
