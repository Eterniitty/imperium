/**
 * Equilibrio de las naves humanas en el combate de flotas por rondas, con el
 * mismo presupuesto por bando (valor de mercado de referencia: metal 1,
 * volátiles 1,5, cristal 6, aleaciones 4). No busca números exactos: comprueba
 * los contrapesos del diseño (ver el comentario de `SHIP_CLASSES`).
 */
import { describe, expect, it } from "vitest";
import { FLEET_BATTLE, getAnyShipClass, getShipClass, SHIP_CLASSES, type ShipClassId } from "@imperium/content";
import { battleShip, resolveBattleRound, type BattleShip } from "../src/battle";

const value = (id: ShipClassId) => {
  const c = getShipClass(id)!.cost;
  return c.metal + c.volatiles * 1.5 + c.crystal * 6 + c.alloys * 4;
};

/** 1 si gana el bando 0, 0 si gana el 1, 0,5 en tablas. */
function fight(a: string[], b: string[], seed: number): number {
  let sides: [BattleShip[], BattleShip[]] = [
    a.map((id, i) => battleShip(`a${String(i).padStart(3, "0")}`, id, getAnyShipClass(id)!.hull)),
    b.map((id, i) => battleShip(`b${String(i).padStart(3, "0")}`, id, getAnyShipClass(id)!.hull)),
  ];
  for (let r = 0; r < FLEET_BATTLE.maxRounds; r++) {
    const res = resolveBattleRound(sides, (seed * 7919 + r * 104729) >>> 0);
    sides = sides.map((s) => s.map((x) => ({ ...x, hull: res.hull[x.id] ?? x.hull })).filter((x) => x.hull > 0)) as [BattleShip[], BattleShip[]];
    if (!sides[0].length || !sides[1].length) break;
  }
  return sides[0].length && !sides[1].length ? 1 : !sides[0].length && sides[1].length ? 0 : 0.5;
}

const fleet = (id: ShipClassId, budget: number) => Array.from({ length: Math.max(1, Math.round(budget / value(id))) }, () => id);

/** Tasa de victorias de `a` contra `b` con el mismo presupuesto (varios presupuestos y semillas, en los dos órdenes). */
function winRate(a: ShipClassId, b: ShipClassId, seeds = 6): number {
  let w = 0;
  let n = 0;
  for (const budget of [5000, 8000, 12000, 16000]) {
    for (let s = 1; s <= seeds; s++) {
      w += (fight(fleet(a, budget), fleet(b, budget), s) + 1 - fight(fleet(b, budget), fleet(a, budget), s + 1000)) / 2;
      n++;
    }
  }
  return w / n;
}

describe("equilibrio de las naves humanas (mismo presupuesto)", () => {
  it("las corbetas (muchos disparos) ganan a los cazas", () => {
    expect(winRate("corvette", "fighter")).toBeGreaterThan(0.65);
  });

  it("las fragatas ganan a las corbetas (su escudo absorbe los disparos pequeños)", () => {
    expect(winRate("frigate", "corvette")).toBeGreaterThan(0.65);
  });

  it("los destructores ganan a las corbetas", () => {
    expect(winRate("destroyer", "corvette")).toBeGreaterThan(0.6);
  });

  it("el interceptor paga su velocidad: pierde contra la fragata", () => {
    expect(winRate("interceptor", "frigate")).toBeLessThan(0.35);
  });

  it("ninguna nave de combate gana o pierde casi siempre contra todas", () => {
    // La nodriza (`dockFlagship`) no es una nave de línea: paga el acople, el taller y el hangar.
    const ids = SHIP_CLASSES.filter((s) => s.role === "combat" && !s.dockFlagship).map((s) => s.id);
    for (const a of ids) {
      const rates = ids.filter((b) => b !== a).map((b) => winRate(a, b, 3));
      const mean = rates.reduce((x, y) => x + y, 0) / rates.length;
      expect(mean, a).toBeGreaterThan(0.2);
      expect(mean, a).toBeLessThan(0.8);
    }
  });
});

describe("tamaño como blanco", () => {
  it("las naves grandes atraen el fuego y protegen a las pequeñas", () => {
    // Sin escudos, para contar solo dónde caen los disparos.
    const cruiser = { ...battleShip("a0", "cruiser", 100_000), shield: 0 };
    const escorts = [1, 2, 3].map((i) => ({ ...battleShip(`a${i}`, "fighter", 100_000), shield: 0 }));
    const shooters = Array.from({ length: 20 }, (_, i) => battleShip(`b${String(i).padStart(2, "0")}`, "frigate", 300));
    let onCruiser = 0;
    let onEscorts = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = resolveBattleRound([[cruiser, ...escorts], shooters], seed);
      onCruiser += 100_000 - r.hull.a0!;
      for (const e of escorts) onEscorts += 100_000 - r.hull[e.id]!;
    }
    // Perfil 4 frente a 1: el crucero recibe más disparos que los tres cazas juntos.
    expect(onCruiser).toBeGreaterThan(onEscorts);
  });
});
