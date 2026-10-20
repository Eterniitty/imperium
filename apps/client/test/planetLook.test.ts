import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PlanetType } from "@imperium/shared";
import { bodyDetailFor, bodySegments, planetLook } from "../src/engine/planetLook";
import { createBodyUniforms, createCoronaMaterial, createPlanetMaterial, createStarSurfaceMaterial } from "../src/engine/bodyMaterials";

const TYPES: PlanetType[] = ["lava", "barren", "rocky", "desert", "ocean", "toxic", "ice", "gas_giant", "ice_giant"];

describe("aspecto de los planetas", () => {
  it("es determinista por planeta y distinto entre planetas", () => {
    const a = planetLook("ocean", "sys-1:2");
    const b = planetLook("ocean", "sys-1:2");
    const c = planetLook("ocean", "sys-1:3");
    expect(a.seed.toArray()).toEqual(b.seed.toArray());
    expect(a.colors.map((x) => x.getHex())).toEqual(b.colors.map((x) => x.getHex()));
    expect(a.seed.toArray()).not.toEqual(c.seed.toArray());
  });

  it("da atmósfera a los mundos que la tienen y bandas a los gigantes", () => {
    const withAtmosphere = TYPES.filter((t) => planetLook(t, "k").atmosphere !== null);
    expect(withAtmosphere.sort()).toEqual(["desert", "gas_giant", "ice_giant", "ocean", "rocky", "toxic"]);
    expect(TYPES.filter((t) => planetLook(t, "k").bands).sort()).toEqual(["gas_giant", "ice_giant"]);
    expect(planetLook("ocean", "k").seaLevel).toBeGreaterThan(0);
    expect(planetLook("lava", "k").lavaGlow).toBeGreaterThan(0);
    for (const t of TYPES) {
      const look = planetLook(t, "k");
      expect(look.colors).toHaveLength(5);
      expect(look.stops).toHaveLength(5);
    }
  });
});

describe("nivel de detalle", () => {
  it("más octavas y segmentos con más calidad", () => {
    expect(bodyDetailFor("low").maxOctaves).toBeLessThan(bodyDetailFor("medium").maxOctaves);
    expect(bodyDetailFor("medium").maxOctaves).toBeLessThan(bodyDetailFor("high").maxOctaves);
    expect(bodyDetailFor("low").maxSegments).toBeLessThan(bodyDetailFor("high").maxSegments);
  });

  it("esferas toscas de lejos y finas de cerca", () => {
    const detail = bodyDetailFor("high");
    expect(bodySegments(1000, detail)).toBe(32);
    expect(bodySegments(1.01, detail)).toBe(detail.maxSegments);
    expect(bodySegments(10, bodyDetailFor("low"))).toBeLessThanOrEqual(bodyDetailFor("low").maxSegments);
  });
});

describe("materiales de los cuerpos", () => {
  it("usan el búfer de profundidad logarítmico", () => {
    const shared = createBodyUniforms();
    const materials = [
      createPlanetMaterial(planetLook("rocky", "k"), 5000, shared),
      createStarSurfaceMaterial(new THREE.Color(1, 0.8, 0.5), new THREE.Vector3(), false, shared),
      createCoronaMaterial(new THREE.Color(1, 0.8, 0.5), 150_000, new THREE.Vector3(), false, shared),
    ];
    for (const m of materials) {
      expect(m.vertexShader).toContain("logdepthbuf_vertex");
      expect(m.fragmentShader).toContain("logdepthbuf_fragment");
    }
  });
});
