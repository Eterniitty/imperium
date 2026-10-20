import { describe, expect, it } from "vitest";
import { ECONOMY, HUMANS, POPULATION } from "@imperium/content";
import {
  advanceStock,
  canAfford,
  colonyEnergy,
  colonyFlows,
  installationsUpkeep,
  upkeepShortage,
  flagshipHumansAfter,
  gameHours,
  installationAllowed,
  laborFactor,
  minColonists,
  netRates,
  pay,
  populationAfter,
  populationCap,
  realDurationMs,
  resolveColony,
  zeroStock,
  type ColonyPlanet,
} from "../src";

const rocky: ColonyPlanet = { habitability: 0.5, deposits: { metal: 2, volatiles: 1, crystal: 0 }, moons: [{ deposits: { metal: 0, volatiles: 2, crystal: 1 } }] };

describe("humanos", () => {
  it("la nave del Emperador genera humanos hasta su capacidad (Ley II)", () => {
    expect(flagshipHumansAfter(100, 2)).toBe(100 + 2 * HUMANS.flagshipPerHour);
    expect(flagshipHumansAfter(100, 10_000)).toBe(HUMANS.flagshipCapacity);
    // Por encima del tope no se pierde nadie.
    expect(flagshipHumansAfter(HUMANS.flagshipCapacity + 7, 5)).toBe(HUMANS.flagshipCapacity + 7);
  });

  it("los mundos hostiles piden más colonos y sostienen menos población", () => {
    expect(minColonists(1)).toBe(HUMANS.minColonistsBase);
    expect(minColonists(0)).toBe(HUMANS.minColonistsBase + HUMANS.minColonistsHostile);
    expect(minColonists(0.2)).toBeGreaterThan(minColonists(0.8));
    expect(populationCap(0)).toBe(POPULATION.capMin);
    expect(populationCap(1)).toBe(POPULATION.capMin + POPULATION.capPerHabitability);
  });

  it("la población crece hacia el tope sin pasarlo (y baja si lo supera)", () => {
    const cap = populationCap(0.5);
    const a = populationAfter(100, cap, 10);
    const b = populationAfter(100, cap, 100);
    expect(a).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(a);
    expect(populationAfter(100, cap, 100_000)).toBeCloseTo(cap, 3);
    expect(populationAfter(cap * 2, cap, 1000)).toBeLessThan(cap * 2);
    // Resolver en dos tramos da lo mismo que en uno (resolución perezosa).
    expect(populationAfter(populationAfter(100, cap, 30), cap, 70)).toBeCloseTo(b, 6);
  });

  it("horas de juego y duraciones con la escala de tiempo", () => {
    expect(gameHours(0, 3_600_000, 1)).toBe(1);
    expect(gameHours(0, 1_000, 3600)).toBe(1);
    expect(gameHours(5, 0, 1)).toBe(0);
    expect(realDurationMs(2, 1)).toBe(7_200_000);
    expect(realDurationMs(2, 7200)).toBe(1000);
  });
});

