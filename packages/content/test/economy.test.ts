import { describe, expect, it } from "vitest";
import { getInstallation, INSTALLATIONS, validateEconomy } from "../src";

describe("datos de economía", () => {
  it("son coherentes", () => {
    expect(validateEconomy()).toEqual([]);
  });

  it("hay mina, refinería, central, astillero y dique orbital", () => {
    expect(INSTALLATIONS.map((i) => i.id).sort()).toEqual(["drydock", "mine", "power_plant", "refinery", "shipyard"]);
    expect(getInstallation("shipyard")?.maxPerColony).toBe(1);
    expect(getInstallation("nada")).toBeUndefined();
  });
});
