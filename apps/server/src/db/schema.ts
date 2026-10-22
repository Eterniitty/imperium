import { sql } from "drizzle-orm";
import { EMPEROR_FLAGSHIP, FLAGSHIP_SUPPLIES } from "@imperium/content";
import type { ShipDesignSnapshot } from "@imperium/shared";
import { bigint, bigserial, boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  /** Cuenta del jugador. Null solo en los actores de la IA (`kind` distinto de "player"). */
  accountId: uuid("account_id")
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
  /** Autogestión de las colonias por la IA mientras el jugador no está (`colony.autoGovern`, evento `colony.govern`). */
  autoGovern: boolean("auto_govern").notNull().default(false),
  /** Fuego amigo: con false (por defecto), sus disparos y choques no dañan a sus compañeros. */
  friendlyFire: boolean("friendly_fire").notNull().default(false),
  /** Cuenta de pruebas: combustible infinito (ni el pulso ni los saltos lo gastan). Solo se pone a mano en la base de datos. */
  infiniteFuel: boolean("infinite_fuel").notNull().default(false),
  /**
   * Fase 11: "player" (un jugador), "ai" (Emperador humano de la IA) o "alien"
   * (actor de una facción alienígena: sus flotas usan las mismas tablas y
   * órdenes que las de los jugadores). Los "alien" no salen en la lista de Emperadores.
   */
  kind: text("kind").notNull().default("player"),
  /** Reputación ante la humanidad (`REPUTATION`). */
  reputation: doublePrecision("reputation").notNull().default(0),
  /** Experiencia del rango del Emperador (`RANKS`; no se pierde al morir). */
  xp: integer("xp").notNull().default(0),
  /** Tecnología investigada (`TECH_TREES` → nivel). */
  tech: jsonb("tech").$type<Record<string, number>>().notNull().default({}),
  /** Investigación en marcha: rama, nivel al que llega y cuándo termina (ms). */
  research: jsonb("research").$type<{ tree: string; level: number; finishAt: number }>(),
  /** Facción alienígena del actor (solo con kind "alien"; id de `FACTIONS`). */
  factionId: text("faction_id").unique(),
  /**
   * Sistema donde está, o del que salió si está viajando: "sx:sy:sz:indice"; o
   * una región de espacio profundo, "deep:x:y:z", si salió del túnel a mitad de viaje.
   */
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
  /**
   * Nave aparcada (nadie la pilota): dónde estaba, en metros dentro de su sistema,
   * a la hora `parkAt`. Desde ahí orbita la estrella (`@imperium/sim` park.ts).
   * Las cuatro o ninguna: sin ellas, aparca en el sitio por defecto del sistema.
   */
  parkX: doublePrecision("park_x"),
  parkY: doublePrecision("park_y"),
  parkZ: doublePrecision("park_z"),
  parkAt: timestamp("park_at", { withTimezone: true }),
  /**
   * Resto de la nave aparcada: cuerpo al que va anclada (`park_x/y/z` es entonces
   * el desplazamiento desde su centro), orientación y si se dejó con los motores
   * encendidos (`ParkedOrbit` de `@imperium/sim`). Null: orbita la estrella.
   */
  parkExtra: jsonb("park_extra").$type<{ anchor?: { planet: number; moon?: number }; q?: [number, number, number, number]; engines?: boolean; travel?: { from: [number, number, number]; until: number }; spin?: number; dock?: { fleetId: string; slot: number; colonyPlanet: number | null; at?: [number, number, number] | null } }>(),
  /**
   * Recursos de la nave (ver FLAGSHIP_SUPPLIES en content): combustible a la hora
   * `fuelAt` (la reserva de emergencia se regenera sola desde ahí) y munición a la
   * hora `ammoAt`. La energía no se guarda: el reactor la recarga en segundos.
   */
  fuel: doublePrecision("fuel").notNull().default(FLAGSHIP_SUPPLIES.fuelMax),
  fuelAt: timestamp("fuel_at", { withTimezone: true }).notNull().defaultNow(),
  cannonAmmo: integer("cannon_ammo").notNull().default(1500),
  missiles: integer("missiles").notNull().default(6),
  ammoAt: timestamp("ammo_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Fase 10: casco de la nave (el mismo en el combate pilotado y en el de flotas
   * por rondas). El espacio local lo lleva en memoria y lo guarda con los recursos.
   */
  flagshipHull: doublePrecision("flagship_hull").notNull().default(EMPEROR_FLAGSHIP.hull),
  /**
   * Bodega de la nave: lo minado en el espacio profundo, { recurso: unidades }
   * (capacidad en `FLAGSHIP_HOLD`). Se descarga en colonias propias.
   */
  hold: jsonb("hold").notNull().default({}),
  /**
   * Fase 10: muerto y gestándose (las dos o ninguna). Mientras, la nave no está
   * en ningún sitio y el Emperador no puede moverse ni pilotar; el evento
   * `lineage.rebirth` lo hace renacer a la hora `rebornAt`.
   */
  deadAt: timestamp("dead_at", { withTimezone: true }),
  rebornAt: timestamp("reborn_at", { withTimezone: true }),
  /** Colonia con Cuna elegida al morir para renacer (se vuelve a comprobar al renacer). Sin clave ajena. */
  rebirthColonyId: uuid("rebirth_colony_id"),
  /** Racha de muertes seguidas a la hora `lastDeathAt` (se olvida con el tiempo, `@imperium/sim` lineage.ts). */
  deathStreak: integer("death_streak").notNull().default(0),
  lastDeathAt: timestamp("last_death_at", { withTimezone: true }),
  /** Generación del linaje: sube con cada cuerpo nuevo (renacer o encarnarse). */
  generation: integer("generation").notNull().default(1),
  /** Última vez que se encarnó en un Heredero (enfriamiento). */
  incarnatedAt: timestamp("incarnated_at", { withTimezone: true }),
  /** Cuna preferida para renacer (colonia propia con Cuna; se comprueba al morir). Sin clave ajena. */
  preferredCradleId: uuid("preferred_cradle_id"),
  /** Herederos gestados (para ponerles nombre en orden). */
  heirsBorn: integer("heirs_born").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("emperors_kind", sql`${t.kind} IN ('player', 'ai', 'alien') AND (${t.kind} = 'player') = (${t.accountId} IS NOT NULL) AND (${t.kind} = 'alien') = (${t.factionId} IS NOT NULL)`),
  check("emperors_humans_nonnegative", sql`${t.humans} >= 0`),
  check("emperors_visibility", sql`${t.visibility} IN ('public', 'allies', 'hidden')`),
  check("emperors_dead_complete", sql`(${t.deadAt} IS NULL) = (${t.rebornAt} IS NULL)`),
  check("emperors_flagship_hull", sql`${t.flagshipHull} >= 0`),
  check("emperors_travel_complete", sql`(${t.destSystemId} IS NULL) = (${t.departAt} IS NULL) AND (${t.departAt} IS NULL) = (${t.arriveAt} IS NULL)`),
  check(
    "emperors_park_complete",
    sql`(${t.parkX} IS NULL) = (${t.parkAt} IS NULL) AND (${t.parkY} IS NULL) = (${t.parkAt} IS NULL) AND (${t.parkZ} IS NULL) = (${t.parkAt} IS NULL)`,
  ),
]);

