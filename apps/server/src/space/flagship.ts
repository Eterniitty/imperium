import { ECONOMY, EMPEROR_FLAGSHIP, FLAGSHIP_HOLD, FLAGSHIP_REPAIR, FLAGSHIP_SUPPLIES, HOLD_STOCK_IDS, type StockId } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { isDeepId, type CommandError, type FlagshipStatus, type StarSystemDetail, type StarSystemSummary } from "@imperium/shared";
import { deepLayout, defaultPark, regenFuel, sanitizeHold, sanitizePark, systemLayout, type Hold, type ParkedOrbit, type SystemLayout } from "@imperium/sim";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { ColonyService } from "../colony/service";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { colonies, emperors, fleetCargo, fleets, resourceLedger } from "../db/schema";
import { findSystem, placeFromRow } from "../emperor/world";
import type { StoredSupplies } from "./combat";
import { rememberPosition } from "./memory";

/** Disposición común de las regiones de espacio profundo. */
const DEEP_LAYOUT = deepLayout();

/** Columnas de la nave aparcada de un Emperador. */
export interface ParkRow {
  parkX: number | null;
  parkY: number | null;
  parkZ: number | null;
  parkAt: Date | null;
  parkExtra?: { anchor?: { planet: number; moon?: number }; q?: [number, number, number, number]; engines?: boolean; travel?: { from: [number, number, number]; until: number } } | null;
}

/** Columnas de los recursos de la nave. */
interface SuppliesRow {
  fuel: number;
  fuelAt: Date;
  cannonAmmo: number;
  missiles: number;
  ammoAt: Date;
  flagshipHull: number;
}

/** Órbita de aparcamiento guardada en una fila, o null si no la hay (aparca en el sitio por defecto). */
export function parkFromRow(row: ParkRow): ParkedOrbit | null {
  if (row.parkX === null || row.parkY === null || row.parkZ === null || row.parkAt === null) return null;
  const x = row.parkExtra ?? {};
  return { p: [row.parkX, row.parkY, row.parkZ], at: row.parkAt.getTime(), ...(x.anchor ? { anchor: x.anchor } : {}), ...(x.q ? { q: x.q } : {}), ...(x.engines !== undefined ? { engines: x.engines } : {}), ...(x.travel ? { travel: x.travel } : {}) };
}

/** Columnas para guardar una órbita de aparcamiento (null: la de por defecto). */
export function parkColumns(park: ParkedOrbit | null): ParkRow {
  return park
    ? { parkX: park.p[0], parkY: park.p[1], parkZ: park.p[2], parkAt: new Date(park.at), parkExtra: park.anchor || park.q || park.engines !== undefined || park.travel ? { anchor: park.anchor, q: park.q ? [park.q[0], park.q[1], park.q[2], park.q[3]] : undefined, engines: park.engines, travel: park.travel ? { from: [park.travel.from[0], park.travel.from[1], park.travel.from[2]], until: park.travel.until } : undefined } : null }
    : { parkX: null, parkY: null, parkZ: null, parkAt: null, parkExtra: null };
}

function suppliesFromRow(r: SuppliesRow): StoredSupplies {
  return { fuel: r.fuel, fuelAt: r.fuelAt.getTime(), cannon: r.cannonAmmo, missiles: r.missiles, ammoAt: r.ammoAt.getTime(), hull: r.flagshipHull };
}

/** Munición máxima de un arma de la nave del Emperador. */
function ammoMax(kind: "cannon" | "missile"): number {
  return EMPEROR_FLAGSHIP.combat.weapons.find((w) => w.kind === kind)?.ammo ?? 0;
}

const SUPPLY_COLUMNS = { fuel: emperors.fuel, fuelAt: emperors.fuelAt, cannonAmmo: emperors.cannonAmmo, missiles: emperors.missiles, ammoAt: emperors.ammoAt, flagshipHull: emperors.flagshipHull };
const PARK_COLUMNS = { parkX: emperors.parkX, parkY: emperors.parkY, parkZ: emperors.parkZ, parkAt: emperors.parkAt, parkExtra: emperors.parkExtra };

