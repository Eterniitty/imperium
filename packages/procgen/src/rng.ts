/**
 * Generador pseudoaleatorio determinista (mulberry32).
 * La misma semilla produce siempre la misma secuencia, en cliente y servidor.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Número en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Número real en [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Entero en [min, max], ambos incluidos. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick() sobre una lista vacía");
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Elige un elemento según su peso relativo. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, w] of entries) total += w;
    let roll = this.next() * total;
    for (const [item, w] of entries) {
      roll -= w;
      if (roll < 0) return item;
    }
    return entries[entries.length - 1]![0];
  }

  /** Aproximación barata a una distribución normal centrada en 0 (rango ±1.5). */
  bell(): number {
    return (this.next() + this.next() + this.next()) - 1.5;
  }
}
