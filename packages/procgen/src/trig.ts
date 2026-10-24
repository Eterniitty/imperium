/**
 * Seno y coseno deterministas (regla 3): solo + - * / y floor, iguales al bit en
 * el servidor y en el cliente de Unreal (port en aeonarch-ue/Core). Precisión de
 * ~1e-15 en todo el círculo: reducción a un octante y polinomios de Taylor.
 *
 * El ángulo va en **vueltas** (1 = 360°), así el tiempo / periodo se usa tal cual
 * y no hay que multiplicar por π antes de reducir.
 */

const PI = 3.141592653589793;
const QUARTER = PI / 2;

/** Taylor de cos y sin en [−π/4, π/4] (hasta x¹⁶ y x¹⁷). */
function cosPoly(x: number): number {
  const x2 = x * x;
  return 1 - (x2 / 2) * (1 - (x2 / 12) * (1 - (x2 / 30) * (1 - (x2 / 56) * (1 - (x2 / 90) * (1 - (x2 / 132) * (1 - (x2 / 182) * (1 - x2 / 240)))))));
}

function sinPoly(x: number): number {
  const x2 = x * x;
  return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - (x2 / 156) * (1 - (x2 / 210) * (1 - x2 / 272))))))));
}

/** [cos, sin] de un ángulo en vueltas. */
export function cosSinTurns(turns: number): [number, number] {
  // Cuartos de vuelta: el entero dice el cuadrante; el resto, el ángulo dentro de él.
  const q = turns * 4;
  const k = Math.floor(q + 0.5); // cuadrante más cercano → resto en [−0,5, 0,5) cuartos
  const x = (q - k) * QUARTER; // en [−π/4, π/4)
  const c = cosPoly(x);
  const s = sinPoly(x);
  const quadrant = k - 4 * Math.floor(k / 4);
  if (quadrant === 0) return [c, s];
  if (quadrant === 1) return [-s, c];
  if (quadrant === 2) return [-c, -s];
  return [s, -c];
}
