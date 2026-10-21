import { describe, expect, it } from "vitest";
import {
  PILOT_BOOST,
  PILOT_SPEED,
  plausibleMove,
  PULSE_MAX_SPEED,
  PULSE_MIN_SPEED,
  pulseLimitAt,
  pulseSpeedLimit,
  stepPulseSpeed,
} from "../src/flight";

describe("motor de pulso (supercrucero)", () => {
  it("junto a un cuerpo va despacio, y más deprisa si se aleja que si va de frente", () => {
    const head = pulseSpeedLimit(1000, 1);
    const away = pulseSpeedLimit(1000, -1);
    expect(head).toBeGreaterThanOrEqual(PULSE_MIN_SPEED);
    expect(head).toBeLessThan(2000);
    expect(away).toBeGreaterThan(head * 3);
    expect(pulseSpeedLimit(1e9, 1)).toBe(PULSE_MAX_SPEED);
  });

  it("acelera y frena sin saltos bruscos", () => {
    let v = 0;
    for (let i = 0; i < 600; i++) {
      const next = stepPulseSpeed(v, PULSE_MAX_SPEED, 1 / 60);
      // Nunca más de un 1 % (o 7 m/s) de cambio en un fotograma.
      expect(next - v).toBeLessThanOrEqual(Math.max(7, v * 0.01));
      v = next;
    }
    const braked = stepPulseSpeed(v, 1000, 1 / 60);
    expect(braked).toBeLessThan(v);
    expect(v - braked).toBeLessThan(v * 0.05);
  });

  it("cruza entre dos planetas a 8000 km en uno o dos minutos", () => {
    // Dos planetas de 5 km de radio en la recta; la nave sale de la superficie del primero.
    const bodies = [
      { center: [0, 0, 0], radius: 5000 },
      { center: [8_000_000, 0, 0], radius: 5000 },
    ];
    let x = 6000;
    let v = 0;
    let t = 0;
    const dt = 1 / 30;
    while (x < 8_000_000 - 5000 - 20_000 && t < 600) {
      v = stepPulseSpeed(v, pulseLimitAt([x, 0, 0], [1, 0, 0], bodies), dt);
      x += v * dt;
      t += dt;
    }
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThan(120);
  });

  it("el servidor acepta la velocidad del pulso y rechaza teletransportes", () => {
    expect(plausibleMove([0, 0, 0], [PULSE_MAX_SPEED * 0.125, 0, 0], 0.125)).toBe(true);
    expect(plausibleMove([0, 0, 0], [PULSE_MAX_SPEED * 3, 0, 0], 0.125)).toBe(false);
    // Cerca de un cuerpo, con el límite del pulso allí, no cabe ir a la velocidad punta.
    const near = Math.max(PILOT_SPEED * PILOT_BOOST, pulseLimitAt([0, 0, 0], null, [{ center: [10_000, 0, 0], radius: 5000 }]));
    expect(plausibleMove([0, 0, 0], [PULSE_MAX_SPEED * 0.5, 0, 0], 0.5, near)).toBe(false);
  });
});
