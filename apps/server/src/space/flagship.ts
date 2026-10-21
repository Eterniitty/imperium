import { EMPEROR_FLAGSHIP, FLAGSHIP_SUPPLIES } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import type { FlagshipStatus, StarSystemDetail, StarSystemSummary } from "@imperium/shared";
import { defaultPark, regenFuel, systemLayout, type ParkedOrbit, type SystemLayout } from "@imperium/sim";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { ColonyService } from "../colony/service";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, emperors } from "../db/schema";
import { findSystem, placeFromRow } from "../emperor/world";
import type { StoredSupplies } from "./combat";

/** Columnas de la nave aparcada de un Emperador. */
export interface ParkRow {
  parkX: number | null;
  parkY: number | null;
  parkZ: number | null;
  parkAt: Date | null;
}

/** Columnas de los recursos de la nave. */
interface SuppliesRow {
  fuel: number;
  fuelAt: Date;
  cannonAmmo: number;
  missiles: number;
  ammoAt: Date;
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

function suppliesFromRow(r: SuppliesRow): StoredSupplies {
  return { fuel: r.fuel, fuelAt: r.fuelAt.getTime(), cannon: r.cannonAmmo, missiles: r.missiles, ammoAt: r.ammoAt.getTime() };
}

/** Munición máxima de un arma de la nave del Emperador. */
function ammoMax(kind: "cannon" | "missile"): number {
  return EMPEROR_FLAGSHIP.combat.weapons.find((w) => w.kind === kind)?.ammo ?? 0;
}

const SUPPLY_COLUMNS = { fuel: emperors.fuel, fuelAt: emperors.fuelAt, cannonAmmo: emperors.cannonAmmo, missiles: emperors.missiles, ammoAt: emperors.ammoAt };
const PARK_COLUMNS = { parkX: emperors.parkX, parkY: emperors.parkY, parkZ: emperors.parkZ, parkAt: emperors.parkAt };

/** Emperador presente (no de viaje) en un sistema, con su nave aparcada y sus recursos. */
export interface ParkedShip {
  emperorId: string;
  name: string;
  park: ParkedOrbit;
  supplies: StoredSupplies;
}

/** Lo que se pide o se obtiene de una colonia al reponer. */
export interface Refill {
  fuel: number;
  cannon: number;
  missiles: number;
}

/**
 * La nave del Emperador fuera del pilotaje: dónde está aparcada (orbitando la
 * estrella), sus recursos guardados (combustible y munición) y la reposición
 * junto a las colonias propias. También guarda la disposición de los sistemas,
 * que depende de su detalle secreto. El espacio local (`SpaceService`) lleva
 * los recursos en memoria mientras se vuela y los guarda aquí.
 */
export class FlagshipService {
  private readonly seed: number;
  private readonly layouts = new Map<string, SystemLayout | null>();

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED">,
    /** Detalle de un sistema (con la semilla secreta del servidor). */
    private readonly detailOf: (summary: StarSystemSummary) => StarSystemDetail,
    private readonly colonyService: ColonyService | null = null,
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
      .select({ id: emperors.id, systemId: emperors.systemId, destSystemId: emperors.destSystemId, departAt: emperors.departAt, arriveAt: emperors.arriveAt, ...PARK_COLUMNS, ...SUPPLY_COLUMNS })
      .from(emperors)
      .where(eq(emperors.id, emperorId));
    if (!row) return null;
    // Si está de viaje, la órbita guardada ya es la de llegada al destino.
    const now = this.now();
    const place = placeFromRow(this.seed, row, now);
    const systemId = place.travel?.to.systemId ?? place.location.systemId;
    const park = this.resolvePark(systemId, row);
    return {
      systemId,
      park: { p: [park.p[0], park.p[1], park.p[2]], at: park.at },
      supplies: {
        fuel: regenFuel(row.fuel, (now - row.fuelAt.getTime()) / 1000),
        fuelMax: FLAGSHIP_SUPPLIES.fuelMax,
        fuelAt: now,
        cannon: row.cannonAmmo,
        cannonMax: ammoMax("cannon"),
        missiles: row.missiles,
        missilesMax: ammoMax("missile"),
      },
    };
  }

