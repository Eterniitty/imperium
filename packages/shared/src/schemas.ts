/**
 * Esquemas Zod de lo que entra en el servidor. Se importan desde
 * `@imperium/shared/schemas` (no desde el índice) para que el cliente no
 * incluya Zod en su paquete.
 */
import { z } from "zod";
import { EMPEROR_NAME_MAX, EMPEROR_NAME_MIN } from "./api";
import { BASE_LOCALES, type Locale } from "./i18n";

export const LocaleSchema = z.enum(BASE_LOCALES as [Locale, ...Locale[]]);

/** Cuerpo de `POST /api/auth/request`: pedir un enlace de acceso. */
export const AuthRequestBodySchema = z.object({
  // Se recortan los espacios antes de validar: es habitual copiar el correo con ellos.
  email: z.string().trim().pipe(z.email().max(254)),
  locale: LocaleSchema.default("es"),
});
export type AuthRequestBody = z.input<typeof AuthRequestBodySchema>;

/** Cuerpo de `POST /api/auth/verify` (canjear el enlace) y `POST /api/auth/peek` (consultarlo). */
export const AuthVerifyBodySchema = z.object({
  // 32 bytes en base64url = 43 caracteres.
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type AuthVerifyBody = z.input<typeof AuthVerifyBodySchema>;

/**
 * Nombre de Emperador: letras de cualquier alfabeto, cifras, espacios, guiones
 * y apóstrofos; empieza y termina por letra o cifra. Se normaliza (NFC) y se
 * recortan y agrupan los espacios antes de validar.
 */
export const EmperorNameSchema = z
  .string()
  .transform((s) => s.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(
    z
      .string()
      .min(EMPEROR_NAME_MIN)
      .max(EMPEROR_NAME_MAX)
      .regex(/^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N} '’-]*[\p{L}\p{M}\p{N}])?$/u),
  );

/** Cuerpo de `POST /api/emperor`: crear el Emperador de la cuenta. */
export const EmperorCreateBodySchema = z.object({ name: EmperorNameSchema });
export type EmperorCreateBody = z.input<typeof EmperorCreateBodySchema>;

/** Cuerpo de `POST /api/emperor/move`. Coordenadas de sector acotadas para no generar sectores absurdos. */
export const EmperorMoveBodySchema = z.object({
  systemId: z.string().regex(/^-?\d{1,7}:-?\d{1,7}:-?\d{1,7}:\d{1,3}$/),
});
export type EmperorMoveBody = z.input<typeof EmperorMoveBodySchema>;