/**
 * Memoria de posición: el último sitio (metros, coordenadas del sistema) donde
 * estuvo la nave de un Emperador en cada sistema. Se guarda al saltar fuera,
 * al aparcar y cada cierto tiempo mientras se pilota; al volver a ese sistema,
 * la nave llega ahí. Los compañeros pueden pedir llegar junto a ella.
 */
/** Sondas de exploración en vuelo (orden `probe.launch`); se borran al llegar (evento `probe.arrive`). */
export const probes = pgTable(
  "probes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
    fromX: doublePrecision("from_x").notNull(),
    fromY: doublePrecision("from_y").notNull(),
    fromZ: doublePrecision("from_z").notNull(),
    launchedAt: timestamp("launched_at", { withTimezone: true }).notNull(),
    arriveAt: timestamp("arrive_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("probes_emperor_id_idx").on(t.emperorId)],
);

/** Diseños de nave del editor (`docs/editor-naves.md`): casco y pieza de cada anclaje. */
export const shipDesigns = pgTable(
  "ship_designs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hullId: text("hull_id").notNull(),
    parts: jsonb("parts").$type<Record<string, string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ship_designs_emperor_id_idx").on(t.emperorId)],
);

/** Contratos de mercenarios (`MERCENARIES`): la flota contratada y cuándo se marcha. */
export const mercenaryContracts = pgTable(
  "mercenary_contracts",
  {
    fleetId: uuid("fleet_id")
      .primaryKey()
      .references(() => fleets.id, { onDelete: "cascade" }),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    offerId: text("offer_id").notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("mercenary_contracts_emperor_id_idx").on(t.emperorId)],
);

export const systemParks = pgTable(
  "system_parks",
  {
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    z: doublePrecision("z").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.emperorId, t.systemId] })],
);

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
    /** Nombre que le ha puesto su dueño (null: «Flota N»). */
    name: text("name"),
    /**
     * Dónde está dentro de su sistema (m): donde llegó de un salto (por el borde,
     * como una nave) o donde la dejaron. Null: en el punto de reunión (`rally.ts`).
     */
    localP: jsonb("local_p").$type<[number, number, number]>(),
    systemId: text("system_id").notNull(),
    destSystemId: text("dest_system_id"),
    departAt: timestamp("depart_at", { withTimezone: true }),
    arriveAt: timestamp("arrive_at", { withTimezone: true }),
    /** Batalla en la que combate (Fase 9a); null si no está en ninguna. */
    battleId: uuid("battle_id").references((): AnyPgColumn => battles.id, { onDelete: "set null" }),
    /** Táctica en las batallas por rondas (`FLEET_TACTICS`). */
    tactic: text("tactic").notNull().default("balanced"),
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
    /** Nave del Astillero: foto de su diseño (nombre, casco, piezas); `class_id` es la clase base del casco. */
    design: jsonb("design").$type<ShipDesignSnapshot>(),
    /** Combustible (años luz de alcance); null = depósito lleno (`FLEET_FUEL`). */
    fuel: doublePrecision("fuel"),
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

