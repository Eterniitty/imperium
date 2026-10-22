import {
  ECONOMY,
  getHull,
  getRecipe,
  techBonus,
  type ComponentAmounts,
  type TechLevels,
  getInstallation,
  getShipClass,
  HUMANS,
  SHIP_HUMAN_CAPACITY,
  type InstallationId,
  type ShipClassId,
  type StockAmounts,
  type StockId,
} from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { distance, type Colony, type ColonyBuild, type CommandError, type EmperorHumans, type Planet, type PlanetClaim, type ShipDesignSnapshot, type StarSystemDetail, type StarSystemSummary } from "@imperium/shared";
import { PlanetNameSchema } from "@imperium/shared/schemas";
import {
  addComponents,
  canAfford,
  captureLosses,
  designMeetsTech,
  hasComponents,
  designStats,
  isBuildable,
  colonyEnergy,
  doctrineExtraction,
  colonyFlows,
  flagshipHumansAfter,
  gameHours,
  installationAllowed,
  missingInstallations,
  isTravelling,
  minColonists,
  netRates,
  pay,
  populationCap,
  populationGrowthPerHour,
  realDurationMs,
  NO_BONUSES,
  resolveColony,
  upkeepShortage,
  type HumanityBonuses,
  type ColonySite,
  type ColonyState,
  type InstallationCounts,
} from "@imperium/sim";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, colonyBuilds, discoveries, emperors, fleetRoutes, fleets, heirs, installations, mercenaryContracts, resourceLedger, shipDesigns, ships } from "../db/schema";
import { discoverAround, type Discovered } from "../discovery/service";
import { findSystem, placeFromRow } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";

type ColonyRow = typeof colonies.$inferSelect;
type BuildRow = typeof colonyBuilds.$inferSelect;

export type ClaimArgs = { systemId: string; planetIndex: number; humans?: number; fleetId?: string };
export type ClaimResult =
  | { ok: true; emperorId: string; colonyId: string; /** Flota cuyo colonizador se consumió (o null si desembarcó el Emperador). */ fleetId: string | null }
  | { ok: false; error: CommandError };
export type ColonyResult = { ok: true; emperorId: string; colonyId: string } | { ok: false; error: CommandError };

/** Lo que ha cambiado al terminar una construcción, para avisar al dueño. */
export interface BuildDone {
  emperorId: string;
  colonyId: string;
  /** Flota nueva con la nave construida. */
  fleetId: string | null;
  discovered: Discovered | null;
  /** Capital cuyo mantenimiento cambió (al aparecer una nave nueva), si es otra colonia. */
  capitalId: string | null;
}

/** Otro lo reclamó a la vez: se lanza para deshacer la transacción entera. */
class PlanetTaken extends Error {}

/** Margen para dar por terminada una construcción cuyo evento se procesa un instante antes de tiempo. */
const FINISH_TOLERANCE_MS = 1_000;
/** Detalles de sistema guardados en memoria (se generan con la semilla secreta y no cambian). */
const DETAIL_CACHE = 2_000;

/** Coste de un diseño del Astillero: recursos de la colonia y créditos de la cartera. */
function designCost(design: ShipDesignSnapshot): { stock: StockAmounts; credits: number } {
  const c = designStats(design).cost;
  return { stock: { metal: c.metal, volatiles: 0, crystal: c.crystal, alloys: c.alloys, rare_metals: c.rare_metals, exotic: c.exotic }, credits: c.credits };
}

/** Fracción del tiempo de construcción con la tecnología de industria (−5 % por nivel). */
function industryFactor(tech: TechLevels | undefined): number {
  return Math.max(0.5, 2 - techBonus(tech, "industry"));
}

/** Recursos de una receta de la Fábrica (por tanda). */
function recipeStock(id: string): StockAmounts {
  return { ...ZERO_STOCK, ...(getRecipe(id)?.inputs ?? {}) };
}

/** Componentes que gasta un encargo (receta o diseño). */
function buildComponents(build: { kind: string; itemId: string; design?: ShipDesignSnapshot | null }): ComponentAmounts | undefined {
  if (build.kind === "craft") return getRecipe(build.itemId)?.components;
  if (build.kind === "design" && build.design) return designStats(build.design).components;
  return undefined;
}

/** Horas de construcción de un encargo (instalación, nave de serie, diseño o tanda de la Fábrica). */
function buildHours(build: { kind: string; itemId: string; design?: ShipDesignSnapshot | null }): number {
  if (build.kind === "craft") return getRecipe(build.itemId)?.hours ?? 1;
  if (build.kind === "design") return (build.design && getHull(build.design.hullId)?.buildTimeHours) || 8;
  const def = build.kind === "installation" ? getInstallation(build.itemId) : getShipClass(build.itemId as ShipClassId);
  return def?.buildTimeHours ?? 1;
}

/** Reembolso al cancelar un encargo: todo si no había empezado, una parte si sí. */
function refundOf(build: { kind: string; itemId: string; startedAt: Date | null; design?: ShipDesignSnapshot | null }): StockAmounts {
  if (build.kind === "design") return scaled(build.design ? designCost(build.design).stock : scaled(ZERO_STOCK, 0), build.startedAt ? ECONOMY.cancelRefundStarted : 1);
  if (build.kind === "craft") return scaled(recipeStock(build.itemId), build.startedAt ? ECONOMY.cancelRefundStarted : 1);
  const def = build.kind === "installation" ? getInstallation(build.itemId) : getShipClass(build.itemId as ShipClassId);
  const cost: StockAmounts = def ? { ...{ metal: 0, volatiles: 0, crystal: 0, alloys: 0, rare_metals: 0, exotic: 0 }, ...def.cost } : { metal: 0, volatiles: 0, crystal: 0, alloys: 0, rare_metals: 0, exotic: 0 };
  return scaled(cost, build.startedAt ? ECONOMY.cancelRefundStarted : 1);
}
/** Existencias iniciales de una colonia con el multiplicador de las subvenciones (sin pasar del almacén). */
function foundingStock(multiplier: number): StockAmounts {
  const out = { ...ECONOMY.foundingStock };
  for (const k of Object.keys(out) as Array<keyof StockAmounts>) out[k] = Math.min(ECONOMY.storage[k], Math.round(out[k] * multiplier));
  return out;
}
const ZERO_STOCK: StockAmounts = { metal: 0, volatiles: 0, crystal: 0, alloys: 0, rare_metals: 0, exotic: 0 };
const stockOf = (r: Pick<ColonyRow, StockId>): StockAmounts => ({ metal: r.metal, volatiles: r.volatiles, crystal: r.crystal, alloys: r.alloys, rare_metals: r.rare_metals, exotic: r.exotic });
const negate = (s: StockAmounts): StockAmounts => ({ metal: -s.metal, volatiles: -s.volatiles, crystal: -s.crystal, alloys: -s.alloys, rare_metals: -s.rare_metals, exotic: -s.exotic });
const scaled = (s: StockAmounts, k: number): StockAmounts => ({ metal: s.metal * k, volatiles: s.volatiles * k, crystal: s.crystal * k, alloys: s.alloys * k, rare_metals: s.rare_metals * k, exotic: s.exotic * k });

/** Lo que necesita el Astillero de la cartera de créditos. */
export interface Wallet {
  spend(tx: Tx, emperorId: string, amount: number, reason: string, ref: string | null, at: number): Promise<boolean>;
  credit(tx: Tx, emperorId: string, amount: number, reason: string, ref: string | null): Promise<void>;
}

