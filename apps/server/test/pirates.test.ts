import { describe, expect, it } from "vitest";
import { getAlienShipClass, SCAVENGER_DANGER } from "@imperium/content";
import { pirateFlight, piratesOf, stepPirate, systemRing } from "../src/space/pirates";

const ids = (ring: number, n = 400) => Array.from({ length: n }, (_, i) => `${ring}:${i % (ring + 1)}:${-(i % 2) * Math.min(ring, 1)}:${i}`);

describe("Carroñeros del espacio local", () => {
  it("nunca hay piratas en el Núcleo Humano", () => {
    for (const id of [...ids(0), ...ids(1)]) expect(piratesOf(id)).toEqual([]);
  });

  it("son deterministas por sistema", () => {
    for (const id of ids(5, 50)) expect(piratesOf(id)).toEqual(piratesOf(id));
  });

  it("más lejos del Núcleo, más numerosos, más pesados y con mejor puntería", () => {
    const stats = (ring: number) => {
      const all = ids(ring).map(piratesOf).filter((p) => p.length > 0);
      const ships = all.flat();
      return {
        perSystem: ships.length / all.length,
        hull: ships.reduce((a, p) => a + getAlienShipClass(p.classId)!.hull, 0) / ships.length,
        jitter: ships[0]!.aimJitter,
        classes: new Set(ships.map((p) => p.classId)),
      };
    };
    const near = stats(2);
    const mid = stats(5);
    const deep = stats(9);
    expect(systemRing("9:0:0:1")).toBe(9);
    expect(mid.perSystem).toBeGreaterThan(near.perSystem);
    expect(deep.perSystem).toBeGreaterThan(mid.perSystem);
    expect(deep.hull).toBeGreaterThan(mid.hull);
    expect(mid.hull).toBeGreaterThan(near.hull);
    expect(deep.jitter).toBeLessThan(near.jitter);
    expect(near.classes.has("scav_mothership")).toBe(false);
    expect(deep.classes.has("scav_mothership")).toBe(true);
    expect(SCAVENGER_DANGER.length).toBeGreaterThanOrEqual(3);
  });

  it("cada clase vuela a su distancia: el bombardero se aleja si se le echan encima", () => {
    const bomber = pirateFlight("scav_bomber");
    let p: [number, number, number] = [0, 0, 0];
    let v: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 50; i++) ({ p, v } = stepPirate(p, v, [0, 0, 0], [500, 0, 0], 0.1, 0.2, bomber) as { p: typeof p; v: typeof v });
    expect(Math.hypot(p[0] - 500, p[1], p[2])).toBeGreaterThan(500);
  });
});
