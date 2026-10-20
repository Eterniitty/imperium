import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Esquema de la base de datos. Tras cambiarlo: `pnpm --filter @imperium/server db:generate`
 * crea la migración SQL en `apps/server/drizzle/`, que el servidor aplica al arrancar.
 */

/** Cuentas de jugador. Se crean al canjear el primer enlace de acceso. */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Correo normalizado (minúsculas, sin espacios). */
  email: text("email").notNull().unique(),
  locale: text("locale").notNull().default("es"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/**
 * Enlaces de acceso pendientes. Solo se guarda el hash SHA-256 del token: quien
 * lea la base de datos no puede usar los enlaces.
 */
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    locale: text("locale").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    requestIp: text("request_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("magic_link_tokens_expires_at_idx").on(t.expiresAt)],
);

/** Sesiones abiertas. Igual que con los enlaces, solo se guarda el hash del identificador. */
export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_account_id_idx").on(t.accountId)],
);

/**
 * Emperadores: uno por cuenta. Solo se guarda el sistema donde está; su nombre y
 * su posición se deducen del generador procedural, que es determinista.
 */
export const emperors = pgTable("emperors", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  /** Nombre tal y como lo escribió el jugador (normalizado a NFC). */
  name: text("name").notNull(),
  /** Nombre en forma comparable (NFKC y minúsculas): impide "Aurelia" y "AURELIA" a la vez. */
  nameKey: text("name_key").notNull().unique(),
  /** Sistema donde está, o del que salió si está viajando: "sx:sy:sz:indice". */
  systemId: text("system_id").notNull(),
  /**
   * Viaje: destino y horas de salida y llegada (las tres o ninguna). Si la
   * llegada ya pasó, el Emperador está en el destino aunque la fila no se haya
   * actualizado: se normaliza en la siguiente escritura.
   */
  destSystemId: text("dest_system_id"),
  departAt: timestamp("depart_at", { withTimezone: true }),
  arriveAt: timestamp("arrive_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("emperors_travel_complete", sql`(${t.destSystemId} IS NULL) = (${t.departAt} IS NULL) AND (${t.departAt} IS NULL) = (${t.arriveAt} IS NULL)`),
]);
