import { describe, expect, it } from "vitest";
import {
  FACTIONS,
  SHIP_CLASSES,
  SPECIES,
  contentEn,
  contentEs,
  effectiveTraits,
  factionsOfSpecies,
  getShipClass,
  mvpSpecies,
  validateContent,
} from "../src";

describe("validateContent", () => {
  it("el contenido incluido no tiene errores", () => {
    expect(validateContent()).toEqual([]);
  });

  it("detecta errores en contenido defectuoso", () => {
    const base = SPECIES[0]!;
    const broken = {
      ...base,
      rivals: ["no_existe"],
      traits: { ...base.traits, aggression: 1.5 },
      visual: { ...base.visual, primaryColor: "rojo" },
    };
    const errors = validateContent({
      species: [broken, broken],
      factions: [{ ...FACTIONS[0]!, speciesId: "fantasma", hostileTo: [] }],
      ships: SHIP_CLASSES,
      es: contentEs,
      en: {},
    });
    const text = errors.join("\n");
    expect(text).toContain("duplicado");
    expect(text).toContain("rival inexistente");
    expect(text).toContain("fuera de [0,1]");
    expect(text).toContain("hex");
    expect(text).toContain("speciesId inexistente");
    expect(text).toContain("en en");
  });
});

describe("especies (docs/lore.md)", () => {
  it("están todas las del lore, más los Carroñeros", () => {
    expect(SPECIES.map((s) => s.id).sort()).toEqual(
      ["aurelians", "elydri", "eradicators", "greys", "nihil", "precursors", "scavengers", "tharaxi", "vesperi", "void_nomads"].sort(),
    );
  });

  it("todas las especies están activas salvo los Precursores, desaparecidos", () => {
    expect(mvpSpecies().map((s) => s.id).sort()).toEqual(SPECIES.filter((s) => s.id !== "precursors").map((s) => s.id).sort());
  });

  it("ninguna especie alienígena es jugable", () => {
    expect(SPECIES.every((s) => s.playable === false)).toBe(true);
  });

  it("los Tharaxi son los más numerosos; los Precursores, los más avanzados y desaparecidos", () => {
    const maxBy = (k: "numbers" | "techLevel") => [...SPECIES].sort((a, b) => b.traits[k] - a.traits[k])[0]!.id;
    expect(maxBy("numbers")).toBe("tharaxi");
    expect(maxBy("techLevel")).toBe("precursors");
    expect(SPECIES.filter((s) => s.extinct).map((s) => s.id)).toEqual(["precursors"]);
  });

  it("posturas del lore: Erradicadores exterminan y no pactan; Grises controlan con pactos; Nómadas comercian", () => {
    const by = (id: string) => SPECIES.find((s) => s.id === id)!;
    expect([by("eradicators").stance, by("eradicators").diplomacy]).toEqual(["exterminate", "never"]);
    expect([by("greys").stance, by("greys").diplomacy]).toEqual(["control", "conditional"]);
    expect([by("void_nomads").stance, by("void_nomads").expansion]).toEqual(["trade", "nomadic"]);
  });
});

