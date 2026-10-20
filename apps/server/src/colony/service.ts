import {
  ECONOMY,
  getInstallation,
  getShipClass,
  HUMANS,
  SHIP_HUMAN_CAPACITY,
  type InstallationId,
  type ShipClassId,
  type StockAmounts,
} from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import type { Colony, ColonyBuild, CommandError, EmperorHumans, Planet, PlanetClaim, StarSystemDetail, StarSystemSummary } from "@imperium/shared";
import { PlanetNameSchema } from "@imperium/shared/schemas";
import {
  canAfford,
  colonyEnergy,
  colonyFlows,
  flagshipHumansAfter,
  gameHours,
  installationAllowed,
  isTravelling,
  minColonists,
  netRates,
  pay,
  populationCap,
  populationGrowthPerHour,
  realDurationMs,
  resolveColony,
  type ColonySite,
  type ColonyState,
  type InstallationCounts,
} from "@imperium/sim";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, colonyBuilds, discoveries, emperors, fleets, installations, resourceLedger, ships } from "../db/schema";
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
}

/** Otro lo reclamó a la vez: se lanza para deshacer la transacción entera. */
class PlanetTaken extends Error {}

/** Margen para dar por terminada una construcción cuyo evento se procesa un instante antes de tiempo. */
const FINISH_TOLERANCE_MS = 1_000;
/** Detalles de sistema guardados en memoria (se generan con la semilla secreta y no cambian). */
const DETAIL_CACHE = 2_000;

const stockOf = (r: Pick<ColonyRow, "metal" | "volatiles" | "crystal" | "alloys">): StockAmounts => ({ metal: r.metal, volatiles: r.volatiles, crystal: r.crystal, alloys: r.alloys });
const negate = (s: StockAmounts): StockAmounts => ({ metal: -s.metal, volatiles: -s.volatiles, crystal: -s.crystal, alloys: -s.alloys });
const scaled = (s: StockAmounts, k: number): StockAmounts => ({ metal: s.metal * k, volatiles: s.volatiles * k, crystal: s.crystal * k, alloys: s.alloys * k });

/**
 * Humanos, colonias y economía (Fase 7). Las reglas están en `@imperium/sim`
 * y los datos en `@imperium/content`; aquí, la lectura y escritura en la base
 * de datos, siempre resolviendo antes el estado a la hora actual.
 */
export class ColonyService {
  private readonly seed: number;
  private readonly timeScale: number;
  private readonly details = new Map<string, StarSystemDetail>();

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

  private site(row: ColonyRow, counts: InstallationCounts): (ColonySite & { planet: Planet }) | null {
    const found = this.planet(row.systemId, row.planetIndex);
    if (!found) return null;
    return { planet: found.planet, starEnergy: found.detail.energy, installations: counts };
  }

  /** Estado de una colonia resuelto a la hora `at` (no antes de su `resolvedAt`). */
  private resolve(row: ColonyRow, site: ColonySite, at: number): ColonyState {
    const hours = gameHours(row.resolvedAt.getTime(), at, this.timeScale);
    return resolveColony({ population: row.population, stock: stockOf(row) }, site, hours);
  }

