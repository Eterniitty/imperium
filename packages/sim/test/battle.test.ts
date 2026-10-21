import { describe, expect, it } from "vitest";
import { FLEET_BATTLE, getShipClass } from "@imperium/content";
import { battleRoundMs, battleRoundSeed, battleShip, canAttack, resolveBattleRound, type BattleShip } from "../src";

const frigate = (id: string, hull = getShipClass("frigate")!.hull) => battleShip(id, "frigate", hull);
const freighter = (id: string) => battleShip(id, "freighter", getShipClass("freighter")!.hull);

describe("combate de flotas por rondas", () => {
  it("es determinista: misma entrada y semilla, mismo resultado; el orden de entrada no importa", () => {
    const a = [frigate("a1"), frigate("a2"), freighter("a3")];
    const b = [frigate("b1"), freighter("b2")];
    const r1 = resolveBattleRound([a, b], 1234);
    const r2 = resolveBattleRound([[...a].reverse(), [...b].reverse()], 1234);
    expect(r2).toEqual(r1);
    // Otra semilla reparte los disparos de otra forma (en algún caso de unos cuantos).
    const others = [1, 2, 3, 4, 5].map((s) => resolveBattleRound([a, b], s));
    expect(others.some((r) => JSON.stringify(r) !== JSON.stringify(r1))).toBe(true);
  });

  it("no modifica la entrada", () => {
    const a = [frigate("a1")];
    const b = [freighter("b1")];
    const copy = JSON.parse(JSON.stringify([a, b]));
    resolveBattleRound([a, b], 7);
    expect([a, b]).toEqual(copy);
  });

  it("el escudo absorbe primero y el daño varía dentro de la dispersión", () => {
    const cls = getShipClass("frigate")!;
    for (let seed = 0; seed < 50; seed++) {
      const r = resolveBattleRound([[frigate("a")], [frigate("b")]], seed);
      const spread = FLEET_BATTLE.damageSpreadPct / 100;
      const min = Math.round(cls.attack * (1 - spread)) - cls.battleShield;
      const max = Math.round(cls.attack * (1 + spread)) - cls.battleShield;
      for (const side of [0, 1] as const) {
        expect(r.dealt[side]).toBeGreaterThanOrEqual(min);
        expect(r.dealt[side]).toBeLessThanOrEqual(max);
        expect(r.absorbed[side]).toBe(cls.battleShield);
      }
      expect(r.hull.a).toBe(cls.hull - r.dealt[1]);
      expect(r.hull.b).toBe(cls.hull - r.dealt[0]);
    }
  });

  it("destruye naves, las cuenta por clase y no dispara a las ya caídas", () => {
    // Fragatas contra cargueros indefensos y dañados: cada disparo basta para hundir uno.
    const a = [frigate("a1"), frigate("a2")];
    const b: BattleShip[] = ["b1", "b2", "b3"].map((id) => ({ ...freighter(id), hull: 10 }));
    const r = resolveBattleRound([a, b], 99);
    expect(r.destroyed).toHaveLength(2);
    expect(r.lost[1]).toEqual({ freighter: 2 });
    expect(r.lost[0]).toEqual({});
    expect(r.dealt[1]).toBe(0);
    for (const id of r.destroyed) expect(r.hull[id]).toBe(0);
  });

  it("las naves que caen en la ronda también disparan (fuego simultáneo)", () => {
    const r = resolveBattleRound([[frigate("a", 1)], [frigate("b", 1)]], 5);
    expect(r.destroyed).toEqual(["a", "b"]);
  });

  it("sin ataque no hay daño", () => {
    expect(canAttack([freighter("x")])).toBe(false);
    expect(canAttack([frigate("x")])).toBe(true);
    const r = resolveBattleRound([[freighter("a")], [freighter("b")]], 1);
    expect(r.dealt).toEqual([0, 0]);
    expect(r.destroyed).toEqual([]);
  });

  it("semillas de ronda distintas y duración escalada con TIME_SCALE", () => {
    expect(battleRoundSeed(42, 0)).not.toBe(battleRoundSeed(42, 1));
    expect(battleRoundSeed(42, 3)).toBe(battleRoundSeed(42, 3));
    expect(battleRoundMs(1)).toBe(FLEET_BATTLE.roundGameSeconds * 1000);
    expect(battleRoundMs(10)).toBe(FLEET_BATTLE.roundGameSeconds * 100);
    expect(battleRoundMs(1e7)).toBe(250);
  });
});
