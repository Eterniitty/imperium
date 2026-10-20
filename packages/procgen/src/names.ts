import type { Rng } from "./rng";

const START = ["Ka", "Vel", "Or", "Tha", "Ser", "Dra", "Ix", "Mor", "Aur", "Ze", "Qua", "Ny", "Bel", "Cor", "Hel", "Ul", "Var", "Sol", "Ema", "Ry", "Ost", "Pra", "Kel", "Tor"];
const MIDDLE = ["ra", "the", "lo", "mi", "nax", "dor", "si", "ve", "qu", "ri", "an", "es", "or", "ul", "y", "ae"];
const END = ["on", "is", "ar", "us", "ia", "eth", "ax", "or", "en", "um", "ys", "ai", "ok", "el"];
const SUFFIX = ["Prime", "Major", "Minor", "Secundus", "Tertius", "Ultima", "Nova"];

/** Nombre estelar pronunciable y determinista. */
export function generateStarName(rng: Rng): string {
  let name = rng.pick(START);
  const middles = rng.int(0, 2);
  for (let i = 0; i < middles; i++) name += rng.pick(MIDDLE);
  name += rng.pick(END);
  if (rng.chance(0.12)) name += ` ${rng.pick(SUFFIX)}`;
  else if (rng.chance(0.1)) name += `-${rng.int(2, 99)}`;
  return name;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export function planetDesignation(starName: string, index: number): string {
  return `${starName} ${ROMAN[index] ?? String(index + 1)}`;
}
