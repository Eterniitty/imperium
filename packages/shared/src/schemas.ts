/**
 * Esquemas Zod de lo que entra en el servidor. Se importan desde
 * `@imperium/shared/schemas` (no desde el índice) para que el cliente no
 * incluya Zod en su paquete.
 */
import { z } from "zod";
import { EMPEROR_NAME_MAX, EMPEROR_NAME_MIN, PLANET_NAME_MAX, PLANET_NAME_MIN, VISIBILITIES, type Visibility } from "./api";
import { BASE_LOCALES, type Locale } from "./i18n";

export const LocaleSchema = z.enum(BASE_LOCALES as [Locale, ...Locale[]]);

/** Cuerpo de `POST /api/auth/request`: pedir un enlace de acceso. */
export const AuthRequestBodySchema = z.object({
  // Se recortan los espacios antes de validar: es habitual copiar el correo con ellos.
  email: z.string().trim().pipe(z.email().max(254)),
  locale: LocaleSchema.default("es"),
  /** Aceptación de los términos de uso y la política de privacidad vigentes (obligatoria). */
  acceptTerms: z.literal(true),
});
export type AuthRequestBody = z.input<typeof AuthRequestBodySchema>;

/** Cuerpo de `POST /api/auth/verify` (canjear el enlace) y `POST /api/auth/peek` (consultarlo). */
export const AuthVerifyBodySchema = z.object({
  // 32 bytes en base64url = 43 caracteres.
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type AuthVerifyBody = z.input<typeof AuthVerifyBodySchema>;

/** Cuerpo de `POST /api/account/delete`: confirmación explícita del borrado. */
export const AccountDeleteBodySchema = z.object({ confirm: z.literal(true) });
export type AccountDeleteBody = z.input<typeof AccountDeleteBodySchema>;

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

/** Nombre de un planeta: mismas reglas que el de un Emperador, con su propia longitud. */
export const PlanetNameSchema = z
  .string()
  .transform((s) => s.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(
    z
      .string()
      .min(PLANET_NAME_MIN)
      .max(PLANET_NAME_MAX)
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
/** Cantidad a transportar: positiva y acotada. */
const Amount = z.number().finite().min(0).max(1e7);
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
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("colony.claim"),
    args: z.object({
      systemId: SystemIdSchema,
      planetIndex: z.number().int().min(0).max(63),
      humans: z.number().int().min(1).max(1_000_000).optional(),
      fleetId: z.uuid().optional(),
    }),
  }),
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("colony.rename"),
    // El nombre se valida en el servidor, para responder `invalid_name` en vez de cerrar la conexión.
    args: z.object({ colonyId: z.uuid(), name: z.string().max(PLANET_NAME_MAX * 4) }),
  }),
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("colony.build"),
    args: z.object({ colonyId: z.uuid(), kind: z.enum(["installation", "ship"]), itemId: z.string().regex(/^[a-z_]{1,32}$/) }),
  }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("colony.cancel"), args: z.object({ colonyId: z.uuid(), buildId: z.uuid() }) }),
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("fleet.transfer"),
    args: z.object({
      fleetId: z.uuid(),
      colonyId: z.uuid(),
      direction: z.enum(["load", "unload"]),
      amounts: z.object({ metal: Amount, volatiles: Amount, crystal: Amount, alloys: Amount, humans: Amount }).partial(),
    }),
  }),
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("fleet.route"),
    args: z.object({
      fleetId: z.uuid(),
      fromColonyId: z.uuid(),
      toColonyId: z.uuid(),
      carry: z.array(z.enum(["metal", "volatiles", "crystal", "alloys"])).max(4),
      humans: z.boolean(),
    }),
  }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("fleet.routeStop"), args: z.object({ fleetId: z.uuid() }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("colony.disembark"), args: z.object({ colonyId: z.uuid(), humans: z.number().int().min(1).max(100_000) }) }),
  z.object({ t: z.literal("sub"), topic: z.enum(["emperors", "me"]) }),
  z.object({ t: z.literal("pose"), systemId: SystemIdSchema, p: Vec3Schema, q: QuatSchema, v: Vec3Schema }),
  z.object({ t: z.literal("leave") }),
  z.object({ t: z.literal("fire"), weapon: z.enum(["cannon", "missile"]), dir: Vec3Schema, target: z.string().max(64).optional() }),
]);
