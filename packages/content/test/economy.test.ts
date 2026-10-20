import { describe, expect, it } from "vitest";
import { getInstallation, INSTALLATIONS, validateEconomy } from "../src";

describe("datos de economía", () => {
  it("son coherentes", () => {
    expect(validateEconomy()).toEqual([]);
  });

  it("hay mina, refinería, central y astillero", () => {
    expect(INSTALLATIONS.map((i) => i.id).sort()).toEqual(["mine", "power_plant", "refinery", "shipyard"]);
    expect(getInstallation("shipyard")?.maxPerColony).toBe(1);
    expect(getInstallation("nada")).toBeUndefined();
  });
});