/** Emperador presente (no de viaje) en un sistema, con su nave aparcada y sus recursos. */
export interface ParkedShip {
  emperorId: string;
  name: string;
  park: ParkedOrbit;
  supplies: StoredSupplies;
}

/** Lo que se pide o se obtiene de una colonia al reponer (y casco reparado, Fase 10). */
export interface Refill {
  fuel: number;
  cannon: number;
  missiles: number;
  hull: number;
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
      // Espacio profundo: sin estrella ni planetas, todas las regiones iguales para el vuelo.
      if (isDeepId(systemId)) return DEEP_LAYOUT;
      const summary = findSystem(this.seed, systemId);
      l = summary ? systemLayout(this.detailOf(summary)) : null;
      this.layouts.set(systemId, l);
    }
    return l;
  }

  /** Órbita de aparcamiento efectiva: la guardada, o la de por defecto del sistema. */
  resolvePark(systemId: string, row: ParkRow): ParkedOrbit {
    const stored = parkFromRow(row);
    const layout = this.layout(systemId);
    // Las órbitas guardadas con la escala anterior quedan dentro de la estrella: se llevan fuera.
    if (stored) return layout ? sanitizePark(layout, stored) : stored;
    return layout ? defaultPark(layout) : { p: [0, 0, 0], at: 0 };
  }

  /** Estado de la nave para su dueño (tema `me`), o null si no hay Emperador. */
  async status(emperorId: string): Promise<FlagshipStatus | null> {
    const [row] = await this.db
      .select({ id: emperors.id, systemId: emperors.systemId, destSystemId: emperors.destSystemId, departAt: emperors.departAt, arriveAt: emperors.arriveAt, hold: emperors.hold, ...PARK_COLUMNS, ...SUPPLY_COLUMNS })
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
      park: {
        p: [park.p[0], park.p[1], park.p[2]],
        at: park.at,
        anchor: park.anchor,
        q: park.q ? [park.q[0], park.q[1], park.q[2], park.q[3]] : undefined,
        engines: park.engines,
        travel: park.travel ? { from: [park.travel.from[0], park.travel.from[1], park.travel.from[2]], until: park.travel.until } : undefined,
      },
      supplies: {
        fuel: regenFuel(row.fuel, (now - row.fuelAt.getTime()) / 1000),
        fuelMax: FLAGSHIP_SUPPLIES.fuelMax,
        fuelAt: now,
        cannon: row.cannonAmmo,
        cannonMax: ammoMax("cannon"),
        missiles: row.missiles,
        missilesMax: ammoMax("missile"),
        hull: row.flagshipHull,
        hullMax: EMPEROR_FLAGSHIP.hull,
      },
      hold: sanitizeHold(row.hold),
      holdCapacity: FLAGSHIP_HOLD.capacity,
    };
  }

  /** Bodega de la nave (lo minado). */
  async hold(emperorId: string): Promise<Hold> {
    const [row] = await this.db.select({ hold: emperors.hold }).from(emperors).where(eq(emperors.id, emperorId));
    return sanitizeHold(row?.hold);
  }

  /**
   * Cambia la bodega dentro de una transacción con la fila bloqueada: `fn`
   * recibe la actual y devuelve la nueva (o null para no cambiar nada).
   */
  async updateHold<T>(emperorId: string, fn: (hold: Hold) => { hold: Hold; result: T } | null): Promise<T | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select({ hold: emperors.hold, deadAt: emperors.deadAt }).from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
      if (!row || row.deadAt) return null;
      const out = fn(sanitizeHold(row.hold));
      if (!out) return null;
      await tx.update(emperors).set({ hold: sanitizeHold(out.hold) }).where(eq(emperors.id, emperorId));
      return out.result;
    });
  }

  /**
   * Descarga la bodega en una colonia propia del mismo sistema donde está la
   * nave (no de viaje): pasa a sus existencias por `ColonyService.adjustStock`
   * (asentado en el libro como `flagship_unload`). Lo que no cabe en el almacén
   * se queda en la bodega. Devuelve lo descargado.
   */
  async unload(emperorId: string, colonyId: string): Promise<{ ok: true; moved: Hold; systemId: string } | { ok: false; error: CommandError }> {
    const service = this.colonyService;
    if (!service) return { ok: false, error: "no_colony" };
    return this.db.transaction(async (tx) => {
      const now = this.now();
      const [row] = await tx
        .select({ id: emperors.id, systemId: emperors.systemId, destSystemId: emperors.destSystemId, departAt: emperors.departAt, arriveAt: emperors.arriveAt, hold: emperors.hold, deadAt: emperors.deadAt })
        .from(emperors)
        .where(eq(emperors.id, emperorId))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "no_emperor" };
      if (row.deadAt) return { ok: false, error: "dead" };
      const place = placeFromRow(this.seed, row, now);
      if (place.travel && place.travel.arriveAt > now) return { ok: false, error: "in_transit" };
      if (isDeepId(place.location.systemId)) return { ok: false, error: "in_deep_space" };
      const hold = sanitizeHold(row.hold);
      if (HOLD_STOCK_IDS.every((r) => (hold[r] ?? 0) < 1e-6)) return { ok: false, error: "hold_empty" };
      const colony = await service.lockResolved(tx, emperorId, colonyId, now);
      if (!colony) return { ok: false, error: "no_colony" };
      if (colony.row.systemId !== place.location.systemId) return { ok: false, error: "not_present" };
      // Solo lo que quepa en el almacén (lo demás se queda a bordo).
      const moved: Hold = {};
      const left: Hold = { ...hold };
      for (const r of HOLD_STOCK_IDS) {
        const have = hold[r] ?? 0;
        const room = Math.max(0, ECONOMY.storage[r] - colony.state.stock[r]);
        const n = Math.min(have, room);
        if (n > 1e-9) {
          moved[r] = n;
          left[r] = have - n;
        }
      }
      if (Object.keys(moved).length === 0) return { ok: false, error: "storage_full" };
      const res = await service.adjustStock(tx, emperorId, colonyId, moved as Partial<Record<StockId, number>>, "flagship_unload", `emperor:${emperorId}`, now);
      if (!res.ok) return res;
      await tx.update(emperors).set({ hold: sanitizeHold(left) }).where(eq(emperors.id, emperorId));
      return { ok: true, moved, systemId: res.systemId };
    });
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
      .set({ fuel: s.fuel, fuelAt: new Date(s.fuelAt), cannonAmmo: s.cannon, missiles: s.missiles, ammoAt: new Date(s.ammoAt), flagshipHull: s.hull })
      // Un Emperador caído no tiene nave: lo que quedase en memoria ya no vale (Fase 10).
      .where(and(eq(emperors.id, emperorId), isNull(emperors.deadAt)));
  }

  /** Guarda dónde queda aparcada la nave (al dejar de pilotarla). */
  async savePark(emperorId: string, park: ParkedOrbit | null): Promise<void> {
    await this.db.update(emperors).set(parkColumns(park)).where(eq(emperors.id, emperorId));
  }

  /** Memoria de posición: el último punto de la nave en un sistema (ver `memory.ts`). */
  async rememberPosition(emperorId: string, systemId: string, p: readonly number[]): Promise<void> {
    await rememberPosition(this.db, emperorId, systemId, p);
  }

  /** Emperadores que están (no de viaje ni muertos) en un sistema, con su órbita de aparcamiento y sus recursos. */
  async parkedIn(systemId: string): Promise<ParkedShip[]> {
    const now = new Date(this.now());
    const rows = await this.db
      .select({ id: emperors.id, name: emperors.name, systemId: emperors.systemId, ...PARK_COLUMNS, ...SUPPLY_COLUMNS })
      .from(emperors)
      .where(
        and(
          isNull(emperors.deadAt),
          or(and(eq(emperors.systemId, systemId), isNull(emperors.destSystemId)), and(eq(emperors.destSystemId, systemId), lte(emperors.arriveAt, now))),
        ),
      );
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
    const none: Refill = { fuel: 0, cannon: 0, missiles: 0, hull: 0 };
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
      // Fase 10: el casco se repara con las aleaciones que no se llevan los misiles.
      const hull = Math.max(0, Math.min(want.hull, (stock.alloys - missiles * S.alloysPerMissile) / FLAGSHIP_REPAIR.alloysPerHull));
      if (fuel <= 0 && cannon <= 0 && missiles <= 0 && hull <= 0) return none;
      const spent = { volatiles: -fuel * S.volatilesPerFuel, metal: -cannon * S.metalPerRound, alloys: -(missiles * S.alloysPerMissile + hull * FLAGSHIP_REPAIR.alloysPerHull) };
      // El punto de enganche de la economía: resuelve la colonia, descuenta y lo asienta en el libro.
      const res = await service.adjustStock(tx, emperorId, colonyId, spent, "flagship_resupply", `emperor:${emperorId}`, now);
      if (!res.ok) return none;
      return { fuel, cannon, missiles, hull };
    });
  }

  /**
   * Reposición acoplada en una nave nodriza: como junto a una colonia, pero de
   * la bodega de la flota (volátiles → combustible, metal → proyectiles,
   * aleaciones → misiles y casco), asentado en el libro de recursos.
   */
  async resupplyFromFleet(emperorId: string, fleetId: string, want: Refill): Promise<Refill> {
    const none: Refill = { fuel: 0, cannon: 0, missiles: 0, hull: 0 };
    return this.db.transaction(async (tx) => {
      const [own] = await tx.select({ id: fleets.id }).from(fleets).where(and(eq(fleets.id, fleetId), eq(fleets.emperorId, emperorId))).limit(1);
      if (!own) return none;
      const [cargo] = await tx.select().from(fleetCargo).where(eq(fleetCargo.fleetId, fleetId)).for("update").limit(1);
      if (!cargo) return none;
      const S = FLAGSHIP_SUPPLIES;
      const fuel = Math.max(0, Math.min(want.fuel, cargo.volatiles / S.volatilesPerFuel));
      const cannon = Math.max(0, Math.floor(Math.min(want.cannon, cargo.metal / S.metalPerRound)));
      const missiles = Math.max(0, Math.floor(Math.min(want.missiles, cargo.alloys / S.alloysPerMissile)));
      const hull = Math.max(0, Math.min(want.hull, (cargo.alloys - missiles * S.alloysPerMissile) / FLAGSHIP_REPAIR.alloysPerHull));
      if (fuel <= 0 && cannon <= 0 && missiles <= 0 && hull <= 0) return none;
      const spent = { volatiles: fuel * S.volatilesPerFuel, metal: cannon * S.metalPerRound, alloys: missiles * S.alloysPerMissile + hull * FLAGSHIP_REPAIR.alloysPerHull };
      await tx
        .update(fleetCargo)
        .set({ volatiles: Math.max(0, cargo.volatiles - spent.volatiles), metal: Math.max(0, cargo.metal - spent.metal), alloys: Math.max(0, cargo.alloys - spent.alloys) })
        .where(eq(fleetCargo.fleetId, fleetId));
      await tx.insert(resourceLedger).values({ emperorId, reason: "flagship_resupply_fleet", ref: `fleet:${fleetId}`, volatiles: -spent.volatiles, metal: -spent.metal, alloys: -spent.alloys });
      return { fuel, cannon, missiles, hull };
    });
  }
}
