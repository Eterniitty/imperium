import { randomInt } from "node:crypto";
import { ALIEN_SIEGE, SIEGE } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import type { Cargo, CommandError, Siege, SiegeAssaultReport, SiegeOutcome, SiegeState } from "@imperium/shared";
import {
  colonyDefense,
  doctrineDefense,
  flagshipHumansAfter,
  gameHours,
  isTravelling,
  planetDefenders,
  realDurationMs,
  resolveAssault,
  siegeAttrition,
  siegePower,
  siegeProgressPerHour,
  siegeStepSeed,
} from "@imperium/sim";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { ColonyService } from "../colony/service";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, emperors, fleetCargo, fleets, resourceLedger, sieges, ships } from "../db/schema";
import { findSystem, inHumanCore, placeFromRow } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";
import { EMPTY_CARGO } from "../fleet/service";
import type { MarketService } from "../market/service";
import type { WarService } from "./service";

type SiegeRow = typeof sieges.$inferSelect;

/** Lo que ha cambiado por un asedio, para avisar a los afectados tras confirmar la transacción. */
export class SiegeEffects {
  /** Asedios cuyo estado hay que enviar a atacante y defensor. */
  readonly sieges = new Set<string>();
  /** Flotas cambiadas (naves dañadas o destruidas, tropas desembarcadas): id → dueño. */
  readonly fleets = new Map<string, string>();
  /** Colonias cambiadas: [colonia, dueño a quien avisar] (también el que la pierde, que recibe null). */
  readonly colonies: Array<[string, string]> = [];
  /** Emperadores a quienes reenviar todas sus colonias (capital y mantenimiento cambian). */
  readonly allColonies = new Set<string>();
  /** Carteras cambiadas (órdenes de compra canceladas). */
  readonly wallets = new Set<string>();
  /** Humanos de la nave del Emperador cambiados (desembarco desde la nave). */
  readonly humans = new Set<string>();
}

export type SiegeResult = { ok: true; siegeId: string; fx: SiegeEffects } | { ok: false; error: CommandError };

/** Lo que el asedio necesita de las facciones alienígenas (lo enlaza `app.ts`). */
export interface SiegeAlienHooks {
  isActor(emperorId: string): boolean;
  factionOf(emperorId: string): string | null;
  /** Asediar una colonia de una facción suma rencor. */
  onSieged(tx: Tx, emperorId: string, factionId: string): Promise<void>;
}

const EPS = 1e-6;
/** Resoluciones como poco cada tanto tiempo real (con escalas de tiempo altas). */
const MIN_TICK_MS = 1_000;
const RECENT_MAX = 20;

interface ForceShip {
  id: string;
  fleetId: string;
  classId: string;
  hull: number;
  humans: number;
}

/**
 * Conquista de planetas (Fase 9b). Un Emperador con una flota armada parada
 * en el sistema de una colonia ajena la asedia (`siege.start`); cada
 * `SIEGE.tickGameMinutes` un evento `siege.tick` resuelve el progreso, el daño
 * de las plataformas defensivas a las naves que asedian y si el asedio sigue
 * en pie (presencia sostenida). Con el progreso completo, el atacante
 * desembarca tropas —humanos de sus flotas o de su nave— (`siege.assault`); si
 * superan a los defensores, la colonia pasa a ser suya con sus pérdidas
 * (`ColonyService.capture`). Las facciones alienígenas no desembarcan humanos:
 * al completar el asedio, ocupan la colonia.
 */
