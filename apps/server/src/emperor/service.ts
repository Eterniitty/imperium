import { universeSeedFromString } from "@imperium/procgen";
import type { CommandError, Emperor } from "@imperium/shared";
import { isTravelling, settle, travelDurationMs } from "@imperium/sim";
import { eq, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { emperors } from "../db/schema";
import { findSystem, nameKey, pickSpawnSystem, toLocation } from "./world";

const columns = {
  id: emperors.id,
  name: emperors.name,
  systemId: emperors.systemId,
  destSystemId: emperors.destSystemId,
  departAt: emperors.departAt,
  arriveAt: emperors.arriveAt,
};
type Row = { id: string; name: string; systemId: string; destSystemId: string | null; departAt: Date | null; arriveAt: Date | null };

export type CreateResult = { ok: true; emperor: Emperor } | { ok: false; error: "emperor_exists" | "name_taken" };
export type MoveResult = { ok: true; emperor: Emperor } | { ok: false; error: CommandError };

/**
 * Lectura y escritura de Emperadores. Toda la lógica de reglas que no depende
 * de la base de datos está en `@imperium/sim`.
 */
export class EmperorService {
  private readonly seed: number;
  private readonly speed: number;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "TRAVEL_SPEED_LYH">,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
    this.speed = config.TRAVEL_SPEED_LYH;
  }

  /** Fila → Emperador, con el viaje ya resuelto si terminó. */
  private toEmperor(row: Row): Emperor {
    const system = findSystem(this.seed, row.systemId);
    // Solo pasaría si cambiase la semilla o el generador con Emperadores ya creados.
    if (!system) throw new Error(`El Emperador ${row.id} está en un sistema inexistente: ${row.systemId}`);
    let travel: Emperor["travel"] = null;
    if (row.destSystemId && row.departAt && row.arriveAt) {
      const dest = findSystem(this.seed, row.destSystemId);
      if (!dest) throw new Error(`El Emperador ${row.id} viaja a un sistema inexistente: ${row.destSystemId}`);
      travel = { to: toLocation(dest), departAt: row.departAt.getTime(), arriveAt: row.arriveAt.getTime() };
    }
    return settle({ id: row.id, name: row.name, location: toLocation(system), travel }, this.now());
  }

  async byAccount(accountId: string): Promise<Emperor | null> {
    const [row] = await this.db.select(columns).from(emperors).where(eq(emperors.accountId, accountId)).limit(1);
    return row ? this.toEmperor(row) : null;
  }

  async byId(id: string): Promise<Emperor | null> {
    const [row] = await this.db.select(columns).from(emperors).where(eq(emperors.id, id)).limit(1);
    return row ? this.toEmperor(row) : null;
  }

  /** Todos los Emperadores. Vale mientras sean pocos; luego habrá zonas de interés por sector. */
  async all(): Promise<Emperor[]> {
    const rows = await this.db.select(columns).from(emperors).orderBy(emperors.createdAt);
    return rows.map((r) => this.toEmperor(r));
  }

  async create(accountId: string, name: string): Promise<CreateResult> {
    const spawn = pickSpawnSystem(this.seed);
    // Sin objetivo de conflicto: si ya hay Emperador en la cuenta o el nombre está
    // cogido, no inserta nada. Así dos peticiones simultáneas no crean dos.
    const [row] = await this.db
      .insert(emperors)
      .values({ accountId, name, nameKey: nameKey(name), systemId: spawn.id })
      .onConflictDoNothing()
      .returning(columns);
    if (row) return { ok: true, emperor: this.toEmperor(row) };
    const existing = await this.byAccount(accountId);
    return { ok: false, error: existing ? "emperor_exists" : "name_taken" };
  }

  /**
   * Orden de viaje. La fila se bloquea durante la transacción: dos órdenes
   * simultáneas del mismo Emperador se aplican una detrás de otra.
   */
  async move(accountId: string, systemId: string): Promise<MoveResult> {
    const dest = findSystem(this.seed, systemId);
    if (!dest) return { ok: false, error: "unknown_system" };

    return this.db.transaction(async (tx): Promise<MoveResult> => {
      const [row] = await tx.select(columns).from(emperors).where(eq(emperors.accountId, accountId)).for("update").limit(1);
      if (!row) return { ok: false, error: "no_emperor" };
      const now = this.now();
      const current = this.toEmperor(row);
      if (isTravelling(current, now)) return { ok: false, error: "in_transit" };
      if (current.location.systemId === dest.id) return { ok: false, error: "already_there" };

      const arriveAt = now + travelDurationMs(current.location.position, dest.position, this.speed);
      const [updated] = await tx
        .update(emperors)
        .set({
          systemId: current.location.systemId,
          destSystemId: dest.id,
          departAt: new Date(now),
          arriveAt: new Date(arriveAt),
          updatedAt: sql`now()`,
        })
        .where(eq(emperors.id, row.id))
        .returning(columns);
      return { ok: true, emperor: this.toEmperor(updated!) };
    });
  }
}
