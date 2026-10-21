import { sql } from "drizzle-orm";
import { bigserial, boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  /** Versión de los términos y la privacidad aceptada (LEGAL_VERSION) y cuándo. */
  termsVersion: text("terms_version"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
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
    /** Versión de los términos aceptada al pedir el enlace; pasa a la cuenta al canjearlo. */
    termsVersion: text("terms_version"),
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
  /**
   * Quién puede ver dónde está: "public" (todos), "allies" (solo compañeros, es
   * decir, aliados mutuos) o "hidden" (nadie). Lo aplica el servidor al enviar.
   */
  visibility: text("visibility").notNull().default("allies"),
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
  /**
   * Humanos en la nave del Emperador a la hora `humansAt` (Ley II: los genera
   * sola hasta su capacidad; el valor actual se resuelve con `@imperium/sim`).
   */
  humans: doublePrecision("humans").notNull().default(200),
  humansAt: timestamp("humans_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("emperors_humans_nonnegative", sql`${t.humans} >= 0`),
  check("emperors_visibility", sql`${t.visibility} IN ('public', 'allies', 'hidden')`),
  check("emperors_travel_complete", sql`(${t.destSystemId} IS NULL) = (${t.departAt} IS NULL) AND (${t.departAt} IS NULL) = (${t.arriveAt} IS NULL)`),
]);

/**
 * Flotas: grupos de naves de un Emperador que viajan juntos. Igual que los
 * Emperadores, guardan el sistema donde están (o de donde salieron) y el viaje.
 */
export const fleets = pgTable(
  "fleets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    /** Número dentro del imperio: Flota 1, Flota 2… */
    number: integer("number").notNull(),
    systemId: text("system_id").notNull(),
    destSystemId: text("dest_system_id"),
    departAt: timestamp("depart_at", { withTimezone: true }),
    arriveAt: timestamp("arrive_at", { withTimezone: true }),
    /** Batalla en la que combate (Fase 9a); null si no está en ninguna. */
    battleId: uuid("battle_id").references((): AnyPgColumn => battles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("fleets_emperor_number_unique").on(t.emperorId, t.number),
    index("fleets_battle_id_idx").on(t.battleId),
    index("fleets_system_id_idx").on(t.systemId),
    check("fleets_travel_complete", sql`(${t.destSystemId} IS NULL) = (${t.departAt} IS NULL) AND (${t.departAt} IS NULL) = (${t.arriveAt} IS NULL)`),
  ],
);

/** Naves. Cada una pertenece a una flota; su clase es un id de `@imperium/content`. */
export const ships = pgTable(
  "ships",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    fleetId: uuid("fleet_id")
      .notNull()
      .references(() => fleets.id, { onDelete: "cascade" }),
    classId: text("class_id").notNull(),
    hull: integer("hull").notNull(),
    /** Humanos a bordo (los colonos de un colonizador). */
    humans: integer("humans").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ships_fleet_id_idx").on(t.fleetId), check("ships_humans_nonnegative", sql`${t.humans} >= 0`)],
);

/**
 * Cola de eventos programados (llegadas, fin de construcciones…). Un trabajador
 * los toma con `FOR UPDATE SKIP LOCKED` cuando vencen y los borra al procesarlos,
 * en la misma transacción. Ver docs/arquitectura.md §5.
 */
export const scheduledEvents = pgTable(
  "scheduled_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scheduled_events_due_at_idx").on(t.dueAt)],
);

/**
 * Compañeros: cada fila dice que `emperorId` ha añadido a `allyId`. Son
 * compañeros cuando la relación existe en los dos sentidos.
 */
