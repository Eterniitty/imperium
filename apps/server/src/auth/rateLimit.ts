/**
 * Limitador de tasa de ventana fija, en memoria. Suficiente con un solo
 * proceso de servidor; cuando haya varios se moverá a Redis.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private nextPruneAt = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    /** Tope de claves en memoria: si se alcanza, las claves nuevas se rechazan. */
    private readonly maxKeys = 50_000,
  ) {}

  /** Cuenta un intento para `key`. Devuelve false si ya se superó el límite. */
  consume(key: string): boolean {
    const t = this.now();
    this.prune(t);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      // Ante una avalancha de claves distintas, mejor rechazar que agotar la memoria.
      if (!entry && this.hits.size >= this.maxKeys) return false;
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.max;
  }

  /** Elimina ventanas caducadas, como mucho una vez por ventana. */
  private prune(t: number): void {
    if (t < this.nextPruneAt) return;
    this.nextPruneAt = t + this.windowMs;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= t) this.hits.delete(key);
    }
  }
}

/**
 * Clave de límite para una IP. Las IPv6 se agrupan por su prefijo /64, porque
 * cualquier proveedor da a un solo cliente un /64 entero (2^64 direcciones).
 */
export function ipRateKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * IP recortada para los registros (sin datos personales): la red /24 en IPv4 y
 * /48 en IPv6. Basta para ver de dónde viene un abuso sin guardar quién es.
 */
export function anonIp(ip: string | undefined): string {
  if (!ip) return "";
  const key = ipRateKey(ip);
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(key);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (key.endsWith("::/64")) return `${key.slice(0, -5).split(":").slice(0, 3).join(":")}::/48`;
  return "?";
}

/**
 * Clave de límite para un correo: quita la etiqueta `+algo` y, en Gmail, los
 * puntos, que llevan al mismo buzón. Solo para limitar, no como identidad.
 */
export function emailRateKey(email: string): string {
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  local = local.split("+")[0] ?? local;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}