describe("facciones", () => {
  it("toda especie que existe tiene al menos una facción; los Precursores, ninguna", () => {
    for (const s of SPECIES) {
      if (s.extinct) expect(factionsOfSpecies(s.id)).toEqual([]);
      else expect(factionsOfSpecies(s.id).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("especies divididas: dos facciones enfrentadas con distinta relación con la humanidad", () => {
    for (const id of ["tharaxi", "nihil", "aurelians", "vesperi"]) {
      const fs = factionsOfSpecies(id);
      expect(fs, id).toHaveLength(2);
      expect(fs[0]!.hostileTo).toContain(fs[1]!.id);
      expect(fs[1]!.hostileTo).toContain(fs[0]!.id);
      expect(fs[0]!.relation, id).not.toBe(fs[1]!.relation);
    }
  });

  it("la casta disidente Tharaxi y los Desatadores NIHIL pueden ser aliados", () => {
    for (const id of ["tharaxi_severed_caste", "nihil_unbinding", "vesperi_wardens"]) {
      expect(FACTIONS.find((f) => f.id === id)?.relation).toBe("potential_ally");
    }
  });

  it("la validación rechaza facciones de especies desaparecidas", () => {
    const text = validateContent({
      species: SPECIES,
      factions: [...FACTIONS, { ...FACTIONS[0]!, id: "eco_precursor", speciesId: "precursors", hostileTo: [] }],
      ships: SHIP_CLASSES,
      es: contentEs,
      en: contentEn,
    }).join("\n");
    expect(text).toContain("desaparecida");
  });

  it("los rasgos efectivos quedan en [0,1]", () => {
    for (const f of FACTIONS) {
      for (const v of Object.values(effectiveTraits(f))) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("naves", () => {
  it("existen las doce clases humanas", () => {
    expect(SHIP_CLASSES.map((s) => s.id).sort()).toEqual(
      ["carrier", "colonizer", "corvette", "cruiser", "destroyer", "explorer", "fighter", "freighter", "frigate", "hauler", "interceptor", "mothership", "troopship"],
    );
  });

  it("las naves civiles apenas atacan; las de combate escalan con su tamaño", () => {
    const frigate = getShipClass("frigate")!;
    for (const s of SHIP_CLASSES.filter((c) => c.role !== "combat")) expect(s.attack).toBeLessThanOrEqual(frigate.attack * 0.2);
    const line = ["fighter", "frigate", "destroyer", "cruiser"].map((id) => getShipClass(id as "frigate")!);
    for (let i = 1; i < line.length; i++) {
      expect(line[i]!.attack).toBeGreaterThan(line[i - 1]!.attack);
      expect(line[i]!.hull).toBeGreaterThan(line[i - 1]!.hull);
      expect(line[i]!.speedLyPerHour).toBeLessThan(line[i - 1]!.speedLyPerHour);
    }
  });

  it("el carguero pesado lleva más que nadie y el carguero es frágil y lento", () => {
    const freighter = getShipClass("freighter")!;
    const hauler = getShipClass("hauler")!;
    const frigate = getShipClass("frigate")!;
    const explorer = getShipClass("explorer")!;
    expect(Math.max(...SHIP_CLASSES.map((s) => s.cargo))).toBe(hauler.cargo);
    expect(freighter.cargo).toBeGreaterThan(Math.max(...SHIP_CLASSES.filter((s) => s.role !== "logistics").map((s) => s.cargo)));
    expect(freighter.hull).toBeLessThan(frigate.hull);
    expect(freighter.speedLyPerHour).toBeLessThan(frigate.speedLyPerHour);
    expect(freighter.speedLyPerHour).toBeLessThan(explorer.speedLyPerHour);
  });

  it("las capitales piden dique orbital y aleaciones; todas, astillero", () => {
    for (const s of SHIP_CLASSES) expect(s.requires.shipyard).toBeGreaterThanOrEqual(1);
    for (const id of ["cruiser", "carrier"] as const) {
      expect(getShipClass(id)!.requires.drydock).toBe(1);
      expect(getShipClass(id)!.cost.alloys).toBeGreaterThan(0);
    }
  });

  it("todas las naves con armas tienen bocas de fuego para cada una", () => {
    for (const s of SHIP_CLASSES) for (const w of s.combat.weapons) expect(s.combat.hardpoints![w.kind].length).toBeGreaterThan(0);
  });

  it("solo el colonizador se consume al usarse", () => {
    expect(SHIP_CLASSES.filter((s) => s.consumedOnUse).map((s) => s.id)).toEqual(["colonizer"]);
  });

  it("el explorador es el más rápido y con mayor escáner", () => {
    const explorer = getShipClass("explorer")!;
    expect(Math.max(...SHIP_CLASSES.map((s) => s.speedLyPerHour))).toBe(explorer.speedLyPerHour);
    expect(Math.max(...SHIP_CLASSES.map((s) => s.scannerRangeLy))).toBe(explorer.scannerRangeLy);
  });
});

describe("i18n", () => {
  it("es y en tienen exactamente las mismas claves", () => {
    expect(Object.keys(contentEs).sort()).toEqual(Object.keys(contentEn).sort());
  });
});

describe("combate", () => {
  it("las naves y la del Emperador tienen escudo y armas válidos", async () => {
    const { SHIP_CLASSES, EMPEROR_FLAGSHIP, validateCombat } = await import("../src");
    for (const s of SHIP_CLASSES) expect(validateCombat(s.id, s.combat)).toEqual([]);
    expect(validateCombat("emperador", EMPEROR_FLAGSHIP.combat)).toEqual([]);
    expect(EMPEROR_FLAGSHIP.combat.weapons.map((w) => w.kind)).toEqual(["cannon", "missile"]);
  });

  it("detecta armas mal definidas", async () => {
    const { validateCombat } = await import("../src");
    const bad = { shield: 10, shieldRegenPerSec: 1, shieldDelaySec: 1, weapons: [{ kind: "missile" as const, damage: 0, cooldownSec: 1, rangeU: 1, speedU: 1, ammo: 3, ammoRegenSec: null }] };
    expect(validateCombat("x", bad).length).toBeGreaterThanOrEqual(2);
  });
});

describe("especies en el juego (Fase 11)", () => {
  it("cada especie activa tiene al menos dos naves propias y las de su flota son suyas", async () => {
    const { alienShipsOf } = await import("../src");
    for (const s of SPECIES.filter((x) => !x.extinct)) {
      expect(alienShipsOf(s.id).length).toBeGreaterThanOrEqual(2);
      for (const [id] of s.fleet.composition) expect(alienShipsOf(s.id).map((a) => a.id)).toContain(id);
    }
  });

  it("las más peligrosas viven más lejos del Núcleo Humano", () => {
    const ring = (id: string) => SPECIES.find((s) => s.id === id)!.territory.minCoreRing;
    expect(ring("scavengers")).toBe(2);
    expect(ring("eradicators")).toBeGreaterThan(ring("tharaxi"));
    expect(ring("tharaxi")).toBeGreaterThan(ring("vesperi"));
    expect(ring("nihil")).toBeGreaterThan(ring("void_nomads"));
    for (const s of SPECIES) expect(s.territory.minCoreRing).toBeGreaterThanOrEqual(2);
  });

  it("solo los Nómadas del Vacío comercian; los Precursores nunca atacan", () => {
    expect(SPECIES.filter((s) => s.ai.trades).map((s) => s.id)).toEqual(["void_nomads"]);
    expect(SPECIES.find((s) => s.id === "precursors")!.ai.intruders).toBe("ignore");
  });

  it("getAnyShipClass encuentra naves humanas y alienígenas", async () => {
    const { getAnyShipClass, anyFleetSpeedLyPerHour } = await import("../src");
    expect(getAnyShipClass("frigate")!.attack).toBe(getShipClass("frigate")!.attack);
    expect(getAnyShipClass("tharaxi_drone")!.hull).toBeGreaterThan(0);
    expect(getAnyShipClass("no_existe")).toBeUndefined();
    expect(anyFleetSpeedLyPerHour(["frigate", "nomad_ark"])).toBe(Math.min(getShipClass("frigate")!.speedLyPerHour, getAnyShipClass("nomad_ark")!.speedLyPerHour));
  });
});
