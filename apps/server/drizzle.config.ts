import { defineConfig } from "drizzle-kit";

// Solo para generar migraciones a partir del esquema; no necesita conexión.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
