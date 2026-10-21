import { rockyBody, starBody } from "../src/bodies";
import { describe, expect, it } from "vitest";
import { ECONOMY, HEIR_NAMES, LINEAGE } from "@imperium/content";
import { decayedStreak, doctrineDefense, doctrineExtraction, gestationMinutes, gestationMs, governorChoice, heirName, incarnateReadyAt, parkNearPlanet, planetPosition, type SystemLayout } from "../src";

const HOUR = 3_600_000;

describe("linaje (Fase 10)", () => {
  it("la gestación crece con las muertes seguidas hasta un máximo y tarda más en el Núcleo", () => {
    expect(gestationMinutes(1, false)).toBe(LINEAGE.gestationBaseMinutes);
    expect(gestationMinutes(2, false)).toBe(LINEAGE.gestationBaseMinutes * LINEAGE.gestationGrowth);
    expect(gestationMinutes(3, false)).toBeGreaterThan(gestationMinutes(2, false));
    expect(gestationMinutes(50, false)).toBe(LINEAGE.gestationMaxMinutes);
    expect(gestationMinutes(1, true)).toBe(LINEAGE.gestationBaseMinutes * LINEAGE.coreGestationFactor);
    // Con la escala de tiempo, en tiempo real dura menos.
    expect(gestationMs(1, false, 60)).toBe(Math.ceil((LINEAGE.gestationBaseMinutes * 60_000) / 60));
  });

  it("la racha se olvida con el tiempo sin morir", () => {
    const t0 = 1_000_000;
    expect(decayedStreak(3, t0, t0, 1)).toBe(3);
    expect(decayedStreak(3, t0, t0 + LINEAGE.streakDecayHours * HOUR, 1)).toBe(2);
    expect(decayedStreak(3, t0, t0 + 10 * LINEAGE.streakDecayHours * HOUR, 1)).toBe(0);
    expect(decayedStreak(2, null, t0, 1)).toBe(0);
    // Con escala 6, una hora real son 6 de juego.
    expect(decayedStreak(3, t0, t0 + HOUR, 6)).toBe(3 - Math.floor(6 / LINEAGE.streakDecayHours));
  });

  it("doctrinas y enfriamiento de la encarnación", () => {
    expect(doctrineExtraction(null)).toBe(1);
    expect(doctrineExtraction("prosperity")).toBeGreaterThan(1);
    expect(doctrineDefense("bastion")).toBeGreaterThan(1);
    expect(doctrineDefense("nada")).toBe(1);
    expect(incarnateReadyAt(null, 1)).toBe(0);
    expect(incarnateReadyAt(1000, 1)).toBe(1000 + LINEAGE.incarnateCooldownHours * HOUR);
  });

  it("el gobernador encarga lo primero de su doctrina que quepa y se pueda pagar con reserva", () => {
    const rich = { ...ECONOMY.storage };
    expect(governorChoice("bastion", {}, 0, rich)).toBe("defense_platform");
    expect(governorChoice("bastion", { defense_platform: 4 }, 0, rich)).toBe("power_plant");
    // Nunca con la cola ocupada (no se mete en las órdenes del jugador).
    expect(governorChoice("bastion", {}, 1, rich)).toBeNull();
    // Sin existencias por encima de la reserva, nada.
    expect(governorChoice("prosperity", {}, 0, { metal: 100, volatiles: 10, crystal: 0, alloys: 0 })).toBeNull();
  });

  it("nombres de los Herederos", () => {
    expect(heirName(0)).toBe(HEIR_NAMES[0]);
    expect(heirName(HEIR_NAMES.length)).toBe(`${HEIR_NAMES[0]} 2`);
  });

  it("la nave renacida aparece junto al planeta de la Cuna", () => {
    const body = rockyBody("p2", "planet", "star", "rocky", 5_000 / 637_100);
    const layout: SystemLayout = {
      starRadius: 100_000,
      star: starBody("G"),
      planets: [{ index: 2, orbitRadius: 2_000_000, size: 5_000, angularSpeed: 1e-5, phase: 0.3, body, moons: [], spin: 1e-4 }],
      belts: [],
      boundary: 5_000_000,
      parkMinRadius: 600_000,
    };
    const t = 123_456_789;
    const park = parkNearPlanet(layout, 2, t)!;
    const c = planetPosition(layout.planets[0]!, t);
    const d = Math.hypot(park.p[0] - c.x, park.p[1] - c.y, park.p[2] - c.z);
    expect(d).toBeCloseTo(5_000 + LINEAGE.rebirthAltitudeM, 0);
    expect(parkNearPlanet(layout, 9, t)).toBeNull();
  });
});
