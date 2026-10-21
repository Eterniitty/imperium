import { randomInt } from "node:crypto";
import { CONTACT_SENSORS, EMPEROR_FLAGSHIP, FLEET_BATTLE, STOCK_IDS } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import {
  distance,
  type Battle,
  type BattleOutcome,
  type BattleRoundReport,
  type Cargo,
  type FleetContact,
  type ShipCounts,
  type WorldPosition,
} from "@imperium/shared";
import { battleRoundMs, battleRoundSeed, battleShip, canAttack, isTravelling, resolveBattleRound, type BattleShip } from "@imperium/sim";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { ColonyService } from "../colony/service";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { battleRounds, battles, battleSides, colonies, emperorAllies, emperors, fleetCargo, fleets, resourceLedger, ships } from "../db/schema";
import { fleetScannerRangeLy } from "../discovery/service";
import { findSystem, placeFromRow } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";
import { EMPTY_CARGO, fleetCapacity, type FleetMoveResult, type FleetService } from "../fleet/service";
import type { LogisticsService } from "../logistics/service";

/** Lo que ha cambiado (para avisar a los jugadores tras confirmar la transacción). */
export class WarEffects {
  /** Batallas cuyo estado hay que enviar a sus bandos. */
  readonly battles = new Set<string>();
  /** Flotas cambiadas (o destruidas): id → dueño. */
  readonly fleets = new Map<string, string>();
  /** Colonias cambiadas (rutas reanudadas, capital que paga menos mantenimiento): id → dueño. */
  readonly colonies = new Map<string, string>();

  get empty(): boolean {
    return this.battles.size + this.fleets.size + this.colonies.size === 0;
  }
}

/** Informe guardado de una ronda (índices 0 y 1: los bandos). */
interface StoredReport {
  dealt: [number, number];
  absorbed: [number, number];
  lost: [ShipCounts, ShipCounts];
}

/** Rondas que se envían en la vista de una batalla. */
const VIEW_ROUNDS = 10;
/** Batallas acabadas que se siguen mostrando: las de la última hora (como mucho, 10). */
const RECENT_MS = 3_600_000;
const RECENT_MAX = 10;
const EPS = 1e-6;

/**
 * Guerra (Fase 9a): combate de flotas por rondas. Cuando coinciden en un
 * sistema flotas paradas de dos Emperadores hostiles (que no son compañeros
 * mutuos), empieza una batalla; cada ronda es un evento `battle.round` que se
 * resuelve con `resolveBattleRound` de `@imperium/sim`. Una orden de viaje
 * saca a la flota de la batalla (huye). Un sistema tiene como mucho una
 * batalla en curso; quien llega y no es de ninguno de sus bandos espera a que
 * termine.
 */
export class WarService {
  private readonly seed: number;

  /** Multiplicador del escudo de batalla en un sistema (Defensas del Núcleo; lo enlaza `app.ts`). */
  private shieldFactor: (systemId: string) => number = () => 1;

  /** Enlaza el multiplicador del escudo de batalla por sistema (proyectos comunes de la humanidad). */
  setShieldFactor(get: (systemId: string) => number): void {
    this.shieldFactor = get;
  }

  /**
   * Fase 11: ¿combaten dos dueños que no son compañeros? Por defecto, sí (dos
   * Emperadores). Con facciones alienígenas lo decide `AlienService` (su
   * postura, el rencor y el Núcleo Humano, donde nunca combaten).
   */
  private hostility: (db: Database | Tx, a: string, b: string, systemId: string) => Promise<boolean> = async () => true;
  /** Se llama al interceptar una flota alienígena (rencor de su facción), dentro de la misma transacción. */
  private onAlienIntercept: ((tx: Tx, emperorId: string, factionId: string) => Promise<void>) | null = null;

  setAlienHooks(hostility: WarService["hostility"], onIntercept: (tx: Tx, emperorId: string, factionId: string) => Promise<void>): void {
    this.hostility = hostility;
    this.onAlienIntercept = onIntercept;
  }