describe("producción", () => {
  it("la energía sale de la estrella y de las centrales; sin bastante, todo va más lento", () => {
    expect(colonyEnergy(3, {})).toEqual({ produced: 3 * ECONOMY.baseEnergyPerStarEnergy, consumed: 0, efficiency: 1 });
    const short = colonyEnergy(1, { mine: 3, refinery: 1 });
    expect(short.efficiency).toBeLessThan(1);
    expect(colonyEnergy(1, { mine: 3, refinery: 1, power_plant: 3 }).efficiency).toBe(1);
  });

  it("la mano de obra tiene un mínimo y llega a 1", () => {
    expect(laborFactor(1)).toBe(ECONOMY.laborMin);
    expect(laborFactor(ECONOMY.laborFullPopulation * 2)).toBe(1);
  });

  it("extrae según la riqueza del planeta y de sus lunas, y las minas multiplican", () => {
    const pop = ECONOMY.laborFullPopulation;
    const none = colonyFlows(rocky, 5, {}, pop);
    expect(none.extraction.metal).toBeCloseTo(2 * ECONOMY.baseExtractionPerRichness);
    // Volátiles: 1 del planeta + 0,5 × 2 de la luna.
    expect(none.extraction.volatiles).toBeCloseTo(2 * ECONOMY.baseExtractionPerRichness);
    expect(none.extraction.crystal).toBeCloseTo(0.5 * ECONOMY.baseExtractionPerRichness * ECONOMY.crystalFactor);
    const mined = colonyFlows(rocky, 5, { mine: 2 }, pop);
    expect(mined.extraction.metal).toBeCloseTo(2 * (ECONOMY.baseExtractionPerRichness + 2 * ECONOMY.mineExtractionPerRichness));
  });

  it("las existencias llegan al tope del almacén y no lo pasan", () => {
    const flows = colonyFlows(rocky, 5, { mine: 2 }, 500);
    const s = advanceStock(zeroStock(), flows, 1e6);
    expect(s.metal).toBe(ECONOMY.storage.metal);
    expect(s.volatiles).toBe(ECONOMY.storage.volatiles);
    const one = advanceStock(zeroStock(), flows, 1);
    expect(one.metal).toBeCloseTo(flows.extraction.metal);
  });

  it("la refinería convierte metal y volátiles en aleaciones y se frena al agotarlos", () => {
    const flows = { extraction: { metal: 1, volatiles: 1, crystal: 0, alloys: 0 }, refinery: { metal: 6, volatiles: 2, alloys: 3 }, upkeep: 0 };
    // Con 10 de metal: 2 horas a pleno rendimiento (pierde 5/h), luego al ritmo de la extracción (1/6).
    const s = advanceStock({ metal: 10, volatiles: 100, crystal: 0, alloys: 0 }, flows, 4);
    expect(s.metal).toBeCloseTo(0, 6);
    expect(s.alloys).toBeCloseTo(2 * 3 + 2 * 3 * (1 / 6), 6);
    // Agotado el metal, la tasa neta es cero y las aleaciones siguen al ritmo del metal que llega.
    const rates = netRates(s, flows);
    expect(rates.metal).toBe(0);
    expect(rates.alloys).toBeCloseTo(0.5);
    // Con el almacén de aleaciones lleno, la refinería se para.
    const full = netRates({ metal: 100, volatiles: 100, crystal: 0, alloys: ECONOMY.storage.alloys }, flows);
    expect(full.alloys).toBe(0);
    expect(full.metal).toBe(1);
  });

  it("resolver una colonia en un tramo o en varios da casi lo mismo", () => {
    const site = { planet: rocky, starEnergy: 3, installations: { mine: 1, refinery: 1, power_plant: 1 } };
    const start = { population: 100, stock: { ...ECONOMY.foundingStock } };
    const once = resolveColony(start, site, 30);
    const twice = resolveColony(resolveColony(start, site, 12), site, 18);
    expect(twice.population).toBeCloseTo(once.population, 6);
    for (const r of ["metal", "volatiles", "crystal", "alloys"] as const) expect(twice.stock[r]).toBeCloseTo(once.stock[r], 4);
    expect(once.population).toBeGreaterThan(100);
    expect(once.stock.alloys).toBeGreaterThan(0);
  });

  it("pagar, permitir y límites de instalaciones", () => {
    const stock = { metal: 200, volatiles: 50, crystal: 0, alloys: 0 };
    expect(canAfford(stock, { metal: 150, volatiles: 20, crystal: 0, alloys: 0 })).toBe(true);
    expect(canAfford(stock, { metal: 250, volatiles: 0, crystal: 0, alloys: 0 })).toBe(false);
    expect(pay(stock, { metal: 150, volatiles: 20, crystal: 0, alloys: 0 })).toEqual({ metal: 50, volatiles: 30, crystal: 0, alloys: 0 });
    expect(installationAllowed("shipyard", {}, 0)).toBe(true);
    expect(installationAllowed("shipyard", {}, 1)).toBe(false);
    expect(installationAllowed("shipyard", { shipyard: 1 }, 0)).toBe(false);
  });
});

describe("mantenimiento", () => {
  const base = { extraction: { metal: 4, volatiles: 3, crystal: 0, alloys: 0 }, refinery: { metal: 6, volatiles: 2, alloys: 3 } };

  it("las instalaciones consumen volátiles de su colonia", () => {
    expect(installationsUpkeep({ mine: 2, refinery: 1, power_plant: 1, shipyard: 1 })).toBeCloseTo(2 * 0.5 + 1 + 0.5 + 1.5);
    const rates = netRates({ metal: 100, volatiles: 100, crystal: 0, alloys: 0 }, { ...base, upkeep: 5 });
    // 3 extraídos − 2 de la refinería − 5 de mantenimiento.
    expect(rates.volatiles).toBeCloseTo(-4);
  });

  it("sin volátiles se paga primero el mantenimiento; la refinería usa lo que sobra", () => {
    const empty = { metal: 100, volatiles: 0, crystal: 0, alloys: 0 };
    // Sobra 1 de los 3 extraídos tras pagar 2: la refinería va a la mitad (necesita 2).
    const some = netRates(empty, { ...base, upkeep: 2 });
    expect(some.volatiles).toBeCloseTo(0);
    expect(some.alloys).toBeCloseTo(1.5);
    expect(upkeepShortage(empty, { ...base, upkeep: 2 })).toBe(false);
    // Mantenimiento mayor que la extracción: desabastecida, refinería parada, el almacén no baja de cero.
    const short = netRates(empty, { ...base, upkeep: 8 });
    expect(short.alloys).toBe(0);
    expect(short.volatiles).toBe(0);
    expect(upkeepShortage(empty, { ...base, upkeep: 8 })).toBe(true);
  });

  it("la capital paga además el mantenimiento de las flotas", () => {
    const planet = { habitability: 0.5, deposits: { metal: 1, volatiles: 1, crystal: 0 } as const, moons: [] };
    expect(colonyFlows(planet, 3, {}, 500, 7).upkeep).toBe(7);
    expect(colonyFlows(planet, 3, { mine: 1 }, 500).upkeep).toBe(0.5);
  });
});
