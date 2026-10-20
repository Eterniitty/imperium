import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
