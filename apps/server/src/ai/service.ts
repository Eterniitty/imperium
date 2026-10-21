import {
  ALIEN_AI,
  ALIEN_SIEGE,
  effectiveTraits,
  FACTIONS,
  getAlienShipClass,
  getFaction,
  getSpecies,
  type FactionDefinition,
  type SpeciesDefinition,
  type StockId,
} from "@imperium/content";
import { coreRing, generateSector, regionKey, regionMaxRing, type RegionCoord } from "@imperium/procgen";
import {
  distance,
  type AlienSighting,
  type AlienStanding,
  type AliensResponse,
  type CommandError,
  type ShipCounts,
  type StarSystemDetail,
  type StarSystemSummary,
  type SystemAliensResponse,
  type WorldPosition,
} from "@imperium/shared";
import { gameHours, isTravelling, realDurationMs } from "@imperium/sim";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { ColonyService } from "../colony/service";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { alienFleets, alienRegions, alienStandings, colonies, emperors, emperorWallets, fleets, marketOrders, resourceLedger, ships } from "../db/schema";
import type { DiscoveryService } from "../discovery/service";
import { findSystem, inHumanCore, placeFromRow, systemsInRange } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";
import type { FleetService } from "../fleet/service";
import type { HumanityService } from "../humanity/service";
import type { MarketEffects, MarketService } from "../market/service";
import type { TerritoryService } from "./territory";
import type { SiegeEffects, SiegeService } from "../war/siege";

const EPS = 1e-6;
/** Decisiones por región como poco cada tanto tiempo real (con escalas de tiempo altas). */
const MIN_TICK_MS = 5_000;
/** Entre cuántos sistemas cercanos se elige dónde aparece una guarnición. */
const NEAR_CHOICES = 4;
/** Avistamientos que se envían como mucho. */
const MAX_SIGHTINGS = 40;

type Sensors = Array<{ position: WorldPosition; range: number }>;

/** Lo que el servicio necesita de la guerra (sensores del jugador). */
export interface SensorSource {
  sensors(emperorId: string): Promise<Sensors>;
}

export type TributeResult = { ok: true; emperorId: string } | { ok: false; error: CommandError };

/** Interpola entre lo cercano y lo profundo según el anillo de la región. */
function depthLerp(range: readonly [number, number], ring: number, minRing: number): number {
  const span = Math.max(1, ALIEN_AI.deepRing - minRing);
  const t = Math.min(1, Math.max(0, (ring - minRing) / span));
  return Math.round(range[0] + (range[1] - range[0]) * t);
}