/**
 * Humanos, colonias y economía (Fase 7). Las reglas están en `@imperium/sim`
 * y los datos en `@imperium/content`; aquí, la lectura y escritura en la base
 * de datos, siempre resolviendo antes el estado a la hora actual.
 */
export class ColonyService {
  private readonly seed: number;
  private readonly timeScale: number;
  private readonly details = new Map<string, StarSystemDetail>();
  /** Bonificaciones de los proyectos comunes de la humanidad (las pone `HumanityService`). */
  private bonuses: () => HumanityBonuses = () => NO_BONUSES;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    /** Detalle de un sistema (con la semilla secreta): `DiscoveryService.detail`. */
    private readonly detailOf: (summary: StarSystemSummary) => StarSystemDetail,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
    this.timeScale = config.TIME_SCALE;
  }

  /** Enlaza las bonificaciones globales de la humanidad (extracción, fundación). */
  setBonuses(get: () => HumanityBonuses): void {
    this.bonuses = get;
  }

  /** Crisis galácticas: el auge industrial acorta lo que se encarga. */
  crisis: { factor(effect: "buildTime"): number } | null = null;

  /** Cartera de créditos (`HumanityService`): los diseños del Astillero cuestan créditos además de recursos. */
  private wallet: Wallet | null = null;
  setWallet(wallet: Wallet): void {
    this.wallet = wallet;
  }

  private detail(systemId: string): StarSystemDetail | null {
    let d = this.details.get(systemId);
    if (!d) {
      const summary = findSystem(this.seed, systemId);
      if (!summary) return null;
      d = this.detailOf(summary);
      if (this.details.size >= DETAIL_CACHE) this.details.clear();
      this.details.set(systemId, d);
    }
    return d;
  }

  private planet(systemId: string, index: number): { detail: StarSystemDetail; planet: Planet } | null {
    const detail = this.detail(systemId);
    const planet = detail?.planets.find((p) => p.index === index);
    return detail && planet ? { detail, planet } : null;
  }

  /** Designación de un planeta (para las vistas de los asedios). */
  planetName(systemId: string, index: number): string {
    return this.planet(systemId, index)?.planet.name ?? `${systemId}/${index}`;
  }

  // --- Humanos de la nave del Emperador ---

  private humansView(count: number, at: number): EmperorHumans {
    return { count, capacity: HUMANS.flagshipCapacity, perHour: HUMANS.flagshipPerHour * this.timeScale, at };
  }

  /** Humanos que lleva ahora la nave del Emperador. */
  async humans(emperorId: string): Promise<EmperorHumans | null> {
    const [row] = await this.db.select({ humans: emperors.humans, humansAt: emperors.humansAt }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    if (!row) return null;
    const now = this.now();
    return this.humansView(flagshipHumansAfter(row.humans, gameHours(row.humansAt.getTime(), now, this.timeScale)), now);
  }

  // --- Lectura de colonias ---

  private async installationCounts(db: Database | Tx, colonyIds: string[]): Promise<Map<string, InstallationCounts>> {
    const out = new Map<string, InstallationCounts>();
    if (colonyIds.length === 0) return out;
    const rows = await db
      .select({ colonyId: installations.colonyId, kind: installations.kind, n: sql<number>`count(*)::int` })
      .from(installations)
      .where(inArray(installations.colonyId, colonyIds))
      .groupBy(installations.colonyId, installations.kind);
    for (const r of rows) {
      const counts = out.get(r.colonyId) ?? {};
      counts[r.kind as InstallationId] = r.n;
      out.set(r.colonyId, counts);
    }
    return out;
  }

  private async buildsOf(db: Database | Tx, colonyIds: string[]): Promise<BuildRow[]> {
    if (colonyIds.length === 0) return [];
    return db.select().from(colonyBuilds).where(inArray(colonyBuilds.colonyId, colonyIds)).orderBy(asc(colonyBuilds.seq));
  }

  private site(row: ColonyRow, counts: InstallationCounts, extraUpkeep = 0): (ColonySite & { planet: Planet }) | null {
    const found = this.planet(row.systemId, row.planetIndex);
    if (!found) return null;
    // Fase 10: el Heredero que la gobierna (su doctrina) también multiplica la extracción; fuera de la red de suministro, menos.
    const extractionMultiplier = this.bonuses().extraction * doctrineExtraction(row.governor) * (this.isIsolated(row) ? ECONOMY.isolatedExtraction : 1);
    return { planet: found.planet, starEnergy: found.detail.energy, installations: counts, extraUpkeep, extractionMultiplier };
  }

  // --- Red de suministro (Fase 8) ---

  /** Colonias aisladas de cada Emperador (en caché un minuto: solo cambia al ganar o perder colonias). */
  private supply = new Map<string, { at: number; isolated: Set<string>; loading: boolean }>();

  /** ¿Está esta colonia fuera de la red de suministro? Sin dato todavía, se la da por abastecida y se calcula. */
  private isIsolated(row: ColonyRow): boolean {
    if (!row.emperorId) return false;
    const c = this.supply.get(row.emperorId);
    if (!c || (!c.loading && this.now() - c.at > 60_000)) void this.refreshSupply(row.emperorId).catch(() => undefined);
    return c?.isolated.has(row.id) ?? false;
  }

  /** Recalcula la red: desde la capital, en cadena, las colonias a `supplyRangeLy` unas de otras. */
  async refreshSupply(emperorId: string): Promise<void> {
    const prev = this.supply.get(emperorId);
    if (prev?.loading) return;
    const entry = { at: this.now(), isolated: prev?.isolated ?? new Set<string>(), loading: true };
    this.supply.set(emperorId, entry);
    try {
      const rows = await this.db
        .select({ id: colonies.id, systemId: colonies.systemId })
        .from(colonies)
        .where(eq(colonies.emperorId, emperorId))
        .orderBy(sql`coalesce(${colonies.acquiredAt}, ${colonies.foundedAt})`, asc(colonies.id));
      const at = rows.map((r) => ({ id: r.id, p: findSystem(this.seed, r.systemId)?.position ?? null }));
      const reached = new Set<string>();
      const queue = at.length && at[0]!.p ? [at[0]!] : [];
      if (queue[0]) reached.add(queue[0].id);
      while (queue.length) {
        const cur = queue.shift()!;
        for (const o of at) {
          if (reached.has(o.id) || !o.p || !cur.p || distance(cur.p, o.p) > ECONOMY.supplyRangeLy) continue;
          reached.add(o.id);
          queue.push(o);
        }
      }
      entry.isolated = new Set(at.filter((o) => !reached.has(o.id)).map((o) => o.id));
    } catch (err) {
      entry.at = 0;
      throw err;
    } finally {
      entry.loading = false;
    }
  }

  // --- Mantenimiento de las flotas: lo paga la capital ---

  /** Capital del Emperador: su colonia más antigua (o null si no tiene). */
  private async capitalId(db: Database | Tx, emperorId: string): Promise<string | null> {
    const [row] = await db
      .select({ id: colonies.id })
      .from(colonies)
      .where(eq(colonies.emperorId, emperorId))
      // La más antigua para su dueño: las conquistadas cuentan desde la conquista (Fase 9b).
      .orderBy(sql`coalesce(${colonies.acquiredAt}, ${colonies.foundedAt})`, asc(colonies.id))
      .limit(1);
    return row?.id ?? null;
  }

  /** Mantenimiento por hora de juego de todas las naves de las flotas del Emperador (los mercenarios no: lo cubre su contrato). */
  private async fleetUpkeep(db: Database | Tx, emperorId: string): Promise<number> {
    const rows = await db
      .select({ classId: ships.classId, n: sql<number>`count(*)::int` })
      .from(ships)
      .innerJoin(fleets, eq(fleets.id, ships.fleetId))
      .leftJoin(mercenaryContracts, eq(mercenaryContracts.fleetId, fleets.id))
      .where(and(eq(fleets.emperorId, emperorId), isNull(mercenaryContracts.fleetId)))
      .groupBy(ships.classId);
    let total = 0;
    for (const r of rows) total += (getShipClass(r.classId as ShipClassId)?.upkeepVolatilesPerHour ?? 0) * r.n;
    return total;
  }

  /** Mantenimiento extra de una colonia: el de las flotas si es la capital, si no 0. */
  private async extraUpkeepOf(db: Database | Tx, row: ColonyRow): Promise<number> {
    if (!row.emperorId) return 0;
    return (await this.capitalId(db, row.emperorId)) === row.id ? this.fleetUpkeep(db, row.emperorId) : 0;
  }

  /**
   * Antes de cambiar las naves del Emperador (nueva nave, colonizador gastado),
   * la capital se resuelve hasta `at` con el mantenimiento de antes. Devuelve
   * su id si la resolvió (para avisar a su dueño), o null.
   */
  async settleCapital(tx: Tx, emperorId: string, at: number, skipColonyId?: string): Promise<string | null> {
    const id = await this.capitalId(tx, emperorId);
    if (!id || id === skipColonyId) return null;
    const [row] = await tx.select().from(colonies).where(eq(colonies.id, id)).for("update").limit(1);
    if (!row || row.resolvedAt.getTime() >= at) return null;
    const counts = (await this.installationCounts(tx, [id])).get(id) ?? {};
    const site = this.site(row, counts, await this.fleetUpkeep(tx, emperorId));
    if (!site) return null;
    const state = this.resolve(row, site, at);
    await tx.update(colonies).set({ population: state.population, ...state.stock, resolvedAt: new Date(at) }).where(eq(colonies.id, id));
    return id;
  }

  /** Estado de una colonia resuelto a la hora `at` (no antes de su `resolvedAt`). */
  private resolve(row: ColonyRow, site: ColonySite, at: number): ColonyState {
    const hours = gameHours(row.resolvedAt.getTime(), at, this.timeScale);
    return resolveColony({ population: row.population, stock: stockOf(row) }, site, hours);
  }

  private toColony(row: ColonyRow, counts: InstallationCounts, builds: BuildRow[], now: number, extraUpkeep: number, capital: boolean): Colony | null {
    const site = this.site(row, counts, extraUpkeep);
    if (!site) return null;
    const state = this.resolve(row, site, now);
    const cap = populationCap(site.planet.habitability);
    const flows = colonyFlows(site.planet, site.starEnergy, counts, state.population, extraUpkeep, site.extractionMultiplier);
    const energy = colonyEnergy(site.starEnergy, counts);
    const installed: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) if (v) installed[k] = v;
    return {
      id: row.id,
      systemId: row.systemId,
      systemName: findSystem(this.seed, row.systemId)?.name ?? row.systemId,
      planetIndex: row.planetIndex,
      planetName: site.planet.name,
      name: row.name,
      population: state.population,
      populationCap: cap,
      populationPerHour: populationGrowthPerHour(state.population, cap) * this.timeScale,
      stock: state.stock,
      storage: { ...ECONOMY.storage },
      ratesPerHour: scaled(netRates(state.stock, flows), this.timeScale),
      energy: { produced: energy.produced, consumed: energy.consumed },
      upkeepPerHour: flows.upkeep * this.timeScale,
      capital,
      shortage: upkeepShortage(state.stock, flows),
      isolated: this.isIsolated(row),
      installations: installed,
      items: { ...row.items },
      builds: builds.map(
        (b): ColonyBuild => ({
          id: b.id,
          kind: b.kind as ColonyBuild["kind"],
          itemId: b.itemId,
          ...(b.design ? { design: b.design } : {}),
          startedAt: b.startedAt?.getTime() ?? null,
          finishAt: b.finishAt?.getTime() ?? null,
        }),
      ),
      at: now,
      foundedAt: row.foundedAt.getTime(),
    };
  }

  private async toColonies(rows: ColonyRow[]): Promise<Colony[]> {
    const ids = rows.map((r) => r.id);
    const [counts, builds] = await Promise.all([this.installationCounts(this.db, ids), this.buildsOf(this.db, ids)]);
    // Capital y mantenimiento de flotas de cada Emperador que aparece.
    const capitals = new Map<string, { id: string | null; upkeep: number }>();
    for (const emperorId of new Set(rows.map((r) => r.emperorId))) {
      if (!emperorId) continue;
      capitals.set(emperorId, { id: await this.capitalId(this.db, emperorId), upkeep: await this.fleetUpkeep(this.db, emperorId) });
    }
    const now = this.now();
    const out: Colony[] = [];
    for (const r of rows) {
      const cap = r.emperorId ? capitals.get(r.emperorId) : undefined;
      const isCapital = cap?.id === r.id;
      const c = this.toColony(
        r,
        counts.get(r.id) ?? {},
        builds.filter((b) => b.colonyId === r.id),
        now,
        isCapital ? cap!.upkeep : 0,
        isCapital,
      );
      if (c) out.push(c);
    }
    return out;
  }

  /** Colonias de un Emperador (privado: solo para su dueño). */
  async list(emperorId: string): Promise<Colony[]> {
    const rows = await this.db.select().from(colonies).where(eq(colonies.emperorId, emperorId)).orderBy(asc(colonies.foundedAt), asc(colonies.id));
    return this.toColonies(rows);
  }

  /** Una colonia, si es de `emperorId` (si no, null: para avisar a su antiguo dueño de que la ha perdido). */
  async byId(emperorId: string, colonyId: string): Promise<Colony | null> {
    const rows = await this.db
      .select()
      .from(colonies)
      .where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId)))
      .limit(1);
    return (await this.toColonies(rows))[0] ?? null;
  }

  /**
   * Dueño y nombre de los planetas reclamados de un sistema. Es territorio, no
   * posición: lo puede ver quien haya descubierto el sistema (lo comprueba quien llama).
   */
  async claims(systemId: string): Promise<PlanetClaim[]> {
    const rows = await this.db
      .select({ colonyId: colonies.id, planetIndex: colonies.planetIndex, name: colonies.name, ownerId: colonies.emperorId, ownerName: emperors.name, ownerFactionId: emperors.factionId })
      .from(colonies)
      // Sin dueño (cuenta borrada): colonia independiente, con ownerId y ownerName null.
      .leftJoin(emperors, eq(emperors.id, colonies.emperorId))
      .where(eq(colonies.systemId, systemId))
      .orderBy(asc(colonies.planetIndex));
    // La facción solo va si el dueño es alienígena (el hábitat de los Nómadas).
    return rows.map(({ ownerFactionId, ...r }) => (ownerFactionId ? { ...r, ownerFactionId } : r));
  }

  // --- Órdenes ---

  /**
   * Reclama un planeta libre: desembarca humanos de la nave del Emperador (que
   * tiene que estar en el sistema, no de viaje) o los colonos de un colonizador
   * de una flota propia parada allí (el colonizador se consume). Funda la
   * colonia con las existencias iniciales y lo asienta en el libro.
   */
  async claim(emperorId: string, args: ClaimArgs): Promise<ClaimResult> {
    const system = findSystem(this.seed, args.systemId);
    if (!system) return { ok: false, error: "unknown_system" };
    const found = this.planet(system.id, args.planetIndex);

    return this.db.transaction(async (tx): Promise<ClaimResult> => {
      const [known] = await tx
        .select({ systemId: discoveries.systemId })
        .from(discoveries)
        .where(and(eq(discoveries.emperorId, emperorId), eq(discoveries.systemId, system.id)))
        .limit(1);
      if (!known) return { ok: false, error: "not_discovered" };
      if (!found) return { ok: false, error: "unknown_planet" };
      const [taken] = await tx
        .select({ id: colonies.id })
        .from(colonies)
        .where(and(eq(colonies.systemId, system.id), eq(colonies.planetIndex, args.planetIndex)))
        .limit(1);
      if (taken) return { ok: false, error: "planet_owned" };

      const need = minColonists(found.planet.habitability);
      const now = this.now();
      let humans: number;
      let fleetId: string | null = null;

      if (args.fleetId) {
        const [fleet] = await tx
          .select({ id: fleets.id, systemId: fleets.systemId, destSystemId: fleets.destSystemId, departAt: fleets.departAt, arriveAt: fleets.arriveAt, battleId: fleets.battleId })
          .from(fleets)
          .where(and(eq(fleets.id, args.fleetId), eq(fleets.emperorId, emperorId)))
          .for("update")
          .limit(1);
        if (!fleet) return { ok: false, error: "no_fleet" };
        const place = placeFromRow(this.seed, fleet, now);
        if (isTravelling(place, now)) return { ok: false, error: "in_transit" };
        if (place.location.systemId !== system.id) return { ok: false, error: "not_present" };
        if (fleet.battleId) return { ok: false, error: "in_battle" };
        // El colonizador con más colonos.
        const [ship] = await tx
          .select({ id: ships.id, humans: ships.humans })
          .from(ships)
          .where(and(eq(ships.fleetId, fleet.id), eq(ships.classId, "colonizer")))
          .orderBy(desc(ships.humans))
          .limit(1);
        if (!ship) return { ok: false, error: "no_colonizer" };
        if (ship.humans < need) return { ok: false, error: "not_enough_humans" };
        // El colonizador deja de costar mantenimiento: la capital se cobra hasta ahora.
        await this.settleCapital(tx, emperorId, now);
        humans = ship.humans;
        await tx.delete(ships).where(eq(ships.id, ship.id));
        const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(ships).where(eq(ships.fleetId, fleet.id));
        if (!left || left.n === 0) await tx.delete(fleets).where(eq(fleets.id, fleet.id));
        fleetId = fleet.id;
      } else {
        const [row] = await tx
          .select({
            id: emperors.id,
            systemId: emperors.systemId,
            destSystemId: emperors.destSystemId,
            departAt: emperors.departAt,
            arriveAt: emperors.arriveAt,
            humans: emperors.humans,
            humansAt: emperors.humansAt,
            deadAt: emperors.deadAt,
          })
          .from(emperors)
          .where(eq(emperors.id, emperorId))
          .for("update")
          .limit(1);
        if (!row) return { ok: false, error: "no_emperor" };
        // Fase 10: muerto (gestándose), su nave no está en ningún sitio.
        if (row.deadAt) return { ok: false, error: "dead" };
        const place = placeFromRow(this.seed, row, now);
        if (isTravelling(place, now)) return { ok: false, error: "in_transit" };
        if (place.location.systemId !== system.id) return { ok: false, error: "not_present" };
        humans = args.humans ?? need;
        const aboard = flagshipHumansAfter(row.humans, gameHours(row.humansAt.getTime(), now, this.timeScale));
        if (humans < need || humans > aboard) return { ok: false, error: "not_enough_humans" };
        await tx
          .update(emperors)
          .set({ humans: aboard - humans, humansAt: new Date(now) })
          .where(eq(emperors.id, emperorId));
      }

      // Sin objetivo de conflicto: si otro lo reclamó a la vez, no se inserta nada y se deshace todo.
      // Las subvenciones del Núcleo (proyecto común) aumentan las existencias iniciales.
      const stock = foundingStock(this.bonuses().founding);
      const [colony] = await tx
        .insert(colonies)
        .values({ emperorId, systemId: system.id, planetIndex: args.planetIndex, population: humans, ...stock, resolvedAt: new Date(now) })
        .onConflictDoNothing()
        .returning({ id: colonies.id });
      if (!colony) throw new PlanetTaken();
      await tx.insert(resourceLedger).values({ emperorId, colonyId: colony.id, reason: "foundation", ref: fleetId ? `fleet:${fleetId}` : "emperor", ...stock, humans });
      return { ok: true, emperorId, colonyId: colony.id, fleetId };
    }).catch((err: unknown) => {
      if (err instanceof PlanetTaken) return { ok: false, error: "planet_owned" } as const;
      throw err;
    });
  }

  /** Renombra un planeta propio. */
  async rename(emperorId: string, colonyId: string, name: string): Promise<ColonyResult> {
    const parsed = PlanetNameSchema.safeParse(name);
    if (!parsed.success) return { ok: false, error: "invalid_name" };
    const [row] = await this.db
      .update(colonies)
      .set({ name: parsed.data })
      .where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId)))
      .returning({ id: colonies.id });
    if (!row) return { ok: false, error: "no_colony" };
    return { ok: true, emperorId, colonyId };
  }

  /**
   * Encarga una instalación o una nave. Se paga al encargarla (con las
   * existencias resueltas a esta hora) y va a la cola; si la cola estaba
   * vacía, empieza ya y se programa su fin.
   */
  async build(emperorId: string, colonyId: string, kind: "installation" | "ship" | "design" | "craft", itemId: string): Promise<ColonyResult> {
    let cost: StockAmounts;
    let hours: number;
    let requires: Partial<Record<InstallationId, number>> | undefined;
    let credits = 0;
    let design: ShipDesignSnapshot | null = null;
    if (kind === "craft") {
      // Tanda de la Fábrica: recursos y, en las cadenas, componentes.
      const recipe = getRecipe(itemId);
      if (!recipe) return { ok: false, error: "unknown_item" };
      cost = recipeStock(itemId);
      hours = recipe.hours;
      requires = recipe.requires;
    } else if (kind === "design") {
      // Diseño del Astillero: se construye la foto de ahora; tiene que poder construirse.
      const [d] = await this.db.select().from(shipDesigns).where(and(eq(shipDesigns.id, itemId), eq(shipDesigns.emperorId, emperorId))).limit(1);
      if (!d) return { ok: false, error: "unknown_design" };
      design = { name: d.name, hullId: d.hullId, parts: d.parts };
      const hull = getHull(design.hullId);
      if (!hull || !isBuildable(design)) return { ok: false, error: "design_not_buildable" };
      const [owner] = await this.db.select({ tech: emperors.tech }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
      if (!designMeetsTech(design, owner?.tech as TechLevels | undefined)) return { ok: false, error: "tech_locked" };
      const c = designCost(design);
      cost = c.stock;
      credits = c.credits;
      hours = hull.buildTimeHours;
      requires = hull.builtAt === "drydock" ? { drydock: 1 } : undefined;
    } else if (kind === "installation") {
      const def = getInstallation(itemId);
      if (!def) return { ok: false, error: "unknown_item" };
      cost = def.cost;
      hours = def.buildTimeHours;
      requires = def.requires;
    } else {
      const cls = getShipClass(itemId as ShipClassId);
      if (!cls) return { ok: false, error: "unknown_item" };
      cost = { rare_metals: 0, exotic: 0, ...cls.cost };
      hours = cls.buildTimeHours;
      requires = cls.requires;
    }

    return this.db.transaction(async (tx): Promise<ColonyResult> => {
      const [row] = await tx
        .select()
        .from(colonies)
        .where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId)))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "no_colony" };
      const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
      const queue = await this.buildsOf(tx, [row.id]);
      if (queue.length >= ECONOMY.maxQueue) return { ok: false, error: "queue_full" };
      if (kind === "installation") {
        const queued = queue.filter((b) => b.kind === "installation" && b.itemId === itemId).length;
        if (!installationAllowed(itemId as InstallationId, counts, queued)) return { ok: false, error: "limit_reached" };
      } else if (kind !== "craft" && !counts.shipyard) {
        return { ok: false, error: "needs_shipyard" };
      }
      // Instalaciones que pide (refinería, dique orbital…): tienen que estar ya construidas.
      if (missingInstallations(requires, counts).length > 0) return { ok: false, error: "needs_installation" };
      const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
      if (!site) return { ok: false, error: "unknown_planet" };
      const now = this.now();
      const state = this.resolve(row, site, now);
      if (!canAfford(state.stock, cost)) return { ok: false, error: "insufficient_resources" };
      const needComponents = buildComponents({ kind, itemId, design });
      if (!hasComponents(row.items, needComponents)) return { ok: false, error: "insufficient_components" };
      if (credits > 0 && !(await this.wallet?.spend(tx, emperorId, credits, "build", `design:${itemId}`, now))) return { ok: false, error: "insufficient_credits" };

      await tx
        .update(colonies)
        .set({ population: state.population, ...pay(state.stock, cost), items: addComponents(row.items, needComponents, -1), resolvedAt: new Date(now) })
        .where(eq(colonies.id, row.id));
      const start = queue.length === 0;
      // Tecnología de industria: se construye antes (también lo que espera en la cola, al empezar).
      const [ind] = await tx.select({ tech: emperors.tech }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
      const finishAt = now + realDurationMs(hours * industryFactor(ind?.tech as TechLevels | undefined) * (this.crisis?.factor("buildTime") ?? 1), this.timeScale);
      const [build] = await tx
        .insert(colonyBuilds)
        .values({ colonyId: row.id, kind, itemId, design, startedAt: start ? new Date(now) : null, finishAt: start ? new Date(finishAt) : null })
        .returning({ id: colonyBuilds.id });
      if (start) await schedule(tx, "colony.build", new Date(finishAt), { buildId: build!.id });
      await tx.insert(resourceLedger).values({ emperorId, colonyId: row.id, reason: "build", ref: `${kind}:${itemId}`, ...negate(cost) });
      return { ok: true, emperorId, colonyId: row.id };
    });
  }

  /**
   * Manejador del fin de una construcción (evento `colony.build`): resuelve la
   * colonia hasta la hora de fin con lo que tenía, añade la instalación o crea
   * una flota nueva con la nave en el sistema de la colonia, y pone en marcha
   * la siguiente de la cola.
   */
  async completeBuild(tx: Tx, buildId: string): Promise<BuildDone | null> {
    const [build] = await tx.select().from(colonyBuilds).where(eq(colonyBuilds.id, buildId)).for("update").limit(1);
    if (!build?.finishAt) return null;
    const now = this.now();
    if (build.finishAt.getTime() > now + FINISH_TOLERANCE_MS) {
      await schedule(tx, "colony.build", build.finishAt, { buildId });
      return null;
    }
    const [row] = await tx.select().from(colonies).where(eq(colonies.id, build.colonyId)).for("update").limit(1);
    // Las colonias independientes no construyen (sus encargos se cancelan al quedarse sin dueño).
    if (!row?.emperorId) return null;
    const emperorId = row.emperorId;
    const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
    const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
    if (!site) return null;
    const finishAt = build.finishAt.getTime();
    const at = Math.max(row.resolvedAt.getTime(), finishAt);
    const state = this.resolve(row, site, at);
    let population = state.population;
    let fleetId: string | null = null;
    let discovered: Discovered | null = null;
    let capitalId: string | null = null;

    let items = row.items;
    if (build.kind === "installation") {
      await tx.insert(installations).values({ colonyId: row.id, kind: build.itemId, builtAt: new Date(at) });
    } else if (build.kind === "craft") {
      // Tanda de la Fábrica: los componentes van al inventario de la colonia.
      const recipe = getRecipe(build.itemId);
      if (recipe) items = addComponents(items, { [recipe.id]: recipe.output });
    } else {
      // Nave de serie, o diseño del Astillero (clase base de su casco, con el casco y las plazas de sus piezas).
      const hullDef = build.kind === "design" && build.design ? getHull(build.design.hullId) : undefined;
      const cls = getShipClass((hullDef ? hullDef.baseClass : build.itemId) as ShipClassId);
      const stats = hullDef && build.design ? designStats(build.design) : null;
      if (cls && (build.kind !== "design" || stats)) {
        // La nave nueva cuesta mantenimiento desde ya: la capital (si es otra colonia) se cobra hasta aquí.
        capitalId = await this.settleCapital(tx, emperorId, at, row.id);
        // Los colonos embarcan de la colonia, dejando siempre a algunos.
        const capacity = stats ? stats.humans : (SHIP_HUMAN_CAPACITY[cls.id] ?? 0);
        const boarding = Math.max(0, Math.min(capacity, Math.floor(population - HUMANS.colonyKeep)));
        population -= boarding;
        const [last] = await tx.select({ n: sql<number>`coalesce(max(${fleets.number}), 0)::int` }).from(fleets).where(eq(fleets.emperorId, emperorId));
        const [fleet] = await tx
          .insert(fleets)
          .values({ emperorId: emperorId, number: (last?.n ?? 0) + 1, systemId: row.systemId })
          .returning({ id: fleets.id });
        await tx.insert(ships).values({ fleetId: fleet!.id, classId: cls.id, hull: stats ? stats.hull : cls.hull, humans: boarding, design: build.design ?? null });
        if (boarding > 0) {
          await tx.insert(resourceLedger).values({ emperorId: emperorId, colonyId: row.id, reason: "colonizer_boarding", ref: `fleet:${fleet!.id}`, humans: -boarding });
        }
        fleetId = fleet!.id;
        const system = findSystem(this.seed, row.systemId);
        if (system) {
          const systemIds = await discoverAround(tx, this.seed, emperorId, system, cls.scannerRangeLy);
          discovered = { emperorId: emperorId, systemIds };
        }
      }
    }
    await tx
      .update(colonies)
      .set({ population, ...state.stock, items, resolvedAt: new Date(at) })
      .where(eq(colonies.id, row.id));
    await tx.delete(colonyBuilds).where(eq(colonyBuilds.id, build.id));

    // La siguiente de la cola empieza cuando terminó esta (no cuando se procesa el evento).
    const [next] = await tx.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, row.id)).orderBy(asc(colonyBuilds.seq)).limit(1);
    if (next) {
      const nextFinish = finishAt + realDurationMs(buildHours(next), this.timeScale);
      await tx
        .update(colonyBuilds)
        .set({ startedAt: new Date(finishAt), finishAt: new Date(nextFinish) })
        .where(eq(colonyBuilds.id, next.id));
      await schedule(tx, "colony.build", new Date(nextFinish), { buildId: next.id });
    }
    return { emperorId: emperorId, colonyId: row.id, fleetId, discovered, capitalId };
  }

  /**
   * Cancela un encargo de la cola. Si aún no había empezado, se devuelve todo;
   * si estaba en construcción, la mitad, y empieza el siguiente.
   */
  async cancel(emperorId: string, colonyId: string, buildId: string): Promise<ColonyResult> {
    return this.db.transaction(async (tx): Promise<ColonyResult> => {
      const [row] = await tx
        .select()
        .from(colonies)
        .where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId)))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "no_colony" };
      const [build] = await tx
        .select()
        .from(colonyBuilds)
        .where(and(eq(colonyBuilds.id, buildId), eq(colonyBuilds.colonyId, row.id)))
        .for("update")
        .limit(1);
      if (!build) return { ok: false, error: "no_build" };
      const refund = refundOf(build);

      const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
      const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
      if (!site) return { ok: false, error: "unknown_planet" };
      const now = this.now();
      const state = this.resolve(row, site, now);
      const stock = { ...state.stock };
      for (const k of Object.keys(stock) as Array<keyof StockAmounts>) stock[k] = Math.min(ECONOMY.storage[k], stock[k] + refund[k]);
      // Los componentes vuelven al inventario (una parte si ya estaba en marcha).
      const items = addComponents(row.items, buildComponents(build), 1, build.startedAt ? ECONOMY.cancelRefundStarted : 1);
      await tx.update(colonies).set({ population: state.population, ...stock, items, resolvedAt: new Date(now) }).where(eq(colonies.id, row.id));
      await tx.delete(colonyBuilds).where(eq(colonyBuilds.id, build.id));
      await tx.insert(resourceLedger).values({ emperorId, colonyId: row.id, reason: "cancel", ref: `${build.kind}:${build.itemId}`, ...refund });
      // Los diseños devuelven también sus créditos (una parte si ya estaba en marcha).
      if (build.kind === "design" && build.design) {
        const credits = designCost(build.design).credits * (build.startedAt ? ECONOMY.cancelRefundStarted : 1);
        await this.wallet?.credit(tx, emperorId, credits, "cancel", `design:${build.itemId}`);
      }

      // Si se canceló la que estaba en marcha, empieza la siguiente (su evento programado
      // de fin, si ya lo hubiera, no encontrará la cancelada y no hará nada).
      if (build.startedAt) {
        const [next] = await tx.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, row.id)).orderBy(asc(colonyBuilds.seq)).limit(1);
        if (next) {
          const finishAt = now + realDurationMs(buildHours(next), this.timeScale);
          await tx.update(colonyBuilds).set({ startedAt: new Date(now), finishAt: new Date(finishAt) }).where(eq(colonyBuilds.id, next.id));
          await schedule(tx, "colony.build", new Date(finishAt), { buildId: next.id });
        }
      }
      return { ok: true, emperorId, colonyId: row.id };
    });
  }

  /**
   * Derriba la instalación más reciente de un tipo en una colonia propia y
   * devuelve `ECONOMY.demolishRefund` de su coste (sin pasar del almacén). Las
   * existencias se resuelven antes, con las instalaciones que había.
   */
  async demolish(emperorId: string, colonyId: string, installationId: string): Promise<ColonyResult> {
    return this.db.transaction(async (tx): Promise<ColonyResult> => {
      const [row] = await tx
        .select()
        .from(colonies)
        .where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId)))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "no_colony" };
      const def = getInstallation(installationId);
      if (!def) return { ok: false, error: "unknown_item" };
      const [target] = await tx
        .select({ id: installations.id })
        .from(installations)
        .where(and(eq(installations.colonyId, row.id), eq(installations.kind, def.id)))
        .orderBy(desc(installations.builtAt))
        .limit(1);
      if (!target) return { ok: false, error: "unknown_item" };
      const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
      const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
      if (!site) return { ok: false, error: "unknown_planet" };
      const now = this.now();
      const state = this.resolve(row, site, now);
      const refund = scaled({ ...def.cost }, ECONOMY.demolishRefund);
      const stock = { ...state.stock };
      for (const k of Object.keys(stock) as Array<keyof StockAmounts>) stock[k] = Math.min(ECONOMY.storage[k], stock[k] + refund[k]);
      await tx.update(colonies).set({ population: state.population, ...stock, resolvedAt: new Date(now) }).where(eq(colonies.id, row.id));
      await tx.delete(installations).where(eq(installations.id, target.id));
      await tx.insert(resourceLedger).values({ emperorId, colonyId: row.id, reason: "demolish", ref: `installation:${def.id}`, ...refund });
      return { ok: true, emperorId, colonyId: row.id };
    });
  }

  /**
   * Bombardeo orbital (Fase 9b, `siege.raze`): destruye la instalación más
   * reciente de un tipo, sin reembolso, dentro de la transacción del asedio.
   * Devuelve false si la colonia no la tiene.
   */
  async razeInstallation(tx: Tx, colonyId: string, installationId: string, ref: string): Promise<boolean> {
    const [row] = await tx.select().from(colonies).where(eq(colonies.id, colonyId)).for("update").limit(1);
    const def = getInstallation(installationId);
    if (!row || !def) return false;
    const [target] = await tx
      .select({ id: installations.id })
      .from(installations)
      .where(and(eq(installations.colonyId, row.id), eq(installations.kind, def.id)))
      .orderBy(desc(installations.builtAt))
      .limit(1);
    if (!target) return false;
    // Lo producido hasta ahora, con las instalaciones que tenía.
    const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
    const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
    const now = this.now();
    if (site && row.emperorId) {
      const state = this.resolve(row, site, now);
      await tx.update(colonies).set({ population: state.population, ...state.stock, resolvedAt: new Date(now) }).where(eq(colonies.id, row.id));
    }
    await tx.delete(installations).where(eq(installations.id, target.id));
    await tx.insert(resourceLedger).values({ emperorId: row.emperorId, colonyId: row.id, reason: "razed", ref: `${ref}:${def.id}` });
    return true;
  }

  /**
   * Desembarca humanos de la nave del Emperador en una colonia propia: el
   * Emperador tiene que estar en ese sistema (no viajando), y no se puede pasar
   * del tope de población del planeta.
   */
  async disembark(emperorId: string, colonyId: string, humans: number): Promise<ColonyResult> {
    return this.db.transaction(async (tx): Promise<ColonyResult> => {
      const [row] = await tx
        .select()
        .from(colonies)
        .where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId)))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "no_colony" };
      const [emp] = await tx
        .select({
          id: emperors.id,
          systemId: emperors.systemId,
          destSystemId: emperors.destSystemId,
          departAt: emperors.departAt,
          arriveAt: emperors.arriveAt,
          humans: emperors.humans,
          humansAt: emperors.humansAt,
          deadAt: emperors.deadAt,
        })
        .from(emperors)
        .where(eq(emperors.id, emperorId))
        .for("update")
        .limit(1);
      if (!emp) return { ok: false, error: "no_emperor" };
      if (emp.deadAt) return { ok: false, error: "dead" };
      const now = this.now();
      const place = placeFromRow(this.seed, emp, now);
      if (isTravelling(place, now)) return { ok: false, error: "in_transit" };
      if (place.location.systemId !== row.systemId) return { ok: false, error: "not_present" };
      const aboard = flagshipHumansAfter(emp.humans, gameHours(emp.humansAt.getTime(), now, this.timeScale));
      if (humans > aboard) return { ok: false, error: "not_enough_humans" };

      const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
      const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
      if (!site) return { ok: false, error: "unknown_planet" };
      const state = this.resolve(row, site, now);
      if (state.population + humans > populationCap(site.planet.habitability)) return { ok: false, error: "colony_full" };

      await tx.update(emperors).set({ humans: aboard - humans, humansAt: new Date(now) }).where(eq(emperors.id, emperorId));
      await tx
        .update(colonies)
        .set({ population: state.population + humans, ...state.stock, resolvedAt: new Date(now) })
        .where(eq(colonies.id, row.id));
      await tx.insert(resourceLedger).values({ emperorId, colonyId: row.id, reason: "disembark", ref: "emperor", humans });
      return { ok: true, emperorId, colonyId: row.id };
    });
  }

  /**
   * Embarca humanos de una colonia propia en la nave del Emperador (la inversa
   * de `disembark`): el Emperador tiene que estar en ese sistema (no viajando),
   * la nave no pasa de su capacidad y en la colonia quedan siempre al menos
   * `HUMANS.colonyKeep` (como cuando embarcan colonos en un colonizador).
   */
  async embark(emperorId: string, colonyId: string, humans: number): Promise<ColonyResult> {
    return this.db.transaction(async (tx): Promise<ColonyResult> => {
      const [row] = await tx
        .select()
        .from(colonies)
        .where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId)))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "no_colony" };
      const [emp] = await tx
        .select({
          id: emperors.id,
          systemId: emperors.systemId,
          destSystemId: emperors.destSystemId,
          departAt: emperors.departAt,
          arriveAt: emperors.arriveAt,
          humans: emperors.humans,
          humansAt: emperors.humansAt,
          deadAt: emperors.deadAt,
        })
        .from(emperors)
        .where(eq(emperors.id, emperorId))
        .for("update")
        .limit(1);
      if (!emp) return { ok: false, error: "no_emperor" };
      if (emp.deadAt) return { ok: false, error: "dead" };
      const now = this.now();
      const place = placeFromRow(this.seed, emp, now);
      if (isTravelling(place, now)) return { ok: false, error: "in_transit" };
      if (place.location.systemId !== row.systemId) return { ok: false, error: "not_present" };
      const aboard = flagshipHumansAfter(emp.humans, gameHours(emp.humansAt.getTime(), now, this.timeScale));
      if (humans > Math.floor(HUMANS.flagshipCapacity - aboard)) return { ok: false, error: "flagship_full" };

      const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
      const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
      if (!site) return { ok: false, error: "unknown_planet" };
      const state = this.resolve(row, site, now);
      if (humans > Math.floor(state.population - HUMANS.colonyKeep)) return { ok: false, error: "colony_keep" };

      await tx.update(emperors).set({ humans: aboard + humans, humansAt: new Date(now) }).where(eq(emperors.id, emperorId));
      await tx
        .update(colonies)
        .set({ population: state.population - humans, ...state.stock, resolvedAt: new Date(now) })
        .where(eq(colonies.id, row.id));
      await tx.insert(resourceLedger).values({ emperorId, colonyId: row.id, reason: "embark", ref: "emperor", humans: -humans });
      return { ok: true, emperorId, colonyId: row.id };
    });
  }

  /** Existencias de una colonia propia resueltas a `at` (bloquea la fila hasta el final de la transacción). */
  async stockAt(tx: Tx, emperorId: string, colonyId: string, at: number): Promise<StockAmounts | null> {
    return (await this.lockResolved(tx, emperorId, colonyId, at))?.state.stock ?? null;
  }

  /**
   * Colonia propia bloqueada y resuelta a la hora `at` (con su mantenimiento),
   * para quien vaya a cambiar sus existencias o población (logística). Null si
   * no existe o no es de `emperorId`.
   */
  async lockResolved(tx: Tx, emperorId: string, colonyId: string, at: number): Promise<{ row: ColonyRow; state: ColonyState; cap: number } | null> {
    const [row] = await tx
      .select()
      .from(colonies)
      .where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId)))
      .for("update")
      .limit(1);
    if (!row) return null;
    const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
    const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
    if (!site) return null;
    return { row, state: this.resolve(row, site, at), cap: populationCap(site.planet.habitability) };
  }

  /** Guarda el estado de una colonia resuelto a la hora `at`. */
  async writeState(tx: Tx, colonyId: string, state: ColonyState, at: number): Promise<void> {
    await tx.update(colonies).set({ population: state.population, ...state.stock, resolvedAt: new Date(at) }).where(eq(colonies.id, colonyId));
  }

  /**
   * Suma (o resta, con cantidades negativas) recursos a una colonia propia,
   * resuelta antes a la hora `at`, y lo asienta en el libro con `reason`. Lo
   * usan el mercado y los aportes a la humanidad, y es el punto de enganche
   * para reponer combustible y munición de la nave en colonias propias.
   * Las retiradas exigen tener todo (si no, `insufficient_resources` y no
   * cambia nada); lo que entra y no cabe en el almacén se pierde y se devuelve
   * en `lost`. Null si la colonia no existe o no es de `emperorId`.
   */
  async adjustStock(
    tx: Tx,
    emperorId: string,
    colonyId: string,
    delta: Partial<StockAmounts>,
    reason: string,
    ref: string | null,
    at: number,
  ): Promise<{ ok: true; systemId: string; lost: StockAmounts } | { ok: false; error: CommandError }> {
    const locked = await this.lockResolved(tx, emperorId, colonyId, at);
    if (!locked) return { ok: false, error: "no_colony" };
    const stock = { ...locked.state.stock };
    const applied: StockAmounts = { metal: 0, volatiles: 0, crystal: 0, alloys: 0, rare_metals: 0, exotic: 0 };
    const lost: StockAmounts = { metal: 0, volatiles: 0, crystal: 0, alloys: 0, rare_metals: 0, exotic: 0 };
    for (const k of Object.keys(applied) as Array<keyof StockAmounts>) {
      const d = delta[k] ?? 0;
      if (d < 0 && stock[k] + 1e-6 < -d) return { ok: false, error: "insufficient_resources" };
      const next = Math.max(0, Math.min(ECONOMY.storage[k], stock[k] + d));
      applied[k] = next - stock[k];
      if (d > 0) lost[k] = d - applied[k];
      stock[k] = next;
    }
    await this.writeState(tx, colonyId, { population: locked.state.population, stock }, at);
    await tx.insert(resourceLedger).values({ emperorId, colonyId, reason, ref, ...applied });
    return { ok: true, systemId: locked.row.systemId, lost };
  }

  /**
   * Al borrar una cuenta, sus colonias se quedan en el universo como
   * independientes: se resuelven hasta `at` (lo producido hasta entonces se
   * queda), se cancelan sus encargos (con el reembolso de siempre, asentado en
   * el libro) y pierden el dueño. Desde ahí, congeladas: nadie las resuelve.
   * Los eventos `colony.build` los borra quien llama. Devuelve cuántas son.
   */
  async makeIndependent(tx: Tx, emperorId: string, at: number): Promise<number> {
    const rows = await tx.select().from(colonies).where(eq(colonies.emperorId, emperorId)).for("update");
    for (const row of rows) {
      const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
      const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
      const state = site ? this.resolve(row, site, at) : { population: row.population, stock: stockOf(row) };
      const stock = { ...state.stock };
      for (const build of await tx.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, row.id)).orderBy(asc(colonyBuilds.seq))) {
        const refund = refundOf(build);
        for (const k of Object.keys(stock) as Array<keyof StockAmounts>) stock[k] = Math.min(ECONOMY.storage[k], stock[k] + refund[k]);
        await tx.insert(resourceLedger).values({ emperorId, colonyId: row.id, reason: "cancel", ref: `${build.kind}:${build.itemId}`, ...refund });
      }
      await tx.delete(colonyBuilds).where(eq(colonyBuilds.colonyId, row.id));
      await tx
        .update(colonies)
        .set({ emperorId: null, governor: null, population: state.population, ...stock, resolvedAt: new Date(Math.max(at, row.resolvedAt.getTime())) })
        .where(eq(colonies.id, row.id));
      await tx.insert(resourceLedger).values({ emperorId, colonyId: row.id, reason: "independence", ref: null });
    }
    return rows.length;
  }

  // --- Fase 9b: conquista ---

  /**
   * Colonia bloqueada con su estado a la hora `at`, sea de quien sea: las
   * independientes están congeladas (su estado es el guardado). Para los
   * asedios (defensa de la colonia) y la captura.
   */
  async lockAny(tx: Tx, colonyId: string, at: number): Promise<{ row: ColonyRow; state: ColonyState; counts: InstallationCounts; cap: number } | null> {
    const [row] = await tx.select().from(colonies).where(eq(colonies.id, colonyId)).for("update").limit(1);
    if (!row) return null;
    const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
    const site = this.site(row, counts, await this.extraUpkeepOf(tx, row));
    if (!site) return null;
    const state = row.emperorId && at > row.resolvedAt.getTime() ? this.resolve(row, site, at) : { population: row.population, stock: stockOf(row) };
    return { row, state, counts, cap: populationCap(site.planet.habitability) };
  }

  /**
   * Captura (Fase 9b): la colonia pasa a `newOwnerId` con su población,
   * instalaciones y existencias, con pérdidas (`captureLosses` de
   * `@imperium/sim`). Antes, quien llama ha cancelado sus órdenes del mercado.
   * Aquí: el antiguo dueño cobra su capital hasta `at` (puede cambiar de
   * capital), se resuelve la colonia hasta `at` (una independiente no: estaba
   * congelada y desde ahora vuelve a producir), se pierde su cola de
   * construcción (lo pagado se pierde, como lo destruido), se acaban las rutas
   * de transporte que la usaban, se aplican las pérdidas y se suman las tropas
   * supervivientes como colonos. Todo queda en el libro.
   */
  async capture(
    tx: Tx,
    colonyId: string,
    newOwnerId: string,
    at: number,
    opts: { seed: number; survivors: number; extraPopulationLoss?: number; ref: string },
  ): Promise<{ oldOwnerId: string | null; capitalId: string | null; destroyed: number } | null> {
    const [pre] = await tx.select({ emperorId: colonies.emperorId }).from(colonies).where(eq(colonies.id, colonyId)).for("update").limit(1);
    if (!pre) return null;
    const oldOwnerId = pre.emperorId;
    // La capital del antiguo dueño se cobra hasta ahora (si era esta, queda resuelta aquí mismo).
    const capitalId = oldOwnerId ? await this.settleCapital(tx, oldOwnerId, at) : null;
    const locked = await this.lockAny(tx, colonyId, at);
    if (!locked) return null;
    const { row, state } = locked;

    // Cola de construcción: se pierde (lo pagado no se devuelve a nadie).
    const builds = await tx.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, row.id));
    for (const b of builds) await tx.insert(resourceLedger).values({ emperorId: oldOwnerId, colonyId: row.id, reason: "conquest_cancel", ref: `${b.kind}:${b.itemId}` });
    await tx.delete(colonyBuilds).where(eq(colonyBuilds.colonyId, row.id));
    // Rutas automáticas que la usaban (de cualquier flota): se acaban.
    await tx.delete(fleetRoutes).where(or(eq(fleetRoutes.fromColonyId, row.id), eq(fleetRoutes.toColonyId, row.id)));

    // Fase 10: el Heredero que la gobernaba (o se gestaba en su Cuna) muere con la colonia perdida.
    await tx.delete(heirs).where(eq(heirs.colonyId, row.id));

    const inst = await tx.select({ id: installations.id }).from(installations).where(eq(installations.colonyId, row.id));
    const losses = captureLosses(state.population, state.stock, inst.map((i) => i.id), opts.seed, opts.extraPopulationLoss ?? 0);
    if (losses.destroyed.length) await tx.delete(installations).where(inArray(installations.id, losses.destroyed));
    const population = Math.min(locked.cap, losses.population + Math.max(0, opts.survivors));
    await tx
      .update(colonies)
      .set({ emperorId: newOwnerId, governor: null, population, ...losses.stock, resolvedAt: new Date(at), acquiredAt: new Date(at) })
      .where(eq(colonies.id, row.id));
    const lost = (k: keyof StockAmounts) => losses.stock[k] - state.stock[k];
    await tx.insert(resourceLedger).values({
      emperorId: oldOwnerId,
      colonyId: row.id,
      reason: "conquest_lost",
      ref: opts.ref,
      metal: -state.stock.metal,
      volatiles: -state.stock.volatiles,
      crystal: -state.stock.crystal,
      alloys: -state.stock.alloys,
      rare_metals: -state.stock.rare_metals,
      exotic: -state.stock.exotic,
      humans: -state.population,
    });
    await tx.insert(resourceLedger).values({
      emperorId: newOwnerId,
      colonyId: row.id,
      reason: "conquest",
      ref: opts.ref,
      metal: state.stock.metal + lost("metal"),
      volatiles: state.stock.volatiles + lost("volatiles"),
      crystal: state.stock.crystal + lost("crystal"),
      alloys: state.stock.alloys + lost("alloys"),
      rare_metals: state.stock.rare_metals + lost("rare_metals"),
      exotic: state.stock.exotic + lost("exotic"),
      humans: population,
    });
    return { oldOwnerId, capitalId: capitalId === row.id ? null : capitalId, destroyed: losses.destroyed.length };
  }

  /** Asientos del libro de una colonia, en orden (para auditar y para los tests). */
  async ledger(colonyId: string) {
    return this.db.select().from(resourceLedger).where(eq(resourceLedger.colonyId, colonyId)).orderBy(asc(resourceLedger.id));
  }
}
