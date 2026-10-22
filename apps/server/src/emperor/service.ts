import { COMPANION_ARRIVAL_OFFSET_M, EMPEROR_FLAGSHIP, FLAGSHIP_SUPPLIES, fuelCapacityFor, getShipClass, HUMANS, QUANTUM_RIFT, STARTING_FLEET } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { deepRegionIdAt, distance, isDeepId, type CommandError, type Emperor, type StarSystemSummary, type Vec3, type WorldPosition } from "@imperium/shared";
import { arrivalPark, arrivalParkAt, besidePoint, defaultPark, isTravelling, parkedPosition, positionAt, quantumFuelCost, regenFuel, sanitizePark, travelDurationMs, type ParkedOrbit, type SystemLayout } from "@imperium/sim";
import { and, eq, ne, or, sql } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { companionRequests, emperorAllies, emperors, fleets, ships } from "../db/schema";
import { discoverAround, discoverNear, fleetScannerRangeLy } from "../discovery/service";
import { schedule, type Tx } from "../events/queue";
import { parkColumns, parkFromRow, type ParkRow } from "../space/flagship";
import { recallPosition, rememberPosition } from "../space/memory";
import { findSystem, nameKey, pickSpawnNear, pickSpawnSystem, placeFromRow, type PlaceRow } from "./world";

const columns = {
  id: emperors.id,
  name: emperors.name,
  kind: emperors.kind,
  systemId: emperors.systemId,
  destSystemId: emperors.destSystemId,
  departAt: emperors.departAt,
  arriveAt: emperors.arriveAt,
  deadAt: emperors.deadAt,
  autoGovern: emperors.autoGovern,
  friendlyFire: emperors.friendlyFire,
  infiniteFuel: emperors.infiniteFuel,
};
const PARK_SELECT = { parkX: emperors.parkX, parkY: emperors.parkY, parkZ: emperors.parkZ, parkAt: emperors.parkAt, parkExtra: emperors.parkExtra };
type Row = PlaceRow & { name: string; kind: string; deadAt: Date | null; autoGovern: boolean; friendlyFire: boolean; infiniteFuel: boolean };

/** `companionId`: el compañero cerca del que apareció (alta con compañero aceptada). */
export type CreateResult = { ok: true; emperor: Emperor; companionId: string | null } | { ok: false; error: "emperor_exists" | "name_taken" };
/** `near`: llega junto al compañero pedido (false si no se pudo y llegó a su sitio de siempre). */
export type MoveResult = { ok: true; emperor: Emperor; near: boolean } | { ok: false; error: CommandError };

/** Datos en vivo del espacio local que la orden de salto aprovecha (las naves pilotadas no guardan su posición a cada momento). */
export interface MoveOptions {
  /** Viaje acoplado en una nave nodriza: llega cuando su flota y no gasta combustible. */
  withFleet?: { arriveAt: number; at: Vec3 | null };
  /** Dónde está ahora la nave propia (en vivo), para recordarla en el sistema que deja. */
  here?: { systemId: string; p: Vec3 } | null;
  /** Llegar junto a este compañero: su posición actual en el destino o la última conocida allí. */
  near?: string | null;
  /** Dónde está ahora el compañero (en vivo), si vuela o está aparcado en un sistema activo. */
  nearLive?: { systemId: string; p: Vec3 } | null;
}
/** Salida del túnel: el Emperador, la región donde queda y los sistemas que descubre su escáner desde allí. */
export type DropResult = { ok: true; emperor: Emperor; regionId: string; discovered: string[] } | { ok: false; error: CommandError };

/**
 * Lectura y escritura de Emperadores. Toda la lógica de reglas que no depende
 * de la base de datos está en `@imperium/sim`.
 */
