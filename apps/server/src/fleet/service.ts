import { fleetSpeedLyPerHour } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import type { CommandError, Fleet } from "@imperium/shared";
import { isTravelling, travelDurationMs } from "@imperium/sim";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { fleets, ships } from "../db/schema";
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
};
type Row = { id: string; emperorId: string; number: number; systemId: string; destSystemId: string | null; departAt: Date | null; arriveAt: Date | null };

export type FleetMoveResult = { ok: true; fleet: Fleet; emperorId: string } | { ok: false; error: CommandError };

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
    const now = this.now();
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      ...placeFromRow(this.seed, r, now),
      ships: shipRows.filter((s) => s.fleetId === r.id).map(({ id, classId, hull, humans }) => ({ id, classId, hull, humans })),
    }));
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
    const dest = findSystem(this.seed, systemId);
    if (!dest) return { ok: false, error: "unknown_system" };

    return this.db.transaction(async (tx): Promise<FleetMoveResult> => {
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

      const speed = fleetSpeedLyPerHour(current.ships.map((s) => s.classId)) * this.config.TIME_SCALE;
      const arriveAt = now + travelDurationMs(current.location.position, dest.position, speed);
      const updated = await tx
        .update(fleets)
        .set({ systemId: current.location.systemId, destSystemId: dest.id, departAt: new Date(now), arriveAt: new Date(arriveAt) })
        .where(eq(fleets.id, fleetId))
        .returning(columns);
      await schedule(tx, "fleet.arrive", new Date(arriveAt), { fleetId });
      const [fleet] = await this.toFleets(tx, updated);
      return { ok: true, fleet: fleet!, emperorId };
    });
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
