/**
 * Limitador de tasa de ventana fija, en memoria. Suficiente con un solo
 * proceso de servidor; cuando haya varios se moverá a Redis.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cuenta un intento para `key`. Devuelve false si ya se superó el límite. */
  consume(key: string): boolean {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      this.prune(t);
      return true;
    }
    entry.count++;
    return entry.count <= this.max;
  }

  /** Elimina ventanas caducadas para que el mapa no crezca sin límite. */
  private prune(t: number): void {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= t) this.hits.delete(key);
    }
  }
}
