import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "../apps/server/src/db/client";
import { resetTestDatabase } from "../apps/server/test/resetDb";
import { SERVER_LOG } from "./mail";
import { CLIENT_PORT, SERVER_PORT } from "./ports";

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
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("Las pruebas de navegador necesitan TEST_DATABASE_URL (se vacía en cada ejecución)");

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

  return () => {
    server.kill("SIGTERM");
  };
}