  constructor(
    private readonly db: Database,
    private readonly config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    private readonly fleetService: FleetService,
    private readonly colonyService: ColonyService,
    private readonly logistics: LogisticsService,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
  }

  // --- Hostilidad ---

  /** Pares de compañeros (aliados mutuos) entre estos Emperadores, como "a|b" con a < b. */
  private async allyPairs(db: Database | Tx, ids: string[]): Promise<Set<string>> {
    if (ids.length < 2) return new Set();
    const rows = await db
      .select({ a: emperorAllies.emperorId, b: emperorAllies.allyId })
      .from(emperorAllies)
      .where(and(inArray(emperorAllies.emperorId, ids), inArray(emperorAllies.allyId, ids)));
    const added = new Set(rows.map((r) => `${r.a}|${r.b}`));
    const pairs = new Set<string>();
    for (const r of rows) if (added.has(`${r.b}|${r.a}`)) pairs.add(r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`);
    return pairs;
  }

  /**
   * ¿Son hostiles dos dueños en este sistema? No si son compañeros mutuos; si
   * no, la regla de la hostilidad (la de las facciones y el Núcleo Humano).
   * La usan los asedios (Fase 9b).
   */
  async areHostile(db: Database | Tx, a: string, b: string, systemId: string): Promise<boolean> {
    if (a === b) return false;
    if ((await this.allyPairs(db, [a, b])).size > 0) return false;
    return this.hostility(db, a, b, systemId);
  }

  // --- Llegadas y comienzo de las batallas ---

  /**
   * Manejador de la llegada de una flota (dentro de la transacción del evento).
   * Si su Emperador ya combate en ese sistema, se une a su bando; si no hay
   * batalla y hay flotas hostiles paradas, empieza una. `inBattle` dice si la
   * flota ha entrado en combate (si no, sigue su ruta, si la tiene).
   */
  async onArrive(tx: Tx, fleetId: string): Promise<{ fx: WarEffects; inBattle: boolean }> {
    const fx = new WarEffects();
    const [fleet] = await tx
      .select({ id: fleets.id, emperorId: fleets.emperorId, systemId: fleets.systemId, destSystemId: fleets.destSystemId })
      .from(fleets)
      .where(eq(fleets.id, fleetId))
      .limit(1);
    if (!fleet || fleet.destSystemId !== null) return { fx, inBattle: false };
    const [ongoing] = await tx
      .select({ id: battles.id })
      .from(battles)
      .where(and(eq(battles.systemId, fleet.systemId), isNull(battles.endedAt)))
      .for("update")
      .limit(1);
    if (ongoing) {
      const [mine] = await tx
        .select({ side: battleSides.side })
        .from(battleSides)
        .where(and(eq(battleSides.battleId, ongoing.id), eq(battleSides.emperorId, fleet.emperorId)))
        .limit(1);
      // Batalla ajena: espera a que termine.
      if (!mine) return { fx, inBattle: false };
      await tx.update(fleets).set({ battleId: ongoing.id }).where(eq(fleets.id, fleet.id));
      fx.battles.add(ongoing.id);
      fx.fleets.set(fleet.id, fleet.emperorId);
      return { fx, inBattle: true };
    }
    await this.startIfHostile(tx, fleet.systemId, fleet.emperorId, fx);
    return { fx, inBattle: fx.fleets.has(fleet.id) };
  }

  /**
   * Si en el sistema hay flotas paradas (y fuera de combate) de dos Emperadores
   * hostiles y al menos uno puede atacar, empieza una batalla entre ellos con
   * todas esas flotas. `prefer` (quien acaba de llegar) tiene prioridad y va en
   * el bando 1; el bando 0 es quien ya estaba. Devuelve el id de la batalla.
   */
  private async startIfHostile(tx: Tx, systemId: string, prefer: string | null, fx: WarEffects): Promise<string | null> {
    const rows = await tx
      .select({ id: fleets.id, emperorId: fleets.emperorId, createdAt: fleets.createdAt })
      .from(fleets)
      .where(and(eq(fleets.systemId, systemId), isNull(fleets.destSystemId), isNull(fleets.battleId)))
      .orderBy(asc(fleets.createdAt), asc(fleets.id));
    if (rows.length < 2) return null;
    const shipRows = await tx
      .select({ id: ships.id, fleetId: ships.fleetId, classId: ships.classId, hull: ships.hull })
      .from(ships)
      .where(inArray(ships.fleetId, rows.map((r) => r.id)));
    const byEmperor = new Map<string, { fleetIds: string[]; ships: BattleShip[] }>();
    for (const r of rows) {
      const own = shipRows.filter((s) => s.fleetId === r.id);
      if (own.length === 0) continue;
      const e = byEmperor.get(r.emperorId) ?? { fleetIds: [], ships: [] };
      e.fleetIds.push(r.id);
      e.ships.push(...own.map((s) => battleShip(s.id, s.classId, s.hull)));
      byEmperor.set(r.emperorId, e);
    }
    // Orden: quien llega primero; los demás por orden de llegada de su flota más antigua.
    const order = [...byEmperor.keys()];
    if (prefer && byEmperor.has(prefer)) {
      order.splice(order.indexOf(prefer), 1);
      order.unshift(prefer);
    }
    if (order.length < 2) return null;
    const allies = await this.allyPairs(tx, order);
    for (const a of order) {
      for (const b of order) {
        if (a === b || allies.has(a < b ? `${a}|${b}` : `${b}|${a}`)) continue;
        const A = byEmperor.get(a)!;
        const B = byEmperor.get(b)!;
        if (!canAttack(A.ships) && !canAttack(B.ships)) continue;
        if (!(await this.hostility(tx, a, b, systemId))) continue;
        // Bando 0: el que ya estaba (b); bando 1: el que llega (a).
        const now = this.now();
        const nextRoundAt = new Date(now + battleRoundMs(this.config.TIME_SCALE));
        const [battle] = await tx
          .insert(battles)
          .values({ systemId, seed: randomInt(0, 2 ** 31 - 1), startedAt: new Date(now), nextRoundAt })
          .returning({ id: battles.id });
        await tx.insert(battleSides).values([
          { battleId: battle!.id, side: 0, emperorId: b },
          { battleId: battle!.id, side: 1, emperorId: a },
        ]);
        await tx
          .update(fleets)
          .set({ battleId: battle!.id })
          .where(inArray(fleets.id, [...A.fleetIds, ...B.fleetIds]));
        await schedule(tx, "battle.round", nextRoundAt, { battleId: battle!.id });
        fx.battles.add(battle!.id);
        for (const id of A.fleetIds) fx.fleets.set(id, a);
        for (const id of B.fleetIds) fx.fleets.set(id, b);
        return battle!.id;
      }
    }
    return null;
  }

  // --- Rondas ---

  /** Manejador del evento `battle.round`: resuelve una ronda y, si toca, termina la batalla. */
  async round(tx: Tx, battleId: string): Promise<WarEffects | null> {
    const [battle] = await tx.select().from(battles).where(eq(battles.id, battleId)).for("update").limit(1);
    if (!battle || battle.endedAt) return null;
    const now = this.now();
    const fx = new WarEffects();
    fx.battles.add(battle.id);
    const sides = await tx.select().from(battleSides).where(eq(battleSides.battleId, battle.id));
    const sideOf = new Map(sides.map((s) => [s.emperorId, s.side as 0 | 1]));
    const fleetRows = await tx
      .select({ id: fleets.id, emperorId: fleets.emperorId })
      .from(fleets)
      .where(eq(fleets.battleId, battle.id))
      .for("update");
    const shipRows = fleetRows.length
      ? await tx
          .select({ id: ships.id, fleetId: ships.fleetId, classId: ships.classId, hull: ships.hull, humans: ships.humans })
          .from(ships)
          .where(inArray(ships.fleetId, fleetRows.map((f) => f.id)))
      : [];
    const fleetOwner = new Map(fleetRows.map((f) => [f.id, f.emperorId]));
    for (const f of fleetRows) fx.fleets.set(f.id, f.emperorId);
    const bySide: [BattleShip[], BattleShip[]] = [[], []];
    const shield = this.shieldFactor(battle.systemId);
    for (const s of shipRows) {
      const side = sideOf.get(fleetOwner.get(s.fleetId)!);
      if (side !== undefined) bySide[side].push(battleShip(s.id, s.classId, s.hull, shield));
    }

    // Un bando sin naves en la batalla ha huido (o su Emperador ya no existe).
    if (bySide[0].length === 0 || bySide[1].length === 0) {
      const outcome = (i: 0 | 1): BattleOutcome => (bySide[i].length === 0 ? "fled" : "won");
      await this.end(tx, battle.id, battle.systemId, battle.round, [outcome(0), outcome(1)], fx);
      return fx;
    }

    const result = resolveBattleRound(bySide, battleRoundSeed(battle.seed, battle.round));
    const round = battle.round + 1;

    // Daños: el casco que queda; las destruidas se borran (y su carga se pierde).
    const destroyed = new Set(result.destroyed);
    for (const s of shipRows) {
      const hull = result.hull[s.id];
      if (hull !== undefined && !destroyed.has(s.id) && hull !== s.hull) await tx.update(ships).set({ hull }).where(eq(ships.id, s.id));
    }
    if (destroyed.size > 0) {
      // Las naves perdidas dejan de costar mantenimiento: cada capital se cobra hasta ahora.
      const losers = new Set(shipRows.filter((s) => destroyed.has(s.id)).map((s) => fleetOwner.get(s.fleetId)!));
      for (const emperorId of losers) {
        const capital = await this.colonyService.settleCapital(tx, emperorId, now);
        if (capital) fx.colonies.set(capital, emperorId);
      }
      await tx.delete(ships).where(inArray(ships.id, [...destroyed]));
      for (const f of fleetRows) {
        const lostShips = shipRows.filter((s) => s.fleetId === f.id && destroyed.has(s.id));
        if (lostShips.length === 0) continue;
        const left = shipRows.filter((s) => s.fleetId === f.id && !destroyed.has(s.id));
        await this.loseCargo(tx, f.id, f.emperorId, left.map((s) => s.classId), lostShips.reduce((a, s) => a + s.humans, 0));
        if (left.length === 0) await tx.delete(fleets).where(eq(fleets.id, f.id));
      }
    }
    const report: StoredReport = { dealt: result.dealt, absorbed: result.absorbed, lost: result.lost };
    await tx.insert(battleRounds).values({ battleId: battle.id, round, report });

    const alive = bySide.map((side) => side.filter((s) => !destroyed.has(s.id)).map((s) => ({ ...s, hull: result.hull[s.id]! }))) as [BattleShip[], BattleShip[]];
    let outcomes: [BattleOutcome, BattleOutcome] | null = null;
    if (alive[0].length === 0 && alive[1].length === 0) outcomes = ["lost", "lost"];
    else if (alive[0].length === 0) outcomes = ["lost", "won"];
    else if (alive[1].length === 0) outcomes = ["won", "lost"];
    // Sin vencedor tras el máximo de rondas, o si ya nadie puede hacer daño: tablas.
    else if (round >= FLEET_BATTLE.maxRounds || (!canAttack(alive[0]) && !canAttack(alive[1]))) outcomes = ["draw", "draw"];

    if (outcomes) {
      await this.end(tx, battle.id, battle.systemId, round, outcomes, fx);
    } else {
      const nextRoundAt = new Date(now + battleRoundMs(this.config.TIME_SCALE));
      await tx.update(battles).set({ round, nextRoundAt }).where(eq(battles.id, battle.id));
      await schedule(tx, "battle.round", nextRoundAt, { battleId: battle.id });
    }
    return fx;
  }

  /**
   * Carga perdida al caer naves de una flota: la que ya no cabe en la bodega
   * (proporcional) y los pasajeros sin plaza, más los colonos de las naves
   * destruidas. Todo se asienta en el libro como `battle_loss`.
   */
  async loseCargo(tx: Tx, fleetId: string, emperorId: string, leftClasses: string[], humansAboard: number): Promise<void> {
    const [row] = await tx.select().from(fleetCargo).where(eq(fleetCargo.fleetId, fleetId)).for("update").limit(1);
    const cargo: Cargo = row ? { metal: row.metal, volatiles: row.volatiles, crystal: row.crystal, alloys: row.alloys, humans: row.humans } : { ...EMPTY_CARGO };
    const cap = fleetCapacity(leftClasses);
    const total = STOCK_IDS.reduce((a, r) => a + cargo[r], 0);
    const keep = total > cap.resources + EPS ? cap.resources / total : 1;
    const lost: Cargo = { ...EMPTY_CARGO };
    for (const r of STOCK_IDS) lost[r] = cargo[r] * (1 - keep);
    lost.humans = Math.max(0, cargo.humans - cap.humans);
    const after: Cargo = { ...EMPTY_CARGO };
    for (const k of [...STOCK_IDS, "humans"] as const) after[k] = Math.max(0, cargo[k] - lost[k]);
    if (row && leftClasses.length > 0) await tx.update(fleetCargo).set(after).where(eq(fleetCargo.fleetId, fleetId));
    const humans = lost.humans + humansAboard;
    if (STOCK_IDS.every((r) => lost[r] <= EPS) && humans <= EPS) return;
    await tx.insert(resourceLedger).values({
      emperorId,
      colonyId: null,
      reason: "battle_loss",
      ref: `fleet:${fleetId}`,
      metal: -lost.metal,
      volatiles: -lost.volatiles,
      crystal: -lost.crystal,
      alloys: -lost.alloys,
      humans: -humans,
    });
  }

  /**
   * Termina una batalla: guarda el resultado de cada bando, saca a las flotas,
   * reanuda las rutas de los convoyes que sobreviven y comprueba si en el
   * sistema quedan otros hostiles que deban combatir.
   */
  private async end(tx: Tx, battleId: string, systemId: string, round: number, outcomes: [BattleOutcome, BattleOutcome], fx: WarEffects): Promise<void> {
    await tx.update(battles).set({ round, nextRoundAt: null, endedAt: new Date(this.now()) }).where(eq(battles.id, battleId));
    for (const side of [0, 1] as const)
      await tx.update(battleSides).set({ outcome: outcomes[side] }).where(and(eq(battleSides.battleId, battleId), eq(battleSides.side, side)));
    const survivors = await tx.update(fleets).set({ battleId: null }).where(eq(fleets.battleId, battleId)).returning({ id: fleets.id, emperorId: fleets.emperorId });
    for (const f of survivors) {
      fx.fleets.set(f.id, f.emperorId);
      // Convoyes: siguen su ruta (si la tienen) como si acabasen de llegar.
      const step = await this.logistics.onArrive(tx, f.id);
      if (step) for (const id of step.colonyIds) fx.colonies.set(id, step.emperorId);
    }
    await this.startIfHostile(tx, systemId, null, fx);
  }

  // --- Interceptar ---

  /**
   * Flotas enemigas en tránsito que detectan los sensores del Emperador: las
   * que salen de o van a un sistema al alcance de una de sus flotas paradas,
   * de su nave o de una de sus colonias. No incluye a sus compañeros.
   */
  async contacts(emperorId: string): Promise<FleetContact[]> {
    const now = this.now();
    const sensors = await this.sensors(emperorId);
    if (sensors.length === 0) return [];
    return this.contactsFrom(emperorId, sensors, now);
  }

  /**
   * Sensores de un Emperador: sus flotas paradas (escáner de su mejor nave), su
   * nave (si no viaja) y sus colonias. Lo usan los contactos y los avistamientos
   * de flotas alienígenas.
   */
  async sensors(emperorId: string): Promise<Array<{ position: WorldPosition; range: number }>> {
    const now = this.now();
    const sensors: Array<{ position: WorldPosition; range: number }> = [];
    const own = await this.db.select().from(fleets).where(eq(fleets.emperorId, emperorId));
    if (own.length) {
      const classes = await this.db.select({ fleetId: ships.fleetId, classId: ships.classId }).from(ships).where(inArray(ships.fleetId, own.map((f) => f.id)));
      for (const f of own) {
        const place = placeFromRow(this.seed, f, now);
        if (isTravelling(place, now)) continue;
        sensors.push({ position: place.location.position, range: fleetScannerRangeLy(classes.filter((c) => c.fleetId === f.id).map((c) => c.classId)) });
      }
    }
    const [me] = await this.db.select().from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    if (!me) return [];
    const mePlace = placeFromRow(this.seed, me, now);
    if (!isTravelling(mePlace, now)) sensors.push({ position: mePlace.location.position, range: EMPEROR_FLAGSHIP.scannerRangeLy });
    for (const c of await this.db.select({ systemId: colonies.systemId }).from(colonies).where(eq(colonies.emperorId, emperorId))) {
      const s = findSystem(this.seed, c.systemId);
      if (s) sensors.push({ position: s.position, range: CONTACT_SENSORS.colonyRangeLy });
    }
    return sensors;
  }

  private async contactsFrom(emperorId: string, sensors: Array<{ position: WorldPosition; range: number }>, now: number): Promise<FleetContact[]> {
    const moving = await this.db
      .select({
        id: fleets.id,
        emperorId: fleets.emperorId,
        systemId: fleets.systemId,
        destSystemId: fleets.destSystemId,
        departAt: fleets.departAt,
        arriveAt: fleets.arriveAt,
        name: emperors.name,
        factionId: emperors.factionId,
      })
      .from(fleets)
      .innerJoin(emperors, eq(emperors.id, fleets.emperorId))
      .where(and(sql`${fleets.emperorId} <> ${emperorId}`, isNotNull(fleets.destSystemId), gt(fleets.arriveAt, new Date(now))))
      .orderBy(asc(fleets.arriveAt))
      .limit(500);
    if (moving.length === 0) return [];
    const allies = await this.allyPairs(this.db, [emperorId, ...new Set(moving.map((m) => m.emperorId))]);
    const seen = (p: WorldPosition) => sensors.some((s) => distance(s.position, p) <= s.range);
    const counts = await this.db
      .select({ fleetId: ships.fleetId, n: sql<number>`count(*)::int` })
      .from(ships)
      .where(inArray(ships.fleetId, moving.map((m) => m.id)))
      .groupBy(ships.fleetId);
    const out: FleetContact[] = [];
    for (const m of moving) {
      const key = emperorId < m.emperorId ? `${emperorId}|${m.emperorId}` : `${m.emperorId}|${emperorId}`;
      if (allies.has(key)) continue;
      const place = placeFromRow(this.seed, m, now);
      if (!place.travel || !(seen(place.location.position) || seen(place.travel.to.position))) continue;
      out.push({
        fleetId: m.id,
        emperorName: m.name,
        factionId: m.factionId,
        ships: counts.find((c) => c.fleetId === m.id)?.n ?? 0,
        from: place.location,
        to: place.travel.to,
        departAt: place.travel.departAt,
        arriveAt: place.travel.arriveAt,
      });
      if (out.length >= 50) break;
    }
    return out;
  }

  /**
   * Orden `fleet.intercept`: la flota viaja al destino de una flota enemiga
   * visible en tránsito; al coincidir allí, combaten.
   */
  async intercept(emperorId: string, fleetId: string, targetFleetId: string): Promise<FleetMoveResult> {
    const target = (await this.contacts(emperorId)).find((c) => c.fleetId === targetFleetId);
    if (!target) return { ok: false, error: "no_target" };
    return this.db.transaction(async (tx) => {
      const res = await this.fleetService.moveTx(tx, emperorId, fleetId, target.to.systemId);
      // Interceptar a una facción alienígena es un acto hostil: aumenta su rencor.
      if (res.ok && target.factionId && this.onAlienIntercept) await this.onAlienIntercept(tx, emperorId, target.factionId);
      return res;
    });
  }

  // --- Vistas para los jugadores ---

  /** Emperadores de los bandos de una batalla. */
  async participants(battleId: string): Promise<string[]> {
    const rows = await this.db.select({ emperorId: battleSides.emperorId }).from(battleSides).where(eq(battleSides.battleId, battleId));
    return rows.map((r) => r.emperorId);
  }

  /** Batallas que ve un Emperador: las que siguen en curso y las acabadas hace poco. */
  async list(emperorId: string): Promise<Battle[]> {
    const since = new Date(this.now() - RECENT_MS);
    const rows = await this.db
      .select({ id: battles.id })
      .from(battles)
      .innerJoin(battleSides, eq(battleSides.battleId, battles.id))
      .where(and(eq(battleSides.emperorId, emperorId), or(isNull(battles.endedAt), gt(battles.endedAt, since))))
      .orderBy(desc(battles.startedAt))
      .limit(RECENT_MAX);
    const out: Battle[] = [];
    for (const r of rows) {
      const v = await this.view(emperorId, r.id);
      if (v) out.push(v);
    }
    return out;
  }

  /** Una batalla desde el punto de vista de uno de sus bandos (null si no es suya). */
  async view(emperorId: string, battleId: string): Promise<Battle | null> {
    const [battle] = await this.db.select().from(battles).where(eq(battles.id, battleId)).limit(1);
    if (!battle) return null;
    const sides = await this.db
      .select({ side: battleSides.side, emperorId: battleSides.emperorId, outcome: battleSides.outcome, name: emperors.name, factionId: emperors.factionId })
      .from(battleSides)
      .innerJoin(emperors, eq(emperors.id, battleSides.emperorId))
      .where(eq(battleSides.battleId, battleId));
    const mine = sides.find((s) => s.emperorId === emperorId);
    if (!mine) return null;
    const enemy = sides.find((s) => s.emperorId !== emperorId);
    const me = mine.side as 0 | 1;
    const them = me === 0 ? 1 : 0;
    const shipRows = await this.db
      .select({ emperorId: fleets.emperorId, classId: ships.classId })
      .from(ships)
      .innerJoin(fleets, eq(fleets.id, ships.fleetId))
      .where(eq(fleets.battleId, battleId));
    const own: ShipCounts = {};
    const foe: ShipCounts = {};
    for (const s of shipRows) {
      const counts = s.emperorId === emperorId ? own : foe;
      counts[s.classId] = (counts[s.classId] ?? 0) + 1;
    }
    const roundRows = await this.db
      .select()
      .from(battleRounds)
      .where(eq(battleRounds.battleId, battleId))
      .orderBy(desc(battleRounds.round))
      .limit(VIEW_ROUNDS);
    const rounds: BattleRoundReport[] = roundRows.reverse().map((r) => {
      const rep = r.report as StoredReport;
      return { round: r.round, at: r.createdAt.getTime(), dealt: rep.dealt[me], taken: rep.dealt[them], lost: rep.lost[me], killed: rep.lost[them] };
    });
    const system = findSystem(this.seed, battle.systemId);
    return {
      id: battle.id,
      systemId: battle.systemId,
      systemName: system?.name ?? battle.systemId,
      startedAt: battle.startedAt.getTime(),
      endedAt: battle.endedAt?.getTime() ?? null,
      round: battle.round,
      nextRoundAt: battle.nextRoundAt?.getTime() ?? null,
      outcome: (mine.outcome as BattleOutcome | null) ?? "ongoing",
      enemyName: enemy?.name ?? "?",
      enemyFactionId: enemy?.factionId ?? null,
      own,
      foe,
      rounds,
    };
  }
}
