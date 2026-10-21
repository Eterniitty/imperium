import { describe, expect, it } from "vitest";
import { AI_LINEAGE, getDoctrine, HEIR_DOCTRINES, validateLineage } from "../src";

describe("datos del linaje (Fase 10)", () => {
  it("son coherentes", () => {
    expect(validateLineage()).toEqual([]);
  });

  it("cada personalidad de la IA usa una doctrina que existe", () => {
    for (const l of Object.values(AI_LINEAGE)) expect(getDoctrine(l.doctrine)).toBeDefined();
    expect(HEIR_DOCTRINES.map((d) => d.id).sort()).toEqual(["balanced", "bastion", "prosperity"]);
  });
});
