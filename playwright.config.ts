import { defineConfig } from "@playwright/test";
import { CLIENT_PORT, SERVER_PORT } from "./e2e/ports";

/**
 * Pruebas de navegador (`pnpm e2e`). Arrancan su propio servidor de juego en el
 * puerto 3100 contra TEST_DATABASE_URL (que se vacía) y un cliente Vite en el
 * 5174: no tocan el juego desplegado. No se pueden ejecutar a la vez que `pnpm test`,
 * porque comparten la base de datos de pruebas.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Un solo navegador a la vez: todas las pruebas comparten servidor y base de datos.
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    locale: "es-ES",
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    // Si una prueba falla, queda una traza para ver qué pasó: pnpm exec playwright show-trace <archivo>.
    trace: "retain-on-failure",
    launchOptions: {
      // Sin tarjeta gráfica: WebGL por software para que Three.js funcione.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: `pnpm --filter @imperium/client exec vite --port ${CLIENT_PORT} --strictPort`,
    url: `http://localhost:${CLIENT_PORT}`,
    env: { AEONARCH_API_PORT: String(SERVER_PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
