import { describe, expect, it } from "vitest";
import { getHumanityProject, HUMANITY_PROJECTS, validateHumanity } from "../src";

describe("datos de la economía de la humanidad", () => {
  it("son coherentes", () => {
    expect(validateHumanity()).toEqual([]);
  });

  it("hay defensas, investigación, subvenciones y red de transporte", () => {
    expect(HUMANITY_PROJECTS.map((p) => p.id).sort()).toEqual(["colony_grants", "core_defenses", "core_research", "trade_network"]);
    expect(getHumanityProject("core_research")?.maxLevel).toBeGreaterThan(0);
    expect(getHumanityProject("nada")).toBeUndefined();
  });
});