  private toColony(row: ColonyRow, counts: InstallationCounts, builds: BuildRow[], now: number): Colony | null {
    const site = this.site(row, counts);
    if (!site) return null;
    const state = this.resolve(row, site, now);
    const cap = populationCap(site.planet.habitability);
    const flows = colonyFlows(site.planet, site.starEnergy, counts, state.population);
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
      installations: installed,
      builds: builds.map(
        (b): ColonyBuild => ({
          id: b.id,
          kind: b.kind as ColonyBuild["kind"],
          itemId: b.itemId,
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
    const now = this.now();
    const out: Colony[] = [];
    for (const r of rows) {
      const c = this.toColony(
        r,
        counts.get(r.id) ?? {},
        builds.filter((b) => b.colonyId === r.id),
        now,
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
      .select({ planetIndex: colonies.planetIndex, name: colonies.name, ownerId: colonies.emperorId, ownerName: emperors.name })
      .from(colonies)
      .innerJoin(emperors, eq(emperors.id, colonies.emperorId))
      .where(eq(colonies.systemId, systemId))
      .orderBy(asc(colonies.planetIndex));
    return rows;
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
          .select({ id: fleets.id, systemId: fleets.systemId, destSystemId: fleets.destSystemId, departAt: fleets.departAt, arriveAt: fleets.arriveAt })
          .from(fleets)
          .where(and(eq(fleets.id, args.fleetId), eq(fleets.emperorId, emperorId)))
          .for("update")
          .limit(1);
        if (!fleet) return { ok: false, error: "no_fleet" };
        const place = placeFromRow(this.seed, fleet, now);
        if (isTravelling(place, now)) return { ok: false, error: "in_transit" };
        if (place.location.systemId !== system.id) return { ok: false, error: "not_present" };
        // El colonizador con más colonos.
        const [ship] = await tx
          .select({ id: ships.id, humans: ships.humans })
          .from(ships)
          .where(and(eq(ships.fleetId, fleet.id), eq(ships.classId, "colonizer")))
          .orderBy(desc(ships.humans))
          .limit(1);
        if (!ship) return { ok: false, error: "no_colonizer" };
        if (ship.humans < need) return { ok: false, error: "not_enough_humans" };
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
          })
          .from(emperors)
          .where(eq(emperors.id, emperorId))
          .for("update")
          .limit(1);
        if (!row) return { ok: false, error: "no_emperor" };
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
      const stock = ECONOMY.foundingStock;
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
  async build(emperorId: string, colonyId: string, kind: "installation" | "ship", itemId: string): Promise<ColonyResult> {
    let cost: StockAmounts;
    let hours: number;
    if (kind === "installation") {
      const def = getInstallation(itemId);
      if (!def) return { ok: false, error: "unknown_item" };
      cost = def.cost;
      hours = def.buildTimeHours;
    } else {
      const cls = getShipClass(itemId as ShipClassId);
      if (!cls) return { ok: false, error: "unknown_item" };
      cost = { ...cls.cost, alloys: 0 };
      hours = cls.buildTimeHours;
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
      } else if (!counts.shipyard) {
        return { ok: false, error: "needs_shipyard" };
      }
      const site = this.site(row, counts);
      if (!site) return { ok: false, error: "unknown_planet" };
      const now = this.now();
      const state = this.resolve(row, site, now);
      if (!canAfford(state.stock, cost)) return { ok: false, error: "insufficient_resources" };

      await tx
        .update(colonies)
        .set({ population: state.population, ...pay(state.stock, cost), resolvedAt: new Date(now) })
        .where(eq(colonies.id, row.id));
      const start = queue.length === 0;
      const finishAt = now + realDurationMs(hours, this.timeScale);
      const [build] = await tx
        .insert(colonyBuilds)
        .values({ colonyId: row.id, kind, itemId, startedAt: start ? new Date(now) : null, finishAt: start ? new Date(finishAt) : null })
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
    if (!row) return null;
    const counts = (await this.installationCounts(tx, [row.id])).get(row.id) ?? {};
    const site = this.site(row, counts);
    if (!site) return null;
    const finishAt = build.finishAt.getTime();
    const at = Math.max(row.resolvedAt.getTime(), finishAt);
    const state = this.resolve(row, site, at);
    let population = state.population;
    let fleetId: string | null = null;
    let discovered: Discovered | null = null;

    if (build.kind === "installation") {
      await tx.insert(installations).values({ colonyId: row.id, kind: build.itemId, builtAt: new Date(at) });
    } else {
      const cls = getShipClass(build.itemId as ShipClassId);
      if (cls) {
        // Los colonos embarcan de la colonia, dejando siempre a algunos.
        const capacity = SHIP_HUMAN_CAPACITY[cls.id] ?? 0;
        const boarding = Math.max(0, Math.min(capacity, Math.floor(population - HUMANS.colonyKeep)));
        population -= boarding;
        const [last] = await tx.select({ n: sql<number>`coalesce(max(${fleets.number}), 0)::int` }).from(fleets).where(eq(fleets.emperorId, row.emperorId));
        const [fleet] = await tx
          .insert(fleets)
          .values({ emperorId: row.emperorId, number: (last?.n ?? 0) + 1, systemId: row.systemId })
          .returning({ id: fleets.id });
        await tx.insert(ships).values({ fleetId: fleet!.id, classId: cls.id, hull: cls.hull, humans: boarding });
        if (boarding > 0) {
          await tx.insert(resourceLedger).values({ emperorId: row.emperorId, colonyId: row.id, reason: "colonizer_boarding", ref: `fleet:${fleet!.id}`, humans: -boarding });
        }
        fleetId = fleet!.id;
        const system = findSystem(this.seed, row.systemId);
        if (system) {
          const systemIds = await discoverAround(tx, this.seed, row.emperorId, system, cls.scannerRangeLy);
          discovered = { emperorId: row.emperorId, systemIds };
        }
      }
    }
    await tx
      .update(colonies)
      .set({ population, ...state.stock, resolvedAt: new Date(at) })
      .where(eq(colonies.id, row.id));
    await tx.delete(colonyBuilds).where(eq(colonyBuilds.id, build.id));

    // La siguiente de la cola empieza cuando terminó esta (no cuando se procesa el evento).
    const [next] = await tx.select().from(colonyBuilds).where(eq(colonyBuilds.colonyId, row.id)).orderBy(asc(colonyBuilds.seq)).limit(1);
    if (next) {
      const def = next.kind === "installation" ? getInstallation(next.itemId) : getShipClass(next.itemId as ShipClassId);
      const nextFinish = finishAt + realDurationMs(def?.buildTimeHours ?? 1, this.timeScale);
      await tx
        .update(colonyBuilds)
        .set({ startedAt: new Date(finishAt), finishAt: new Date(nextFinish) })
        .where(eq(colonyBuilds.id, next.id));
      await schedule(tx, "colony.build", new Date(nextFinish), { buildId: next.id });
    }
    return { emperorId: row.emperorId, colonyId: row.id, fleetId, discovered };
  }

  /** Asientos del libro de una colonia, en orden (para auditar y para los tests). */
  async ledger(colonyId: string) {
    return this.db.select().from(resourceLedger).where(eq(resourceLedger.colonyId, colonyId)).orderBy(asc(resourceLedger.id));
  }
}