export const emperorAllies = pgTable(
  "emperor_allies",
  {
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    allyId: uuid("ally_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.emperorId, t.allyId] }), index("emperor_allies_ally_id_idx").on(t.allyId), check("emperor_allies_not_self", sql`${t.emperorId} <> ${t.allyId}`)],
);

/**
 * Niebla de guerra: sistemas que ha descubierto cada Emperador (con su nave o
 * sus flotas). Solo de estos puede pedir el detalle (planetas, recursos…).
 */
export const discoveries = pgTable(
  "discoveries",
  {
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    /** Sistema descubierto: "sx:sy:sz:indice". */
    systemId: text("system_id").notNull(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.emperorId, t.systemId] })],
);

// --- Fase 7: colonias y economía ---

/**
 * Colonias: un planeta reclamado. El dueño (`emperorId`) puede cambiar (Fase 9:
 * conquista), así que el planeta es la clave natural (un dueño por planeta).
 * Población y existencias se guardan resueltas a la hora `resolvedAt`; el valor
 * actual se calcula con `@imperium/sim` (resolución perezosa).
 */
export const colonies = pgTable(
  "colonies",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
    planetIndex: integer("planet_index").notNull(),
    /** Nombre puesto por el dueño (normalizado a NFC); null = la designación del planeta. */
    name: text("name"),
    population: doublePrecision("population").notNull(),
    metal: doublePrecision("metal").notNull().default(0),
    volatiles: doublePrecision("volatiles").notNull().default(0),
    crystal: doublePrecision("crystal").notNull().default(0),
    alloys: doublePrecision("alloys").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
    foundedAt: timestamp("founded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("colonies_planet_unique").on(t.systemId, t.planetIndex),
    index("colonies_emperor_id_idx").on(t.emperorId),
    check(
      "colonies_stock_nonnegative",
      sql`${t.population} >= 0 AND ${t.metal} >= 0 AND ${t.volatiles} >= 0 AND ${t.crystal} >= 0 AND ${t.alloys} >= 0`,
    ),
  ],
);

/** Instalaciones construidas: una fila por instalación (la Fase 9 las conquistará una a una). */
export const installations = pgTable(
  "installations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    colonyId: uuid("colony_id")
      .notNull()
      .references(() => colonies.id, { onDelete: "cascade" }),
    /** Id de `INSTALLATIONS` en `@imperium/content`. */
    kind: text("kind").notNull(),
    builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("installations_colony_id_idx").on(t.colonyId)],
);

/**
 * Cola de construcción de cada colonia. Se paga al encargar; solo la primera
 * (por `seq`) está en marcha, con `startedAt`/`finishAt` y un evento
 * `colony.build` programado para su fin.
 */