export class SiegeService {
  private readonly seed: number;
  private readonly timeScale: number;
  aliens: SiegeAlienHooks | null = null;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    private readonly colonyService: ColonyService,
    private readonly wars: WarService,
    private readonly market: MarketService,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
    this.timeScale = config.TIME_SCALE;
  }

  private tickMs(): number {
    return Math.max(MIN_TICK_MS, realDurationMs(SIEGE.tickGameMinutes / 60, this.timeScale));
  }

  // --- Fuerzas presentes ---

  /** Naves del Emperador paradas en el sistema: las que no combaten y si alguna flota suya combate allí. */
  private async forces(db: Database | Tx, emperorId: string, systemId: string): Promise<{ idle: ForceShip[]; inBattle: boolean }> {
    const rows = await db
      .select({ id: fleets.id, battleId: fleets.battleId })
      .from(fleets)
      .where(and(eq(fleets.emperorId, emperorId), eq(fleets.systemId, systemId), isNull(fleets.destSystemId)));
    const idleIds = rows.filter((r) => !r.battleId).map((r) => r.id);
    const idle = idleIds.length
      ? await db.select({ id: ships.id, fleetId: ships.fleetId, classId: ships.classId, hull: ships.hull, humans: ships.humans }).from(ships).where(inArray(ships.fleetId, idleIds))
      : [];
    return { idle, inBattle: rows.some((r) => r.battleId) };
  }

  private armed(list: ForceShip[]): ForceShip[] {
    return list.filter((s) => siegePower([s.classId]) > 0);
  }

  /** ¿Tiene el defensor naves armadas paradas (y fuera de combate) en el sistema? */
  private async defended(db: Database | Tx, defenderId: string | null, systemId: string): Promise<boolean> {
    if (!defenderId) return false;
    const f = await this.forces(db, defenderId, systemId);
    return this.armed(f.idle).length > 0;
  }

  /** ¿Está el Emperador en sus primeras horas (protegido)? Los actores alienígenas nunca. */
  private async protectedNovice(db: Database | Tx, emperorId: string): Promise<boolean> {
    if (this.aliens?.isActor(emperorId)) return false;
    const [row] = await db.select({ createdAt: emperors.createdAt }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    if (!row) return false;
    return gameHours(row.createdAt.getTime(), this.now(), this.timeScale) < SIEGE.noviceGraceHours;
  }

  // --- Empezar y levantar ---

  /** Orden `siege.start`. */
  async start(attackerId: string, colonyId: string): Promise<SiegeResult> {
    return this.db.transaction((tx) => this.startTx(tx, attackerId, colonyId));
  }

  /** Igual que `start`, dentro de una transacción (la IA alienígena la usa en su decisión). */
  async startTx(tx: Tx, attackerId: string, colonyId: string): Promise<SiegeResult> {
    const now = this.now();
    const [colony] = await tx.select().from(colonies).where(eq(colonies.id, colonyId)).for("update").limit(1);
    if (!colony) return { ok: false, error: "no_colony" };
    if (colony.emperorId === attackerId) return { ok: false, error: "own_colony" };
    const defenderId = colony.emperorId;
    const [attacker] = await tx.select({ kind: emperors.kind }).from(emperors).where(eq(emperors.id, attackerId)).limit(1);
    if (!attacker) return { ok: false, error: "no_emperor" };
    const defenderFaction = defenderId ? (this.aliens?.factionOf(defenderId) ?? null) : null;
    if (defenderId && !defenderFaction) {
      // Compañeros, el Núcleo Humano para la IA y las facciones, y la gracia de los nuevos.
      if (!(await this.wars.areHostile(tx, attackerId, defenderId, colony.systemId))) return { ok: false, error: "protected" };
      if (await this.protectedNovice(tx, defenderId)) return { ok: false, error: "protected" };
    } else if (defenderFaction && inHumanCore(colony.systemId)) {
      return { ok: false, error: "protected" };
    } else if (!defenderId && attacker.kind !== "player" && inHumanCore(colony.systemId)) {
      // La IA no conquista en el Núcleo Humano (ni siquiera colonias independientes).
      return { ok: false, error: "protected" };
    }
    const [active] = await tx.select({ id: sieges.id }).from(sieges).where(and(eq(sieges.colonyId, colony.id), isNull(sieges.endedAt))).limit(1);
    if (active) return { ok: false, error: "already_besieged" };
    const f = await this.forces(tx, attackerId, colony.systemId);
    const armed = this.armed(f.idle);
    if (armed.length === 0) return { ok: false, error: f.inBattle ? "in_battle" : "no_armed_fleet" };
    if (await this.defended(tx, defenderId, colony.systemId)) return { ok: false, error: "defended" };

    const locked = await this.colonyService.lockAny(tx, colony.id, now);
    if (!locked) return { ok: false, error: "unknown_planet" };
    const attack = siegePower(armed.map((s) => s.classId));
    const defense = colonyDefense(locked.state.population, locked.counts) * doctrineDefense(locked.row.governor);
    const nextTickAt = new Date(now + this.tickMs());
    const [row] = await tx
      .insert(sieges)
      .values({
        colonyId: colony.id,
        systemId: colony.systemId,
        attackerId,
        defenderId,
        seed: randomInt(0, 2 ** 31 - 1),
        resolvedAt: new Date(now),
        startedAt: new Date(now),
        state: "advancing",
        attack,
        defense,
        defenders: planetDefenders(locked.state.population, locked.counts),
        nextTickAt,
      })
      .returning({ id: sieges.id });
    await schedule(tx, "siege.tick", nextTickAt, { siegeId: row!.id });
    if (defenderFaction && this.aliens) await this.aliens.onSieged(tx, attackerId, defenderFaction);
    const fx = new SiegeEffects();
    fx.sieges.add(row!.id);
    return { ok: true, siegeId: row!.id, fx };
  }

  /** Orden `siege.lift`: el atacante abandona el asedio. */
  async lift(attackerId: string, siegeId: string): Promise<SiegeResult> {
    return this.db.transaction(async (tx): Promise<SiegeResult> => {
      const [siege] = await tx
        .select()
        .from(sieges)
        .where(and(eq(sieges.id, siegeId), eq(sieges.attackerId, attackerId), isNull(sieges.endedAt)))
        .for("update")
        .limit(1);
      if (!siege) return { ok: false, error: "no_siege" };
      const fx = new SiegeEffects();
      await this.end(tx, siege, "lifted", fx);
      return { ok: true, siegeId, fx };
    });
  }

  private async end(tx: Tx, siege: SiegeRow, outcome: Exclude<SiegeOutcome, "ongoing">, fx: SiegeEffects): Promise<void> {
    await tx.update(sieges).set({ endedAt: new Date(this.now()), outcome, nextTickAt: null }).where(eq(sieges.id, siege.id));
    fx.sieges.add(siege.id);
  }

  // --- Resolución periódica ---

  /** Manejador del evento `siege.tick`. */
  async tick(tx: Tx, siegeId: string): Promise<SiegeEffects | null> {
    const [siege] = await tx.select().from(sieges).where(eq(sieges.id, siegeId)).for("update").limit(1);
    if (!siege || siege.endedAt) return null;
    const now = this.now();
    const fx = new SiegeEffects();
    fx.sieges.add(siege.id);
    const colony = await this.colonyService.lockAny(tx, siege.colonyId, now);
    // La colonia cambió de manos por otra vía (otro conquistador, la ocupación…): el asedio ya no tiene sentido.
    if (!colony || colony.row.emperorId !== siege.defenderId) {
      await this.end(tx, siege, "void", fx);
      return fx;
    }
    let f = await this.forces(tx, siege.attackerId, siege.systemId);
    if (this.armed(f.idle).length === 0 && !f.inBattle) {
      await this.end(tx, siege, "broken", fx);
      return fx;
    }
    const hours = gameHours(siege.resolvedAt.getTime(), now, this.timeScale);
    const contested = await this.defended(tx, siege.defenderId, siege.systemId);
    const attack = siegePower(this.armed(f.idle).map((s) => s.classId));
    const defense = colonyDefense(colony.state.population, colony.counts) * doctrineDefense(colony.row.governor);
    let progress = siege.progress;
    let state: SiegeState;
    if (this.armed(f.idle).length === 0) state = "battle";
    else if (contested) state = "contested";
    else {
      progress = Math.min(1, progress + siegeProgressPerHour(attack, defense) * hours);
      state = progress >= 1 - EPS ? "ready" : "advancing";
    }
    if (state === "ready") progress = 1;

    // Las defensas de la colonia disparan a las naves que la asedian (las que no combaten en otra parte).
    if (f.idle.length > 0 && hours > 0) {
      const hit = siegeAttrition(f.idle, colony.counts, hours, siegeStepSeed(siege.seed, siege.step));
      if (Object.keys(hit.hull).length > 0) {
        await this.damage(tx, siege.attackerId, f.idle, hit.hull, hit.destroyed, now, fx);
        f = await this.forces(tx, siege.attackerId, siege.systemId);
        if (this.armed(f.idle).length === 0 && !f.inBattle) {
          await tx.update(sieges).set({ progress, resolvedAt: new Date(now), step: siege.step + 1 }).where(eq(sieges.id, siege.id));
          await this.end(tx, siege, "broken", fx);
          return fx;
        }
      }
    }

    const nextTickAt = new Date(now + this.tickMs());
    await tx
      .update(sieges)
      .set({
        progress,
        resolvedAt: new Date(now),
        state,
        attack,
        defense,
        defenders: planetDefenders(colony.state.population, colony.counts),
        step: siege.step + 1,
        nextTickAt,
      })
      .where(eq(sieges.id, siege.id));

    // Las facciones alienígenas no desembarcan humanos: al completar el asedio, ocupan la colonia.
    if (state === "ready" && this.aliens?.isActor(siege.attackerId)) {
      await this.captureFor(tx, { ...siege, progress, step: siege.step + 1 }, now, 0, ALIEN_SIEGE.occupationPopulationLoss, fx);
      return fx;
    }
    await schedule(tx, "siege.tick", nextTickAt, { siegeId: siege.id });
    return fx;
  }

  /** Aplica el daño a las naves: casco nuevo, destruidas (con su carga y pasajeros) y flotas vacías. */
  private async damage(tx: Tx, emperorId: string, list: ForceShip[], hull: Record<string, number>, destroyed: string[], now: number, fx: SiegeEffects): Promise<void> {
    const dead = new Set(destroyed);
    for (const s of list) {
      const h = hull[s.id];
      if (h !== undefined && !dead.has(s.id)) await tx.update(ships).set({ hull: h }).where(eq(ships.id, s.id));
      if (h !== undefined) fx.fleets.set(s.fleetId, emperorId);
    }
    if (dead.size === 0) return;
    const capital = await this.colonyService.settleCapital(tx, emperorId, now);
    if (capital) fx.colonies.push([capital, emperorId]);
    await tx.delete(ships).where(inArray(ships.id, [...dead]));
    for (const fleetId of new Set(list.filter((s) => dead.has(s.id)).map((s) => s.fleetId))) {
      const left = list.filter((s) => s.fleetId === fleetId && !dead.has(s.id));
      const humans = list.filter((s) => s.fleetId === fleetId && dead.has(s.id)).reduce((a, s) => a + s.humans, 0);
      await this.wars.loseCargo(tx, fleetId, emperorId, left.map((s) => s.classId), humans);
      if (left.length === 0) await tx.delete(fleets).where(eq(fleets.id, fleetId));
    }
  }

  // --- Desembarco y captura ---

  /**
   * Orden `siege.assault`: con el asedio completo y la órbita aún controlada,
   * desembarcan las tropas (humanos de una flota propia del sistema o de la
   * nave del Emperador). Si superan a los defensores, la colonia es suya.
   */
  async assault(attackerId: string, siegeId: string, fleetId?: string, troops?: number): Promise<SiegeResult> {
    return this.db.transaction(async (tx): Promise<SiegeResult> => {
      const [siege] = await tx
        .select()
        .from(sieges)
        .where(and(eq(sieges.id, siegeId), eq(sieges.attackerId, attackerId), isNull(sieges.endedAt)))
        .for("update")
        .limit(1);
      if (!siege) return { ok: false, error: "no_siege" };
      if (siege.progress < 1 - EPS) return { ok: false, error: "siege_not_ready" };
      const f = await this.forces(tx, attackerId, siege.systemId);
      if (this.armed(f.idle).length === 0) return { ok: false, error: f.inBattle ? "in_battle" : "no_armed_fleet" };
      if (await this.defended(tx, siege.defenderId, siege.systemId)) return { ok: false, error: "defended" };
      const now = this.now();
      const fx = new SiegeEffects();
      fx.sieges.add(siege.id);

      const colony = await this.colonyService.lockAny(tx, siege.colonyId, now);
      if (!colony || colony.row.emperorId !== siege.defenderId) {
        await this.end(tx, siege, "void", fx);
        return { ok: false, error: "no_siege" };
      }

      // Las tropas embarcan... y bajan.
      let landed = 0;
      if (fleetId) {
        const [fleet] = await tx.select().from(fleets).where(and(eq(fleets.id, fleetId), eq(fleets.emperorId, attackerId))).for("update").limit(1);
        if (!fleet) return { ok: false, error: "no_fleet" };
        const place = placeFromRow(this.seed, fleet, now);
        if (isTravelling(place, now)) return { ok: false, error: "in_transit" };
        if (place.location.systemId !== siege.systemId) return { ok: false, error: "not_present" };
        if (fleet.battleId) return { ok: false, error: "in_battle" };
        const [c] = await tx.select().from(fleetCargo).where(eq(fleetCargo.fleetId, fleet.id)).for("update").limit(1);
        const cargo: Cargo = c ? { metal: c.metal, volatiles: c.volatiles, crystal: c.crystal, alloys: c.alloys, humans: c.humans } : { ...EMPTY_CARGO };
        const aboard = await tx.select({ id: ships.id, humans: ships.humans }).from(ships).where(eq(ships.fleetId, fleet.id)).orderBy(desc(ships.humans));
        const available = Math.floor(cargo.humans + aboard.reduce((a, s) => a + s.humans, 0));
        landed = Math.min(troops ?? available, available);
        if (landed < 1) return { ok: false, error: "no_troops" };
        // Primero los pasajeros de la bodega, luego los colonos de las naves.
        let left = landed;
        const fromCargo = Math.min(left, cargo.humans);
        left -= fromCargo;
        if (c && fromCargo > 0) await tx.update(fleetCargo).set({ humans: cargo.humans - fromCargo }).where(eq(fleetCargo.fleetId, fleet.id));
        for (const s of aboard) {
          if (left <= 0) break;
          const take = Math.min(left, s.humans);
          if (take <= 0) continue;
          await tx.update(ships).set({ humans: s.humans - take }).where(eq(ships.id, s.id));
          left -= take;
        }
        fx.fleets.set(fleet.id, attackerId);
      } else {
        const [emp] = await tx.select().from(emperors).where(eq(emperors.id, attackerId)).for("update").limit(1);
        if (!emp) return { ok: false, error: "no_emperor" };
        if (emp.deadAt) return { ok: false, error: "dead" };
        const place = placeFromRow(this.seed, emp, now);
        if (isTravelling(place, now)) return { ok: false, error: "in_transit" };
        if (place.location.systemId !== siege.systemId) return { ok: false, error: "not_present" };
        const aboard = flagshipHumansAfter(emp.humans, gameHours(emp.humansAt.getTime(), now, this.timeScale));
        landed = Math.min(troops ?? Math.floor(aboard), Math.floor(aboard));
        if (landed < 1) return { ok: false, error: "no_troops" };
        await tx.update(emperors).set({ humans: aboard - landed, humansAt: new Date(now) }).where(eq(emperors.id, attackerId));
        fx.humans.add(attackerId);
      }
      await tx.insert(resourceLedger).values({ emperorId: attackerId, colonyId: null, reason: "assault_troops", ref: `siege:${siege.id}`, humans: -landed });

      const result = resolveAssault(landed, colony.state.population, colony.counts);
      const report: SiegeAssaultReport = {
        at: now,
        troops: landed,
        defenders: result.defenders,
        captured: result.captured,
        attackerLosses: result.attackerLosses,
        populationLosses: result.populationLosses,
      };
      await tx.update(sieges).set({ lastAssault: report }).where(eq(sieges.id, siege.id));
      if (result.captured) {
        // Las milicias caen; los supervivientes se quedan como colonos.
        const state = { population: Math.max(0, colony.state.population - result.populationLosses), stock: colony.state.stock };
        if (colony.row.emperorId) await this.colonyService.writeState(tx, colony.row.id, state, Math.max(now, colony.row.resolvedAt.getTime()));
        else await tx.update(colonies).set({ population: state.population }).where(eq(colonies.id, colony.row.id));
        await this.captureFor(tx, siege, now, result.survivors, 0, fx);
      } else {
        const state = { population: Math.max(0, colony.state.population - result.populationLosses), stock: colony.state.stock };
        if (colony.row.emperorId) await this.colonyService.writeState(tx, colony.row.id, state, Math.max(now, colony.row.resolvedAt.getTime()));
        else await tx.update(colonies).set({ population: state.population }).where(eq(colonies.id, colony.row.id));
        if (result.populationLosses > 0)
          await tx.insert(resourceLedger).values({ emperorId: colony.row.emperorId, colonyId: colony.row.id, reason: "assault_defense", ref: `siege:${siege.id}`, humans: -result.populationLosses });
        if (colony.row.emperorId) fx.colonies.push([colony.row.id, colony.row.emperorId]);
      }
      return { ok: true, siegeId: siege.id, fx };
    });
  }

  /**
   * Toma la colonia: cancela sus órdenes del mercado (lo retenido vuelve a sus
   * almacenes y pasa al conquistador; los créditos, a quien los puso), la
   * captura (`ColonyService.capture`) y termina el asedio.
   */
  private async captureFor(tx: Tx, siege: SiegeRow, at: number, survivors: number, extraPopulationLoss: number, fx: SiegeEffects): Promise<void> {
    const market = await this.market.cancelForColony(tx, siege.colonyId, at);
    for (const w of market.wallets) fx.wallets.add(w);
    const res = await this.colonyService.capture(tx, siege.colonyId, siege.attackerId, at, {
      seed: siegeStepSeed(siege.seed, 1_000_000 + siege.step),
      survivors,
      extraPopulationLoss,
      ref: `siege:${siege.id}`,
    });
    if (res?.oldOwnerId) {
      fx.colonies.push([siege.colonyId, res.oldOwnerId]);
      fx.allColonies.add(res.oldOwnerId);
    }
    fx.colonies.push([siege.colonyId, siege.attackerId]);
    fx.allColonies.add(siege.attackerId);
    await this.end(tx, siege, "captured", fx);
  }

  // --- Vistas ---

  /** Emperadores a quienes enseñar un asedio: atacante y defensor. */
  async participants(siegeId: string): Promise<string[]> {
    const [row] = await this.db.select({ a: sieges.attackerId, d: sieges.defenderId }).from(sieges).where(eq(sieges.id, siegeId)).limit(1);
    if (!row) return [];
    return [row.a, ...(row.d ? [row.d] : [])].filter((id) => !this.aliens?.isActor(id));
  }

  /** Asedios de un Emperador (atacante o defensor): en curso y acabados hace poco. */
  async list(emperorId: string): Promise<Siege[]> {
    const since = new Date(this.now() - SIEGE.recentHours * 3_600_000);
    const rows = await this.db
      .select({ id: sieges.id })
      .from(sieges)
      .where(and(or(eq(sieges.attackerId, emperorId), eq(sieges.defenderId, emperorId)), or(isNull(sieges.endedAt), gt(sieges.endedAt, since))))
      .orderBy(desc(sieges.startedAt))
      .limit(RECENT_MAX);
    const out: Siege[] = [];
    for (const r of rows) {
      const v = await this.view(emperorId, r.id);
      if (v) out.push(v);
    }
    return out;
  }

  /** Un asedio visto por su atacante o su defensor (null si no es de ninguno). */
  async view(emperorId: string, siegeId: string): Promise<Siege | null> {
    const [s] = await this.db.select().from(sieges).where(eq(sieges.id, siegeId)).limit(1);
    if (!s) return null;
    const role = s.attackerId === emperorId ? "attacker" : s.defenderId === emperorId ? "defender" : null;
    if (!role) return null;
    const ids = [s.attackerId, ...(s.defenderId ? [s.defenderId] : [])];
    const people = await this.db.select({ id: emperors.id, name: emperors.name, factionId: emperors.factionId }).from(emperors).where(inArray(emperors.id, ids));
    const attacker = people.find((p) => p.id === s.attackerId);
    const defender = s.defenderId ? people.find((p) => p.id === s.defenderId) : undefined;
    const [colony] = await this.db.select({ planetIndex: colonies.planetIndex, name: colonies.name }).from(colonies).where(eq(colonies.id, s.colonyId)).limit(1);
    const planetIndex = colony?.planetIndex ?? 0;
    return {
      id: s.id,
      colonyId: s.colonyId,
      systemId: s.systemId,
      systemName: findSystem(this.seed, s.systemId)?.name ?? s.systemId,
      planetIndex,
      planetName: this.colonyService.planetName(s.systemId, planetIndex),
      colonyName: colony?.name ?? null,
      role,
      attackerName: attacker?.name ?? "?",
      attackerFactionId: attacker?.factionId ?? null,
      defenderName: defender?.name ?? null,
      defenderFactionId: defender?.factionId ?? null,
      progress: s.progress,
      ratePerHour: !s.endedAt && s.state === "advancing" ? siegeProgressPerHour(s.attack, s.defense) * this.timeScale : 0,
      state: s.state as SiegeState,
      outcome: (s.outcome as SiegeOutcome | null) ?? "ongoing",
      attack: s.attack,
      defense: s.defense,
      defenders: s.defenders,
      startedAt: s.startedAt.getTime(),
      endedAt: s.endedAt?.getTime() ?? null,
      nextTickAt: s.nextTickAt?.getTime() ?? null,
      lastAssault: (s.lastAssault as SiegeAssaultReport | null) ?? null,
      at: s.resolvedAt.getTime(),
    };
  }

  /** Colonias asediadas ahora en un sistema (para marcar los planetas). */
  async besiegedIn(systemId: string): Promise<Set<string>> {
    const rows = await this.db.select({ colonyId: sieges.colonyId }).from(sieges).where(and(eq(sieges.systemId, systemId), isNull(sieges.endedAt)));
    return new Set(rows.map((r) => r.colonyId));
  }

  /** Asedios en curso de un Emperador como atacante (para la IA). */
  async activeBy(db: Database | Tx, attackerId: string): Promise<SiegeRow[]> {
    return db.select().from(sieges).where(and(eq(sieges.attackerId, attackerId), isNull(sieges.endedAt)));
  }

  /** Asedios en curso contra colonias de un Emperador (para la IA que defiende). */
  async activeAgainst(db: Database | Tx, defenderId: string): Promise<SiegeRow[]> {
    return db.select().from(sieges).where(and(eq(sieges.defenderId, defenderId), isNull(sieges.endedAt)));
  }

  /** Para la exportación de datos de un Emperador. */
  async exportFor(emperorId: string) {
    return this.db.select().from(sieges).where(or(eq(sieges.attackerId, emperorId), eq(sieges.defenderId, emperorId)));
  }
}
