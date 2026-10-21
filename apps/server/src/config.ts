import { z } from "zod";

/**
 * Configuración del servidor, leída de las variables de entorno y validada al
 * arrancar. Si falta algo o tiene un valor no válido, el servidor no arranca.
 */
/** Semilla de detalle de desarrollo, pruebas y staging. Pública: nunca en producción. */
export const DEV_DETAIL_SEED = "aeonarch-dev-detail-seed";

const EnvSchema = z
  .object({
    // Entorno de la aplicación (distinto de NODE_ENV, que afecta a las librerías):
    // - development: tu máquina.
    // - staging: servidor de pruebas cerrado con contraseña; se permite el correo por consola.
    // - production: abierto al público; exige correo real y cookies Secure (HTTPS).
    APP_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
    // Por defecto solo escucha en la máquina local: al exterior se llega a
    // través de Caddy, nunca abriendo el puerto directamente.
    SERVER_HOST: z.string().default("127.0.0.1"),
    SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().startsWith("postgres"),
    // Dirección pública del cliente; los enlaces de acceso apuntan aquí. Nunca se
    // deduce de la cabecera Host, que un atacante puede falsear.
    PUBLIC_URL: z.url().transform((u) => u.replace(/\/+$/, "")),
    // Semilla del universo. Hasta el paso 4d, en que el servidor la enviará al
    // cliente, debe coincidir con VITE_UNIVERSE_SEED del cliente.
    UNIVERSE_SEED: z.string().min(1).default("imperium-alpha"),
    // Semilla secreta del detalle de los sistemas (planetas, recursos, anomalías):
    // niebla de guerra. Solo la conoce el servidor; el cliente recibe el detalle
    // de los sistemas descubiertos. Obligatoria en producción (larga y aleatoria);
    // si cambia, cambian todos los planetas: no se toca con partidas en marcha.
    DETAIL_SEED: z.string().min(16).optional(),
    // Escala del tiempo de juego: multiplica la velocidad de viajes, construcción
    // y producción. 1 es el ritmo del diseño (horas reales); en el servidor de
    // pruebas se sube para poder ver las cosas sin esperar horas.
    TIME_SCALE: z.coerce.number().positive().max(1e7).default(1),
    /** Enlaces de acceso que puede pedir una IP cada 15 min. Las pruebas de navegador lo suben (todas salen de la misma IP). */
    AUTH_REQUESTS_PER_IP: z.coerce.number().int().min(1).max(1000).default(10),
    /** Peticiones a la API HTTP por IP y minuto (tope general, además de los límites de cada ruta). */
    API_REQUESTS_PER_IP_MINUTE: z.coerce.number().int().min(1).max(100_000).default(600),
    // Emperadores humanos de la IA (Fase 11) que se crean al arrancar. Por defecto 3
    // (ninguno con APP_ENV=test, para que las pruebas de navegador no los vean).
    AI_EMPERORS: z.coerce.number().int().min(0).max(6).optional(),
    // Administradores (panel de edición de la Wiki): correos separados por comas. Lo
    // decide solo el servidor, al comparar con el correo de la cuenta de la sesión.
    ADMIN_EMAILS: z
      .string()
      .default("")
      .transform((v) => new Set(v.split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0))),
    MAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
    // Correo real (MAIL_TRANSPORT=smtp): servidor del proveedor de correo transaccional.
    // Con smtp, SMTP_HOST, SMTP_USER, SMTP_PASS y MAIL_FROM son obligatorias.
    SMTP_HOST: z.string().trim().min(1).optional(),
    // 587: STARTTLS (obligatorio, nunca se envía en claro); 465: TLS directo.
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    // TLS directo desde el primer byte. Si no se indica, se deduce del puerto (465 → true).
    SMTP_SECURE: z.enum(["true", "false"]).optional(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    // Remitente, p. ej. "Aeonarch <no-reply@tu-dominio>". Su dominio se usa en el Message-ID.
    MAIL_FROM: z.string().trim().min(1).optional(),
    // Escribe también el enlace de acceso en el registro aunque se envíe por correo:
    // para probar el correo real en staging. Prohibido en producción.
    MAIL_LOG_LINKS: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Sin HTTPS el navegador no guarda cookies Secure: solo se desactiva en desarrollo o pruebas.
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === "smtp") {
      for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "obligatoria con MAIL_TRANSPORT=smtp" });
      }
      if (env.MAIL_FROM && !parseMailFrom(env.MAIL_FROM)) {
        ctx.addIssue({ code: "custom", path: ["MAIL_FROM"], message: 'debe ser "Nombre <direccion@dominio>" o "direccion@dominio"' });
      }
    }
    if (env.APP_ENV !== "production") return;
    if (env.MAIL_LOG_LINKS) {
      ctx.addIssue({ code: "custom", path: ["MAIL_LOG_LINKS"], message: "en producción los enlaces de acceso nunca se escriben en el registro" });
    }
    if (!env.DETAIL_SEED) {
      ctx.addIssue({ code: "custom", path: ["DETAIL_SEED"], message: "en producción hace falta una semilla secreta de detalle" });
    }
    if (env.MAIL_TRANSPORT === "console") {
      ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "en producción no se permite el correo por consola" });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "en producción las cookies deben ser Secure" });
    }
    if (!env.PUBLIC_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["PUBLIC_URL"], message: "en producción la dirección pública debe usar https" });
    }
  })
  // Fuera de producción hay un valor por defecto, conocido: no protege nada.
  .transform((env) => ({
    ...env,
    DETAIL_SEED: env.DETAIL_SEED ?? DEV_DETAIL_SEED,
    AI_EMPERORS: env.AI_EMPERORS ?? (env.APP_ENV === "test" ? 0 : 3),
    SMTP_SECURE: env.SMTP_SECURE === undefined ? env.SMTP_PORT === 465 : env.SMTP_SECURE === "true",
  }));

/**
 * Dirección y dominio del remitente: "Aeonarch <no-reply@ejemplo.com>" o
 * "no-reply@ejemplo.com". Null si no tiene forma de dirección de correo.
 */
export function parseMailFrom(from: string): { address: string; domain: string } | null {
  const match = /^(?:[^<>]*<\s*([^<>\s@]+@([^<>\s@]+\.[^<>\s@]+))\s*>|([^<>\s@]+@([^<>\s@]+\.[^<>\s@]+)))$/.exec(from.trim());
  if (!match) return null;
  const address = match[1] ?? match[3];
  const domain = match[2] ?? match[4];
  return address && domain ? { address, domain: domain.toLowerCase() } : null;
}

export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración no válida:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
