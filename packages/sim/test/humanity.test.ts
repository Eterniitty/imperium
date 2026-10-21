import { describe, expect, it } from "vitest";
import { CREDITS, HUMANITY, getHumanityProject } from "@imperium/content";
import {
  bookDepth,
  creditIncomePerHour,
  hoursUntilTreasury,
  humanityBonuses,
  marketFee,
  matchOrder,
  projectCost,
  projectMissing,
  projectResourcesReady,
  shipmentHours,
  taxSplit,
  treasuryAfter,
  validPrice,
  validQuantity,
  walletAfter,
  type BookOrder,
} from "../src";

describe("economía de la humanidad", () => {
  it("las colonias generan créditos por población y una parte va al tesoro", () => {
    expect(creditIncomePerHour(500)).toBeCloseTo(500 * CREDITS.perPopulationPerHour);
    const { net, tax } = taxSplit(100);
    expect(tax).toBeCloseTo(100 * HUMANITY.taxRate);
    expect(net + tax).toBeCloseTo(100);
    // Lo que cobra el Emperador más lo que acumula el tesoro es la renta bruta.
    const gross = creditIncomePerHour(1000);
    expect(walletAfter(0, gross, 3) + treasuryAfter(0, gross * HUMANITY.taxRate, 3)).toBeCloseTo(gross * 3);
  });

  it("el tesoro llega a una cifra cuando le entra dinero", () => {
    expect(hoursUntilTreasury(100, 10, 50)).toBe(0);
    expect(hoursUntilTreasury(100, 10, 200)).toBeCloseTo(10);
    expect(hoursUntilTreasury(0, 0, 1)).toBe(Infinity);
  });

  it("los proyectos encarecen con cada nivel y saben qué les falta", () => {
    const def = getHumanityProject("core_research")!;
    const l0 = projectCost(def, 0);
    const l1 = projectCost(def, 1);
    expect(l0.credits).toBe(def.baseCost.credits);
    expect(l1.metal).toBe(Math.round(def.baseCost.metal * def.costGrowth));
    const progress = { metal: l0.metal, volatiles: 0, crystal: l0.crystal, alloys: l0.alloys };
    expect(projectResourcesReady(l0, progress)).toBe(false);
    expect(projectMissing(l0, progress)).toEqual({ metal: 0, volatiles: l0.volatiles, crystal: 0, alloys: 0 });
    expect(projectResourcesReady(l0, { ...progress, volatiles: l0.volatiles + 5 })).toBe(true);
  });

  it("los niveles completados dan bonificaciones globales", () => {
    const b = humanityBonuses({ core_research: 2, trade_network: 1 });
    expect(b.extraction).toBeCloseTo(1 + 2 * getHumanityProject("core_research")!.effectPerLevel);
    expect(b.founding).toBe(1);
    expect(shipmentHours(600, b.shipmentSpeed)).toBeLessThan(shipmentHours(600));
    expect(shipmentHours(0)).toBe(HUMANITY.minShipmentHours);
  });
});

describe("mercado", () => {
  const book: BookOrder[] = [
    { id: "s1", ownerId: "b", side: "sell", price: 2, remaining: 50, createdAt: 2 },
    { id: "s2", ownerId: "c", side: "sell", price: 1.5, remaining: 30, createdAt: 3 },
    { id: "s3", ownerId: "c", side: "sell", price: 2, remaining: 40, createdAt: 1 },
    { id: "s4", ownerId: "a", side: "sell", price: 1, remaining: 99, createdAt: 0 },
    { id: "s5", ownerId: "d", side: "sell", price: 3, remaining: 10, createdAt: 0 },
  ];

  it("casa por mejor precio y luego por antigüedad, al precio del libro y sin casarse consigo mismo", () => {
    const { fills, remaining } = matchOrder({ ownerId: "a", side: "buy", price: 2, quantity: 100 }, book);
    expect(fills).toEqual([
      { makerId: "s2", quantity: 30, price: 1.5 },
      { makerId: "s3", quantity: 40, price: 2 },
      { makerId: "s1", quantity: 30, price: 2 },
    ]);
    expect(remaining).toBe(0);
  });

  it("una venta solo casa con compras a su precio o más", () => {
    const bids: BookOrder[] = [
      { id: "b1", ownerId: "x", side: "buy", price: 4, remaining: 5, createdAt: 0 },
      { id: "b2", ownerId: "y", side: "buy", price: 2, remaining: 5, createdAt: 0 },
    ];
    const { fills, remaining } = matchOrder({ ownerId: "z", side: "sell", price: 3, quantity: 8 }, bids);
    expect(fills).toEqual([{ makerId: "b1", quantity: 5, price: 4 }]);
    expect(remaining).toBe(3);
  });

  it("valida precios y cantidades, cobra comisión y resume el libro", () => {
    expect(validPrice(1.25)).toBe(true);
    expect(validPrice(1.255)).toBe(false);
    expect(validPrice(0)).toBe(false);
    expect(validPrice(Number.NaN)).toBe(false);
    expect(validQuantity(10)).toBe(true);
    expect(validQuantity(1.5)).toBe(false);
    expect(validQuantity(0)).toBe(false);
    expect(marketFee(100)).toBeGreaterThan(0);
    expect(bookDepth("sell", book)).toEqual([
      { price: 1, quantity: 99 },
      { price: 1.5, quantity: 30 },
      { price: 2, quantity: 90 },
      { price: 3, quantity: 10 },
    ]);
  });
});
