import { describe, expect, it } from "vitest";
import { EMPEROR_FLAGSHIP } from "@imperium/content";
import { Combatant, forwardOf, rayHit } from "../src/space/combat";

describe("reglas del combate", () => {
  it("el morro de una nave sin girar apunta a -Z; girada 90° a la izquierda, a -X", () => {
    expect(forwardOf([0, 0, 0, 1])).toEqual([-0, -0, -1]);
    const s = Math.SQRT1_2;
    const f = forwardOf([0, s, 0, s]);
    expect(f[0]).toBeCloseTo(-1);
    expect(f[2]).toBeCloseTo(0);
  });

  it("un rayo acierta lo que pasa cerca dentro del alcance, y no lo que queda detrás o lejos", () => {
    expect(rayHit([0, 0, 0], [0, 0, -1], [1, 0, -50], 140)).toBeCloseTo(50);
    expect(rayHit([0, 0, 0], [0, 0, -1], [10, 0, -50], 140)).toBeNull();
    expect(rayHit([0, 0, 0], [0, 0, -1], [0, 0, 50], 140)).toBeNull();
    expect(rayHit([0, 0, 0], [0, 0, -1], [0, 0, -200], 140)).toBeNull();
  });

  it("cadencia y munición: el misil se gasta y se repone con el tiempo", () => {
    const c = new Combatant(400, EMPEROR_FLAGSHIP.combat, 0);
    expect(c.tryFire("cannon", 0)).not.toBeNull();
    expect(c.tryFire("cannon", 100)).toBeNull(); // cadencia de 0,2 s
    expect(c.tryFire("cannon", 200)).not.toBeNull();
    // Seis misiles cada 2,5 s (0 a 12,5 s); a los 15 s ya se ha repuesto uno.
    for (let t = 0; t <= 12_500; t += 2500) expect(c.tryFire("missile", t)).not.toBeNull();
    expect(c.tryFire("missile", 15_000)).not.toBeNull();
    expect(c.tryFire("missile", 17_500)).toBeNull(); // sin misiles hasta la siguiente recarga
    expect(c.tryFire("missile", 30_000)).not.toBeNull();
  });

  it("el daño va primero al escudo, luego al casco; el escudo se recarga tras unos segundos", () => {
    const c = new Combatant(400, EMPEROR_FLAGSHIP.combat, 0);
    expect(c.damage(150, 1000)).toBe(false);
    expect([c.shield, c.hull]).toEqual([50, 400]);
    expect(c.damage(100, 1000)).toBe(false);
    expect([c.shield, c.hull]).toEqual([0, 350]);
    expect(c.regenShield(1, 2000)).toBe(false); // aún no han pasado 4 s
    expect(c.regenShield(1, 6000)).toBe(true);
    expect(c.shield).toBe(20);
    expect(c.damage(1000, 7000)).toBe(true);
    c.restore(8000);
    expect([c.shield, c.hull]).toEqual([200, 400]);
  });
});
