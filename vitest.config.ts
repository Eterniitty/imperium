import { defineConfig } from "vitest/config";

// Variables del .env de la raíz (p. ej. TEST_DATABASE_URL para los tests de
// integración del servidor). Si no existe, esos tests se saltan.
try {
  process.loadEnvFile(".env");
} catch {
  // Sin .env: se usan solo las variables del entorno.
}

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    // Los tests de integración del servidor comparten la base de datos de pruebas
    // y la vacían al empezar: en paralelo se pisarían.
    fileParallelism: false,
  },
});
