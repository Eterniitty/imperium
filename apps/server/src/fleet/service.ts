import { anyFleetSpeedLyPerHour, FLEET_TACTICS, getAnyShipClass, getShipClass, MOTHERSHIP_HANGAR, MOTHERSHIP_WORKSHOP, SHIP_CLASSES, SHIP_PASSENGERS, type ShipClassId } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { distance, type Cargo, type CommandError, type Fleet, type FleetRoute, type FleetTactic } from "@imperium/shared";
import { isTravelling, refuelCost, shipFuel, shipFuelMax, travelDurationMs } from "@imperium/sim";
import type { ColonyService } from "../colony/service";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, emperors, fleetCargo, fleetRoutes, fleets, mercenaryContracts, resourceLedger, ships } from "../db/schema";
import type { RemotePilot } from "../realtime/hub";
import { findSystem, placeFromRow } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";

const columns = {
  id: fleets.id,
  emperorId: fleets.emperorId,
  number: fleets.number,
  systemId: fleets.systemId,
  destSystemId: fleets.destSystemId,
  departAt: fleets.departAt,
  arriveAt: fleets.arriveAt,
  battleId: fleets.battleId,
  tactic: fleets.tactic,
};
type Row = {
  id: string;
  emperorId: string;
  number: number;
  systemId: string;
  destSystemId: string | null;
  departAt: Date | null;
  arriveAt: Date | null;
  battleId: string | null;
  tactic: string;
};

/** Resultado de una orden de viaje. `fledBattleId`: la batalla de la que huye la flota al salir, si estaba en una. */
export type FleetMoveResult = { ok: true; fleet: Fleet; emperorId: string; fledBattleId: string | null } | { ok: false; error: CommandError };

/** Táctica guardada (texto) → táctica válida (la equilibrada si no se reconoce). */
export function asTactic(value: string): FleetTactic {
  return value in FLEET_TACTICS ? (value as FleetTactic) : "balanced";
}

export const EMPTY_CARGO: Cargo = { metal: 0, volatiles: 0, crystal: 0, alloys: 0, humans: 0 };

/** Capacidad de una flota: bodega (suma de la carga de sus naves) y plazas de pasajeros. */
export function fleetCapacity(classIds: readonly string[]): Fleet["capacity"] {
  let resources = 0;
  let humans = 0;
  for (const id of classIds) {
    resources += getAnyShipClass(id)?.cargo ?? 0;
    humans += SHIP_PASSENGERS[id as ShipClassId] ?? 0;
  }
  return { resources, humans };
}

/** Margen para dar por llegada una flota cuyo evento se procesa un instante antes de tiempo. */
const ARRIVAL_TOLERANCE_MS = 1_000;

/** Flotas y naves de los Emperadores. */
export class FleetService {
  private readonly seed: number;

  constructor(
    private readonly db: Database,
    private readonly config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
  }

  /** Filas → flotas con sus naves (una consulta para todas las naves). */
  private async toFleets(db: Database | Tx, rows: Row[]): Promise<Fleet[]> {
    if (rows.length === 0) return [];
    const shipRows = await db
      .select({ id: ships.id, fleetId: ships.fleetId, classId: ships.classId, hull: ships.hull, humans: ships.humans, design: ships.design, fuel: ships.fuel })
      .from(ships)
      .where(inArray(ships.fleetId, rows.map((r) => r.id)))
      .orderBy(asc(ships.createdAt));
    const ids = rows.map((r) => r.id);
    const [cargoRows, routeRows, contractRows] = await Promise.all([
      db.select().from(fleetCargo).where(inArray(fleetCargo.fleetId, ids)),
      db.select().from(fleetRoutes).where(inArray(fleetRoutes.fleetId, ids)),
      db.select({ fleetId: mercenaryContracts.fleetId, endsAt: mercenaryContracts.endsAt }).from(mercenaryContracts).where(inArray(mercenaryContracts.fleetId, ids)),
    ]);
    const now = this.now();
    return rows.map((r) => {
      const fleetShips = shipRows.filter((s) => s.fleetId === r.id).map(({ id, classId, hull, humans, design, fuel }) => ({
          id,
          classId,
          hull,
          humans,
          ...(design ? { design } : {}),
          fuel: shipFuel({ classId, design, fuel }),
          fuelMax: shipFuelMax({ classId, design }),
        }));
      const c = cargoRows.find((x) => x.fleetId === r.id);
      const route = routeRows.find((x) => x.fleetId === r.id);
      return {
        id: r.id,
        number: r.number,
        ...placeFromRow(this.seed, r, now),
        ships: fleetShips,
        cargo: c ? { metal: c.metal, volatiles: c.volatiles, crystal: c.crystal, alloys: c.alloys, humans: c.humans } : { ...EMPTY_CARGO },
        capacity: fleetCapacity(fleetShips.map((s) => s.classId)),
        route: route
          ? { fromColonyId: route.fromColonyId, toColonyId: route.toColonyId, carry: route.carry as FleetRoute["carry"], humans: route.humans }
          : null,
        battleId: r.battleId,
        tactic: asTactic(r.tactic),
        mercenaryUntil: contractRows.find((x) => x.fleetId === r.id)?.endsAt.getTime() ?? null,
      };
    });
  }

