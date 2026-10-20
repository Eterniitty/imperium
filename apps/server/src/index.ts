import { buildApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = buildApp(config);

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
} catch (err) {
  app.log.fatal(err, "No se pudo arrancar el servidor");
  process.exit(1);
}
