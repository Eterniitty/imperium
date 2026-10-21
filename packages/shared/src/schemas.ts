/**
 * Esquemas Zod de lo que entra en el servidor. Se importan desde
 * `@imperium/shared/schemas` (no desde el índice) para que el cliente no
 * incluya Zod en su paquete.
 */
import { z } from "zod";
import { EMPEROR_NAME_MAX, EMPEROR_NAME_MIN, PLANET_NAME_MAX, PLANET_NAME_MIN, VISIBILITIES, type Visibility } from "./api";
import { BASE_LOCALES, type Locale } from "./i18n";
import { WIKI_BODY_MAX, WIKI_GROUPS, WIKI_NOTE_MAX, WIKI_SLUG_MAX, WIKI_SLUG_RE, WIKI_TITLE_MAX } from "./wiki";

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

/** Cuerpo de `POST /api/emperor/companion`: pedir aparecer cerca de un compañero. */
export const CompanionRequestBodySchema = z.object({ name: EmperorNameSchema, companion: z.string().min(1).max(64) });

/** Cuerpo de `POST /api/companion-requests/respond`: aceptar o rechazar una solicitud de alta. */
export const CompanionRespondBodySchema = z.object({ id: z.uuid(), accept: z.boolean() });

/** Identificador de sistema. Coordenadas de sector acotadas para no generar sectores absurdos. */
export const SystemIdSchema = z.string().regex(/^-?\d{1,7}:-?\d{1,7}:-?\d{1,7}:\d{1,3}$/);

/** Región de espacio profundo («deep:x:y:z»). */
export const DeepIdSchema = z.string().regex(/^deep:-?\d{1,7}:-?\d{1,7}:-?\d{1,7}$/);
/** Donde se puede pilotar: un sistema estelar o una región de espacio profundo. */
const PlaceIdSchema = z.union([SystemIdSchema, DeepIdSchema]);

const CmdIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
/** Cantidad a transportar: positiva y acotada. */
const Amount = z.number().finite().min(0).max(1e7);
/** Números finitos y acotados: nada de NaN, Infinity ni coordenadas absurdas. */
const Coord = z.number().finite().min(-1e9).max(1e9);
const Vec3Schema = z.tuple([Coord, Coord, Coord]);
const QuatSchema = z.tuple([z.number().min(-1.01).max(1.01), z.number().min(-1.01).max(1.01), z.number().min(-1.01).max(1.01), z.number().min(-1.01).max(1.01)]);

/** Mensajes del cliente por el WebSocket (ver `protocol.ts`). */
const Stock4 = z.enum(["metal", "volatiles", "crystal", "alloys", "rare_metals", "exotic"]);
/** Doctrina de un Heredero (Fase 10). */
const Doctrine = z.enum(["prosperity", "bastion", "balanced"]);

