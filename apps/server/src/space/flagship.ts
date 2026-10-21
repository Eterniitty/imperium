import { universeSeedFromString } from "@imperium/procgen";
import type { FlagshipStatus, StarSystemDetail, StarSystemSummary } from "@imperium/shared";
import { defaultPark, systemLayout, type ParkedOrbit, type SystemLayout } from "@imperium/sim";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { emperors } from "../db/schema";
import { findSystem, placeFromRow } from "../emperor/world";

/** Columnas de la nave aparcada de un Emperador. */
export interface ParkRow {
  parkX: number | null;
  parkY: number | null;
  parkZ: number | null;
  parkAt: Date | null;
}

/** Órbita de aparcamiento guardada en una fila, o null si no la hay (aparca en el sitio por defecto). */
export function parkFromRow(row: ParkRow): ParkedOrbit | null {
  if (row.parkX === null || row.parkY === null || row.parkZ === null || row.parkAt === null) return null;
  return { p: [row.parkX, row.parkY, row.parkZ], at: row.parkAt.getTime() };
}

/** Columnas para guardar una órbita de aparcamiento (null: la de por defecto). */
export function parkColumns(park: ParkedOrbit | null): ParkRow {
  return park
    ? { parkX: park.p[0], parkY: park.p[1], parkZ: park.p[2], parkAt: new Date(park.at) }
    : { parkX: null, parkY: null, parkZ: null, parkAt: null };
}

/** Emperador presente (no de viaje) en un sistema, con su nave aparcada. */
export interface ParkedShip {
  emperorId: string;
  name: string;
  park: ParkedOrbit;
}

/**
 * La nave del Emperador fuera del pilotaje: dónde está aparcada (orbitando la
 * estrella) y la disposición de los sistemas, que depende de su detalle
 * secreto. El espacio local (`SpaceService`) la usa para mostrar las naves
 * aparcadas y validar desde dónde se empieza a pilotar.
 */
export class FlagshipService {
  private readonly seed: number;
  private readonly layouts = new Map<string, SystemLayout | null>();

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED">,
    /** Detalle de un sistema (con la semilla secreta del servidor). */
    private readonly detailOf: (summary: StarSystemSummary) => StarSystemDetail,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
  }

  /** Disposición de un sistema en metros (en caché), o null si no existe. */
  layout(systemId: string): SystemLayout | null {
    let l = this.layouts.get(systemId);
    if (l === undefined) {
      const summary = findSystem(this.seed, systemId);
      l = summary ? systemLayout(this.detailOf(summary)) : null;
      this.layouts.set(systemId, l);
    }
    return l;
  }

  /** Órbita de aparcamiento efectiva: la guardada, o la de por defecto del sistema. */
  resolvePark(systemId: string, row: ParkRow): ParkedOrbit {
    const stored = parkFromRow(row);
    if (stored) return stored;
    const layout = this.layout(systemId);
    return layout ? defaultPark(layout) : { p: [0, 0, 0], at: 0 };
  }

  /** Estado de la nave para su dueño (tema `me`), o null si no hay Emperador. */
  async status(emperorId: string): Promise<FlagshipStatus | null> {
    const [row] = await this.db
      .select({ id: emperors.id, systemId: emperors.systemId, destSystemId: emperors.destSystemId, departAt: emperors.departAt, arriveAt: emperors.arriveAt, parkX: emperors.parkX, parkY: emperors.parkY, parkZ: emperors.parkZ, parkAt: emperors.parkAt })
      .from(emperors)
      .where(eq(emperors.id, emperorId));
    if (!row) return null;
    // Si está de viaje, la órbita guardada ya es la de llegada al destino.
    const place = placeFromRow(this.seed, row, this.now());
    const systemId = place.travel?.to.systemId ?? place.location.systemId;
    const park = this.resolvePark(systemId, row);
    return { systemId, park: { p: [park.p[0], park.p[1], park.p[2]], at: park.at } };
  }

  /** Guarda dónde queda aparcada la nave (al dejar de pilotarla). */
  async savePark(emperorId: string, park: ParkedOrbit | null): Promise<void> {
    await this.db.update(emperors).set(parkColumns(park)).where(eq(emperors.id, emperorId));
  }

  /** Emperadores que están (no de viaje) en un sistema, con su órbita de aparcamiento. */
  async parkedIn(systemId: string): Promise<ParkedShip[]> {
    const now = new Date(this.now());
    const rows = await this.db
      .select({ id: emperors.id, name: emperors.name, systemId: emperors.systemId, parkX: emperors.parkX, parkY: emperors.parkY, parkZ: emperors.parkZ, parkAt: emperors.parkAt })
      .from(emperors)
      .where(or(and(eq(emperors.systemId, systemId), isNull(emperors.destSystemId)), and(eq(emperors.destSystemId, systemId), lte(emperors.arriveAt, now))));
    return rows.map((r) => ({ emperorId: r.id, name: r.name, park: this.resolvePark(systemId, r) }));
  }
}
