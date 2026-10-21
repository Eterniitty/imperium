import {
  ALIEN_AI,
  AI_EMPEROR,
  AI_EMPERORS,
  AI_PERSONALITIES,
  ECONOMY,
  EMPEROR_FLAGSHIP,
  getShipClass,
  HUMANS,
  STARTING_FLEET,
  STOCK_IDS,
  type AiPersonalityDefinition,
} from "@imperium/content";
import { minColonists, realDurationMs } from "@imperium/sim";
import { distance, type Colony, type Fleet, type StarSystemDetail, type StarSystemSummary } from "@imperium/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { ColonyService } from "../colony/service";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, emperors, fleets, ships } from "../db/schema";
import { discoverAround, fleetScannerRangeLy, type DiscoveryService } from "../discovery/service";
import { findSystem, nameKey, spawnCandidates, systemsInRange } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";
import type { FleetService } from "../fleet/service";
import type { MarketEffects, MarketService } from "../market/service";
import type { TerritoryService } from "./territory";

/** Decisiones como poco cada tanto tiempo real (con escalas de tiempo altas). */
const MIN_DECIDE_MS = 10_000;

/** Qué ha cambiado tras una decisión (para avisar a quien mire). */
export interface AiEmperorEffects {
  emperorId: string;
  colonies: string[];
  fleets: string[];
  wallet: boolean;
  market: MarketEffects[];
}

/**
 * Emperadores humanos de la IA (Fase 11). Son filas de `emperors` con
 * `kind = "ai"` (sin cuenta), visibles para todos. Cada uno decide cada
 * `AI_EMPEROR.decideEveryHours` con un evento `ai.emperor`; la decisión se
 * ejecuta tras confirmar el evento con las **mismas órdenes que un jugador**
 * (`ColonyService.claim/build`, `FleetService.move`, `MarketService.place`),
 * cada una en su transacción, y solo con lo que ha descubierto.
 */
