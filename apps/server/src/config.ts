import { z } from "zod";

/**
 * Configuración del servidor, leída de las variables de entorno y validada al
 * arrancar. Si falta algo o tiene un valor no válido, el servidor no arranca.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Por defecto solo escucha en la máquina local: al exterior se llega a
  // través de Caddy, nunca abriendo el puerto directamente.
  SERVER_HOST: z.string().default("127.0.0.1"),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración no válida:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
