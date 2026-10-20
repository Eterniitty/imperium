import { describe, expect, it } from "vitest";
import type { Emperor } from "@imperium/shared";
import { isTravelling, MIN_TRAVEL_MS, positionAt, settle, travelDurationMs } from "../src";

const origin = { systemId: "0:0:0:0", systemName: "Origen", position: { x: 0, y: 0, z: 0 } };
const dest = { systemId: "0:0:0:1", systemName: "Destino", position: { x: 30, y: 40, z: 0 } };
const travelling: Emperor = { id: "e", name: "E", location: origin, travel: { to: dest, departAt: 1000, arriveAt: 11_000 } };

describe("viaje", () => {
  it("la duración es la distancia entre la velocidad, con un mínimo", () => {
    // 50 a.l. a 3600 a.l./h = 50 s.
    expect(travelDurationMs(origin.position, dest.position, 3600)).toBe(50_000);
    expect(travelDurationMs(origin.position, origin.position, 3600)).toBe(MIN_TRAVEL_MS);
  });

  it("la posición se interpola entre salida y llegada", () => {
    expect(positionAt(travelling, 0)).toEqual(origin.position);
    expect(positionAt(travelling, 6000)).toEqual({ x: 15, y: 20, z: 0 });
    expect(positionAt(travelling, 20_000)).toEqual(dest.position);
  });

  it("al llegar, el Emperador queda en el destino y sin viaje", () => {
    expect(isTravelling(travelling, 10_999)).toBe(true);
    expect(settle(travelling, 10_999)).toBe(travelling);
    expect(isTravelling(travelling, 11_000)).toBe(false);
    expect(settle(travelling, 11_000)).toEqual({ ...travelling, location: dest, travel: null });
  });
});