function regionFromKey(key: string): RegionCoord {
  const [x, y, z] = key.split(":").map(Number) as [number, number, number];
  return { x, y, z };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * IA de las facciones alienígenas (Fase 11). Cada facción tiene un **actor**:
 * una fila de `emperors` con `kind = "alien"`, dueña de sus flotas, que usan
 * las mismas tablas, órdenes (`FleetService.moveTx`), combate por rondas
 * (`WarService`) y mercado (`MarketService.place`) que los jugadores.
 *
 * Sin bucles por tick: la IA solo despierta donde hay humanos. Cuando una flota
 * o la nave de un Emperador llega a un sistema de su territorio, la región se
 * **activa** (aparece su guarnición) y un evento `ai.region` decide cada
 * `ALIEN_AI.tickGameMinutes`: refuerzos, patrullas, expansión lenta y, los
 * Nómadas, comercio. Tras `ALIEN_AI.activeHours` sin humanos cerca, se duerme.
 */
export class AlienService {
  private readonly seed: number;
  private readonly timeScale: number;
  /** Actor de cada facción y facción de cada actor. */
  private actors = new Map<string, string>();
  private actorFactions = new Map<string, string>();
  private loading: Promise<void> | null = null;
  /** Azar de las decisiones (los tests lo fijan). No afecta al universo: es la voluntad de la IA. */
  random: () => number = Math.random;
  /** Mercado (lo enlaza `app.ts`) y aviso a los jugadores afectados por una operación. */
  market: MarketService | null = null;
  onMarket: ((fx: MarketEffects) => void) | null = null;
  /** Asedios (Fase 9b; lo enlaza `app.ts`) y aviso a los afectados por uno. */
  sieges: SiegeService | null = null;
  onSiege: ((fx: SiegeEffects) => void) | null = null;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    readonly territory: TerritoryService,
    private readonly fleetService: FleetService,
    private readonly colonyService: ColonyService,
    private readonly humanity: HumanityService,
    private readonly detailOf: (summary: StarSystemSummary) => StarSystemDetail,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = territory.universeSeed;
    this.timeScale = config.TIME_SCALE;
  }

  /**
   * Carga los actores y la expansión (una vez) y crea los actores que falten,
   * cada uno en su propia transacción: así nunca se recuerda el id de un actor
   * creado dentro de una transacción que luego se deshace.
   */
  ensure(): Promise<void> {
    return (this.loading ??= (async () => {
      await this.territory.ensure();
      const rows = await this.db.select({ id: emperors.id, factionId: emperors.factionId }).from(emperors).where(eq(emperors.kind, "alien"));
      for (const r of rows) if (r.factionId) this.remember(r.factionId, r.id);
      // Su fila necesita un sistema: el primero del sector de origen (es solo contabilidad; no se ven).
      const home = generateSector(this.seed, { x: 0, y: 0, z: 0 }).systems[0]!.id;
      for (const f of FACTIONS) {
        if (this.actors.has(f.id) || getSpecies(f.speciesId)?.extinct) continue;
        await this.createActor(f.id, home);
      }
    })().catch((err: unknown) => {
      this.loading = null;
      throw err;
    }));
  }

  /** Olvida lo cargado (los tests borran la base de datos). */
  async reset(): Promise<void> {
    this.actors.clear();
    this.actorFactions.clear();
    this.loading = null;
    await this.territory.reload();
    await this.ensure();
  }

  private remember(factionId: string, id: string): void {
    this.actors.set(factionId, id);
    this.actorFactions.set(id, factionId);
  }

  /** ¿Es este Emperador el actor de una facción alienígena? (tras `ensure`). */
  isActor(emperorId: string): boolean {
    return this.actorFactions.has(emperorId);
  }

  factionOf(emperorId: string): string | null {
    return this.actorFactions.get(emperorId) ?? null;
  }

  /** Crea (fuera de cualquier otra transacción) el actor de una facción. */
  private async createActor(factionId: string, homeSystemId: string): Promise<string> {
    const [row] = await this.db
      .insert(emperors)
      .values({ kind: "alien", factionId, name: factionId, nameKey: `#alien:${factionId}`, visibility: "hidden", systemId: homeSystemId, humans: 0 })
      .onConflictDoNothing()
      .returning({ id: emperors.id });
    const id = row?.id ?? (await this.db.select({ id: emperors.id }).from(emperors).where(eq(emperors.factionId, factionId)).limit(1))[0]?.id;
    if (!id) throw new Error(`No se pudo crear el actor de ${factionId}`);
    this.remember(factionId, id);
    return id;
  }

  /** Actor de una facción (creado en `ensure`; si faltase, se crea aparte). */
  async actor(_tx: Tx | Database, factionId: string, homeSystemId: string): Promise<string> {
    await this.ensure();
    return this.actors.get(factionId) ?? this.createActor(factionId, homeSystemId);
  }

  private ms(hours: number): number {
    return realDurationMs(hours, this.timeScale);
  }

  // --- Relación con cada Emperador (rencor y hostilidad) ---

  private decayed(grudge: number, updatedAt: Date, now: number): number {
    const days = gameHours(updatedAt.getTime(), now, this.timeScale) / 24;
    return Math.max(0, grudge - ALIEN_AI.grudge.decayPerDay * days);
  }

  /** Rencor actual de una facción hacia un Emperador. */
  async grudge(db: Database | Tx, emperorId: string, factionId: string): Promise<number> {
    const [row] = await db
      .select()
      .from(alienStandings)
      .where(and(eq(alienStandings.emperorId, emperorId), eq(alienStandings.factionId, factionId)))
      .limit(1);
    return row ? this.decayed(row.grudge, row.updatedAt, this.now()) : 0;
  }

  /** Suma (o resta) rencor, ya descontado lo olvidado. */
  async addGrudge(tx: Tx, emperorId: string, factionId: string, amount: number): Promise<number> {
    const now = this.now();
    const [row] = await tx
      .select()
      .from(alienStandings)
      .where(and(eq(alienStandings.emperorId, emperorId), eq(alienStandings.factionId, factionId)))
      .for("update")
      .limit(1);
    const next = Math.max(0, (row ? this.decayed(row.grudge, row.updatedAt, now) : 0) + amount);
    await tx
      .insert(alienStandings)
      .values({ emperorId, factionId, grudge: next, updatedAt: new Date(now) })
      .onConflictDoUpdate({ target: [alienStandings.emperorId, alienStandings.factionId], set: { grudge: next, updatedAt: new Date(now) } });
    return next;
  }

  /** ¿Es la facción hostil a este Emperador? Hostil por naturaleza o por rencor. */
  async isHostileTo(db: Database | Tx, factionId: string, emperorId: string): Promise<boolean> {
    const faction = getFaction(factionId);
    const species = faction && getSpecies(faction.speciesId);
    if (!faction || !species || species.extinct || species.ai.intruders === "ignore") return false;
    if (faction.relation === "hostile") return true;
    return (await this.grudge(db, emperorId, factionId)) >= ALIEN_AI.grudge.hostileAt - EPS;
  }

  /**
   * Regla de hostilidad para el combate por rondas (`WarService`): entre
   * Emperadores, siempre (salvo los de la IA en el Núcleo Humano, que no
   * empiezan peleas allí); entre facciones, nunca (sus territorios no se
   * tocan); entre una facción y un Emperador, según su postura y el rencor, y
   * nunca en el Núcleo Humano.
   */
  async hostile(db: Database | Tx, a: string, b: string, systemId: string): Promise<boolean> {
    await this.ensure();
    const fa = this.actorFactions.get(a);
    const fb = this.actorFactions.get(b);
    if (!fa && !fb) {
      if (!inHumanCore(systemId)) return true;
      const ai = await db.select({ id: emperors.id }).from(emperors).where(and(inArray(emperors.id, [a, b]), eq(emperors.kind, "ai")));
      return ai.length === 0;
    }
    if (fa && fb) return false;
    if (inHumanCore(systemId)) return false;
    return this.isHostileTo(db, (fa ?? fb)!, fa ? b : a);
  }

  // --- Regiones: activación, guarnición y decisiones ---

  private speciesOf(factionId: string): { faction: FactionDefinition; species: SpeciesDefinition } | null {
    const faction = getFaction(factionId);
    const species = faction && getSpecies(faction.speciesId);
    return faction && species ? { faction, species } : null;
  }

  private tickMs(): number {
    return Math.max(MIN_TICK_MS, this.ms(ALIEN_AI.tickGameMinutes / 60));
  }

  /** Flotas y naves por flota de una región según su profundidad. */
  private garrisonSize(key: string, species: SpeciesDefinition): { fleets: number; ships: number } {
    const ring = regionMaxRing(regionFromKey(key), this.territory.regionSize);
    const min = species.territory.minCoreRing;
    return { fleets: depthLerp(species.fleet.fleetsPerRegion, ring, min), ships: Math.max(1, depthLerp(species.fleet.shipsPerFleet, ring, min)) };
  }

  /**
   * Despierta la región de `system` (si es territorio de alguien): la crea con
   * su guarnición la primera vez y programa sus decisiones. Devuelve la clave
   * de la región y su facción, o null si el sistema no es territorio alienígena.
   */
  async activate(tx: Tx, system: StarSystemSummary): Promise<{ key: string; factionId: string } | null> {
    await this.ensure();
    const owner = this.territory.owner(system);
    if (!owner) return null;
    const info = this.speciesOf(owner.factionId);
    if (!info || info.species.extinct) return null;
    const key = regionKey(this.territory.regionOf(system));
    const now = this.now();
    const until = new Date(now + this.ms(ALIEN_AI.activeHours));
    const [row] = await tx.select().from(alienRegions).where(eq(alienRegions.regionKey, key)).for("update").limit(1);
    if (!row) {
      const [created] = await tx
        .insert(alienRegions)
        .values({ regionKey: key, factionId: owner.factionId, activeUntil: until, ticking: true, lastSpawnAt: new Date(now) })
        .onConflictDoNothing()
        .returning({ key: alienRegions.regionKey });
      if (created) {
        const { fleets: n } = this.garrisonSize(key, info.species);
        // La guarnición aparece cerca de donde se ha visto al humano (sin pisar su sistema).
        for (let i = 0; i < n; i++) await this.spawnFleet(tx, key, owner.factionId, info.species, system.position);
        await schedule(tx, "ai.region", new Date(now + this.tickMs()), { regionKey: key });
      }
      return { key, factionId: owner.factionId };
    }
    await tx
      .update(alienRegions)
      .set({ activeUntil: until, ticking: true })
      .where(eq(alienRegions.regionKey, key));
    if (!row.ticking) await schedule(tx, "ai.region", new Date(now + this.tickMs()), { regionKey: key });
    return { key, factionId: row.factionId };
  }

  /** Sistemas con flotas paradas de Emperadores (para no aparecer encima de nadie). */
  private async occupied(tx: Tx, systemIds: string[]): Promise<Set<string>> {
    if (systemIds.length === 0) return new Set();
    const rows = await tx
      .select({ systemId: fleets.systemId })
      .from(fleets)
      .innerJoin(emperors, eq(emperors.id, fleets.emperorId))
      .where(and(inArray(fleets.systemId, systemIds), isNull(fleets.destSystemId), ne(emperors.kind, "alien")));
    return new Set(rows.map((r) => r.systemId));
  }

  /**
   * Crea una flota de guarnición en un sistema de su territorio en la región,
   * donde no haya flotas humanas paradas; con `near`, entre los más cercanos a ese punto.
   */
  async spawnFleet(tx: Tx, key: string, factionId: string, species: SpeciesDefinition, near?: WorldPosition): Promise<string | null> {
    const systems = this.territory.factionSystems(key, factionId);
    if (systems.length === 0) return null;
    const busy = await this.occupied(tx, systems.map((s) => s.id));
    let free = systems.filter((s) => !busy.has(s.id));
    if (free.length === 0) return null;
    if (near) free = free.sort((a, b) => distance(a.position, near) - distance(b.position, near)).slice(0, NEAR_CHOICES);
    const at = free[Math.floor(this.random() * free.length)]!;
    const actorId = await this.actor(tx, factionId, at.id);
    // Bloquea el actor: el número de flota es único por dueño.
    await tx.select({ id: emperors.id }).from(emperors).where(eq(emperors.id, actorId)).for("update");
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`coalesce(max(${fleets.number}), 0)::int` }).from(fleets).where(eq(fleets.emperorId, actorId));
    const [fleet] = await tx.insert(fleets).values({ emperorId: actorId, number: n + 1, systemId: at.id }).returning({ id: fleets.id });
    const { ships: count } = this.garrisonSize(key, species);
    const comp = species.fleet.composition;
    const total = comp.reduce((a, [, w]) => a + w, 0);
    const shipRows = [];
    for (let i = 0; i < count; i++) {
      let roll = this.random() * total;
      let classId = comp[0]![0];
      for (const [id, w] of comp) {
        roll -= w;
        if (roll < 0) {
          classId = id;
          break;
        }
      }
      shipRows.push({ fleetId: fleet!.id, classId, hull: getAlienShipClass(classId)?.hull ?? 1 });
    }
    await tx.insert(ships).values(shipRows);
    await tx.insert(alienFleets).values({ fleetId: fleet!.id, regionKey: key });
    return fleet!.id;
  }

  /** Flotas de una región con su lugar (las que viajan, en tránsito). */
  private async regionFleets(tx: Tx, key: string) {
    const rows = await tx
      .select({
        id: fleets.id,
        systemId: fleets.systemId,
        destSystemId: fleets.destSystemId,
        departAt: fleets.departAt,
        arriveAt: fleets.arriveAt,
        battleId: fleets.battleId,
      })
      .from(fleets)
      .innerJoin(alienFleets, eq(alienFleets.fleetId, fleets.id))
      .where(eq(alienFleets.regionKey, key))
      .orderBy(asc(fleets.createdAt));
    const now = this.now();
    return rows.map((r) => {
      const place = placeFromRow(this.seed, r, now);
      return { id: r.id, place, idle: !isTravelling(place, now) && !r.battleId };
    });
  }

  /**
   * Una flota de un Emperador llega a un sistema (dentro de la transacción del
   * evento `fleet.arrive`): si es territorio alienígena, la región despierta y,
   * si la facción le es hostil y responde atacando, envía flotas contra ella
   * según su agresividad. Devuelve las flotas alienígenas enviadas.
   */
  async onFleetArrived(tx: Tx, fleetId: string): Promise<string[]> {
    await this.ensure();
    const [f] = await tx
      .select({ id: fleets.id, emperorId: fleets.emperorId, systemId: fleets.systemId, destSystemId: fleets.destSystemId, createdAt: emperors.createdAt })
      .from(fleets)
      .innerJoin(emperors, eq(emperors.id, fleets.emperorId))
      .where(eq(fleets.id, fleetId))
      .limit(1);
    if (!f || f.destSystemId !== null || this.isActor(f.emperorId)) return [];
    const system = findSystem(this.seed, f.systemId);
    if (!system) return [];
    const region = await this.activate(tx, system);
    if (!region) return [];
    const info = this.speciesOf(region.factionId)!;
    if (info.species.ai.intruders !== "attack" || !(await this.isHostileTo(tx, region.factionId, f.emperorId))) return [];
    // Gracia para los Emperadores nuevos: no se envían flotas contra ellos.
    if (gameHours(f.createdAt.getTime(), this.now(), this.timeScale) < ALIEN_AI.noviceGraceHours) return [];
    if (this.random() > effectiveTraits(info.faction).aggression) return [];
    return this.respond(tx, region.key, region.factionId, system, info.species.ai.responders);
  }

  /** Envía hasta `max` flotas paradas de la región (las más cercanas) a `target`. */
  private async respond(tx: Tx, key: string, factionId: string, target: StarSystemSummary, max: number, keep?: Set<string>): Promise<string[]> {
    const actorId = this.actors.get(factionId);
    if (!actorId || max <= 0) return [];
    // Las que asedian no se mueven (Fase 9b).
    const sieging = keep ?? new Set((this.sieges ? await this.sieges.activeBy(tx, actorId) : []).map((s) => s.systemId));
    const candidates = (await this.regionFleets(tx, key))
      .filter((f) => f.idle && f.place.location.systemId !== target.id && !sieging.has(f.place.location.systemId))
      .map((f) => ({ id: f.id, d: distance(f.place.location.position, target.position) }))
      .filter((f) => f.d <= ALIEN_AI.responseRangeLy)
      .sort((a, b) => a.d - b.d)
      .slice(0, max);
    const sent: string[] = [];
    for (const c of candidates) {
      const res = await this.fleetService.moveTx(tx, actorId, c.id, target.id);
      if (res.ok) sent.push(c.id);
    }
    return sent;
  }

  /** La nave de un Emperador llega a un sistema: si es territorio alienígena, la región despierta. */
  async onEmperorArrived(tx: Tx, emperorId: string, systemId: string): Promise<void> {
    await this.ensure();
    if (this.isActor(emperorId)) return;
    const system = findSystem(this.seed, systemId);
    if (system) await this.activate(tx, system);
  }

  /** Un Emperador funda una colonia: si es territorio alienígena, la facción le guarda rencor. */
  async onColonyClaimed(emperorId: string, systemId: string): Promise<void> {
    await this.ensure();
    const system = findSystem(this.seed, systemId);
    if (!system || this.isActor(emperorId)) return;
    const owner = this.territory.owner(system);
    const info = owner && this.speciesOf(owner.factionId);
    if (!owner || !info) return;
    await this.db.transaction(async (tx) => {
      await this.activate(tx, system);
      if (info.species.ai.grudgePerColony > 0) await this.addGrudge(tx, emperorId, owner.factionId, info.species.ai.grudgePerColony);
    });
  }

  /** Asediar una colonia ocupada por una facción: rencor (lo llama `SiegeService`). */
  async onSieged(tx: Tx, emperorId: string, factionId: string): Promise<void> {
    await this.addGrudge(tx, emperorId, factionId, ALIEN_SIEGE.grudge);
  }

  /** Interceptar una flota alienígena: rencor de su facción (lo llama `WarService`). */
  async onIntercept(tx: Tx, emperorId: string, factionId: string): Promise<void> {
    await this.addGrudge(tx, emperorId, factionId, ALIEN_AI.grudge.intercept);
  }

  /**
   * Manejador del evento `ai.region`: una decisión de la IA de una región.
   * Devuelve, si toca comerciar, lo que hay que hacer tras confirmar.
   */
  async tick(tx: Tx, key: string): Promise<(() => void) | void> {
    await this.ensure();
    const [row] = await tx.select().from(alienRegions).where(eq(alienRegions.regionKey, key)).for("update").limit(1);
    if (!row) return;
    const now = this.now();
    const info = this.speciesOf(row.factionId);
    const systems = this.territory.factionSystems(key, row.factionId);
    // Sin humanos cerca desde hace rato (o sin territorio): la región se duerme.
    if (!info || systems.length === 0 || row.activeUntil.getTime() <= now) {
      await tx.update(alienRegions).set({ ticking: false }).where(eq(alienRegions.regionKey, key));
      return;
    }
    const { species } = info;
    const actorId = await this.actor(tx, row.factionId, systems[0]!.id);
    const own = await this.regionFleets(tx, key);

    // Refuerzos: hasta su guarnición, como mucho una flota cada `reinforceHours`.
    const target = this.garrisonSize(key, species).fleets;
    if (own.length < target && (!row.lastSpawnAt || now - row.lastSpawnAt.getTime() >= this.ms(ALIEN_AI.reinforceHours))) {
      if (await this.spawnFleet(tx, key, row.factionId, species)) await tx.update(alienRegions).set({ lastSpawnAt: new Date(now) }).where(eq(alienRegions.regionKey, key));
    }

    // Asedios (Fase 9b): las flotas que asedian no patrullan; quizá empieza o prepara otro.
    const sieging = new Set((this.sieges ? await this.sieges.activeBy(tx, actorId) : []).map((s) => s.systemId));
    const siegeFx = await this.considerSieges(tx, key, row.factionId, actorId, own, systems, sieging);

    // Patrullas: las flotas paradas recorren su territorio.
    for (const f of own) {
      if (!f.idle || sieging.has(f.place.location.systemId) || this.random() >= species.ai.patrol) continue;
      const here = f.place.location;
      const options = systems.filter((s) => s.id !== here.systemId && distance(s.position, here.position) <= ALIEN_AI.patrolRangeLy);
      if (options.length === 0) continue;
      const dest = options[Math.floor(this.random() * options.length)]!;
      await this.fleetService.moveTx(tx, actorId, f.id, dest.id);
    }

    // Expansión lenta.
    const chance = (species.ai.expansionPerDay * ALIEN_AI.tickGameMinutes) / (60 * 24);
    if (this.random() < chance) await this.expand(tx, key, row.factionId, species, systems);

    await schedule(tx, "ai.region", new Date(now + this.tickMs()), { regionKey: key });
    const trades = species.ai.trades && this.market;
    if (!trades && siegeFx.length === 0) return;
    return () => {
      for (const fx of siegeFx) this.onSiege?.(fx);
      if (trades) void this.trade(row.factionId, key).catch(() => undefined);
    };
  }

  /**
   * Ataques a colonias humanas de su territorio (Fase 9b), según su agresividad
   * y su rencor: solo si la facción es hostil a su dueño (o la colonia es
   * independiente), nunca en el Núcleo Humano ni contra Emperadores en su
   * gracia. Si tiene una flota parada allí, empieza el asedio; si no, envía
   * flotas. Una acción por decisión y como mucho `ALIEN_SIEGE.maxPerRegion` a la vez.
   */
  private async considerSieges(
    tx: Tx,
    key: string,
    factionId: string,
    actorId: string,
    own: Awaited<ReturnType<AlienService["regionFleets"]>>,
    systems: StarSystemSummary[],
    sieging: Set<string>,
  ): Promise<SiegeEffects[]> {
    const info = this.speciesOf(factionId);
    if (!this.sieges || !info || info.species.ai.intruders === "ignore" || systems.length === 0) return [];
    const inRegion = new Set(systems.map((s) => s.id));
    if ([...sieging].filter((id) => inRegion.has(id)).length >= ALIEN_SIEGE.maxPerRegion) return [];
    const targets = await tx
      .select({ id: colonies.id, emperorId: colonies.emperorId, systemId: colonies.systemId, createdAt: emperors.createdAt })
      .from(colonies)
      .leftJoin(emperors, eq(emperors.id, colonies.emperorId))
      .where(inArray(colonies.systemId, [...inRegion]));
    const chance = effectiveTraits(info.faction).aggression * ALIEN_SIEGE.chancePerTick;
    for (const t of targets) {
      if (t.emperorId === actorId || (t.emperorId && this.isActor(t.emperorId)) || sieging.has(t.systemId) || inHumanCore(t.systemId)) continue;
      if (t.emperorId) {
        if (!(await this.isHostileTo(tx, factionId, t.emperorId))) continue;
        if (t.createdAt && gameHours(t.createdAt.getTime(), this.now(), this.timeScale) < ALIEN_AI.noviceGraceHours) continue;
      }
      if (this.random() >= chance) continue;
      const here = own.some((f) => f.idle && f.place.location.systemId === t.systemId);
      if (here) {
        const res = await this.sieges.startTx(tx, actorId, t.id);
        if (res.ok) sieging.add(t.systemId);
        return res.ok ? [res.fx] : [];
      }
      const system = findSystem(this.seed, t.systemId);
      if (system) await this.respond(tx, key, factionId, system, info.species.ai.responders, sieging);
      return [];
    }
    return [];
  }

  /**
   * Suma a su territorio un sistema libre cercano de la misma región (nunca en
   * el Núcleo ni más cerca que su anillo mínimo, ni donde haya colonias).
   */
  async expand(tx: Tx, key: string, factionId: string, species: SpeciesDefinition, systems: StarSystemSummary[]): Promise<string | null> {
    if (systems.length === 0) return null;
    const from = systems[Math.floor(this.random() * systems.length)]!;
    const candidates = systemsInRange(this.seed, from.position, ALIEN_AI.expansionRangeLy).filter(
      (s) => regionKey(this.territory.regionOf(s)) === key && coreRing(s.sector) >= species.territory.minCoreRing && !this.territory.owner(s),
    );
    if (candidates.length === 0) return null;
    const settled = new Set(
      (await tx.select({ systemId: colonies.systemId }).from(colonies).where(inArray(colonies.systemId, candidates.map((c) => c.id)))).map((r) => r.systemId),
    );
    const free = candidates.filter((c) => !settled.has(c.id));
    if (free.length === 0) return null;
    const chosen = free[Math.floor(this.random() * free.length)]!;
    return (await this.territory.addClaim(tx, chosen.id, factionId)) ? chosen.id : null;
  }

  // --- Comercio (Nómadas del Vacío) ---

  /**
   * Hábitat de la facción (una colonia sin población en un planeta libre de su
   * territorio) y su cartera: lo que necesita para usar el mercado como
   * cualquier Emperador. Se crea la primera vez que comercia.
   */
  private async habitat(factionId: string, key: string): Promise<{ actorId: string; colonyId: string } | null> {
    const systems = this.territory.factionSystems(key, factionId);
    if (systems.length === 0) return null;
    return this.db.transaction(async (tx) => {
      const actorId = await this.actor(tx, factionId, systems[0]!.id);
      const [existing] = await tx.select({ id: colonies.id }).from(colonies).where(eq(colonies.emperorId, actorId)).orderBy(asc(colonies.foundedAt)).limit(1);
      const now = this.now();
      await tx.insert(emperorWallets).values({ emperorId: actorId, credits: ALIEN_AI.traderStartingCredits, settledAt: new Date(now) }).onConflictDoNothing();
      if (existing) return { actorId, colonyId: existing.id };
      for (const s of systems) {
        const planets = this.detailOf(s).planets;
        if (planets.length === 0) continue;
        const taken = new Set((await tx.select({ i: colonies.planetIndex }).from(colonies).where(eq(colonies.systemId, s.id))).map((r) => r.i));
        const planet = planets.find((p) => !taken.has(p.index));
        if (!planet) continue;
        const [colony] = await tx
          .insert(colonies)
          .values({ emperorId: actorId, systemId: s.id, planetIndex: planet.index, population: 0, resolvedAt: new Date(now) })
          .onConflictDoNothing()
          .returning({ id: colonies.id });
        if (colony) {
          await tx.insert(resourceLedger).values({ emperorId: actorId, colonyId: colony.id, reason: "ai_habitat", ref: factionId });
          return { actorId, colonyId: colony.id };
        }
      }
      return null;
    });
  }

  /**
   * Una ronda de comercio: repone su hábitat (producción propia) y pone una
   * orden de venta (y a veces una de compra) cerca del último precio, por la
   * misma orden `market.order` que los jugadores.
   */
  async trade(factionId: string, key: string): Promise<void> {
    const market = this.market;
    if (!market) return;
    const home = await this.habitat(factionId, key);
    if (!home) return;
    const [open] = await this.db.select({ n: sql<number>`count(*)::int` }).from(marketOrders).where(eq(marketOrders.emperorId, home.actorId));
    if ((open?.n ?? 0) >= ALIEN_AI.trade.maxOpenOrders) return;
    const t = ALIEN_AI.trade;
    const sells: readonly StockId[] = t.sells;
    const resource = sells[Math.floor(this.random() * sells.length)]!;
    await this.db.transaction(async (tx) => {
      await this.colonyService.adjustStock(tx, home.actorId, home.colonyId, { [resource]: t.restock }, "ai_production", factionId, this.now());
    });
    const prices = await market.view();
    const priceOf = (r: StockId) => {
      const m = prices.resources.find((x) => x.resource === r);
      return m?.last ?? m?.bestAsk ?? m?.bestBid ?? t.referencePrice[r];
    };
    const quantity = Math.round(t.quantity[0] + this.random() * (t.quantity[1] - t.quantity[0]));
    const sell = await market.place(home.actorId, { resource, side: "sell", price: Math.max(0.01, round2(priceOf(resource) * (1 + t.spread))), quantity, colonyId: home.colonyId });
    if (sell.ok) this.onMarket?.(sell);
    if (this.random() < 0.5) {
      const buys: readonly StockId[] = t.buys;
      const want = buys[Math.floor(this.random() * buys.length)]!;
      const qty = Math.round(t.quantity[0] / 2 + this.random() * (t.quantity[1] - t.quantity[0]) / 2);
      const buy = await market.place(home.actorId, { resource: want, side: "buy", price: Math.max(0.01, round2(priceOf(want) * (1 - t.spread))), quantity: qty, colonyId: home.colonyId });
      if (buy.ok) this.onMarket?.(buy);
    }
  }

  // --- Diplomacia básica ---

  /**
   * Orden `alien.tribute`: paga créditos a una facción para borrar rencor
   * (`ALIEN_AI.grudge.tributeCreditsPerPoint` por punto). Solo se paga lo que
   * hace falta; las que nunca pactan lo rechazan. Si la facción tiene cartera
   * (comercia), los créditos van a ella.
   */
  async tribute(emperorId: string, factionId: string, credits: number): Promise<TributeResult> {
    await this.ensure();
    const info = this.speciesOf(factionId);
    if (!info || info.species.extinct) return { ok: false, error: "unknown_faction" };
    if (info.species.diplomacy === "never" || this.isActor(emperorId)) return { ok: false, error: "no_diplomacy" };
    if (credits < ALIEN_AI.grudge.minTribute) return { ok: false, error: "invalid_order" };
    return this.db.transaction(async (tx): Promise<TributeResult> => {
      const now = this.now();
      const current = await this.grudge(tx, emperorId, factionId);
      const amount = Math.min(credits, current * ALIEN_AI.grudge.tributeCreditsPerPoint);
      if (amount <= EPS) return { ok: true, emperorId };
      if (!(await this.humanity.spend(tx, emperorId, amount, "alien_tribute", factionId, now))) return { ok: false, error: "insufficient_credits" };
      const actorId = this.actors.get(factionId);
      if (actorId) await this.humanity.credit(tx, actorId, amount, "alien_tribute", emperorId);
      await this.addGrudge(tx, emperorId, factionId, -amount / ALIEN_AI.grudge.tributeCreditsPerPoint);
      return { ok: true, emperorId };
    });
  }

  // --- Vistas para los jugadores ---

  private standingOf(factionId: string, grudge: number, hostile: boolean): AlienStanding {
    const info = this.speciesOf(factionId)!;
    return { factionId, speciesId: info.species.id, grudge: Math.round(grudge * 100) / 100, hostile, acceptsTribute: info.species.diplomacy !== "never" };
  }

  /** Territorio de los sistemas descubiertos, ruinas y relación con las facciones conocidas. */
  async view(emperorId: string, discovered: readonly string[]): Promise<AliensResponse> {
    await this.ensure();
    const territory: AliensResponse["territory"] = [];
    const relics: string[] = [];
    const known = new Set<string>();
    for (const id of discovered) {
      const s = findSystem(this.seed, id);
      if (!s) continue;
      const o = this.territory.owner(s);
      if (o) {
        territory.push({ systemId: id, ...o });
        known.add(o.factionId);
      }
      if (this.territory.relic(s)) relics.push(id);
    }
    const rows = await this.db.select().from(alienStandings).where(eq(alienStandings.emperorId, emperorId));
    for (const r of rows) known.add(r.factionId);
    const standings: AlienStanding[] = [];
    for (const factionId of [...known].sort()) {
      if (!this.speciesOf(factionId)) continue;
      const r = rows.find((x) => x.factionId === factionId);
      const g = r ? this.decayed(r.grudge, r.updatedAt, this.now()) : 0;
      standings.push(this.standingOf(factionId, g, await this.isHostileTo(this.db, factionId, emperorId)));
    }
    return { territory, relics, standings, hostileAt: ALIEN_AI.grudge.hostileAt };
  }

  /** Flotas alienígenas paradas al alcance de los sensores (o en `onlySystemId`). */
  async sightings(sensors: Sensors, onlySystemId?: string): Promise<AlienSighting[]> {
    await this.ensure();
    if (sensors.length === 0 || this.actors.size === 0) return [];
    const rows = await this.db
      .select({ id: fleets.id, emperorId: fleets.emperorId, systemId: fleets.systemId, battleId: fleets.battleId, factionId: emperors.factionId })
      .from(fleets)
      .innerJoin(emperors, eq(emperors.id, fleets.emperorId))
      .where(and(eq(emperors.kind, "alien"), isNull(fleets.destSystemId), onlySystemId ? eq(fleets.systemId, onlySystemId) : sql`true`))
      .limit(2_000);
    const seen = rows.filter((r) => {
      const s = findSystem(this.seed, r.systemId);
      return s && sensors.some((x) => distance(x.position, s.position) <= x.range);
    }).slice(0, MAX_SIGHTINGS);
    if (seen.length === 0) return [];
    const shipRows = await this.db.select({ fleetId: ships.fleetId, classId: ships.classId }).from(ships).where(inArray(ships.fleetId, seen.map((r) => r.id)));
    return seen.map((r) => {
      const counts: ShipCounts = {};
      for (const s of shipRows) if (s.fleetId === r.id) counts[s.classId] = (counts[s.classId] ?? 0) + 1;
      const s = findSystem(this.seed, r.systemId)!;
      return {
        fleetId: r.id,
        factionId: r.factionId!,
        speciesId: getFaction(r.factionId!)?.speciesId ?? "",
        systemId: r.systemId,
        systemName: s.name,
        ships: counts,
        inBattle: r.battleId !== null,
      };
    });
  }

  /** Presencia alienígena en un sistema descubierto. */
  async systemView(system: StarSystemSummary, sensors: Sensors): Promise<SystemAliensResponse> {
    await this.ensure();
    const sensed = sensors.some((x) => distance(x.position, system.position) <= x.range);
    return {
      territory: this.territory.owner(system),
      relic: this.territory.relic(system),
      fleets: sensed ? await this.sightings(sensors, system.id) : [],
      sensed,
    };
  }

}
