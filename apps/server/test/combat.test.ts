import { describe, expect, it } from "vitest";
import { EMPEROR_FLAGSHIP, FLAGSHIP_HARDPOINTS, FLAGSHIP_REPAIR, FLAGSHIP_SUPPLIES } from "@imperium/content";
import { Combatant, forwardOf, rayHit, rotate } from "../src/space/combat";

describe("reglas del combate", () => {
  it("el morro de una nave sin girar apunta a -Z; girada 90° a la izquierda, a -X", () => {
    expect(forwardOf([0, 0, 0, 1])).toEqual([-0, -0, -1]);
    const s = Math.SQRT1_2;
    const f = forwardOf([0, s, 0, s]);
    expect(f[0]).toBeCloseTo(-1);
    expect(f[2]).toBeCloseTo(0);
  });

  it("los disparos salen alternando de las bocas de fuego de @imperium/content, giradas con la nave", () => {
    const c = new Combatant(400, EMPEROR_FLAGSHIP.combat, 0);
    const a = c.nextMuzzle("cannon");
    const b = c.nextMuzzle("cannon");
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
    expect(a.offset).toEqual([...FLAGSHIP_HARDPOINTS.cannon[0]!]);
    expect(c.nextMuzzle("cannon").index).toBe(0);
    // Girada 90° a la izquierda: lo que estaba delante (-Z) queda a la izquierda (-X).
    const s = Math.SQRT1_2;
    const r = rotate([0, s, 0, s], [0, 0, -10]);
    expect(r[0]).toBeCloseTo(-10);
    expect(r[2]).toBeCloseTo(0);
  });

  it("un rayo acierta lo que pasa cerca dentro del alcance, y no lo que queda detrás o lejos", () => {
    expect(rayHit([0, 0, 0], [0, 0, -1], [1, 0, -50], 140)).toBeCloseTo(50);
    expect(rayHit([0, 0, 0], [0, 0, -1], [100, 0, -50], 140)).toBeNull();
    expect(rayHit([0, 0, 0], [0, 0, -1], [0, 0, 50], 140)).toBeNull();
    expect(rayHit([0, 0, 0], [0, 0, -1], [0, 0, -200], 140)).toBeNull();
  });

  it("cadencia y munición: los misiles se gastan y a bordo solo se fabrica la reserva de emergencia", () => {
    const c = new Combatant(400, EMPEROR_FLAGSHIP.combat, 0);
    expect(c.tryFire("cannon", 0)).not.toBeNull();
    expect(c.tryFire("cannon", 100)).toBeNull(); // cadencia de 0,2 s
    expect(c.tryFire("cannon", 200)).not.toBeNull();
    // Seis misiles cada 2,5 s (0 a 12,5 s); luego, ninguno.
    for (let t = 0; t <= 12_500; t += 2500) expect(c.tryFire("missile", t)).not.toBeNull();
    expect(c.tryFire("missile", 15_000)).toBeNull();
    // A bordo se fabrica uno cada 30 min, hasta 2.
    expect(c.tryFire("missile", 1_900_000)).not.toBeNull();
    expect(c.weaponsView(3 * 3_600_000 + 10_000).find((w) => w.kind === "missile")!.ammo).toBe(2);
  });

  it("energía, combustible y reposición de la nave del Emperador", () => {
    const S = FLAGSHIP_SUPPLIES;
    const c = new Combatant(400, EMPEROR_FLAGSHIP.combat, 0, { fuel: 10, fuelAt: 0, cannon: 1500, missiles: 6, ammoAt: 0, hull: 300 });
    // El cañón gasta energía: sin energía no dispara, y el reactor la recarga sola.
    let t = 0;
    let shots = 0;
    while (c.tryFire("cannon", t)) {
      shots++;
      t += 200;
    }
    expect(shots).toBeGreaterThan(80);
    expect(c.energyNow(t)).toBeLessThan(S.cannonEnergy);
    expect(c.energyNow(t + 10_000)).toBe(S.energyMax);
    // El pulso gasta combustible; sin combustible no hay pulso.
    expect(c.spendPulse(20, 20_000)).toBe(true);
    expect(c.fuelNow(20_000)).toBeCloseTo(10 - 20 * S.pulseFuelPerSec, 0);
    // Lo que queda, justo: después ya no hay pulso.
    expect(c.spendPulse(c.fuelNow(20_000) / S.pulseFuelPerSec - 1e-6, 20_000)).toBe(true);
    expect(c.spendPulse(1, 20_000)).toBe(false);
    // La reserva de emergencia se regenera despacio (unas 30 unidades por hora), solo hasta su tope.
    expect(c.fuelNow(20_000 + 3_600_000)).toBeCloseTo(S.emergencyFuelPerHour, 0);
    expect(c.fuelNow(20_000 + 100 * 3_600_000)).toBe(S.emergencyFuelMax);
    // Junto a una colonia: se llena hasta el máximo, no más.
    // Fase 10: el casco guardado (300) también se repara junto a la colonia, hasta el máximo.
    expect(c.missing(400 * 3_600_000).hull).toBe(100);
    const added = c.refill({ fuel: 5000, cannon: 10, missiles: 3, hull: 500 }, 400 * 3_600_000);
    expect(added.fuel).toBe(S.fuelMax - S.emergencyFuelMax);
    expect(added.missiles).toBe(0);
    expect(added.hull).toBe(100);
    expect(c.stored(400 * 3_600_000)).toMatchObject({ fuel: S.fuelMax, missiles: 6, hull: 400 });
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

  it("la tripulación repara el casco de la nave del Emperador poco a poco (Fase 10)", () => {
    const c = new Combatant(400, EMPEROR_FLAGSHIP.combat, 0, { fuel: 100, fuelAt: 0, cannon: 10, missiles: 1, ammoAt: 0, hull: 200 });
    c.damage(250, 1000);
    expect(c.hull).toBe(150);
    expect(c.repairHull(10, 5000)).toBe(false); // demasiado pronto tras el impacto
    expect(c.repairHull(10, 1000 + FLAGSHIP_REPAIR.onboardDelaySec * 1000)).toBe(true);
    expect(c.hull).toBeCloseTo(150 + 10 * FLAGSHIP_REPAIR.onboardPerSec);
    // Los piratas (sin reactor) no se reparan.
    const p = new Combatant(100, EMPEROR_FLAGSHIP.combat, 0);
    p.damage(250, 0);
    expect(p.repairHull(10, 1_000_000)).toBe(false);
  });
});
