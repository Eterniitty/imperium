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

describe("especies", () => {
  it("hay seis arquetipos", () => {
    expect(SPECIES).toHaveLength(6);
  });

  it("exactamente Hordas y Máquinas están activas en el MVP", () => {
    expect(mvpSpecies().map((s) => s.id).sort()).toEqual(["horde", "machines"]);
  });

  it("ninguna especie alienígena es jugable", () => {
    expect(SPECIES.every((s) => s.playable === false)).toBe(true);
  });

  it("las Hordas son las más numerosas y los Antiguos los más avanzados", () => {
    const maxBy = (k: "numbers" | "techLevel") =>
      [...SPECIES].sort((a, b) => b.traits[k] - a.traits[k])[0]!.id;
    expect(maxBy("numbers")).toBe("horde");
    expect(maxBy("techLevel")).toBe("ancients");
  });
});

describe("facciones", () => {
  it("todas las especies tienen al menos una facción", () => {
    for (const s of SPECIES) expect(factionsOfSpecies(s.id).length).toBeGreaterThanOrEqual(1);
  });

  it("Hordas y Máquinas tienen dos facciones enfrentadas", () => {
    for (const id of ["horde", "machines"]) {
      const fs = factionsOfSpecies(id);
      expect(fs).toHaveLength(2);
      expect(fs[0]!.hostileTo).toContain(fs[1]!.id);
      expect(fs[1]!.hostileTo).toContain(fs[0]!.id);
    }
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
  it("existen las cuatro clases del MVP", () => {
    expect(SHIP_CLASSES.map((s) => s.id).sort()).toEqual(["colonizer", "explorer", "freighter", "frigate"]);
  });

  it("la fragata tiene el mayor ataque y es la única con ataque relevante", () => {
    const frigate = getShipClass("frigate")!;
    for (const s of SHIP_CLASSES) {
      if (s.id === "frigate") continue;
      expect(s.attack).toBeLessThan(frigate.attack);
      expect(s.attack).toBeLessThanOrEqual(frigate.attack * 0.1);
    }
  });

  it("el carguero es el de mayor carga, frágil y más lento que la fragata y el explorador", () => {
    const freighter = getShipClass("freighter")!;
    const frigate = getShipClass("frigate")!;
    const explorer = getShipClass("explorer")!;
    expect(Math.max(...SHIP_CLASSES.map((s) => s.cargo))).toBe(freighter.cargo);
    expect(freighter.hull).toBeLessThan(frigate.hull);
    expect(freighter.speedLyPerHour).toBeLessThan(frigate.speedLyPerHour);
    expect(freighter.speedLyPerHour).toBeLessThan(explorer.speedLyPerHour);
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
