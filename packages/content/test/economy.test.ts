import { describe, expect, it } from "vitest";
import { getInstallation, INSTALLATIONS, validateEconomy } from "../src";

describe("datos de economía", () => {
  it("son coherentes", () => {
    expect(validateEconomy()).toEqual([]);
  });

  it("hay mina, refinería, central, astillero, dique orbital y plataforma defensiva (Fase 9b)", () => {
    expect(INSTALLATIONS.map((i) => i.id).sort()).toEqual(["defense_platform", "drydock", "mine", "power_plant", "refinery", "shipyard"]);
    expect(getInstallation("shipyard")?.maxPerColony).toBe(1);
    expect(getInstallation("nada")).toBeUndefined();
  });
});