export class AiEmperorService {
  private readonly seed: number;
  private readonly timeScale: number;
  random: () => number = Math.random;
  /** Aviso a los jugadores (lo enlaza `app.ts`). */
  onEffects: ((fx: AiEmperorEffects) => void) | null = null;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "TIME_SCALE">,
    private readonly territory: TerritoryService,
    private readonly discoveries: DiscoveryService,
    private readonly fleetService: FleetService,
    private readonly colonyService: ColonyService,
    private readonly market: MarketService,
    private readonly log: FastifyBaseLogger | null = null,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = territory.universeSeed;
    this.timeScale = config.TIME_SCALE;
  }

  private decideMs(): number {
    return Math.max(MIN_DECIDE_MS, realDurationMs(AI_EMPEROR.decideEveryHours, this.timeScale));
  }

  private detail(s: StarSystemSummary): StarSystemDetail {
    return this.discoveries.detail(s);
  }

  /** Personalidad de un Emperador de la IA por su nombre. */
  personality(name: string): AiPersonalityDefinition {
    const p = AI_EMPERORS.find((e) => e.name === name)?.personality ?? "expansionist";
    return AI_PERSONALITIES[p];
  }

  /**
   * Crea los Emperadores de la IA que falten (hasta `count`) en sistemas del
   * Núcleo Humano con algún planeta libre y habitable, con su flota inicial y
   * su entorno descubierto, como un jugador nuevo. Devuelve cuántos creó.
   */
  async ensure(count: number): Promise<number> {
    const wanted = AI_EMPERORS.slice(0, Math.max(0, count));
    if (wanted.length === 0) return 0;
    const existing = new Set((await this.db.select({ name: emperors.name }).from(emperors).where(eq(emperors.kind, "ai"))).map((r) => r.name));
    let created = 0;
    const candidates = spawnCandidates(this.seed);
    for (const persona of wanted) {
      if (existing.has(persona.name)) continue;
      const home = await this.homeFor(candidates);
      if (!home) break;
      const id = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(emperors)
          .values({ kind: "ai", name: persona.name, nameKey: nameKey(persona.name), visibility: "public", systemId: home.id, humans: HUMANS.flagshipStart })
          .onConflictDoNothing()
          .returning({ id: emperors.id });
        if (!row) return null;
        const [fleet] = await tx.insert(fleets).values({ emperorId: row.id, number: 1, systemId: home.id }).returning({ id: fleets.id });
        await tx.insert(ships).values(STARTING_FLEET.map((classId) => ({ fleetId: fleet!.id, classId, hull: getShipClass(classId)!.hull })));
        await discoverAround(tx, this.seed, row.id, home, Math.max(EMPEROR_FLAGSHIP.scannerRangeLy, fleetScannerRangeLy(STARTING_FLEET)));
        await schedule(tx, "ai.emperor", new Date(this.now() + MIN_DECIDE_MS), { emperorId: row.id });
        return row.id;
      });
      if (id) created++;
    }
    return created;
  }

  /** Un sistema del Núcleo con un planeta libre y habitable (el primero, en un orden barajado). */
  private async homeFor(candidates: StarSystemSummary[]): Promise<StarSystemSummary | null> {
    const shuffled = [...candidates].sort(() => this.random() - 0.5);
    for (const s of shuffled.slice(0, 60)) {
      if ((await this.freePlanets(s)).length > 0) return s;
    }
    return null;
  }

  /** Planetas libres y habitables de un sistema, del mejor al peor. */
  private async freePlanets(s: StarSystemSummary): Promise<number[]> {
    const planets = this.detail(s).planets.filter((p) => p.habitability >= AI_EMPEROR.minHabitability);
    if (planets.length === 0) return [];
    const taken = new Set((await this.db.select({ i: colonies.planetIndex }).from(colonies).where(eq(colonies.systemId, s.id))).map((r) => r.i));
    return planets.filter((p) => !taken.has(p.index)).sort((a, b) => b.habitability - a.habitability).map((p) => p.index);
  }

  /** Manejador del evento `ai.emperor`: programa la siguiente y decide tras confirmar. */
  async tick(tx: Tx, emperorId: string): Promise<(() => void) | void> {
    const [row] = await tx.select({ id: emperors.id, kind: emperors.kind }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    if (!row || row.kind !== "ai") return;
    await schedule(tx, "ai.emperor", new Date(this.now() + this.decideMs()), { emperorId });
    return () =>
      void this.decide(emperorId).then(
        (fx) => fx && this.onEffects?.(fx),
        (err: unknown) => this.log?.error({ err, emperorId }, "Fallo en la decisión de un Emperador de la IA"),
      );
  }

  /** Una decisión: colonizar, construir, explorar y comerciar, con las órdenes de un jugador. */
  async decide(emperorId: string): Promise<AiEmperorEffects | null> {
    const [me] = await this.db.select().from(emperors).where(and(eq(emperors.id, emperorId), eq(emperors.kind, "ai"))).limit(1);
    if (!me) return null;
    const persona = this.personality(me.name);
    const fx: AiEmperorEffects = { emperorId, colonies: [], fleets: [], wallet: false, market: [] };
    let own = await this.colonyService.list(emperorId);
    const myFleets = await this.fleetService.byEmperor(emperorId);
    const now = this.now();
    const idle = (f: Fleet) => !(f.travel && f.travel.arriveAt > now) && !f.battleId;
    const at = (f: Fleet) => (f.travel && f.travel.arriveAt <= now ? f.travel.to : f.location).systemId;

    // 1. Primera colonia: con los humanos de su nave, en el sistema donde está.
    if (own.length === 0) {
      const here = findSystem(this.seed, me.systemId);
      const planet = here ? (await this.freePlanets(here))[0] : undefined;
      if (here && planet !== undefined) {
        const need = minColonists(this.detail(here).planets.find((p) => p.index === planet)!.habitability);
        const aboard = (await this.colonyService.humans(emperorId))?.count ?? 0;
        const res = await this.colonyService.claim(emperorId, { systemId: here.id, planetIndex: planet, humans: Math.min(Math.floor(aboard), need + AI_EMPEROR.extraColonists) });
        if (res.ok) fx.colonies.push(res.colonyId);
      }
      own = await this.colonyService.list(emperorId);
    }

    // 2. Colonizadores: los que han llegado reclaman; los parados van a un buen planeta.
    for (const f of myFleets.filter((x) => x.ships.some((s) => s.classId === "colonizer") && idle(x))) {
      const sys = findSystem(this.seed, at(f));
      const free = sys ? await this.freePlanets(sys) : [];
      if (sys && free.length > 0 && !this.territory.owner(sys)) {
        const res = await this.colonyService.claim(emperorId, { systemId: sys.id, planetIndex: free[0]!, fleetId: f.id });
        if (res.ok) {
          fx.colonies.push(res.colonyId);
          fx.fleets.push(f.id);
          continue;
        }
      }
      const target = await this.colonyTarget(emperorId, sys?.position ?? null);
      if (target) {
        const res = await this.fleetService.move(emperorId, f.id, target.id);
        if (res.ok) fx.fleets.push(f.id);
      }
    }

    // 3. Construcción: instalaciones en orden; naves en el astillero de la capital.
    const colonizers = myFleets.reduce((n, f) => n + f.ships.filter((s) => s.classId === "colonizer").length, 0);
    for (const c of own) {
      if (c.builds.length > 0) continue;
      const next = this.nextInstallation(c, persona);
      if (next) {
        const res = await this.colonyService.build(emperorId, c.id, "installation", next);
        if (res.ok) fx.colonies.push(c.id);
        continue;
      }
      if ((c.installations.shipyard ?? 0) === 0) continue;
      const shipNeeded = this.nextShip(persona, myFleets, own.length + colonizers);
      if (shipNeeded) {
        const res = await this.colonyService.build(emperorId, c.id, "ship", shipNeeded);
        if (res.ok) fx.colonies.push(c.id);
      }
    }

    // 4. Exploración: su explorador va a un sistema sin descubrir cercano.
    const explorer = myFleets.find((f) => f.ships.every((s) => s.classId === "explorer") && idle(f));
    if (explorer && this.random() < persona.explore) {
      const from = findSystem(this.seed, at(explorer));
      if (from) {
        const known = new Set(await this.discoveries.list(emperorId));
        const options = systemsInRange(this.seed, from.position, AI_EMPEROR.rangeLy).filter((s) => !known.has(s.id));
        if (options.length > 0) {
          const dest = options[Math.floor(this.random() * options.length)]!;
          const res = await this.fleetService.move(emperorId, explorer.id, dest.id);
          if (res.ok) fx.fleets.push(explorer.id);
        }
      }
    }

    // 5. Comercio: vende los excedentes de su capital.
    if (persona.trades && own.length > 0) await this.trade(emperorId, own, fx);
    return fx;
  }

  private nextInstallation(c: Colony, persona: AiPersonalityDefinition): string | null {
    for (const [id, n] of persona.buildOrder) if ((c.installations[id] ?? 0) < n) return id;
    return null;
  }

  private nextShip(persona: AiPersonalityDefinition, myFleets: Fleet[], coloniesAndColonizers: number): string | null {
    const count = (id: string) => myFleets.reduce((n, f) => n + f.ships.filter((s) => s.classId === id).length, 0);
    if (coloniesAndColonizers < persona.maxColonies) return "colonizer";
    for (const [id, n] of persona.ships) if (count(id) < n) return id;
    return null;
  }

  /**
   * Sistema descubierto, cercano, con un planeta libre y habitable, que no sea
   * territorio alienígena (lo sabe porque lo ha descubierto, como un jugador).
   */
  private async colonyTarget(emperorId: string, from: { x: number; y: number; z: number } | null): Promise<StarSystemSummary | null> {
    const known = await this.discoveries.list(emperorId);
    const scored: Array<{ s: StarSystemSummary; d: number }> = [];
    for (const id of known) {
      const s = findSystem(this.seed, id);
      if (!s || this.territory.owner(s)) continue;
      const d = from ? distance(from, s.position) : 0;
      if (d > AI_EMPEROR.rangeLy) continue;
      scored.push({ s, d });
    }
    scored.sort((a, b) => a.d - b.d);
    for (const { s } of scored.slice(0, 20)) if ((await this.freePlanets(s)).length > 0) return s;
    return null;
  }

  /** Pone a la venta parte de lo que le sobra (cerca del último precio del mercado). */
  private async trade(emperorId: string, own: Colony[], fx: AiEmperorEffects): Promise<void> {
    const capital = own.find((c) => c.capital) ?? own[0]!;
    const view = await this.market.view();
    for (const r of STOCK_IDS) {
      const stock = capital.stock[r];
      const limit = ECONOMY.storage[r] * AI_EMPEROR.sellAbove;
      if (stock <= limit) continue;
      const m = view.resources.find((x) => x.resource === r);
      const ref = m?.last ?? m?.bestBid ?? m?.bestAsk ?? ALIEN_AI.trade.referencePrice[r];
      const quantity = Math.floor((stock - limit) * AI_EMPEROR.sellShare);
      if (quantity < 1) continue;
      const price = Math.max(0.01, Math.round(ref * (1 - AI_EMPEROR.priceSpread) * 100) / 100);
      const res = await this.market.place(emperorId, { resource: r, side: "sell", price, quantity, colonyId: capital.id });
      if (res.ok) {
        fx.market.push(res);
        fx.wallet = true;
      }
      break;
    }
  }

  /** Emperadores de la IA (para los tests y la administración). */
  async list(): Promise<Array<{ id: string; name: string }>> {
    return this.db.select({ id: emperors.id, name: emperors.name }).from(emperors).where(eq(emperors.kind, "ai"));
  }

  /** Sus colonias (para los tests). */
  async coloniesOf(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return (await this.db.select({ id: colonies.id }).from(colonies).where(inArray(colonies.emperorId, ids))).length;
  }
}
