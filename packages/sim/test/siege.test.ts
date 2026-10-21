import { describe, expect, it } from "vitest";
import { INSTALLATION_DEFENSE, SIEGE, validateConquest } from "@imperium/content";
import {
  captureLosses,
  colonyDefense,
  colonyDefenseFire,
  planetDefenders,
  resolveAssault,
  siegeAttrition,
  siegeHoursLeft,
  siegePower,
  siegeProgressPerHour,
  siegeStepSeed,
} from "../src";

const platform = INSTALLATION_DEFENSE.defense_platform!;

describe("conquista (Fase 9b)", () => {
  it("los datos de conquista son coherentes", () => {
    expect(validateConquest()).toEqual([]);
  });

  it("defensa: base, población y plataformas; fuerza: el ataque de las naves", () => {
    expect(colonyDefense(0, {})).toBe(SIEGE.defenseBase);
    expect(colonyDefense(1000, { defense_platform: 2 })).toBeCloseTo(SIEGE.defenseBase + 1000 * SIEGE.defensePerPopulation + 2 * platform.defense);
    expect(colonyDefenseFire({ defense_platform: 3, mine: 5 })).toBe(3 * platform.attackPerHour);
    expect(siegePower(["frigate", "frigate", "freighter"])).toBe(80);
    expect(siegePower(["freighter", "colonizer"])).toBe(0);
  });

  it("progreso: con ataque igual a la defensa tarda el doble que con una fuerza abrumadora", () => {
    expect(siegeProgressPerHour(0, 10)).toBe(0);
    expect(siegeHoursLeft(0, 50, 50)).toBeCloseTo(2 * SIEGE.baseHours);
    expect(siegeHoursLeft(0, 1e9, 1)).toBeCloseTo(SIEGE.baseHours);
    expect(siegeHoursLeft(0.5, 50, 50)).toBeCloseTo(SIEGE.baseHours);
    expect(siegeHoursLeft(0, 0, 50)).toBe(Infinity);
  });

  it("las plataformas dañan a las naves que asedian, de forma determinista", () => {
    const ships = [
      { id: "a", hull: 300 },
      { id: "b", hull: 20 },
    ];
    const seed = siegeStepSeed(1234, 0);
    const r1 = siegeAttrition(ships, { defense_platform: 2 }, 1, seed);
    const r2 = siegeAttrition(ships, { defense_platform: 2 }, 1, seed);
    expect(r1).toEqual(r2);
    expect(r1.dealt).toBeGreaterThan(0);
    expect(r1.dealt).toBeLessThanOrEqual(2 * platform.attackPerHour);
    // Sin plataformas, nada.
    expect(siegeAttrition(ships, {}, 5, seed)).toEqual({ hull: {}, destroyed: [], dealt: 0 });
    // Con muchas horas, caen las dos.
    expect(siegeAttrition(ships, { defense_platform: 4 }, 100, seed).destroyed).toEqual(["a", "b"]);
  });

  it("desembarco: más tropas que defensores toman el planeta; menos, caen todas", () => {
    const defenders = planetDefenders(1000, { defense_platform: 1 });
    expect(defenders).toBe(Math.round(1000 * SIEGE.militiaShare + platform.garrison));
    const won = resolveAssault(defenders + 100, 1000, { defense_platform: 1 });
    expect(won.captured).toBe(true);
    expect(won.attackerLosses).toBe(Math.round(defenders * SIEGE.attackerLossPerDefender));
    expect(won.survivors).toBe(defenders + 100 - won.attackerLosses);
    expect(won.populationLosses).toBe(100);
    const lost = resolveAssault(defenders, 1000, { defense_platform: 1 });
    expect(lost.captured).toBe(false);
    expect(lost.attackerLosses).toBe(defenders);
    expect(lost.survivors).toBe(0);
    expect(lost.populationLosses).toBeLessThanOrEqual(100);
    // Un planeta sin habitantes ni defensas cae con un solo soldado.
    expect(resolveAssault(1, 0, {}).captured).toBe(true);
  });

  it("captura: pierde una parte de población, existencias e instalaciones (determinista)", () => {
    const stock = { metal: 1000, volatiles: 400, crystal: 100, alloys: 0, rare_metals: 0, exotic: 0 };
    const ids = Array.from({ length: 50 }, (_, i) => `inst-${String(i).padStart(2, "0")}`);
    const a = captureLosses(1000, stock, ids, 99);
    expect(a).toEqual(captureLosses(1000, stock, [...ids].reverse(), 99));
    expect(a.population).toBeCloseTo(1000 * (1 - SIEGE.capture.populationLoss));
    expect(a.stock.metal).toBeCloseTo(1000 * (1 - SIEGE.capture.stockLoss));
    expect(a.destroyed.length).toBeGreaterThan(0);
    expect(a.destroyed.length).toBeLessThan(25);
    expect(captureLosses(1000, stock, [], 1, 0.25).population).toBeCloseTo(1000 * (1 - SIEGE.capture.populationLoss - 0.25));
  });
});
