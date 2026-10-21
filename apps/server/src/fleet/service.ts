import { anyFleetSpeedLyPerHour, getAnyShipClass, SHIP_PASSENGERS, type ShipClassId } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import type { Cargo, CommandError, Fleet, FleetRoute } from "@imperium/shared";
import { isTravelling, travelDurationMs } from "@imperium/sim";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { fleetCargo, fleetRoutes, fleets, ships } from "../db/schema";
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
};

/** Resultado de una orden de viaje. `fledBattleId`: la batalla de la que huye la flota al salir, si estaba en una. */
export type FleetMoveResult = { ok: true; fleet: Fleet; emperorId: string; fledBattleId: string | null } | { ok: false; error: CommandError };

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
      .select({ id: ships.id, fleetId: ships.fleetId, classId: ships.classId, hull: ships.hull, humans: ships.humans })
      .from(ships)
      .where(inArray(ships.fleetId, rows.map((r) => r.id)))
      .orderBy(asc(ships.createdAt));
    const ids = rows.map((r) => r.id);
    const [cargoRows, routeRows] = await Promise.all([
      db.select().from(fleetCargo).where(inArray(fleetCargo.fleetId, ids)),
      db.select().from(fleetRoutes).where(inArray(fleetRoutes.fleetId, ids)),
    ]);
    const now = this.now();
    return rows.map((r) => {
      const fleetShips = shipRows.filter((s) => s.fleetId === r.id).map(({ id, classId, hull, humans }) => ({ id, classId, hull, humans }));
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
      };
    });
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
}