  /**
   * Orden `fleet.pilot`: ¿se puede pilotar a distancia esta nave? La flota es
   * propia, está parada (ni viajando ni en batalla) y la nave es suya y armada.
   */
  async pilotable(emperorId: string, fleetId: string, shipId: string): Promise<{ ok: true; pilot: RemotePilot } | { ok: false; error: CommandError }> {
    const [f] = await this.db.select(columns).from(fleets).where(and(eq(fleets.id, fleetId), eq(fleets.emperorId, emperorId))).limit(1);
    if (!f) return { ok: false, error: "no_fleet" };
    if (f.destSystemId && f.arriveAt && f.arriveAt.getTime() > this.now()) return { ok: false, error: "in_transit" };
    if (f.battleId) return { ok: false, error: "in_battle" };
    const [s] = await this.db
      .select({ id: ships.id, classId: ships.classId, hull: ships.hull })
      .from(ships)
      .where(and(eq(ships.id, shipId), eq(ships.fleetId, fleetId)))
      .limit(1);
    const cls = s ? getShipClass(s.classId as ShipClassId) : undefined;
    if (!s || !cls) return { ok: false, error: "no_fleet" };
    if (cls.combat.weapons.length === 0) return { ok: false, error: "ship_unarmed" };
    const [{ name } = { name: "" }] = await this.db.select({ name: emperors.name }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    const systemId = f.destSystemId ?? f.systemId;
    return { ok: true, pilot: { shipId: s.id, fleetId, systemId, classId: s.classId, hull: s.hull, name } };
  }

  /**
   * Acople en una nave nodriza: la flota es propia, está parada en `systemId`
   * fuera de batalla y lleva una nave con `dockFlagship`. Devuelve su sitio
   * entre las flotas paradas del sistema (el mismo orden que dibuja el
   * cliente) y la colonia propia de menor índice del sistema (punto de reunión).
   */
  async dockInfo(emperorId: string, fleetId: string, systemId: string): Promise<{ ok: true; slot: number; colonyPlanet: number | null; lengthM: number } | { ok: false; error: CommandError }> {
    const all = await this.byEmperor(emperorId);
    const parked = all.filter((f) => !f.travel && !f.battleId && f.location.systemId === systemId).sort((a, b) => a.number - b.number);
    const slot = parked.findIndex((f) => f.id === fleetId);
    const fleet = all.find((f) => f.id === fleetId);
    if (!fleet) return { ok: false, error: "no_fleet" };
    if (fleet.battleId) return { ok: false, error: "in_battle" };
    if (slot < 0) return { ok: false, error: "not_present" };
    const mother = fleet.ships.map((s) => getShipClass(s.classId as ShipClassId)).find((c) => c?.dockFlagship);
    if (!mother) return { ok: false, error: "no_mothership" };
    const own = await this.db.select({ planetIndex: colonies.planetIndex }).from(colonies).where(and(eq(colonies.emperorId, emperorId), eq(colonies.systemId, systemId)));
    const colonyPlanet = own.length ? Math.min(...own.map((c) => c.planetIndex)) : null;
    return { ok: true, slot, colonyPlanet, lengthM: mother.model.lengthM };
  }

  /**
   * Naves que salen a escoltar al Emperador en `systemId` (Fase 9d): las
   * armadas de sus flotas paradas allí fuera de batalla, las más grandes primero.
   */
  async escorts(emperorId: string, systemId: string, max: number): Promise<Array<{ fleetId: string; shipId: string; classId: string; hull: number }>> {
    const all = await this.byEmperor(emperorId);
    const out: Array<{ fleetId: string; shipId: string; classId: string; hull: number; size: number }> = [];
    for (const f of all) {
      if (f.travel || f.battleId || f.location.systemId !== systemId) continue;
      for (const s of f.ships) {
        const cls = getShipClass(s.classId as ShipClassId);
        // La nodriza no sale a escoltar: se queda y lanza su ala de cazas (`MOTHERSHIP_HANGAR`).
        if (cls?.dockFlagship) {
          for (let i = 0; i < MOTHERSHIP_HANGAR.fighters; i++) out.push({ fleetId: f.id, shipId: `wing:${s.id}:${i}`, classId: MOTHERSHIP_HANGAR.classId, hull: getShipClass(MOTHERSHIP_HANGAR.classId)?.hull ?? 100, size: 0 });
          continue;
        }
        if (cls && cls.combat.weapons.length > 0) out.push({ fleetId: f.id, shipId: s.id, classId: s.classId, hull: s.hull, size: cls.hull });
      }
    }
    // Las naves de la flota primero (por tamaño); el ala de cazas aparte, sin contar en el tope.
    const own = out.filter((e) => !e.shipId.startsWith("wing:")).sort((a, b) => b.size - a.size || (a.shipId < b.shipId ? -1 : 1)).slice(0, max);
    return [...own, ...out.filter((e) => e.shipId.startsWith("wing:"))].map(({ size: _size, ...e }) => e);
  }

  /**
   * Naves de las flotas alienígenas paradas en un sistema (fuera de batalla),
   * para sacarlas al espacio local; las más grandes primero, como mucho `max`.
   */
  async alienShipsIn(systemId: string, max: number): Promise<Array<{ actorId: string; factionId: string; fleetId: string; shipId: string; classId: string; hull: number }>> {
    const now = new Date(this.now());
    const rows = await this.db
      .select({ actorId: fleets.emperorId, factionId: emperors.factionId, fleetId: fleets.id, shipId: ships.id, classId: ships.classId, hull: ships.hull })
      .from(fleets)
      .innerJoin(emperors, eq(emperors.id, fleets.emperorId))
      .innerJoin(ships, eq(ships.fleetId, fleets.id))
      .where(and(eq(emperors.kind, "alien"), isNull(fleets.battleId), or(and(isNull(fleets.destSystemId), eq(fleets.systemId, systemId)), and(eq(fleets.destSystemId, systemId), lte(fleets.arriveAt, now)))));
    return rows
      .filter((r): r is typeof r & { factionId: string } => r.factionId !== null)
      .map((r) => ({ ...r, size: getAnyShipClass(r.classId)?.hull ?? 0 }))
      .sort((a, b) => b.size - a.size || (a.shipId < b.shipId ? -1 : 1))
      .slice(0, max)
      .map(({ size: _size, ...r }) => r);
  }

  /**
   * Dónde esperará una flota que llega a `systemId`: su sitio entre las flotas
   * paradas allí (irá detrás de las que ya están) y la colonia propia de menor
   * índice del sistema (punto de reunión). Para llegar acoplado en su nodriza.
   */
  async arrivalSlot(emperorId: string, fleetId: string, systemId: string): Promise<{ slot: number; colonyPlanet: number | null }> {
    const all = await this.byEmperor(emperorId);
    const slot = all.filter((f) => f.id !== fleetId && !f.travel && !f.battleId && f.location.systemId === systemId).length;
    const own = await this.db.select({ planetIndex: colonies.planetIndex }).from(colonies).where(and(eq(colonies.emperorId, emperorId), eq(colonies.systemId, systemId)));
    return { slot, colonyPlanet: own.length ? Math.min(...own.map((c) => c.planetIndex)) : null };
  }

  /**
   * Taller de las naves nodriza (`MOTHERSHIP_WORKSHOP`, cada minuto): en cada
   * flota con nodriza y fuera de batalla, repara el casco de sus naves dañadas
   * con las aleaciones de su bodega. Devuelve las flotas que cambiaron.
   */
  async repairInMotherships(): Promise<Array<{ emperorId: string; fleetId: string }>> {
    const motherIds = SHIP_CLASSES.filter((c) => c.dockFlagship).map((c) => c.id);
    if (motherIds.length === 0) return [];
    const holders = await this.db
      .selectDistinct({ fleetId: fleets.id, emperorId: fleets.emperorId })
      .from(fleets)
      .innerJoin(ships, eq(ships.fleetId, fleets.id))
      .where(and(inArray(ships.classId, motherIds), isNull(fleets.battleId)));
    const changed: Array<{ emperorId: string; fleetId: string }> = [];
    for (const h of holders) {
      const did = await this.db.transaction(async (tx) => {
        const [cargo] = await tx.select().from(fleetCargo).where(eq(fleetCargo.fleetId, h.fleetId)).for("update").limit(1);
        if (!cargo || cargo.alloys <= 0) return false;
        let alloys = cargo.alloys;
        const list = await tx.select({ id: ships.id, classId: ships.classId, hull: ships.hull }).from(ships).where(eq(ships.fleetId, h.fleetId));
        let any = false;
        for (const s of list) {
          const max = getShipClass(s.classId as ShipClassId)?.hull ?? s.hull;
          const want = Math.min(max - s.hull, MOTHERSHIP_WORKSHOP.hullPerMinute, Math.floor(alloys / MOTHERSHIP_WORKSHOP.alloysPerHull));
          if (want <= 0) continue;
          alloys -= want * MOTHERSHIP_WORKSHOP.alloysPerHull;
          await tx.update(ships).set({ hull: s.hull + want }).where(eq(ships.id, s.id));
          any = true;
        }
        if (!any) return false;
        await tx.update(fleetCargo).set({ alloys }).where(eq(fleetCargo.fleetId, h.fleetId));
        await tx.insert(resourceLedger).values({ emperorId: h.emperorId, reason: "mothership_repair", ref: `fleet:${h.fleetId}`, alloys: alloys - cargo.alloys });
        return true;
      });
      if (did) changed.push(h);
    }
    return changed;
  }

  /** Casco de una nave tras pilotarla a distancia. */
  async setShipHull(fleetId: string, shipId: string, hull: number): Promise<void> {
    await this.db.update(ships).set({ hull: Math.max(1, Math.round(hull)) }).where(and(eq(ships.id, shipId), eq(ships.fleetId, fleetId)));
  }

  /** Una nave pilotada a distancia ha caído: sale de su flota (y la flota, si se queda vacía, desaparece). */
  async removeShip(fleetId: string, shipId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(ships).where(and(eq(ships.id, shipId), eq(ships.fleetId, fleetId)));
      const [left] = await tx.select({ id: ships.id }).from(ships).where(eq(ships.fleetId, fleetId)).limit(1);
      if (!left) await tx.delete(fleets).where(eq(fleets.id, fleetId));
    });
  }

  /** Orden `fleet.tactic`: cambia la táctica de una flota propia, esté donde esté (en batalla, desde la ronda siguiente). */
  async setTactic(emperorId: string, fleetId: string, tactic: FleetTactic): Promise<boolean> {
    const rows = await this.db
      .update(fleets)
      .set({ tactic })
      .where(and(eq(fleets.id, fleetId), eq(fleets.emperorId, emperorId)))
      .returning({ id: fleets.id });
    return rows.length > 0;
  }

  async byEmperor(emperorId: string): Promise<Fleet[]> {
    const rows = await this.db.select(columns).from(fleets).where(eq(fleets.emperorId, emperorId)).orderBy(asc(fleets.number));
    return this.toFleets(this.db, rows);
  }

  async byId(fleetId: string): Promise<Fleet | null> {
    const rows = await this.db.select(columns).from(fleets).where(eq(fleets.id, fleetId)).limit(1);
    return (await this.toFleets(this.db, rows))[0] ?? null;
  }

  /**
   * Orden de viaje de una flota del Emperador. Bloquea la fila, valida, guarda
   * el viaje y programa la llegada, todo en la misma transacción.
   */
  async move(emperorId: string, fleetId: string, systemId: string): Promise<FleetMoveResult> {
    return this.db.transaction((tx) => this.moveTx(tx, emperorId, fleetId, systemId));
  }

  /** Igual que `move`, dentro de una transacción ya abierta (las rutas automáticas la usan al llegar). */
  async moveTx(tx: Tx, emperorId: string, fleetId: string, systemId: string): Promise<FleetMoveResult> {
    const dest = findSystem(this.seed, systemId);
    if (!dest) return { ok: false, error: "unknown_system" };
    {
      // Solo flotas propias: la de otro jugador responde igual que una inexistente.
      const rows = await tx
        .select(columns)
        .from(fleets)
        .where(and(eq(fleets.id, fleetId), eq(fleets.emperorId, emperorId)))
        .for("update")
        .limit(1);
      const [current] = await this.toFleets(tx, rows);
      if (!current) return { ok: false, error: "no_fleet" };
      const now = this.now();
      if (isTravelling(current, now)) return { ok: false, error: "in_transit" };
      if (current.location.systemId === dest.id) return { ok: false, error: "already_there" };

      // Combustible (solo los jugadores: la IA no se queda tirada): cada nave gasta la distancia.
      const [owner] = await tx.select({ kind: emperors.kind }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
      if (owner?.kind === "player") {
        const ly = distance(current.location.position, dest.position);
        if (current.ships.some((s) => s.fuel + 1e-6 < ly)) return { ok: false, error: "no_fuel_fleet" };
        for (const s of current.ships) await tx.update(ships).set({ fuel: Math.max(0, s.fuel - ly) }).where(eq(ships.id, s.id));
      }

      const speed = anyFleetSpeedLyPerHour(current.ships.map((s) => s.classId)) * this.config.TIME_SCALE;
      const arriveAt = now + travelDurationMs(current.location.position, dest.position, speed);
      // Salir de un sistema donde combate es huir: deja la batalla.
      const updated = await tx
        .update(fleets)
        .set({ systemId: current.location.systemId, destSystemId: dest.id, departAt: new Date(now), arriveAt: new Date(arriveAt), battleId: null })
        .where(eq(fleets.id, fleetId))
        .returning(columns);
      await schedule(tx, "fleet.arrive", new Date(arriveAt), { fleetId });
      const [fleet] = await this.toFleets(tx, updated);
      return { ok: true, fleet: fleet!, emperorId, fledBattleId: current.battleId };
    }
  }

  /**
   * Manejador de la llegada: deja la flota en su destino y sin viaje. Devuelve
   * el Emperador dueño para avisarle, o null si la flota ya no existe o no tocaba.
   */
  async arrive(tx: Tx, fleetId: string): Promise<string | null> {
    const [row] = await tx.select(columns).from(fleets).where(eq(fleets.id, fleetId)).for("update").limit(1);
    if (!row?.destSystemId || !row.arriveAt) return null;
    if (row.arriveAt.getTime() > this.now() + ARRIVAL_TOLERANCE_MS) return null;
    await tx.update(fleets).set({ systemId: row.destSystemId, destSystemId: null, departAt: null, arriveAt: null }).where(eq(fleets.id, fleetId));
    return row.emperorId;
  }

  /**
   * Llena los depósitos de una flota parada con volátiles de una colonia propia
   * de su sistema (la que más tenga). Reposta nave a nave mientras alcance.
   * `auto`: al llegar (sin colonia, o sin nada que repostar, no es un error).
   */
  async refuel(tx: Tx, emperorId: string, fleetId: string, colonyService: ColonyService, auto = false): Promise<{ ok: true; colonyId: string | null } | { ok: false; error: CommandError }> {
    const rows = await tx.select(columns).from(fleets).where(and(eq(fleets.id, fleetId), eq(fleets.emperorId, emperorId))).for("update").limit(1);
    const [fleet] = await this.toFleets(tx, rows);
    if (!fleet) return { ok: false, error: "no_fleet" };
    const now = this.now();
    if (isTravelling(fleet, now)) return { ok: false, error: "in_transit" };
    const shipRows = await tx.select({ id: ships.id, classId: ships.classId, hull: ships.hull, design: ships.design, fuel: ships.fuel }).from(ships).where(eq(ships.fleetId, fleetId));
    const needs = shipRows.map((s) => ({ s, cost: refuelCost(s) })).filter((x) => x.cost > 0);
    if (needs.length === 0) return { ok: true, colonyId: null };
    const own = await tx
      .select({ id: colonies.id, volatiles: colonies.volatiles })
      .from(colonies)
      .where(and(eq(colonies.emperorId, emperorId), eq(colonies.systemId, fleet.location.systemId)));
    if (own.length === 0) return auto ? { ok: true, colonyId: null } : { ok: false, error: "no_colony_here" };
    const colony = own.sort((a, b) => b.volatiles - a.volatiles)[0]!;
    // Lo que se puede pagar con las existencias de ahora (resueltas): nave a nave.
    const stock = await colonyService.stockAt(tx, emperorId, colony.id, now);
    if (!stock) return auto ? { ok: true, colonyId: null } : { ok: false, error: "no_colony_here" };
    let budget = stock.volatiles;
    let paid = 0;
    for (const { s, cost } of needs) {
      if (cost > budget) continue;
      budget -= cost;
      paid += cost;
      await tx.update(ships).set({ fuel: null }).where(eq(ships.id, s.id));
    }
    if (paid === 0) return auto ? { ok: true, colonyId: null } : { ok: false, error: "insufficient_resources" };
    const res = await colonyService.adjustStock(tx, emperorId, colony.id, { volatiles: -paid }, "refuel", `fleet:${fleetId}`, now);
    if (!res.ok) return auto ? { ok: true, colonyId: null } : res;
    return { ok: true, colonyId: colony.id };
  }
}