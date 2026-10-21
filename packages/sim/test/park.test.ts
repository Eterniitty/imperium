import { describe, expect, it } from "vitest";
import { WORLD_SCALE } from "@imperium/content";
import { arrivalPark, defaultPark, sanitizePark, parkedPosition, parkedVelocity } from "../src/park";
import { rockyBody, starBody } from "../src/bodies";
import { orbitalPeriodS, planetPosition, type PlanetLayout, type SystemLayout } from "../src/systemLayout";

const body = rockyBody("p0", "planet", "star", "rocky", 5000 / 637_100);
const planet: PlanetLayout = { index: 0, orbitRadius: 1_500_000, size: 5000, angularSpeed: (2 * Math.PI) / orbitalPeriodS(1_500_000), phase: 0.7, body, moons: [], spin: 1e-4 };
const layout: SystemLayout = { starRadius: 120_000, star: starBody("G"), planets: [planet], belts: [], boundary: 3_000_000, parkMinRadius: 720_000 };

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
    const park = { p: [80_000_000, 12_000, -30_000_000] as const, at: 5000 };
    expect(parkedPosition(park, 5000)).toEqual([80_000_000, 12_000, -30_000_000].map((v, i) => expect.closeTo(v, i === 1 ? 6 : 3)));
    const later = parkedPosition(park, 5000 + 3_600_000);
    expect(Math.hypot(later[0], later[2])).toBeCloseTo(Math.hypot(80_000_000, 30_000_000), 3);
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
    // En el hueco entre la esfera de influencia del primer planeta y la del siguiente.
    expect(Math.hypot(...d.p)).toBeCloseTo(1_500_000 + body.influenceRadius + WORLD_SCALE.orbitGapM / 2);
  });

  it("las órbitas guardadas dentro de la esfera de la estrella (escala anterior) se llevan fuera", () => {
    const old = { p: [100_000, 0, 200_000] as const, at: 7 };
    const fixed = sanitizePark(layout, old);
    expect(Math.hypot(...fixed.p)).toBeCloseTo(720_000 * 1.05);
    expect(fixed.p[2] / fixed.p[0]).toBeCloseTo(2);
    const ok = { p: [1_000_000, 0, 0] as const, at: 7 };
    expect(sanitizePark(layout, ok)).toBe(ok);
  });
});
