/**
 * Tipos de la API HTTP compartidos entre cliente y servidor.
 */

/** Respuesta de `GET /api/health`. */
export interface HealthResponse {
  ok: true;
  /** Versión del servidor: versión del paquete + commit, o "dev". */
  version: string;
  /** Versión del generador procedural con la que trabaja el servidor. */
  generatorVersion: number;
  uptimeSeconds: number;
}
