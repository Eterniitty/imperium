/**
 * Contrato de la API HTTP compartido entre cliente y servidor. Los esquemas Zod
 * de lo que entra en el servidor están en `schemas.ts`, aparte, para que el
 * cliente no cargue Zod.
 */
import type { Locale } from "./i18n";

/** Respuesta de `GET /api/health`. */
export interface HealthResponse {
  ok: true;
  /** Versión del servidor: versión del paquete + commit, o "dev". */
  version: string;
  /** Versión del generador procedural con la que trabaja el servidor. */
  generatorVersion: number;
  uptimeSeconds: number;
}

/** Validez del enlace de acceso, en minutos. */
export const MAGIC_LINK_TTL_MINUTES = 15;

/**
 * Parámetro del fragmento de la URL del cliente (`/#login=...`) que lleva el
 * token del enlace de acceso. Va en el fragmento para que no llegue a ningún
 * servidor ni quede en sus registros.
 */
export const LOGIN_TOKEN_PARAM = "login";

/** Cuenta tal y como la ve su propietario. */
export interface AuthAccount {
  id: string;
  email: string;
  locale: Locale;
}

/** Respuesta de `GET /api/auth/me` y `POST /api/auth/verify`. */
export interface AuthMeResponse {
  account: AuthAccount;
}

/** Respuesta de `POST /api/auth/peek`: a qué cuenta lleva un enlace, sin gastarlo. */
export interface AuthPeekResponse {
  /** Correo enmascarado, p. ej. "an***@ejemplo.com". */
  email: string;
}

/** Códigos de error de la API; el cliente los traduce con claves `error.*`. */
export type ApiErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "invalid_or_expired"
  | "rate_limited"
  | "internal";

export interface ApiError {
  error: ApiErrorCode;
}