export const ClientMessageSchema = z.union([
  // Economía de la humanidad y mercado (los límites finos se comprueban en el servidor).
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("market.order"),
    args: z.object({
      resource: Stock4,
      side: z.enum(["buy", "sell"]),
      price: z.number().finite().positive().max(1e6),
      quantity: z.number().int().positive().max(1e7),
      colonyId: z.uuid(),
    }),
  }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("market.cancel"), args: z.object({ orderId: z.uuid() }) }),
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("humanity.contribute"),
    args: z.object({
      projectId: z.string().regex(/^[a-z_]{1,32}$/),
      colonyId: z.uuid().optional(),
      amounts: z.object({ metal: Amount, volatiles: Amount, crystal: Amount, alloys: Amount, rare_metals: Amount, exotic: Amount }).partial().optional(),
      credits: z.number().finite().min(0).max(1e9).optional(),
    }),
  }),
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("emperor.move"),
    // `near`: llegar junto a un compañero (memoria de posición).
    args: z.object({ systemId: SystemIdSchema, near: z.uuid().optional() }),
  }),
  // Espacio profundo y minería: salir del túnel, descargar la bodega, refinería de a bordo.
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("emperor.drop"), args: z.object({}).strict() }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("flagship.unload"), args: z.object({ colonyId: z.uuid() }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("flagship.refine"), args: z.object({ on: z.boolean() }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("flagship.jettison"), args: z.object({ resource: z.enum(["volatiles", "metal", "rare_metals", "exotic"]) }) }),
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
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("fleet.tactic"), args: z.object({ fleetId: z.uuid(), tactic: z.enum(["balanced", "aggressive", "defensive", "focus"]) }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("fleet.intercept"), args: z.object({ fleetId: z.uuid(), targetFleetId: z.uuid() }) }),
  // Fase 11: tributo a una facción alienígena para borrar rencor (diplomacia básica).
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("alien.tribute"),
    args: z.object({ factionId: z.string().regex(/^[a-z_]{1,48}$/), credits: z.number().finite().min(1).max(1e7) }),
  }),
  // Fase 9b: conquista de planetas.
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("siege.start"), args: z.object({ colonyId: z.uuid() }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("siege.lift"), args: z.object({ siegeId: z.uuid() }) }),
  z.object({
    t: z.literal("cmd"),
    cmdId: CmdIdSchema,
    op: z.literal("siege.assault"),
    args: z.object({ siegeId: z.uuid(), fleetId: z.uuid().optional(), troops: z.number().int().min(1).max(1_000_000).optional() }),
  }),
  // Fase 10: muerte y linaje.
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("lineage.prefer"), args: z.object({ colonyId: z.uuid().nullable() }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("heir.gestate"), args: z.object({ colonyId: z.uuid(), doctrine: Doctrine }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("heir.doctrine"), args: z.object({ heirId: z.uuid(), doctrine: Doctrine, builds: z.boolean() }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("heir.assign"), args: z.object({ heirId: z.uuid(), colonyId: z.uuid() }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("heir.incarnate"), args: z.object({ heirId: z.uuid() }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("colony.disembark"), args: z.object({ colonyId: z.uuid(), humans: z.number().int().min(1).max(100_000) }) }),
  z.object({ t: z.literal("cmd"), cmdId: CmdIdSchema, op: z.literal("colony.embark"), args: z.object({ colonyId: z.uuid(), humans: z.number().int().min(1).max(100_000) }) }),
  z.object({ t: z.literal("sub"), topic: z.enum(["emperors", "me"]) }),
  z.object({ t: z.literal("pose"), systemId: PlaceIdSchema, p: Vec3Schema, q: QuatSchema, v: Vec3Schema }),
  z.object({ t: z.literal("leave") }),
  z.object({ t: z.literal("fire"), weapon: z.enum(["cannon", "missile"]), dir: Vec3Schema, target: z.string().max(64).optional() }),
  z.object({ t: z.literal("rift"), phase: z.enum(["charge", "cancel", "arrive"]), at: Vec3Schema, q: QuatSchema }),
  z.object({ t: z.literal("mine"), asteroid: z.number().int().min(0).max(999).nullable() }),
]);

// --- Wiki: panel de edición (solo administradores) ---

const WikiSlugSchema = z.string().max(WIKI_SLUG_MAX).regex(WIKI_SLUG_RE);
/** Markdown de un artículo: texto (el renderizador de la Wiki escapa todo HTML), sin caracteres nulos. */
const WikiBodySchema = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, "\n"))
  .pipe(z.string().max(WIKI_BODY_MAX).refine((s) => !s.includes("\u0000")));
const WikiNoteSchema = z
  .string()
  .transform((s) => s.replace(/\s+/gu, " ").trim())
  .pipe(z.string().max(WIKI_NOTE_MAX))
  .default("");

/** Cuerpo de `POST /api/wiki/save`. `baseRevisionId`: la revisión publicada sobre la que se editó (null: la del repositorio). */
export const WikiSaveBodySchema = z.object({
  slug: WikiSlugSchema,
  locale: LocaleSchema,
  body: WikiBodySchema,
  note: WikiNoteSchema,
  baseRevisionId: z.number().int().positive().nullable(),
});
export type WikiSaveBody = z.input<typeof WikiSaveBodySchema>;

/** Cuerpo de `POST /api/wiki/restore`: publica de nuevo el texto de una revisión anterior. */
export const WikiRestoreBodySchema = z.object({
  revisionId: z.number().int().positive(),
  note: WikiNoteSchema,
});
export type WikiRestoreBody = z.input<typeof WikiRestoreBodySchema>;

/** Cuerpo de `POST /api/wiki/create`: artículo nuevo (su primera revisión es el título). */
export const WikiCreateBodySchema = z.object({
  slug: WikiSlugSchema,
  group: z.enum(WIKI_GROUPS),
  locale: LocaleSchema,
  title: z
    .string()
    .transform((s) => s.replace(/\s+/gu, " ").trim())
    .pipe(z.string().min(1).max(WIKI_TITLE_MAX)),
});
export type WikiCreateBody = z.input<typeof WikiCreateBodySchema>;

/** Cuerpo de `POST /api/wiki/meta`: ocultar o mostrar un artículo, o cambiarlo de grupo. */
export const WikiMetaBodySchema = z
  .object({
    slug: WikiSlugSchema,
    hidden: z.boolean().optional(),
    group: z.enum(WIKI_GROUPS).optional(),
  })
  .refine((b) => b.hidden !== undefined || b.group !== undefined);
export type WikiMetaBody = z.input<typeof WikiMetaBodySchema>;
