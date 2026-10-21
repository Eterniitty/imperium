import { describe, expect, it } from "vitest";
import { WORLD_SCALE } from "@imperium/content";
import { rockyBody, starBody } from "../src/bodies";
import { circularOrbitSpeed, gravityAt, gravitySpeedBound } from "../src/gravity";

const earth = rockyBody("p0", "planet", "star", "rocky", 1);
const moon = rockyBody("p0m0", "moon", "p0", "barren", 0.27);
const R = earth.radius;

describe("gravedad", () => {
  it("cuerpo terrestre: radio, gravedad superficial y μ coherentes", () => {
    expect(R).toBe(WORLD_SCALE.earthRadiusM);
    expect(earth.surfaceGravityG).toBeCloseTo(1);
    expect(earth.mu / (R * R)).toBeCloseTo(9.81);
    // En la superficie la aceleración es la superficial (salvo el suavizado, pequeño).
    const s = gravityAt([R, 0, 0], [{ center: [0, 0, 0], body: earth }]);
    expect(s.g).toBeGreaterThan(9.81 * 0.9);
    expect(s.g).toBeLessThan(9.81);
    expect(s.acc[0]).toBeLessThan(0);
    expect(s.region).toBe("surface");
  });

  it("decae con el cuadrado de la distancia y se anula fuera de la esfera de influencia", () => {
    const at = (d: number) => gravityAt([d, 0, 0], [{ center: [0, 0, 0], body: earth }]);
    expect(at(2 * R).g / at(4 * R).g).toBeCloseTo(4, 1);
    expect(at(4 * R).region).toBe("approach");
    expect(at(earth.influenceRadius * 1.01).g).toBe(0);
    expect(at(earth.influenceRadius * 1.01).region).toBe("deep");
    // Sin saltos en el borde: se desvanece suavemente.
    expect(at(earth.influenceRadius * 0.999).g).toBeLessThan(at(earth.influenceRadius * 0.9).g * 0.05);
  });

  it("sin singularidad en el centro", () => {
    const s = gravityAt([1, 0, 0], [{ center: [0, 0, 0], body: earth }]);
    expect(Number.isFinite(s.g)).toBe(true);
    expect(s.g).toBeLessThan(earth.surfaceGravity);
  });

  it("la luna domina cerca de ella y suma su atracción a la del planeta", () => {
    const bodies = [
      { center: [0, 0, 0], body: earth },
      { center: [5 * R, 0, 0], body: moon },
    ];
    const s = gravityAt([5 * R + moon.radius * 1.5, 0, 0], bodies);
    expect(s.dominant?.id).toBe("p0m0");
  });

  it("la estrella recorta su gravedad simulada", () => {
    const sun = starBody("G");
    expect(sun.surfaceGravityG).toBeCloseTo(28);
    expect(sun.surfaceGravity).toBe(WORLD_SCALE.maxSimGravity);
  });

  it("una órbita integrada (semi-implícito, subpasos fijos) se mantiene estable", () => {
    const bodies = [{ center: [0, 0, 0], body: earth }];
    const r0 = 2 * R;
    let p = [r0, 0, 0];
    let v = [0, 0, circularOrbitSpeed(earth, r0)];
    const h = 1 / 120;
    // Varias vueltas (una tarda unos 40 min de juego).
    const period = (2 * Math.PI * r0) / v[2]!;
    let minR = Infinity;
    let maxR = 0;
    for (let t = 0; t < period * 3; t += h * 20) {
      for (let i = 0; i < 20; i++) {
        const a = gravityAt(p, bodies).acc;
        v = v.map((c, k) => c + a[k]! * h);
        p = p.map((c, k) => c + v[k]! * h);
      }
      const r = Math.hypot(...p);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    expect(minR).toBeGreaterThan(r0 * 0.98);
    expect(maxR).toBeLessThan(r0 * 1.02);
  });

  it("la cota de velocidad por caída es la de escape desde el borde de la esfera", () => {
    const bodies = [{ center: [0, 0, 0], body: earth }];
    const b = gravitySpeedBound([R, 0, 0], bodies);
    expect(b).toBeGreaterThan(Math.sqrt(2 * earth.mu / R) * 0.9);
    expect(gravitySpeedBound([earth.influenceRadius * 2, 0, 0], bodies)).toBe(0);
  });
});
