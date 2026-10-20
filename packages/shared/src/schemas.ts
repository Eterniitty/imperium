/**
 * Esquemas Zod de lo que entra en el servidor. Se importan desde
 * `@imperium/shared/schemas` (no desde el índice) para que el cliente no
 * incluya Zod en su paquete.
 */
import { z } from "zod";
import { EMPEROR_NAME_MAX, EMPEROR_NAME_MIN, VISIBILITIES, type Visibility } from "./api";
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

/** Cuerpo de `POST /api/social/visibility`. */
export const VisibilityBodySchema = z.object({ visibility: z.enum(VISIBILITIES as [Visibility, ...Visibility[]]) });

/** Cuerpo de `POST /api/social/allies`: añadir un compañero por nombre. */
export const AllyAddBodySchema = z.object({ name: z.string().max(64) });

/** Cuerpo de `POST /api/social/allies/remove`. */
export const AllyRemoveBodySchema = z.object({ emperorId: z.uuid() });

/** Cuerpo de `POST /api/emperor`: crear el Emperador de la cuenta. */
export const EmperorCreateBodySchema = z.object({ name: EmperorNameSchema });
export type EmperorCreateBody = z.input<typeof EmperorCreateBodySchema>;

/** Identificador de sistema. Coordenadas de sector acotadas para no generar sectores absurdos. */
export const SystemIdSchema = z.string().regex(/^-?\d{1,7}:-?\d{1,7}:-?\d{1,7}:\d{1,3}$/);

const CmdIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
/** Números finitos y acotados: nada de NaN, Infinity ni coordenadas absurdas. */
const Coord = z.number().finite().min(-1e9).max(1e9);
const Vec3Schema = z.tuple([Coord, Coord, Coord]);
const QuatSchema = z.tuple([z.number().min(-1.01).max(1.01), z.number().min(-1.01).max(1.01), z.number().min(-1.01).max(1.01), z.number().min(-1.01).max(1.01)]);

/** Mensajes del cliente por el WebSocket (ver `protocol.ts`). */
export const ClientMessageSchema = z.union([
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("emperor.move"),
    args: z.object({ systemId: SystemIdSchema }),
  }),
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("fleet.move"),
    args: z.object({ fleetId: z.uuid(), systemId: SystemIdSchema }),
  }),
  z.object({ t: z.literal("sub"), topic: z.enum(["emperors", "me"]) }),
  z.object({ t: z.literal("pose"), systemId: SystemIdSchema, p: Vec3Schema, q: QuatSchema, v: Vec3Schema }),
  z.object({ t: z.literal("leave") }),
  z.object({ t: z.literal("fire"), weapon: z.enum(["cannon", "missile"]), dir: Vec3Schema, target: z.string().max(64).optional() }),
]);
