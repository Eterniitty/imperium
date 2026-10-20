import { sql } from "drizzle-orm";
import type { createDb } from "../src/db/client";

/** Deja la base de datos de pruebas vacía y con todas las migraciones aplicadas. */
export async function resetTestDatabase(database: ReturnType<typeof createDb>): Promise<void> {
  await database.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await database.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await database.db.execute(sql`CREATE SCHEMA public`);
  await database.migrate();
}
