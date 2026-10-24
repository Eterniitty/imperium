/**
 * Modelo de vuelo de la Era II: un paso de la nave con sus mandos. Lo calculan
 * igual el servidor (para validar lo que dice el cliente) y el cliente de Unreal
 * (para predecir); port en aeonarch-ue/Core/include/aeon/flight.h, con vectores
 * al bit. Solo + − × ÷ y raíz (el giro usa cosSinTurns).
 *
 * Ejes de la nave como en Unreal: X adelante, Y derecha, Z arriba. La orientación
 * es un cuaternión [w, x, y, z] que lleva de la nave al mundo. Los mandos de giro
 * son velocidades angulares en los ejes de la nave (−1..1 de la máxima), con el
 * signo del álgebra: +Z gira el morro hacia la derecha (+Y); el cliente traduce
 * el ratón y las teclas a estos signos.
 */
import { AEON_FLIGHT } from "@imperium/content";
import { cosSinTurns } from "@imperium/procgen";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface FlightState {
  /** Posición en metros. */
  pos: Vec3;
  /** Velocidad en m/s. */
  vel: Vec3;
  /** Orientación (nave → mundo), unitario. */
  rot: Quat;
  /** Crucero: 0 apagado, 1 a tope. */
  cruise: number;
}

export interface FlightInput {
  /** Empuje en los ejes de la nave (adelante, derecha, arriba), cada uno −1..1. */
  thrust: Vec3;
  /** Giro en los ejes de la nave (alrededor de X, Y, Z), cada uno −1..1. */
  turn: Vec3;
  boost: boolean;
  assist: boolean;
  cruise: boolean;
  /** Tope de la velocidad de crucero (m/s) cerca de un mundo (cruiseCapFor); 0 o sin poner: sin tope. */
  cruiseCap?: number;
}

export type FlightParams = typeof AEON_FLIGHT;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Producto de cuaterniones a ⊗ b. */
export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

/** Gira el vector v con el cuaternión unitario q (q ⊗ v ⊗ q*). */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  // t = 2 · (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

function quatNormalize(q: Quat): Quat {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Un paso de dt segundos. Devuelve el estado nuevo (no cambia el de entrada). */
export function flightStep(state: FlightState, input: FlightInput, dt: number, p: FlightParams = AEON_FLIGHT): FlightState {
  // Giro: velocidad angular en vueltas/s en los ejes de la nave; rotación exacta del paso.
  const wx = clamp(input.turn[0], -1, 1) * p.rollRate;
  const wy = clamp(input.turn[1], -1, 1) * p.pitchRate;
  const wz = clamp(input.turn[2], -1, 1) * p.yawRate;
  const rate = Math.sqrt(wx * wx + wy * wy + wz * wz);
  let rot = state.rot;
  if (rate > 0) {
    const [c, s] = cosSinTurns((rate * dt) / 2);
    const k = s / rate;
    rot = quatNormalize(quatMul(state.rot, [c, wx * k, wy * k, wz * k]));
  }

  // Crucero: sube o baja en cruiseRampS segundos.
  const cruise = clamp(state.cruise + ((input.cruise ? 1 : -1) * dt) / p.cruiseRampS, 0, 1);
  let vel: Vec3;
  if (cruise > 0) {
    const forward = quatRotate(rot, [1, 0, 0]);
    const full = p.maxSpeed + (p.cruiseSpeed - p.maxSpeed) * (cruise * cruise);
    const cap = input.cruiseCap ?? 0;
    const target = cap > 0 && cap < full ? cap : full;
    const a = Math.min(1, dt * p.cruiseAlign);
    vel = [
      state.vel[0] + (forward[0] * target - state.vel[0]) * a,
      state.vel[1] + (forward[1] * target - state.vel[1]) * a,
      state.vel[2] + (forward[2] * target - state.vel[2]) * a,
    ];
  } else {
    let tx = clamp(input.thrust[0], -1, 1);
    let ty = clamp(input.thrust[1], -1, 1);
    let tz = clamp(input.thrust[2], -1, 1);
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl > 1) {
      tx /= tl;
      ty /= tl;
      tz /= tl;
    }
    const push = quatRotate(rot, [tx, ty, tz]);
    const accel = p.accel * (input.boost ? p.boostFactor : 1) * dt;
    vel = [state.vel[0] + push[0] * accel, state.vel[1] + push[1] * accel, state.vel[2] + push[2] * accel];
    // Asistencia: frena sola lo que no se empuja.
    if (input.assist && tl === 0) {
      const keep = 1 - Math.min(1, dt * p.assistBrake);
      vel = [vel[0] * keep, vel[1] * keep, vel[2] * keep];
    }
    const max = input.boost ? p.boostSpeed : p.maxSpeed;
    const speed = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
    if (speed > max) vel = [(vel[0] * max) / speed, (vel[1] * max) / speed, (vel[2] * max) / speed];
  }

  const pos: Vec3 = [state.pos[0] + vel[0] * dt, state.pos[1] + vel[1] * dt, state.pos[2] + vel[2] * dt];
  return { pos, vel, rot, cruise };
}
