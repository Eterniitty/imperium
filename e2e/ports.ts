/**
 * Puertos de las pruebas de navegador: distintos de los del juego (3000) y del
 * desarrollo (5173). Se pueden cambiar con variables de entorno para ejecutar
 * dos baterías a la vez (p. ej. dos agentes trabajando en paralelo).
 */
export const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3100);
export const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT ?? 5174);

/** Estado inicial del navegador de pruebas (preferencias), que escribe global-setup. */
export const STORAGE_STATE = `test-results/storage-state-${CLIENT_PORT}.json`;