export class EmperorService {
  /** Crisis galácticas (la tormenta cuántica encarece los saltos). */
  crisis: { factor(effect: "quantumFuel"): number } | null = null;

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
      ...(row.autoGovern ? { autoGovern: true as const } : {}),
      ...(row.friendlyFire ? { friendlyFire: true as const } : {}),
      ...(row.infiniteFuel ? { infiniteFuel: true as const } : {}),
    };
  }

  async setFriendlyFire(emperorId: string, on: boolean): Promise<void> {
    await this.db.update(emperors).set({ friendlyFire: on }).where(eq(emperors.id, emperorId));
  }

  /** Orden `colony.autoGovern`: activa o desactiva la autogestión; al activarla, programa la primera decisión. */
  async setAutoGovern(emperorId: string, on: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select({ was: emperors.autoGovern }).from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
      if (!row) return;
      await tx.update(emperors).set({ autoGovern: on }).where(eq(emperors.id, emperorId));
      if (on && !row.was) await schedule(tx, "colony.govern", new Date(this.now() + 1000), { emperorId });
    });
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
   *
   * Alta con compañero: si la cuenta tiene una solicitud aceptada, aparece en un
   * sistema inicial cercano al del compañero y quedan como compañeros (los dos
   * sentidos de `emperor_allies`). La solicitud se borra al crear, aceptada o no
   * (empezar en solitario cancela la que estuviera pendiente).
   */
  async create(accountId: string, name: string): Promise<CreateResult> {
    let companionId: string | null = null;
    const created = await this.db.transaction(async (tx) => {
      const [request] = await tx
        .select({ id: companionRequests.id, targetId: companionRequests.targetId, status: companionRequests.status })
        .from(companionRequests)
        .where(eq(companionRequests.accountId, accountId))
        .for("update")
        .limit(1);
      let spawn: StarSystemSummary | null = null;
      if (request?.status === "accepted") {
        const [target] = await tx.select(columns).from(emperors).where(eq(emperors.id, request.targetId)).limit(1);
        if (target) {
          spawn = pickSpawnNear(this.seed, this.toEmperor(target).location.position);
          companionId = target.id;
        }
      }
      spawn ??= pickSpawnSystem(this.seed);
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
      if (companionId) {
        await tx
          .insert(emperorAllies)
          .values([
            { emperorId: row.id, allyId: companionId },
            { emperorId: companionId, allyId: row.id },
          ])
          .onConflictDoNothing();
      }
      if (request) await tx.delete(companionRequests).where(eq(companionRequests.id, request.id));
      return row;
    });
    if (created) return { ok: true, emperor: this.toEmperor(created), companionId };
    const existing = await this.byAccount(accountId);
    return { ok: false, error: existing ? "emperor_exists" : "name_taken" };
  }

  /**
   * Orden de viaje. La fila se bloquea durante la transacción: dos órdenes
   * simultáneas del mismo Emperador se aplican una detrás de otra.
   */
  async move(accountId: string, systemId: string, opts: MoveOptions = {}): Promise<MoveResult> {
    const dest = findSystem(this.seed, systemId);
    if (!dest) return { ok: false, error: "unknown_system" };

    return this.db.transaction(async (tx): Promise<MoveResult> => {
      const [row] = await tx
        .select({ ...columns, fuel: emperors.fuel, fuelAt: emperors.fuelAt, infiniteFuel: emperors.infiniteFuel, ...PARK_SELECT })
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
      // Cuenta de pruebas: el salto no gasta combustible.
      // Acoplada en una nodriza, la lleva su flota: tampoco gasta.
      // Tormenta cuántica (crisis galáctica): los saltos gastan más.
      const cost = row.infiniteFuel || opts.withFleet ? 0 : Math.ceil(quantumFuelCost(distance(current.location.position, dest.position)) * (this.crisis?.factor("quantumFuel") ?? 1));
      if (cost > fuel) return { ok: false, error: "insufficient_fuel" };

      const arriveAt = opts.withFleet ? Math.max(now + 1000, opts.withFleet.arriveAt) : now + travelDurationMs(current.location.position, dest.position, this.speed);
      // Memoria de posición: dónde queda la nave en el sistema que deja (en vivo si se pilotaba).
      const leaving = current.location.systemId;
      const herePos = opts.here?.systemId === leaving ? opts.here.p : this.parkedNow(leaving, row, now);
      if (herePos) await rememberPosition(tx, row.id, leaving, herePos);
      // Dónde aparece: junto al compañero pedido; si no, donde estuvo la última vez en el destino;
      // si nunca estuvo, en el borde, del lado por el que llega. Desde ahí orbita.
      const from = current.location.position;
      const layout = this.layoutOf?.(dest.id) ?? null;
      let park: ParkedOrbit | null = null;
      let near = false;
      if (layout) {
        const companion = opts.near ? await this.companionSpot(tx, row.id, opts.near, dest.id, layout, opts.nearLive ?? null, now, arriveAt) : null;
        // Acoplada en una nodriza, llega dentro de su hangar (donde esperará la flota).
        const spot = opts.withFleet?.at ?? (companion ? besidePoint(companion, COMPANION_ARRIVAL_OFFSET_M) : await recallPosition(tx, row.id, dest.id));
        near = companion !== null;
        park = spot ? arrivalParkAt(layout, spot, arriveAt) : arrivalPark(layout, [from.x - dest.position.x, from.y - dest.position.y, from.z - dest.position.z], arriveAt);
      }
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
      return { ok: true, emperor: this.toEmperor(updated!), near };
    });
  }

  /** Posición ahora de la nave aparcada según la fila (null si no hay órbita guardada). */
  private parkedNow(systemId: string, row: ParkRow, now: number): Vec3 | null {
    const stored = parkFromRow(row);
    if (!stored || isDeepId(systemId)) return null;
    const layout = this.layoutOf?.(systemId) ?? null;
    return parkedPosition(layout ? sanitizePark(layout, stored) : stored, now, layout);
  }

  /**
   * Punto del compañero `allyId` en el sistema `systemId` para llegar a su lado:
   * dónde está ahora (en vivo, o su nave aparcada a la hora de llegada) o, si ya
   * no está allí, el último punto que se recuerda de él. Solo entre compañeros
   * mutuos y si el compañero no se ha ocultado (visibilidad «nadie»).
   */
  private async companionSpot(
    tx: Tx,
    meId: string,
    allyId: string,
    systemId: string,
    layout: SystemLayout,
    live: { systemId: string; p: Vec3 } | null,
    now: number,
    arriveAt: number,
  ): Promise<Vec3 | null> {
    if (allyId === meId) return null;
    const links = await tx
      .select({ a: emperorAllies.emperorId })
      .from(emperorAllies)
      .where(or(and(eq(emperorAllies.emperorId, meId), eq(emperorAllies.allyId, allyId)), and(eq(emperorAllies.emperorId, allyId), eq(emperorAllies.allyId, meId))));
    if (links.length < 2) return null;
    const [ally] = await tx
      .select({ ...columns, visibility: emperors.visibility, ...PARK_SELECT })
      .from(emperors)
      .where(eq(emperors.id, allyId))
      .limit(1);
    if (!ally || ally.visibility === "hidden") return null;
    if (live?.systemId === systemId) return live.p;
    if (!ally.deadAt) {
      const place = placeFromRow(this.seed, ally, now);
      // Está allí (o va de camino): su nave aparcada, a la hora en que llegamos.
      if ((place.travel?.to ?? place.location).systemId === systemId) {
        const stored = parkFromRow(ally);
        return parkedPosition(stored ? sanitizePark(layout, stored) : defaultPark(layout), arriveAt, layout);
      }
    }
    return recallPosition(tx, allyId, systemId);
  }

  /**
   * Sale del túnel cuántico a mitad de viaje: la nave queda en la región de
   * espacio profundo que corresponde a su posición en la línea entre los dos
   * sistemas (según el progreso del viaje), aparcada y quieta en su punto de
   * llegada. Del combustible del salto, que se pagó al saltar, solo se gasta
   * la parte recorrida: el resto vuelve al depósito. Desde allí puede volver a
   * saltar (o reanudar hacia el mismo destino, pagando lo que falta). El
   * evento de llegada que quedaba programado ya no hace nada (no llega).
   */
  async drop(accountId: string): Promise<DropResult> {
    return this.db.transaction(async (tx): Promise<DropResult> => {
      const [row] = await tx
        .select({ ...columns, fuel: emperors.fuel, fuelAt: emperors.fuelAt, xp: emperors.xp })
        .from(emperors)
        .where(eq(emperors.accountId, accountId))
        .for("update")
        .limit(1);
      if (!row) return { ok: false, error: "no_emperor" };
      if (row.deadAt) return { ok: false, error: "dead" };
      const now = this.now();
      const current = this.toEmperor(row);
      const travel = current.travel;
      if (!travel || !isTravelling(current, now)) return { ok: false, error: "not_travelling" };
      // Los últimos segundos la grieta de llegada ya se ve en el destino: no se puede salir del túnel.
      if (travel.arriveAt - now < QUANTUM_RIFT.incomingSec * 1000) return { ok: false, error: "arriving" };
      const k = Math.max(0, Math.min(1, (now - travel.departAt) / Math.max(1, travel.arriveAt - travel.departAt)));
      const at: WorldPosition = positionAt(current, now);
      const regionId = deepRegionIdAt(at);
      // Lo que no se ha recorrido del salto vuelve al depósito.
      const cost = quantumFuelCost(distance(current.location.position, travel.to.position));
      const fuel = Math.min(fuelCapacityFor(row.xp), regenFuel(row.fuel, (now - row.fuelAt.getTime()) / 1000) + cost * (1 - k));
      const [updated] = await tx
        .update(emperors)
        .set({
          systemId: regionId,
          destSystemId: null,
          departAt: null,
          arriveAt: null,
          // Quieta en el punto de llegada de la región (allí no hay estrella que orbitar).
          ...parkColumns({ p: [0, 0, 0], at: now }),
          fuel,
          fuelAt: new Date(now),
          updatedAt: sql`now()`,
        })
        .where(eq(emperors.id, row.id))
        .returning(columns);
      // El escáner de la nave barre lo que tiene alrededor (niebla de guerra).
      const discovered = await discoverNear(tx, this.seed, row.id, this.toEmperor(updated!).location.position, EMPEROR_FLAGSHIP.scannerRangeLy);
      return { ok: true, emperor: this.toEmperor(updated!), regionId, discovered };
    });
  }

  /** ¿Está el Emperador (no de viaje) en una región de espacio profundo? */
  static inDeepSpace(e: Emperor, now: number): boolean {
    return !isTravelling(e, now) && isDeepId((e.travel?.to ?? e.location).systemId);
  }
}
