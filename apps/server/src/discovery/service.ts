import { createHmac } from "node:crypto";
import { EMPEROR_FLAGSHIP, getAnyShipClass } from "@imperium/content";
import { generateSystemDetail, universeSeedFromString } from "@imperium/procgen";
import type { StarSystemDetail, StarSystemSummary } from "@imperium/shared";
import { isTravelling } from "@imperium/sim";
import { and, asc, eq, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { discoveries, emperors, fleets, ships } from "../db/schema";
import { findSystem, placeFromRow, systemsInRange } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";

/** Margen para dar por llegado un viaje cuyo evento se procesa un instante antes de tiempo. */
const ARRIVAL_TOLERANCE_MS = 1_000;

/**
 * Semilla secreta del detalle de un sistema: HMAC-SHA256 del identificador con
 * el secreto del servidor, recortado a 32 bits. Es distinta para cada sistema,
 * así que averiguar la de uno (probando las 2³² posibles contra un detalle ya
 * visto) no sirve para calcular ningún otro.
 */
export function systemDetailSeed(secret: string, systemId: string): number {
  return createHmac("sha256", secret).update(systemId).digest().readUInt32LE(0);
}

/** Alcance del escáner de una flota: el de su mejor nave. */
export function fleetScannerRangeLy(classIds: readonly string[]): number {
  let range = 0;
  for (const id of classIds) range = Math.max(range, getAnyShipClass(id)?.scannerRangeLy ?? 0);
  return range;
}

/**
 * Descubre para un Emperador el sistema `system` y los que estén al alcance del
 * escáner. Devuelve solo los nuevos (los ya descubiertos no se repiten).
 */
export async function discoverAround(
  db: Tx | Database,
  universeSeed: number,
  emperorId: string,
  system: StarSystemSummary,
  rangeLy: number,
): Promise<string[]> {
  const ids = new Set([system.id, ...systemsInRange(universeSeed, system.position, rangeLy).map((s) => s.id)]);
  const rows = await db
    .insert(discoveries)
    .values([...ids].map((systemId) => ({ emperorId, systemId })))
    .onConflictDoNothing()
    .returning({ systemId: discoveries.systemId });
  return rows.map((r) => r.systemId);
}

/** Nuevos descubrimientos de un Emperador, para avisarle. */
export interface Discovered {
  emperorId: string;
  systemIds: string[];
}

/**
 * Niebla de guerra: qué sistemas conoce cada Emperador y el detalle de esos
 * sistemas, que se genera con la semilla secreta y solo sale del servidor para
 * quien lo ha descubierto.
 */
export class DiscoveryService {
  private readonly seed: number;

  constructor(
    private readonly db: Database,
    private readonly config: Pick<ServerConfig, "UNIVERSE_SEED" | "DETAIL_SEED">,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
  }

  /** Detalle completo de un sistema. No comprueba permisos: eso es cosa de quien lo pide. */
  detail(summary: StarSystemSummary): StarSystemDetail {
    return generateSystemDetail(this.seed, summary, systemDetailSeed(this.config.DETAIL_SEED, summary.id));
  }

  /** Sistemas descubiertos por un Emperador, por orden de descubrimiento. */
  async list(emperorId: string): Promise<string[]> {
    const rows = await this.db
      .select({ systemId: discoveries.systemId })
      .from(discoveries)
      .where(eq(discoveries.emperorId, emperorId))
      .orderBy(asc(discoveries.discoveredAt), asc(discoveries.systemId));
    return rows.map((r) => r.systemId);
  }

  async has(emperorId: string, systemId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ systemId: discoveries.systemId })
      .from(discoveries)
      .where(and(eq(discoveries.emperorId, emperorId), eq(discoveries.systemId, systemId)))
      .limit(1);
    return row !== undefined;
  }

  /**
   * Una flota acaba de llegar (tras `FleetService.arrive`): descubre, desde el
   * sistema donde está su fila, lo que cubre el escáner de su mejor nave. Si
   * ya había vuelto a salir antes de procesarse el evento, su fila sigue
   * apuntando al sistema al que llegó, así que también vale.
   */
  async fleetArrived(tx: Tx, fleetId: string): Promise<Discovered | null> {
    const [fleet] = await tx.select({ emperorId: fleets.emperorId, systemId: fleets.systemId }).from(fleets).where(eq(fleets.id, fleetId)).limit(1);
    if (!fleet) return null;
    const system = findSystem(this.seed, fleet.systemId);
    if (!system) return null;
    const classIds = (await tx.select({ classId: ships.classId }).from(ships).where(eq(ships.fleetId, fleetId))).map((s) => s.classId);
    const systemIds = await discoverAround(tx, this.seed, fleet.emperorId, system, fleetScannerRangeLy(classIds));
    return { emperorId: fleet.emperorId, systemIds };
  }

  /**
   * El Emperador llega a `systemId` tras un salto: descubre lo que cubre el
   * escáner de su nave. Si el evento llega antes de tiempo, se vuelve a
   * programar para la hora de llegada.
   */
  async emperorArrived(tx: Tx, emperorId: string, systemId: string): Promise<Discovered | null> {
    const [row] = await tx
      .select({ id: emperors.id, systemId: emperors.systemId, destSystemId: emperors.destSystemId, departAt: emperors.departAt, arriveAt: emperors.arriveAt })
      .from(emperors)
      .where(eq(emperors.id, emperorId))
      .limit(1);
    if (!row) return null;
    const system = findSystem(this.seed, systemId);
    if (!system) return null;
    // Estuvo allí si ya ha llegado o si salió de allí después (otro salto).
    const reached = row.systemId === systemId || (row.destSystemId === systemId && row.arriveAt !== null && row.arriveAt.getTime() <= this.now() + ARRIVAL_TOLERANCE_MS);
    if (!reached) {
      if (row.destSystemId === systemId && row.arriveAt) await schedule(tx, "emperor.arrive", row.arriveAt, { emperorId, systemId });
      return null;
    }
    const systemIds = await discoverAround(tx, this.seed, emperorId, system, EMPEROR_FLAGSHIP.scannerRangeLy);
    return { emperorId, systemIds };
  }

  /**
   * Puesta al día de los Emperadores creados antes de la niebla de guerra (o de
   * cualquiera que no tenga descubrimientos): descubren su sistema actual y lo
   * que cubren su nave y sus flotas; si están de viaje, se programa su llegada.
   * Es idempotente y barata (solo toca Emperadores sin descubrimientos), así que
   * el servidor la ejecuta en cada arranque. Devuelve cuántos Emperadores trató.
   */
  async backfill(): Promise<number> {
    const pending = await this.db
      .select({ id: emperors.id, systemId: emperors.systemId, destSystemId: emperors.destSystemId, departAt: emperors.departAt, arriveAt: emperors.arriveAt })
      .from(emperors)
      // Los actores de las facciones alienígenas no descubren (no tienen niebla de guerra que levantar).
      .where(sql`${emperors.kind} <> 'alien' AND NOT EXISTS (SELECT 1 FROM ${discoveries} WHERE ${discoveries.emperorId} = ${emperors.id})`);
    const now = this.now();
    for (const row of pending) {
      await this.db.transaction(async (tx) => {
        const place = placeFromRow(this.seed, row, now);
        // Si viaja, descubre el sistema del que salió; el de destino, al llegar.
        const here = findSystem(this.seed, place.location.systemId)!;
        await discoverAround(tx, this.seed, row.id, here, EMPEROR_FLAGSHIP.scannerRangeLy);
        if (place.travel && isTravelling(place, now)) {
          await schedule(tx, "emperor.arrive", new Date(place.travel.arriveAt), { emperorId: row.id, systemId: place.travel.to.systemId });
        }
        // Las flotas paradas descubren donde están (las que viajan ya tienen su evento de llegada).
        const own = await tx.select({ id: fleets.id, systemId: fleets.systemId, destSystemId: fleets.destSystemId, departAt: fleets.departAt, arriveAt: fleets.arriveAt }).from(fleets).where(eq(fleets.emperorId, row.id));
        for (const f of own) {
          const fp = placeFromRow(this.seed, f, now);
          if (isTravelling(fp, now)) continue;
          const at = findSystem(this.seed, fp.location.systemId)!;
          const classIds = (await tx.select({ classId: ships.classId }).from(ships).where(eq(ships.fleetId, f.id))).map((s) => s.classId);
          await discoverAround(tx, this.seed, row.id, at, fleetScannerRangeLy(classIds));
        }
      });
    }
    return pending.length;
  }
}
