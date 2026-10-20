import { z } from "zod";

/**
 * Configuración del servidor, leída de las variables de entorno y validada al
 * arrancar. Si falta algo o tiene un valor no válido, el servidor no arranca.
 */
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
    // Escala del tiempo de juego: multiplica la velocidad de viajes, construcción
    // y producción. 1 es el ritmo del diseño (horas reales); en el servidor de
    // pruebas se sube para poder ver las cosas sin esperar horas.
    TIME_SCALE: z.coerce.number().positive().max(1e7).default(1),
    MAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
    // Sin HTTPS el navegador no guarda cookies Secure: solo se desactiva en desarrollo o pruebas.
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== "production") return;
    if (env.MAIL_TRANSPORT === "console") {
      ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "en producción no se permite el correo por consola" });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "en producción las cookies deben ser Secure" });
    }
    if (!env.PUBLIC_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["PUBLIC_URL"], message: "en producción la dirección pública debe usar https" });
    }
  });

export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración no válida:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
