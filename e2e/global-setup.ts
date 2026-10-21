import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "../apps/server/src/db/client";
import { resetTestDatabase } from "../apps/server/test/resetDb";
import { SERVER_LOG } from "./mail";
import { CLIENT_PORT, SERVER_PORT, STORAGE_STATE } from "./ports";

const SERVER_DIR = fileURLToPath(new URL("../apps/server", import.meta.url));

/**
 * Vacía la base de datos de pruebas y arranca un servidor de juego solo para
 * estas pruebas. Su registro (donde el correo por consola deja los enlaces de
 * acceso) se guarda en SERVER_LOG. Devuelve la función que lo para al terminar.
 */
export default async function globalSetup() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Sin .env: solo las variables del entorno.
  }
  // Base propia (E2E_DATABASE_URL) para poder pasar a la vez `pnpm test`, que vacía TEST_DATABASE_URL.
  const databaseUrl = process.env.E2E_DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("Las pruebas de navegador necesitan E2E_DATABASE_URL o TEST_DATABASE_URL (se vacía en cada ejecución)");

  const database = createDb(databaseUrl);
  await resetTestDatabase(database);
  await database.close();

  mkdirSync("test-results", { recursive: true });
  const log = openSync(SERVER_LOG, "w");
  const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: SERVER_DIR,
    stdio: ["ignore", log, log],
    env: {
      PATH: process.env.PATH,
      APP_ENV: "test",
      LOG_LEVEL: "info",
      SERVER_PORT: String(SERVER_PORT),
      DATABASE_URL: databaseUrl,
      PUBLIC_URL: `http://localhost:${CLIENT_PORT}`,
      MAIL_TRANSPORT: "console",
      COOKIE_SECURE: "false",
      // Tiempo 600 veces más rápido: un salto dentro del Núcleo dura unos segundos.
      TIME_SCALE: "600",
      // Todas las pruebas piden enlaces desde la misma IP.
      AUTH_REQUESTS_PER_IP: "200",
      API_REQUESTS_PER_IP_MINUTE: "100000",
      // Administrador de la Wiki (panel de edición; e2e/wiki.spec.ts).
      ADMIN_EMAILS: "wiki-admin@aeonarch.test",
    },
  });

  // Espera a que responda (aplica las migraciones al arrancar).
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`El servidor de pruebas se cerró; mira ${SERVER_LOG}`);
    try {
      if ((await fetch(`http://127.0.0.1:${SERVER_PORT}/api/health`)).ok) break;
    } catch {
      // Aún arrancando.
    }
    if (Date.now() > deadline) throw new Error(`El servidor de pruebas no arrancó; mira ${SERVER_LOG}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Preferencias del navegador de pruebas: calidad baja y sin música (sin GPU, cada fotograma cuesta).
  writeFileSync(
    STORAGE_STATE,
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin: `http://localhost:${CLIENT_PORT}`,
          localStorage: [
            { name: "imperium.prefs", value: JSON.stringify({ quality: "low", uiScale: "auto", musicVolume: 0 }) },
            // El aviso de cookies ya visto: no tapa nada en las capturas.
            { name: "imperium.cookieNotice", value: "1" },
          ],
        },
      ],
    }),
  );

  return () => {
    server.kill("SIGTERM");
  };
}