export const colonyBuilds = pgTable(
  "colony_builds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Orden de la cola. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    colonyId: uuid("colony_id")
      .notNull()
      .references(() => colonies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    itemId: text("item_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishAt: timestamp("finish_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("colony_builds_colony_id_idx").on(t.colonyId, t.seq), check("colony_builds_kind", sql`${t.kind} IN ('installation', 'ship')`)],
);

/**
 * Libro de recursos, solo inserción (docs/arquitectura.md §7): un asiento por
 * cada cambio discreto (fundación, encargo, colonos que embarcan…). La
 * producción continua no se asienta: es la resolución perezosa. Sin claves
 * ajenas, para que los asientos sobrevivan a lo que describen; un disparador
 * (en la migración) impide modificarlos o borrarlos.
 */
export const resourceLedger = pgTable(
  "resource_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    emperorId: uuid("emperor_id"),
    colonyId: uuid("colony_id"),
    /** foundation | build | colonizer_boarding… */
    reason: text("reason").notNull(),
    /** Detalle: id de la instalación o clase de nave, de la flota… */
    ref: text("ref"),
    metal: doublePrecision("metal").notNull().default(0),
    volatiles: doublePrecision("volatiles").notNull().default(0),
    crystal: doublePrecision("crystal").notNull().default(0),
    alloys: doublePrecision("alloys").notNull().default(0),
    /** Humanos que entran (+) o salen (−) de la colonia. */
    humans: doublePrecision("humans").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resource_ledger_colony_id_idx").on(t.colonyId), index("resource_ledger_emperor_id_idx").on(t.emperorId)],
);

/**
 * Bodega de una flota (Fase 8): recursos y pasajeros que transporta. La
 * capacidad sale de sus naves (`cargo` y `SHIP_PASSENGERS` en content).
 */
export const fleetCargo = pgTable(
  "fleet_cargo",
  {
    fleetId: uuid("fleet_id")
      .primaryKey()
      .references(() => fleets.id, { onDelete: "cascade" }),
    metal: doublePrecision("metal").notNull().default(0),
    volatiles: doublePrecision("volatiles").notNull().default(0),
    crystal: doublePrecision("crystal").notNull().default(0),
    alloys: doublePrecision("alloys").notNull().default(0),
    humans: doublePrecision("humans").notNull().default(0),
  },
  (t) => [check("fleet_cargo_nonnegative", sql`${t.metal} >= 0 AND ${t.volatiles} >= 0 AND ${t.crystal} >= 0 AND ${t.alloys} >= 0 AND ${t.humans} >= 0`)],
);

/**
 * Ruta de transporte automática de una flota entre dos colonias propias: en
 * el origen carga lo indicado, en el destino lo descarga todo, y vuelve. Se
 * borra si la flota recibe otra orden o una de las colonias deja de existir.
 */
export const fleetRoutes = pgTable("fleet_routes", {
  fleetId: uuid("fleet_id")
    .primaryKey()
    .references(() => fleets.id, { onDelete: "cascade" }),
  fromColonyId: uuid("from_colony_id")
    .notNull()
    .references(() => colonies.id, { onDelete: "cascade" }),
  toColonyId: uuid("to_colony_id")
    .notNull()
    .references(() => colonies.id, { onDelete: "cascade" }),
  /** Recursos a cargar en el origen, en orden de prioridad. */
  carry: jsonb("carry").notNull(),
  /** Si también lleva pasajeros (humanos) del origen al destino. */
  humans: boolean("humans").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Fase 9a: combate de flotas ---

/**
 * Batallas de flotas en un sistema, resueltas por rondas (evento
 * `battle.round`). Las flotas que combaten llevan `fleets.battle_id`; una
 * orden de viaje la saca (huye). Se conservan al terminar, como historial.
 */
export const battles = pgTable(
  "battles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    systemId: text("system_id").notNull(),
    /** Semilla de las rondas (cada una deriva la suya con `battleRoundSeed`). */
    seed: integer("seed").notNull(),
    /** Rondas resueltas. */
    round: integer("round").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** Hora de la siguiente ronda (null al terminar). */
    nextRoundAt: timestamp("next_round_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("battles_system_id_idx").on(t.systemId)],
);

/** Bandos de una batalla: un Emperador por bando (0 o 1) y su resultado al terminar. */
export const battleSides = pgTable(
  "battle_sides",
  {
    battleId: uuid("battle_id")
      .notNull()
      .references(() => battles.id, { onDelete: "cascade" }),
    side: integer("side").notNull(),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    /** won | lost | fled | draw; null mientras dura. */
    outcome: text("outcome"),
  },
  (t) => [
    primaryKey({ columns: [t.battleId, t.side] }),
    index("battle_sides_emperor_id_idx").on(t.emperorId),
    check("battle_sides_side", sql`${t.side} IN (0, 1)`),
    check("battle_sides_outcome", sql`${t.outcome} IS NULL OR ${t.outcome} IN ('won', 'lost', 'fled', 'draw')`),
  ],
);

/**
 * Informe de cada ronda: daño y pérdidas por bando (`{ dealt, absorbed, lost }`,
 * índices 0 y 1). Solo cifras y clases de nave, sin datos de los jugadores.
 */
export const battleRounds = pgTable(
  "battle_rounds",
  {
    battleId: uuid("battle_id")
      .notNull()
      .references(() => battles.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    report: jsonb("report").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.round] })],
);