/** Leyendas de la era (`LEGENDS`): quién logró primero cada hazaña. Se borra con su Emperador (RGPD). */
export const legends = pgTable("legends", {
  id: text("id").primaryKey(),
  emperorId: uuid("emperor_id")
    .notNull()
    .references(() => emperors.id, { onDelete: "cascade" }),
  emperorName: text("emperor_name").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/** Crisis galácticas (`CRISES`): cada fila es una, con su principio y su fin. */
export const crises = pgTable("crises", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
});

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
 * Alta con compañero: una cuenta sin Emperador pide aparecer cerca de un
 * Emperador existente. Una por cuenta (se reemplaza al pedir otra). Si el
 * compañero acepta, al crear el Emperador aparece en un sistema inicial
 * cercano al suyo y quedan como compañeros; la fila se borra entonces.
 */
export const companionRequests = pgTable(
  "companion_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    accountId: uuid("account_id")
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    /** Nombre que quiere para su Emperador (para que el compañero sepa quién es; no lo reserva). */
    name: text("name").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [index("companion_requests_target_id_idx").on(t.targetId), check("companion_requests_status", sql`${t.status} IN ('pending', 'accepted', 'rejected')`)],
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
    /**
     * Dueño. Null = colonia independiente: su Emperador borró la cuenta. Queda
     * congelada (nadie la resuelve: ni produce ni gasta) hasta que alguien la
     * conquiste (Fase 9b), que debe poner `resolved_at` a la hora de la conquista.
     */
    emperorId: uuid("emperor_id").references(() => emperors.id, { onDelete: "set null" }),
    systemId: text("system_id").notNull(),
    planetIndex: integer("planet_index").notNull(),
    /** Nombre puesto por el dueño (normalizado a NFC); null = la designación del planeta. */
    name: text("name"),
    population: doublePrecision("population").notNull(),
    metal: doublePrecision("metal").notNull().default(0),
    volatiles: doublePrecision("volatiles").notNull().default(0),
    crystal: doublePrecision("crystal").notNull().default(0),
    alloys: doublePrecision("alloys").notNull().default(0),
    /** Minados en el espacio profundo (nunca los produce la colonia). */
    rare_metals: doublePrecision("rare_metals").notNull().default(0),
    exotic: doublePrecision("exotic").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
    foundedAt: timestamp("founded_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Fase 9b: cuándo pasó a su dueño actual por conquista (null = la fundó él).
     * La capital es la colonia más antigua *para su dueño* (coalesce con `foundedAt`).
     */
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    /**
     * Fase 10: doctrina del Heredero que la gobierna (null = sin gobernador). Copia
     * de `heirs.doctrine` del Heredero nacido de esta colonia: la resolución de la
     * economía la lee sin consultar otra tabla. Al cambiar, se resuelve antes.
     */
    governor: text("governor"),
    /** Inventario de componentes fabricados (`COMPONENT_IDS` → unidades). */
    items: jsonb("items").$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [
    unique("colonies_planet_unique").on(t.systemId, t.planetIndex),
    index("colonies_emperor_id_idx").on(t.emperorId),
    check(
      "colonies_stock_nonnegative",
      sql`${t.population} >= 0 AND ${t.metal} >= 0 AND ${t.volatiles} >= 0 AND ${t.crystal} >= 0 AND ${t.alloys} >= 0 AND ${t.rare_metals} >= 0 AND ${t.exotic} >= 0`,
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
    /** Encargo de un diseño del Astillero: su foto al encargarlo. */
    design: jsonb("design").$type<ShipDesignSnapshot>(),
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
    /** foundation | build | colonizer_boarding | cancel | battle_loss | independence… */
    reason: text("reason").notNull(),
    /** Detalle: id de la instalación o clase de nave, de la flota… */
    ref: text("ref"),
    metal: doublePrecision("metal").notNull().default(0),
    volatiles: doublePrecision("volatiles").notNull().default(0),
    crystal: doublePrecision("crystal").notNull().default(0),
    alloys: doublePrecision("alloys").notNull().default(0),
    rare_metals: doublePrecision("rare_metals").notNull().default(0),
    exotic: doublePrecision("exotic").notNull().default(0),
    /** Humanos que entran (+) o salen (−) de la colonia. */
    humans: doublePrecision("humans").notNull().default(0),
    /** Créditos que entran (+) o salen (−) de la cartera del Emperador (o del tesoro, sin Emperador ni colonia). */
    credits: doublePrecision("credits").notNull().default(0),
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
    /** Componentes fabricados en la bodega (ocupan sitio como los recursos). */
    items: jsonb("items").$type<Record<string, number>>().notNull().default({}),
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

// --- Economía de la humanidad y mercado global ---

/** Cantidades de los recursos almacenables (progreso, envíos…). */
const stockColumns = () => ({
  metal: doublePrecision("metal").notNull().default(0),
  volatiles: doublePrecision("volatiles").notNull().default(0),
  crystal: doublePrecision("crystal").notNull().default(0),
  alloys: doublePrecision("alloys").notNull().default(0),
  rare_metals: doublePrecision("rare_metals").notNull().default(0),
  exotic: doublePrecision("exotic").notNull().default(0),
});

/**
 * Cartera de créditos de cada Emperador, resuelta perezosamente: `credits` es
 * el saldo a la hora `settledAt` y `incomePerHour` la renta bruta (por hora de
 * juego) de sus colonias; el Emperador cobra la parte neta y el tesoro el
 * aporte. `summary` guarda, del último recálculo, sus agregados (colonias,
 * población, existencias y tasas) para los de toda la humanidad.
 */
export const emperorWallets = pgTable(
  "emperor_wallets",
  {
    emperorId: uuid("emperor_id")
      .primaryKey()
      .references(() => emperors.id, { onDelete: "cascade" }),
    credits: doublePrecision("credits").notNull(),
    incomePerHour: doublePrecision("income_per_hour").notNull().default(0),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    summary: jsonb("summary").notNull().default({}),
  },
  (t) => [check("emperor_wallets_nonnegative", sql`${t.credits} >= 0 AND ${t.incomePerHour} >= 0`)],
);

/**
 * Tesoro común del Núcleo Humano (una sola fila, id 1): saldo a la hora
 * `settledAt` y aportes por hora de juego (la suma de los de todas las carteras).
 */
export const humanityTreasury = pgTable(
  "humanity_treasury",
  {
    id: integer("id").primaryKey(),
    credits: doublePrecision("credits").notNull().default(0),
    incomePerHour: doublePrecision("income_per_hour").notNull().default(0),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("humanity_treasury_single", sql`${t.id} = 1`), check("humanity_treasury_nonnegative", sql`${t.credits} >= 0`)],
);

/**
 * Proyectos comunes de la humanidad (fichas en `@imperium/content`): niveles
 * completados y recursos ya aportados para el siguiente. Los créditos los
 * paga el tesoro cuando están todos los recursos (evento `humanity.fund`).
 */
export const humanityProjects = pgTable("humanity_projects", {
  projectId: text("project_id").primaryKey(),
  level: integer("level").notNull().default(0),
  ...stockColumns(),
  /** Hora de la próxima comprobación de fondos programada (null si no hay). */
  fundCheckAt: timestamp("fund_check_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/** Aportes a los proyectos comunes (al llegar al Núcleo), para el reconocimiento de cada Emperador. */
export const humanityContributions = pgTable(
  "humanity_contributions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Null si el Emperador borró su cuenta: el aporte se queda, anónimo. */
    emperorId: uuid("emperor_id").references(() => emperors.id, { onDelete: "set null" }),
    projectId: text("project_id").notNull(),
    ...stockColumns(),
    credits: doublePrecision("credits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("humanity_contributions_project_idx").on(t.projectId), index("humanity_contributions_emperor_idx").on(t.emperorId)],
);

/**
 * Órdenes abiertas del mercado global. Al crearla se retiene lo que se ofrece:
 * los recursos de una venta salen de su colonia y los créditos de una compra
 * de la cartera (`escrowCredits`). Al casarse del todo o cancelarse, se borra.
 */
export const marketOrders = pgTable(
  "market_orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Orden de llegada: a igual precio, gana la más antigua. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    /** Colonia de origen (venta) o de destino (compra) de los recursos. */
    colonyId: uuid("colony_id")
      .notNull()
      .references(() => colonies.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    side: text("side").notNull(),
    price: doublePrecision("price").notNull(),
    quantity: integer("quantity").notNull(),
    remaining: integer("remaining").notNull(),
    escrowCredits: doublePrecision("escrow_credits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("market_orders_book_idx").on(t.resource, t.side, t.price),
    index("market_orders_emperor_idx").on(t.emperorId),
    check("market_orders_side", sql`${t.side} IN ('buy', 'sell')`),
    check("market_orders_resource", sql`${t.resource} IN ('metal', 'volatiles', 'crystal', 'alloys', 'rare_metals', 'exotic')`),
    check("market_orders_amounts", sql`${t.price} > 0 AND ${t.remaining} > 0 AND ${t.remaining} <= ${t.quantity} AND ${t.escrowCredits} >= 0`),
  ],
);

/** Operaciones casadas: el historial de precios. Las partes quedan anónimas si borran su cuenta. */
export const marketTrades = pgTable(
  "market_trades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    resource: text("resource").notNull(),
    price: doublePrecision("price").notNull(),
    quantity: integer("quantity").notNull(),
    buyerId: uuid("buyer_id").references(() => emperors.id, { onDelete: "set null" }),
    sellerId: uuid("seller_id").references(() => emperors.id, { onDelete: "set null" }),
    buyerColonyId: uuid("buyer_colony_id"),
    sellerColonyId: uuid("seller_colony_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("market_trades_history_idx").on(t.resource, t.createdAt),
    index("market_trades_buyer_idx").on(t.buyerId),
    index("market_trades_seller_idx").on(t.sellerId),
  ],
);

/**
 * Envíos de recursos por la red del Núcleo: lo comprado en el mercado (de la
 * colonia del vendedor a la del comprador) y los aportes a los proyectos (de
 * una colonia al Núcleo). Llegan con el evento `shipment.arrive`.
 */
export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    /** Destinatario (compra) o quien aporta (proyecto). Null si borró su cuenta. */
    emperorId: uuid("emperor_id").references(() => emperors.id, { onDelete: "set null" }),
    fromColonyId: uuid("from_colony_id"),
    fromSystemId: text("from_system_id").notNull(),
    toColonyId: uuid("to_colony_id"),
    toSystemId: text("to_system_id"),
    projectId: text("project_id"),
    tradeId: bigint("trade_id", { mode: "number" }),
    ...stockColumns(),
    departAt: timestamp("depart_at", { withTimezone: true }).notNull(),
    arriveAt: timestamp("arrive_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("shipments_emperor_idx").on(t.emperorId), check("shipments_kind", sql`${t.kind} IN ('trade', 'contribution')`)],
);

// --- Fase 11: facciones alienígenas (IA) ---

/**
 * Territorio ganado por la expansión lenta de las facciones alienígenas. La
 * capa base es determinista (`@imperium/procgen` territory.ts) y no se guarda;
 * aquí solo los sistemas que se han sumado después.
 */
export const alienClaims = pgTable(
  "alien_claims",
  {
    systemId: text("system_id").primaryKey(),
    factionId: text("faction_id").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alien_claims_faction_idx").on(t.factionId)],
);

/**
 * Regiones de territorio donde la IA está despierta: se activan cuando un
 * humano se acerca y se duermen tras `ALIEN_AI.activeHours` sin actividad.
 * Mientras están activas, un evento `ai.region` decide cada cierto tiempo.
 */
export const alienRegions = pgTable("alien_regions", {
  regionKey: text("region_key").primaryKey(),
  factionId: text("faction_id").notNull(),
  activeUntil: timestamp("active_until", { withTimezone: true }).notNull(),
  /** Hay un evento `ai.region` programado para esta región. */
  ticking: boolean("ticking").notNull().default(false),
  lastSpawnAt: timestamp("last_spawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Flotas alienígenas y la región a la que pertenecen (su guarnición). */
export const alienFleets = pgTable(
  "alien_fleets",
  {
    fleetId: uuid("fleet_id")
      .primaryKey()
      .references(() => fleets.id, { onDelete: "cascade" }),
    regionKey: text("region_key").notNull(),
  },
  (t) => [index("alien_fleets_region_idx").on(t.regionKey)],
);

/**
 * Relación de cada facción con cada Emperador (diplomacia básica): el rencor
 * sube al interceptar sus flotas o colonizar su territorio, se olvida con el
 * tiempo y se puede pagar con tributos. Con `ALIEN_AI.grudge.hostileAt`, una
 * facción neutral se vuelve hostil a ese Emperador.
 */
export const alienStandings = pgTable(
  "alien_standings",
  {
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    factionId: text("faction_id").notNull(),
    /** Rencor a la hora `updatedAt` (decae linealmente desde entonces). */
    grudge: doublePrecision("grudge").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.emperorId, t.factionId] }), check("alien_standings_grudge", sql`${t.grudge} >= 0`)],
);

// --- Fase 9b: conquista de planetas ---

/**
 * Asedios de colonias (Fase 9b). Como mucho uno en curso por colonia. El
 * progreso (0 → 1) se resuelve hasta `resolvedAt` en cada evento `siege.tick`;
 * con el progreso completo, el atacante puede desembarcar tropas
 * (`siege.assault`). Se conservan al terminar, como historial.
 */
export const sieges = pgTable(
  "sieges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    colonyId: uuid("colony_id")
      .notNull()
      .references(() => colonies.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
    attackerId: uuid("attacker_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    /** Dueño de la colonia al empezar (null = independiente, o borró su cuenta). */
    defenderId: uuid("defender_id").references(() => emperors.id, { onDelete: "set null" }),
    /** Semilla de las resoluciones (daño de las defensas, pérdidas de la captura). */
    seed: integer("seed").notNull(),
    /** Resoluciones hechas (cada una deriva su semilla). */
    step: integer("step").notNull().default(0),
    progress: doublePrecision("progress").notNull().default(0),
    /** Hora hasta la que está resuelto el progreso. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
    /** advancing | contested | battle | ready (ver `SiegeState`). */
    state: text("state").notNull().default("advancing"),
    /** Fuerza, defensa y defensores de la última resolución (para mostrarlos). */
    attack: doublePrecision("attack").notNull().default(0),
    defense: doublePrecision("defense").notNull().default(0),
    defenders: integer("defenders").notNull().default(0),
    /** Último desembarco (informe `SiegeAssaultReport`). */
    lastAssault: jsonb("last_assault"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    nextTickAt: timestamp("next_tick_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** captured | broken | lifted | void; null mientras dura. */
    outcome: text("outcome"),
  },
  (t) => [
    uniqueIndex("sieges_active_colony_idx").on(t.colonyId).where(sql`${t.endedAt} IS NULL`),
    index("sieges_attacker_idx").on(t.attackerId),
    index("sieges_defender_idx").on(t.defenderId),
    index("sieges_system_idx").on(t.systemId),
    check("sieges_state", sql`${t.state} IN ('advancing', 'contested', 'battle', 'ready')`),
    check("sieges_outcome", sql`${t.outcome} IS NULL OR ${t.outcome} IN ('captured', 'broken', 'lifted', 'void')`),
    check("sieges_progress", sql`${t.progress} >= 0 AND ${t.progress} <= 1`),
  ],
);

/**
 * Fase 10: Herederos del linaje. Se gestan en la Cuna de una colonia propia y
 * la gobiernan (uno por colonia) con la doctrina elegida; el Emperador puede
 * encarnarse en ellos. Si la colonia cambia de manos, el Heredero muere.
 */
export const heirs = pgTable(
  "heirs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    colonyId: uuid("colony_id")
      .notNull()
      .references(() => colonies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** prosperity | bastion | balanced (`HEIR_DOCTRINES`). */
    doctrine: text("doctrine").notNull(),
    /** Su gobernador encarga instalaciones cuando la cola está vacía. */
    builds: boolean("builds").notNull().default(true),
    /** gestating | active. */
    state: text("state").notNull().default("gestating"),
    /** Cuándo nace (mientras se gesta). */
    readyAt: timestamp("ready_at", { withTimezone: true }),
    /** Flota que manda como comandante (`COMMANDER_BONUS`), o null. */
    fleetId: uuid("fleet_id").references(() => fleets.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("heirs_colony_idx").on(t.colonyId),
    index("heirs_emperor_idx").on(t.emperorId),
    check("heirs_state", sql`${t.state} IN ('gestating', 'active')`),
    check("heirs_doctrine", sql`${t.doctrine} IN ('prosperity', 'bastion', 'balanced')`),
  ],
);

/** Fase 10: muertes de los Emperadores (historial del linaje; van en la exportación de datos). */
export const emperorDeaths = pgTable(
  "emperor_deaths",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    systemId: text("system_id").notNull(),
    /** combat (tiempo real) | battle (flotas por rondas). */
    cause: text("cause").notNull(),
    /** Quién lo derribó (nombre; vacío o null si fue un pirata o no se sabe). */
    killer: text("killer"),
    streak: integer("streak").notNull(),
    diedAt: timestamp("died_at", { withTimezone: true }).notNull(),
    rebornAt: timestamp("reborn_at", { withTimezone: true }).notNull(),
    /** cradle | core | heir, al renacer (null mientras se gesta). */
    rebirthKind: text("rebirth_kind"),
    rebirthSystemId: text("rebirth_system_id"),
  },
  (t) => [
    index("emperor_deaths_emperor_idx").on(t.emperorId, t.diedAt),
    check("emperor_deaths_cause", sql`${t.cause} IN ('combat', 'battle')`),
    check("emperor_deaths_rebirth", sql`${t.rebirthKind} IS NULL OR ${t.rebirthKind} IN ('cradle', 'core', 'heir')`),
  ],
);

/**
 * Wiki: revisiones de los artículos editados desde el panel de administración.
 * Solo inserción (un disparador de la migración impide modificarlas o borrarlas;
 * solo permite dejar anónimo al autor). La versión publicada de un artículo en
 * un idioma es su última revisión; si no tiene, el Markdown del repositorio.
 * Al borrar la cuenta del autor, la revisión se conserva (es contenido público)
 * con el autor anónimo.
 */
export const wikiRevisions = pgTable(
  "wiki_revisions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    slug: text("slug").notNull(),
    locale: text("locale").notNull(),
    /** Markdown completo del artículo. */
    body: text("body").notNull(),
    note: text("note").notNull().default(""),
    authorId: uuid("author_id").references(() => accounts.id, { onDelete: "set null" }),
    /** Nombre del Emperador (o correo enmascarado) al editar; null si la cuenta se borró. */
    authorLabel: text("author_label"),
    /** Revisión cuyo texto se restauró, si esta es una restauración. */
    restoredFrom: bigint("restored_from", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wiki_revisions_article_idx").on(t.slug, t.locale, t.id),
    index("wiki_revisions_author_idx").on(t.authorId),
    check("wiki_revisions_locale", sql`${t.locale} IN ('es', 'en')`),
  ],
);

/**
 * Wiki: datos de los artículos creados desde el panel y de los del repositorio a
 * los que se cambió el grupo del índice o se ocultaron.
 */
export const wikiPages = pgTable(
  "wiki_pages",
  {
    slug: text("slug").primaryKey(),
    group: text("group").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    /** Creado desde el panel (no está en el repositorio). */
    custom: boolean("custom").notNull().default(false),
    /** Orden de los artículos nuevos dentro de su grupo. */
    position: integer("position").notNull().default(0),
    /** Firma bajo el título (los libros: su autor). */
    byline: text("byline"),
    /** Tipo de atribución del libro (`WIKI_BYLINE_KINDS`); null: «Escrito por». */
    bylineKind: text("byline_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("wiki_pages_group", sql`${t.group} IN ('start', 'world', 'ship', 'empire', 'war', 'people', 'lore', 'books')`)],
);

/**
 * Wiki: registro de quién cambió qué (ediciones, restauraciones, artículos
 * nuevos, ocultar y mostrar, cambios de grupo). Solo inserción, como las revisiones.
 */
export const wikiLog = pgTable(
  "wiki_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** save | restore | create | hide | show | group */
    action: text("action").notNull(),
    slug: text("slug").notNull(),
    locale: text("locale"),
    revisionId: bigint("revision_id", { mode: "number" }),
    /** Detalle (p. ej. el grupo nuevo). */
    detail: text("detail"),
    authorId: uuid("author_id").references(() => accounts.id, { onDelete: "set null" }),
    authorLabel: text("author_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wiki_log_slug_idx").on(t.slug, t.id),
    index("wiki_log_author_idx").on(t.authorId),
    check("wiki_log_action", sql`${t.action} IN ('save', 'restore', 'create', 'hide', 'show', 'group', 'byline')`),
  ],
);

// --- Espacio profundo y minería ---

/**
 * Asteroides minados de las regiones de espacio profundo: lo extraído de cada
 * uno (`mined`) a la hora `at`; desde ahí se regenera solo (`asteroidLeft` de
 * `@imperium/sim`). Solo hay fila para los que alguien ha minado; el contenido
 * de la región es determinista (semilla secreta) y no se guarda.
 */
export const asteroidDepletion = pgTable(
  "asteroid_depletion",
  {
    regionId: text("region_id").notNull(),
    asteroid: integer("asteroid").notNull(),
    mined: doublePrecision("mined").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.regionId, t.asteroid] }), check("asteroid_depletion_mined", sql`${t.mined} >= 0`)],
);

/**
 * Contratos aceptados (`docs/juego-solitario.md`): tipo, objetivo y progreso,
 * recompensa, estado y plazo. Las ofertas no se guardan (se generan cada día);
 * `offer_id` (día:índice) impide aceptar dos veces la misma.
 */
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emperorId: uuid("emperor_id")
      .notNull()
      .references(() => emperors.id, { onDelete: "cascade" }),
    offerId: text("offer_id").notNull(),
    kind: text("kind").notNull(),
    target: integer("target").notNull(),
    progress: doublePrecision("progress").notNull().default(0),
    credits: integer("credits").notNull(),
    reputation: integer("reputation").notNull().default(0),
    status: text("status").notNull().default("active"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [index("contracts_emperor_id_idx").on(t.emperorId), unique("contracts_emperor_offer_unique").on(t.emperorId, t.offerId)],
);
