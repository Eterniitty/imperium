import { EMPEROR_FLAGSHIP, getShipClass, HUMANS, STARTING_FLEET } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import type { CommandError, Emperor } from "@imperium/shared";
import { isTravelling, travelDurationMs } from "@imperium/sim";
import { eq, ne, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { emperors, fleets, ships } from "../db/schema";
import { discoverAround, fleetScannerRangeLy } from "../discovery/service";
import { schedule } from "../events/queue";
import { findSystem, nameKey, pickSpawnSystem, placeFromRow, type PlaceRow } from "./world";

const columns = {
  id: emperors.id,
  name: emperors.name,
  systemId: emperors.systemId,
  destSystemId: emperors.destSystemId,
  departAt: emperors.departAt,
  arriveAt: emperors.arriveAt,
};
type Row = PlaceRow & { name: string };

export type CreateResult = { ok: true; emperor: Emperor } | { ok: false; error: "emperor_exists" | "name_taken" };
export type MoveResult = { ok: true; emperor: Emperor } | { ok: false; error: CommandError };

/**
 * Lectura y escritura de Emperadores. Toda la lógica de reglas que no depende
 * de la base de datos está en `@imperium/sim`.
 */
export class EmperorService {
  private readonly seed: number;
  /** Velocidad de la nave del Emperador, ya multiplicada por la escala de tiempo. */
  private readonly speed: number;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
    this.speed = EMPEROR_FLAGSHIP.speedLyPerHour * config.TIME_SCALE;
  }

  private toEmperor(row: Row): Emperor {
    return { id: row.id, name: row.name, ...placeFromRow(this.seed, row, this.now()) };
  }

  async byAccount(accountId: string): Promise<Emperor | null> {
    const [row] = await this.db.select(columns).from(emperors).where(eq(emperors.accountId, accountId)).limit(1);
    return row ? this.toEmperor(row) : null;
  }

  async byId(id: string): Promise<Emperor | null> {
    const [row] = await this.db.select(columns).from(emperors).where(eq(emperors.id, id)).limit(1);
    return row ? this.toEmperor(row) : null;
  }

  /**
   * Todos los Emperadores (sin los actores de las facciones alienígenas, que
   * no lo son). Vale mientras sean pocos; luego habrá zonas de interés por sector.
   */
  async all(): Promise<Emperor[]> {
    const rows = await this.db.select(columns).from(emperors).where(ne(emperors.kind, "alien")).orderBy(emperors.createdAt);
    return rows.map((r) => this.toEmperor(r));
  }

  /**
   * Crea el Emperador y su flota inicial en el mismo sistema, todo o nada. Nace
   * conociendo su sistema y lo que cubren el escáner de su nave y el de su
   * flota inicial (que está en el mismo sitio).
   */
  async create(accountId: string, name: string): Promise<CreateResult> {
    const spawn = pickSpawnSystem(this.seed);
    const created = await this.db.transaction(async (tx) => {
      // Sin objetivo de conflicto: si ya hay Emperador en la cuenta o el nombre está
      // cogido, no inserta nada. Así dos peticiones simultáneas no crean dos.
      const [row] = await tx
        .insert(emperors)
        .values({ accountId, name, nameKey: nameKey(name), systemId: spawn.id, humans: HUMANS.flagshipStart })
        .onConflictDoNothing()
        .returning(columns);
      if (!row) return null;
      const [fleet] = await tx.insert(fleets).values({ emperorId: row.id, number: 1, systemId: spawn.id }).returning({ id: fleets.id });
      await tx.insert(ships).values(
        STARTING_FLEET.map((classId) => ({ fleetId: fleet!.id, classId, hull: getShipClass(classId)!.hull })),
      );
      const range = Math.max(EMPEROR_FLAGSHIP.scannerRangeLy, fleetScannerRangeLy(STARTING_FLEET));
      await discoverAround(tx, this.seed, row.id, spawn, range);
      return row;
    });
    if (created) return { ok: true, emperor: this.toEmperor(created) };
    const existing = await this.byAccount(accountId);
    return { ok: false, error: existing ? "emperor_exists" : "name_taken" };
  }

  /**
   * Renace tras caer en combate: aparece en un sistema del Núcleo Humano, sin
   * viaje. (Las Cunas de linaje, más adelante, darán otros lugares.)
   */
  async respawn(emperorId: string): Promise<Emperor | null> {
    const spawn = pickSpawnSystem(this.seed);
    const [row] = await this.db
      .update(emperors)
      .set({ systemId: spawn.id, destSystemId: null, departAt: null, arriveAt: null, updatedAt: sql`now()` })
      .where(eq(emperors.id, emperorId))
      .returning(columns);
    return row ? this.toEmperor(row) : null;
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
      // La posición se resuelve sola al consultarla; el evento es para descubrir al llegar.
      await schedule(tx, "emperor.arrive", new Date(arriveAt), { emperorId: row.id, systemId: dest.id });
      return { ok: true, emperor: this.toEmperor(updated!) };
    });
  }
}
