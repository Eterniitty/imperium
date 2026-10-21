import { EMPEROR_FLAGSHIP, getShipClass, HUMANS, STARTING_FLEET } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { distance, type CommandError, type Emperor } from "@imperium/shared";
import { arrivalPark, isTravelling, quantumFuelCost, regenFuel, travelDurationMs, type SystemLayout } from "@imperium/sim";
import { eq, ne, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { emperors, fleets, ships } from "../db/schema";
import { discoverAround, fleetScannerRangeLy } from "../discovery/service";
import { schedule } from "../events/queue";
import { parkColumns } from "../space/flagship";
import { findSystem, nameKey, pickSpawnSystem, placeFromRow, type PlaceRow } from "./world";

const columns = {
  id: emperors.id,
  name: emperors.name,
  kind: emperors.kind,
  systemId: emperors.systemId,
  destSystemId: emperors.destSystemId,
  departAt: emperors.departAt,
  arriveAt: emperors.arriveAt,
  deadAt: emperors.deadAt,
};
type Row = PlaceRow & { name: string; kind: string; deadAt: Date | null };

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
  /**
   * Disposición de un sistema (depende de su detalle secreto). Con ella, al saltar
   * se calcula dónde aparece la nave en el borde del destino; sin ella, aparca
   * en el sitio por defecto. La pone `buildApp`.
   */
  layoutOf: ((systemId: string) => SystemLayout | null) | null = null;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
    this.speed = EMPEROR_FLAGSHIP.speedLyPerHour * config.TIME_SCALE;
  }

  private toEmperor(row: Row): Emperor {
    return {
      id: row.id,
      name: row.name,
      ...placeFromRow(this.seed, row, this.now()),
      ...(row.kind === "ai" ? { ai: true as const } : {}),
      // Fase 10: caído y gestándose.
      ...(row.deadAt ? { gestating: true as const } : {}),
    };
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
   * Orden de viaje. La fila se bloquea durante la transacción: dos órdenes
   * simultáneas del mismo Emperador se aplican una detrás de otra.
   */
  async move(accountId: string, systemId: string): Promise<MoveResult> {
    const dest = findSystem(this.seed, systemId);
    if (!dest) return { ok: false, error: "unknown_system" };

    return this.db.transaction(async (tx): Promise<MoveResult> => {
      const [row] = await tx
        .select({ ...columns, fuel: emperors.fuel, fuelAt: emperors.fuelAt })
        .from(emperors)
        .where(eq(emperors.accountId, accountId))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "no_emperor" };
      // Fase 10: muerto (gestándose), no tiene nave con la que saltar.
      if (row.deadAt) return { ok: false, error: "dead" };
      const now = this.now();
      const current = this.toEmperor(row);
      if (isTravelling(current, now)) return { ok: false, error: "in_transit" };
      if (current.location.systemId === dest.id) return { ok: false, error: "already_there" };
      // El motor cuántico gasta combustible según la distancia: el depósito marca el alcance.
      const fuel = regenFuel(row.fuel, (now - row.fuelAt.getTime()) / 1000);
      const cost = quantumFuelCost(distance(current.location.position, dest.position));
      if (cost > fuel) return { ok: false, error: "insufficient_fuel" };

      const arriveAt = now + travelDurationMs(current.location.position, dest.position, this.speed);
      // Aparece en el borde del destino, del lado por el que llega, y desde ahí orbita.
      const from = current.location.position;
      const layout = this.layoutOf?.(dest.id) ?? null;
      const park = layout ? arrivalPark(layout, [from.x - dest.position.x, from.y - dest.position.y, from.z - dest.position.z], arriveAt) : null;
      const [updated] = await tx
        .update(emperors)
        .set({
          systemId: current.location.systemId,
          destSystemId: dest.id,
          departAt: new Date(now),
          arriveAt: new Date(arriveAt),
          ...parkColumns(park),
          fuel: fuel - cost,
          fuelAt: new Date(now),
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
