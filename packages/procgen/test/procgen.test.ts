import { describe, expect, it } from "vitest";
import { SECTOR_SIZE, MAX_SYSTEMS_PER_SECTOR, MIN_SYSTEMS_PER_SECTOR, worldToSector } from "@imperium/shared";
import {
  Rng,
  generateSector,
  generateSystemDetail,
  hashInts,
  sectorDensity,
  universeSeedFromString,
} from "../src";

const SEED = universeSeedFromString("imperium-test");

describe("Rng", () => {
  it("produce la misma secuencia con la misma semilla", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("devuelve valores en [0, 1)", () => {
    const r = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hashInts", () => {
  it("distingue coordenadas cercanas y negativas", () => {
    const values = new Set<number>();
    for (let x = -3; x <= 3; x++)
      for (let y = -3; y <= 3; y++)
        for (let z = -3; z <= 3; z++) values.add(hashInts(SEED, x, y, z));
    expect(values.size).toBe(7 * 7 * 7);
  });
});

describe("generateSector", () => {
  it("es determinista", () => {
    const a = generateSector(SEED, { x: 3, y: -2, z: 11 });
    const b = generateSector(SEED, { x: 3, y: -2, z: 11 });
    expect(a).toEqual(b);
  });

  it("cambia con la semilla del universo", () => {
    const a = generateSector(SEED, { x: 0, y: 0, z: 0 });
    const b = generateSector(universeSeedFromString("otro-universo"), { x: 0, y: 0, z: 0 });
    expect(a.systems.map((s) => s.name)).not.toEqual(b.systems.map((s) => s.name));
  });

  it("mantiene cada sistema dentro de su sector, con identificadores únicos", () => {
    const ids = new Set<string>();
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        const coord = { x, y: 0, z };
        const sector = generateSector(SEED, coord);
        expect(sector.systems.length).toBeGreaterThanOrEqual(MIN_SYSTEMS_PER_SECTOR);
        expect(sector.systems.length).toBeLessThanOrEqual(MAX_SYSTEMS_PER_SECTOR);
        for (const s of sector.systems) {
          expect(worldToSector(s.position)).toEqual(coord);
          expect(ids.has(s.id)).toBe(false);
          ids.add(s.id);
        }
      }
    }
  });

  it("varía la densidad entre regiones", () => {
    const densities: number[] = [];
    for (let i = 0; i < 60; i++) densities.push(sectorDensity(SEED, { x: i * 3, y: i, z: -i * 2 }));
    expect(Math.max(...densities) - Math.min(...densities)).toBeGreaterThan(0.3);
  });

  it("funciona lejos del origen", () => {
    const far = generateSector(SEED, { x: 1_000_000, y: -500_000, z: 250_000 });
    expect(far.systems.length).toBeGreaterThan(0);
    expect(far.systems[0]!.position.x).toBeGreaterThanOrEqual(1_000_000 * SECTOR_SIZE);
  });
});

describe("generateSystemDetail", () => {
  const sector = generateSector(SEED, { x: 1, y: 1, z: 1 });
  /** Semilla secreta de detalle de prueba (en el servidor, una por sistema). */
  const DETAIL = 0x1234abcd;

  it("es determinista", () => {
    for (const s of sector.systems) {
      expect(generateSystemDetail(SEED, s, DETAIL)).toEqual(generateSystemDetail(SEED, s, DETAIL));
    }
  });

  it("genera órbitas crecientes y recursos en rango", () => {
    for (const s of sector.systems) {
      const d = generateSystemDetail(SEED, s, DETAIL);
      expect(d.energy).toBeGreaterThanOrEqual(0);
      expect(d.energy).toBeLessThanOrEqual(5);
      for (let i = 1; i < d.planets.length; i++) {
        expect(d.planets[i]!.orbitAu).toBeGreaterThan(d.planets[i - 1]!.orbitAu);
      }
      for (const p of d.planets) {
        for (const r of Object.values(p.deposits)) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(3);
        }
        expect(p.habitability).toBeGreaterThanOrEqual(0);
        expect(p.habitability).toBeLessThanOrEqual(1);
      }
    }
  });

  it("los gigantes gaseosos no tienen metal: la geografía importa", () => {
    let checked = 0;
    for (let x = 0; x < 6; x++) {
      for (const s of generateSector(SEED, { x, y: 2, z: 0 }).systems) {
        for (const p of generateSystemDetail(SEED, s, DETAIL).planets) {
          if (p.type === "gas_giant") {
            expect(p.deposits.metal).toBe(0);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("el detalle cambia con la semilla secreta y el resumen no", () => {
    const coord = { x: 1, y: 1, z: 1 };
    // El resumen (posición, nombre, clase) no depende de la semilla secreta: es público.
    expect(generateSector(SEED, coord)).toEqual(sector);
    let differ = 0;
    for (const s of sector.systems) {
      const a = generateSystemDetail(SEED, s, DETAIL);
      const b = generateSystemDetail(SEED, s, DETAIL + 1);
      expect(a.summary).toEqual(s);
      expect(b.summary).toEqual(s);
      if (JSON.stringify(a) !== JSON.stringify(b)) differ++;
    }
    // Con otra semilla secreta, (casi) todos los sistemas tienen otro detalle.
    expect(differ).toBeGreaterThanOrEqual(sector.systems.length - 1);
  });
});

describe("territorio alienígena", async () => {
  const { baseSystemTerritory, coreRing, isRelicSite, regionOf, regionOwner, regionMaxRing } = await import("../src");
  const rules = {
    regionSizeSectors: 2,
    emptyRegionWeight: 1,
    species: [
      { speciesId: "cerca", minCoreRing: 2, regionWeight: 1, systemShare: 0.5, region: "any" as const, preferredStarClasses: ["M" as const], factions: [["cerca_a", 1] as const] },
      { speciesId: "lejos", minCoreRing: 6, regionWeight: 1, systemShare: 0.9, region: "dense" as const, preferredStarClasses: ["G" as const, "K" as const], factions: [["lejos_a", 0.5] as const, ["lejos_b", 0.5] as const] },
    ],
    relics: { speciesId: "ruinas", minCoreRing: 3, share: 0.5, starClasses: ["BH" as const, "NS" as const] },
  };
  const TSEED = 12345;

  it("es determinista y no toca el Núcleo Humano", () => {
    let owned = 0;
    for (let x = -4; x <= 4; x++)
      for (let z = -4; z <= 4; z++) {
        for (const s of generateSector(SEED, { x, y: 0, z }).systems) {
          const a = baseSystemTerritory(TSEED, SEED, s, rules);
          expect(baseSystemTerritory(TSEED, SEED, s, rules)).toEqual(a);
          if (coreRing(s.sector) <= 1) expect(a).toBeNull();
          if (a) {
            owned++;
            const sp = rules.species.find((r) => r.speciesId === a.speciesId)!;
            expect(coreRing(s.sector)).toBeGreaterThanOrEqual(sp.minCoreRing);
          }
        }
      }
    expect(owned).toBeGreaterThan(0);
  });

  it("las especies lejanas solo aparecen en regiones lejanas", () => {
    for (let x = -6; x <= 6; x++)
      for (let y = -2; y <= 2; y++) {
        const r = { x, y, z: 0 };
        const o = regionOwner(TSEED, SEED, r, rules);
        if (o?.speciesId === "lejos") expect(regionMaxRing(r, 2)).toBeGreaterThanOrEqual(6);
        if (o) expect(["cerca_a", "lejos_a", "lejos_b"]).toContain(o.factionId);
      }
  });

  it("otra semilla de territorio reparte distinto (es secreta del servidor)", () => {
    const owners = (seed: number) => Array.from({ length: 40 }, (_, i) => regionOwner(seed, SEED, { x: 3 + i, y: 0, z: 0 }, rules)?.speciesId ?? "-").join();
    expect(owners(1)).not.toBe(owners(2));
    expect(regionOf({ x: -1, y: 3, z: 0 }, 2)).toEqual({ x: -1, y: 1, z: 0 });
  });

  it("las ruinas solo están en estrellas exóticas fuera del Núcleo", () => {
    const base = { sector: { x: 5, y: 0, z: 0 }, index: 0 };
    let relics = 0;
    for (let i = 0; i < 50; i++) {
      if (isRelicSite(TSEED, { ...base, index: i, starClass: "BH" }, rules)) relics++;
      expect(isRelicSite(TSEED, { ...base, index: i, starClass: "G" }, rules)).toBe(false);
      expect(isRelicSite(TSEED, { sector: { x: 1, y: 0, z: 0 }, index: i, starClass: "BH" }, rules)).toBe(false);
    }
    expect(relics).toBeGreaterThan(10);
  });
});
