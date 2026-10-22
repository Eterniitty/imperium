import { describe, expect, it } from "vitest";
import { validateContent } from "@imperium/content";
import { designStats, isBuildable, validateDesign, type ShipDesign } from "../src/shipDesign";

/** Una fragata completa: puente, reactor, dos motores, motor cuántico, depósito, escudo y dos armas. */
const FRIGATE: ShipDesign = {
  hullId: "hull_frigate",
  parts: {
    bridge: "bridge_m",
    core: "reactor_fusion_m",
    drive1: "thruster_fusion_m",
    drive2: "thruster_chemical_s",
    sys1: "quantum_b",
    sys2: "tank_m",
    sys3: "shield_light",
    gun1: "laser_m",
    gun2: "cannon_s",
  },
};
const codes = (d: ShipDesign) => validateDesign(d).map((p) => p.code);

describe("editor de naves: reglas", () => {
  it("el catálogo de cascos y piezas es coherente", () => {
    expect(validateContent().filter((e) => /casco|pieza|part\./.test(e))).toEqual([]);
  });

  it("una fragata completa se puede construir y sus estadísticas salen de sus piezas", () => {
    expect(validateDesign(FRIGATE)).toEqual([]);
    expect(isBuildable(FRIGATE)).toBe(true);
    const s = designStats(FRIGATE);
    expect(s.massT).toBe(220 + 25 + 50 + 35 + 10 + 40 + 18 + 10 + 18 + 6);
    expect(s.thrustKN).toBe(7200);
    expect(s.accel).toBeCloseTo(7200 / s.massT, 1);
    expect(s.powerUseMW).toBeLessThanOrEqual(s.powerGenMW);
    expect(s.riftLyPerHour).toBeGreaterThan(240);
    expect(s.jumpRangeLy).toBeGreaterThan(100);
    expect(s.weapons.map((w) => w.weapon).sort()).toEqual(["cannon", "laser"]);
    expect(s.dps).toBe(100);
    expect(s.cost.credits).toBeGreaterThan(900);
  });

  it("como un Lego: sin puente no se pilota, sin reactor no funciona, sin motor no se mueve", () => {
    const without = (slot: string): ShipDesign => ({ ...FRIGATE, parts: Object.fromEntries(Object.entries(FRIGATE.parts).filter(([k]) => k !== slot)) });
    expect(codes(without("bridge"))).toContain("missing_bridge");
    expect(codes(without("core"))).toContain("missing_reactor");
    expect(codes({ ...FRIGATE, parts: { ...without("drive1").parts, drive2: undefined as unknown as string } })).toContain("missing_thruster");
    expect(isBuildable(without("bridge"))).toBe(false);
    // Sin motor cuántico se puede construir, pero avisa: no podrá saltar.
    const noJump = without("sys1");
    expect(isBuildable(noJump)).toBe(true);
    expect(codes(noJump)).toContain("no_quantum");
    expect(designStats(noJump).riftLyPerHour).toBeNull();
  });

  it("la energía no puede pasar de lo que da el reactor", () => {
    const hungry: ShipDesign = { hullId: "hull_skiff", parts: { bridge: "bridge_s", core: "reactor_fission_s", drive: "thruster_ion_s", sys1: "shield_light", sys2: "quantum_a", gun1: "cannon_s" } };
    expect(validateDesign(hungry)).toContainEqual({ level: "error", code: "power_deficit", use: 15, gen: 12 });
  });

  it("cada pieza en su anclaje: de su tipo, de su tamaño o mayor, y con el casco que pide", () => {
    expect(codes({ ...FRIGATE, parts: { ...FRIGATE.parts, gun1: "tank_m" } })).toContain("wrong_kind");
    expect(codes({ ...FRIGATE, parts: { ...FRIGATE.parts, sys3: "shield_fleet" } })).toContain("too_big");
    expect(codes({ ...FRIGATE, parts: { ...FRIGATE.parts, gun1: "lance_l" } })).toContain("too_big");
    expect(codes({ hullId: "hull_cruiser", parts: { sys1: "quantum_d" } })).toContain("min_hull");
    expect(codes({ ...FRIGATE, parts: { ...FRIGATE.parts, nada: "cannon_s" } })).toContain("unknown_slot");
    expect(codes({ hullId: "no-existe", parts: {} })).toEqual(["unknown_hull"]);
    // Una pieza pequeña sí cabe en un anclaje grande.
    expect(codes({ ...FRIGATE, parts: { ...FRIGATE.parts, gun1: "cannon_s" } })).not.toContain("too_big");
  });

  it("más masa: gira más despacio, salta más despacio y con menos alcance; un motor cuántico mejor va más rápido", () => {
    const heavy: ShipDesign = { ...FRIGATE, parts: { ...FRIGATE.parts, bay1: "armor_m" } };
    const a = designStats(FRIGATE);
    const b = designStats(heavy);
    expect(b.turnDegPerSec).toBeLessThan(a.turnDegPerSec);
    expect(b.accel).toBeLessThan(a.accel);
    expect(b.jumpRangeLy!).toBeLessThan(a.jumpRangeLy!);
    expect(b.hull).toBe(a.hull + 250);
    const slow = designStats({ ...FRIGATE, parts: { ...FRIGATE.parts, sys1: "quantum_a" } });
    expect(slow.riftLyPerHour!).toBeLessThan(a.riftLyPerHour!);
    expect(slow.chargeSec!).toBeGreaterThan(a.chargeSec!);
  });
});
