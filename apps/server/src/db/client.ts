import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

/** Carpeta de migraciones SQL, relativa a este archivo (src/db o dist). */
const MIGRATIONS_DIR = fileURLToPath(new URL(import.meta.url.includes("/dist/") ? "../drizzle" : "../../drizzle", import.meta.url));

/**
 * postgres.js no entiende `?host=/ruta` (formato de libpq para conectar por
 * socket Unix, sin contraseña). Lo traducimos a su opción `host`.
 */
function socketOptions(url: string): { url: string; host?: string } {
  const parsed = new URL(url);
  const socketDir = parsed.searchParams.get("host");
  if (!socketDir?.startsWith("/")) return { url };
  parsed.searchParams.delete("host");
  return { url: parsed.toString(), host: socketDir };
}

export function createDb(databaseUrl: string) {
  const { url, host } = socketOptions(databaseUrl);
  const client = postgres(url, {
    ...(host ? { host } : {}),
    max: 10,
    // Los avisos de PostgreSQL (p. ej. "la tabla ya existe" en migraciones) no son errores.
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return {
    db,
    /** Aplica las migraciones pendientes. Es seguro llamarlo en cada arranque. */
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDb>["db"];
