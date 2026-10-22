import { describe, expect, it } from "vitest";
import { getInstallation, INSTALLATIONS, validateEconomy } from "../src";

describe("datos de economía", () => {
  it("son coherentes", () => {
    expect(validateEconomy()).toEqual([]);
  });

  it("hay mina, refinería, central, astillero, dique orbital, plataforma defensiva (Fase 9b) y Cuna de linaje (Fase 10)", () => {
    expect(INSTALLATIONS.map((i) => i.id).sort()).toEqual(["defense_platform", "drydock", "factory", "lineage_cradle", "mine", "power_plant", "refinery", "shipyard"]);
    expect(getInstallation("lineage_cradle")?.maxPerColony).toBe(1);
    expect(getInstallation("shipyard")?.maxPerColony).toBe(1);
    expect(getInstallation("nada")).toBeUndefined();
  });
});
