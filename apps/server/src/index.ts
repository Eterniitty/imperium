import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/client";

const config = loadConfig();
const database = createDb(config.DATABASE_URL);
await database.migrate();
const app = await buildApp(config, { db: database.db });
app.addHook("onClose", () => database.close());

// Cierre ordenado: systemd envía SIGTERM al reiniciar o parar el servicio.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "Cerrando el servidor");
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error(err, "Error al cerrar el servidor");
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ host: config.SERVER_HOST, port: config.SERVER_PORT });
  app.log.info({ appEnv: config.APP_ENV, mail: config.MAIL_TRANSPORT }, "Servidor listo");
} catch (err) {
  app.log.fatal(err, "No se pudo arrancar el servidor");
  process.exit(1);
}
