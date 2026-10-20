/**
 * Esquemas Zod de lo que entra en el servidor. Se importan desde
 * `@imperium/shared/schemas` (no desde el índice) para que el cliente no
 * incluya Zod en su paquete.
 */
import { z } from "zod";
import { BASE_LOCALES, type Locale } from "./i18n";

export const LocaleSchema = z.enum(BASE_LOCALES as [Locale, ...Locale[]]);

/** Cuerpo de `POST /api/auth/request`: pedir un enlace de acceso. */
export const AuthRequestBodySchema = z.object({
  // Se recortan los espacios antes de validar: es habitual copiar el correo con ellos.
  email: z.string().trim().pipe(z.email().max(254)),
  locale: LocaleSchema.default("es"),
});
export type AuthRequestBody = z.input<typeof AuthRequestBodySchema>;

/** Cuerpo de `POST /api/auth/verify`: canjear el token del enlace. */
export const AuthVerifyBodySchema = z.object({
  // 32 bytes en base64url = 43 caracteres.
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type AuthVerifyBody = z.input<typeof AuthVerifyBodySchema>;