  /** Recursos guardados de la nave (para cargarlos al entrar en un sistema). */
  async supplies(emperorId: string): Promise<StoredSupplies | null> {
    const [row] = await this.db.select(SUPPLY_COLUMNS).from(emperors).where(eq(emperors.id, emperorId));
    return row ? suppliesFromRow(row) : null;
  }

  /** Guarda los recursos de la nave. */
  async saveSupplies(emperorId: string, s: StoredSupplies): Promise<void> {
    await this.db
      .update(emperors)
      .set({ fuel: s.fuel, fuelAt: new Date(s.fuelAt), cannonAmmo: s.cannon, missiles: s.missiles, ammoAt: new Date(s.ammoAt) })
      .where(eq(emperors.id, emperorId));
  }

  /** Guarda dónde queda aparcada la nave (al dejar de pilotarla). */
  async savePark(emperorId: string, park: ParkedOrbit | null): Promise<void> {
    await this.db.update(emperors).set(parkColumns(park)).where(eq(emperors.id, emperorId));
  }

  /** Emperadores que están (no de viaje) en un sistema, con su órbita de aparcamiento y sus recursos. */
  async parkedIn(systemId: string): Promise<ParkedShip[]> {
    const now = new Date(this.now());
    const rows = await this.db
      .select({ id: emperors.id, name: emperors.name, systemId: emperors.systemId, ...PARK_COLUMNS, ...SUPPLY_COLUMNS })
      .from(emperors)
      .where(or(and(eq(emperors.systemId, systemId), isNull(emperors.destSystemId)), and(eq(emperors.destSystemId, systemId), lte(emperors.arriveAt, now))));
    return rows.map((r) => ({ emperorId: r.id, name: r.name, park: this.resolvePark(systemId, r), supplies: suppliesFromRow(r) }));
  }

  /** Colonias propias en un sistema: dónde se puede reponer. */
  async coloniesIn(emperorId: string, systemId: string): Promise<Array<{ colonyId: string; planetIndex: number }>> {
    const rows = await this.db
      .select({ colonyId: colonies.id, planetIndex: colonies.planetIndex })
      .from(colonies)
      .where(and(eq(colonies.emperorId, emperorId), eq(colonies.systemId, systemId)));
    return rows;
  }

  /**
   * Repone la nave junto a una colonia propia con sus existencias: volátiles para
   * el combustible, metal para los proyectiles y aleaciones para los misiles. Da
   * lo que se pide si hay existencias (si no, lo que alcance) y lo asienta en el
   * libro de recursos. Devuelve lo concedido.
   */
  async resupply(emperorId: string, colonyId: string, want: Refill): Promise<Refill> {
    const none: Refill = { fuel: 0, cannon: 0, missiles: 0 };
    const service = this.colonyService;
    if (!service) return none;
    return this.db.transaction(async (tx) => {
      const now = this.now();
      const colony = await service.lockResolved(tx, emperorId, colonyId, now);
      if (!colony) return none;
      const stock = { ...colony.state.stock };
      const S = FLAGSHIP_SUPPLIES;
      const fuel = Math.max(0, Math.min(want.fuel, stock.volatiles / S.volatilesPerFuel));
      const cannon = Math.max(0, Math.floor(Math.min(want.cannon, stock.metal / S.metalPerRound)));
      const missiles = Math.max(0, Math.floor(Math.min(want.missiles, stock.alloys / S.alloysPerMissile)));
      if (fuel <= 0 && cannon <= 0 && missiles <= 0) return none;
      const spent = { volatiles: -fuel * S.volatilesPerFuel, metal: -cannon * S.metalPerRound, alloys: -missiles * S.alloysPerMissile };
      // El punto de enganche de la economía: resuelve la colonia, descuenta y lo asienta en el libro.
      const res = await service.adjustStock(tx, emperorId, colonyId, spent, "flagship_resupply", `emperor:${emperorId}`, now);
      if (!res.ok) return none;
      return { fuel, cannon, missiles };
    });
  }
}
