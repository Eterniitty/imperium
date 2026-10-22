import { COMPONENT_IDS, ECONOMY, HUMANS, CARGO_STOCK_IDS, type ComponentAmounts, type StockId } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import type { Cargo, CommandError, FleetRoute } from "@imperium/shared";
import { addComponents, isTravelling } from "@imperium/sim";
import { and, eq } from "drizzle-orm";
import type { ServerConfig } from "../config";
import type { ColonyService } from "../colony/service";
import type { Database } from "../db/client";
import { colonies, fleetCargo, fleetRoutes, fleets, resourceLedger, ships } from "../db/schema";
import { placeFromRow } from "../emperor/world";
import type { Tx } from "../events/queue";
import { EMPTY_CARGO, fleetCapacity, type FleetService } from "../fleet/service";

export type TransferResult = { ok: true; emperorId: string; fleetId: string; colonyId: string } | { ok: false; error: CommandError };
export type RouteResult = { ok: true; emperorId: string; fleetId: string; colonyIds: string[] } | { ok: false; error: CommandError };

/** Lo que cambió al llegar una flota con ruta, para avisar a su dueño. */
export interface RouteStep {
  emperorId: string;
  colonyIds: string[];
}

const KINDS = [...CARGO_STOCK_IDS, "humans"] as const;
type Kind = (typeof KINDS)[number];
const EPS = 1e-6;

/**
 * Logística (Fase 8): flotas que cargan y descargan recursos y pasajeros en
 * colonias propias del mismo sistema, a mano o con una ruta automática entre
 * dos colonias. Todo se asienta en el libro de recursos.
 */
export class LogisticsService {
  private readonly seed: number;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED">,
    private readonly colonies: ColonyService,
    private readonly fleets: FleetService,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
  }

  /** Flota propia bloqueada, con su bodega y capacidad, y si está parada (y dónde). */
  private async lockFleet(tx: Tx, emperorId: string, fleetId: string, now: number) {
    const [row] = await tx.select().from(fleets).where(and(eq(fleets.id, fleetId), eq(fleets.emperorId, emperorId))).for("update").limit(1);
    if (!row) return null;
    const place = placeFromRow(this.seed, row, now);
    const shipRows = await tx.select({ classId: ships.classId }).from(ships).where(eq(ships.fleetId, row.id));
    const [c] = await tx.select().from(fleetCargo).where(eq(fleetCargo.fleetId, row.id)).for("update").limit(1);
    const cargo: Cargo = c ? { metal: c.metal, volatiles: c.volatiles, crystal: c.crystal, alloys: c.alloys, humans: c.humans } : { ...EMPTY_CARGO };
    const items: Record<string, number> = c?.items ?? {};
    return {
      row,
      cargo,
      items,
      loadedIn: c?.loadedIn ?? null,
      capacity: fleetCapacity(shipRows.map((s) => s.classId)),
      at: isTravelling(place, now) ? null : place.location.systemId,
    };
  }

  private async saveCargo(tx: Tx, fleetId: string, cargo: Cargo, loadedIn?: string | null): Promise<void> {
    const extra = loadedIn !== undefined ? { loadedIn } : {};
    await tx
      .insert(fleetCargo)
      .values({ fleetId, ...cargo, ...extra })
      .onConflictDoUpdate({ target: fleetCargo.fleetId, set: { ...cargo, ...extra } });
  }

  /** Contratos de reparto: recursos llevados a una colonia de otro sistema que el de carga (lo pone app.ts). */
  onDelivered: ((emperorId: string, units: number, colonyId: string, moved: Cargo) => void) | null = null;

  /**
   * Mueve recursos y pasajeros entre una flota y una colonia propia del mismo
   * sistema. `amounts` son lo pedido; con `clamp`, se mueve lo que se pueda
   * (rutas automáticas) en vez de rechazar. Devuelve lo movido.
   */
  private async move(
    tx: Tx,
    emperorId: string,
    fleetId: string,
    colonyId: string,
    direction: "load" | "unload",
    amounts: Partial<Cargo>,
    clamp: boolean,
  ): Promise<{ ok: true; moved: Cargo } | { ok: false; error: CommandError }> {
    const now = this.now();
    const fleet = await this.lockFleet(tx, emperorId, fleetId, now);
    if (!fleet) return { ok: false, error: "no_fleet" };
    const colony = await this.colonies.lockResolved(tx, emperorId, colonyId, now);
    if (!colony) return { ok: false, error: "no_colony" };
    if (fleet.at === null) return { ok: false, error: "in_transit" };
    if (fleet.at !== colony.row.systemId) return { ok: false, error: "not_present" };
    // En plena batalla no se carga ni se descarga.
    if (fleet.row.battleId) return { ok: false, error: "in_battle" };

    const cargo = { ...fleet.cargo };
    const stock = { ...colony.state.stock };
    let population = colony.state.population;
    const moved: Cargo = { ...EMPTY_CARGO };
    // Hueco en la bodega (recursos juntos) y en las plazas de pasajeros.
    // Los componentes de la bodega también ocupan sitio.
    let freeResources = fleet.capacity.resources - CARGO_STOCK_IDS.reduce((a, r) => a + cargo[r], 0) - Object.values(fleet.items).reduce((a, n) => a + n, 0);
    let freeSeats = fleet.capacity.humans - cargo.humans;

    for (const k of KINDS) {
      const want = amounts[k] ?? 0;
      if (want <= EPS) continue;
      let can: number;
      if (direction === "load") {
        const available = k === "humans" ? Math.max(0, population - HUMANS.colonyKeep) : stock[k as StockId];
        const room = k === "humans" ? freeSeats : freeResources;
        can = Math.min(want, available, room);
        if (!clamp && can + EPS < want) return { ok: false, error: want > available + EPS ? (k === "humans" ? "not_enough_humans" : "insufficient_resources") : "cargo_full" };
      } else {
        const room = k === "humans" ? colony.cap - population : ECONOMY.storage[k as StockId] - stock[k as StockId];
        can = Math.min(want, cargo[k], Math.max(0, room));
        if (!clamp && can + EPS < want) return { ok: false, error: want > cargo[k] + EPS ? "nothing_to_transfer" : k === "humans" ? "colony_full" : "storage_full" };
      }
      if (can <= EPS) continue;
      const sign = direction === "load" ? 1 : -1;
      cargo[k] += sign * can;
      if (k === "humans") {
        population -= sign * can;
        freeSeats -= sign * can;
      } else {
        stock[k as StockId] -= sign * can;
        freeResources -= sign * can;
      }
      moved[k] = can;
    }
    if (KINDS.every((k) => moved[k] <= EPS)) return clamp ? { ok: true, moved } : { ok: false, error: "nothing_to_transfer" };

    // Reparto: lo descargado en otro sistema que el de carga cuenta; al cargar, se apunta dónde.
    const resources = (c: Cargo) => CARGO_STOCK_IDS.reduce((a, r) => a + c[r], 0);
    const here = colony.row.systemId;
    let loadedIn: string | null = fleet.loadedIn;
    if (direction === "load" && resources(moved) > EPS) loadedIn = here;
    const delivered = direction === "unload" && fleet.loadedIn && fleet.loadedIn !== here ? resources(moved) : 0;
    if (resources(cargo) <= EPS) loadedIn = null;
    await this.saveCargo(tx, fleetId, cargo, loadedIn);
    await this.colonies.writeState(tx, colonyId, { population, stock }, now);
    if (delivered > EPS) this.onDelivered?.(emperorId, delivered, colonyId, moved);
    const sign = direction === "load" ? -1 : 1;
    await tx.insert(resourceLedger).values({
      emperorId,
      colonyId,
      reason: direction,
      ref: `fleet:${fleetId}`,
      metal: sign * moved.metal,
      volatiles: sign * moved.volatiles,
      crystal: sign * moved.crystal,
      alloys: sign * moved.alloys,
      humans: sign * moved.humans,
    });
    return { ok: true, moved };
  }

  /**
   * Orden `fleet.items`: carga o descarga componentes fabricados entre una
   * flota y una colonia propia del mismo sistema (ocupan la bodega como los
   * recursos). Se mueve lo que se pueda de lo pedido.
   */
  async transferItems(
    emperorId: string,
    fleetId: string,
    colonyId: string,
    direction: "load" | "unload",
    items: Record<string, number>,
  ): Promise<TransferResult> {
    return this.db.transaction(async (tx): Promise<TransferResult> => {
      const now = this.now();
      const fleet = await this.lockFleet(tx, emperorId, fleetId, now);
      if (!fleet) return { ok: false, error: "no_fleet" };
      const colony = await this.colonies.lockResolved(tx, emperorId, colonyId, now);
      if (!colony) return { ok: false, error: "no_colony" };
      if (fleet.at === null) return { ok: false, error: "in_transit" };
      if (fleet.at !== colony.row.systemId) return { ok: false, error: "not_present" };
      if (fleet.row.battleId) return { ok: false, error: "in_battle" };
      let free = fleet.capacity.resources - CARGO_STOCK_IDS.reduce((a, r) => a + fleet.cargo[r], 0) - Object.values(fleet.items).reduce((a, n) => a + n, 0);
      let fleetItems: ComponentAmounts = { ...fleet.items };
      let colonyItems: ComponentAmounts = { ...colony.row.items };
      let movedAny = false;
      for (const id of COMPONENT_IDS) {
        const want = Math.floor(items[id] ?? 0);
        if (want <= 0) continue;
        const from = direction === "load" ? colonyItems : fleetItems;
        const can = Math.min(want, Math.floor(from[id] ?? 0), direction === "load" ? Math.floor(Math.max(0, free)) : Number.MAX_SAFE_INTEGER);
        if (can <= 0) continue;
        const delta = { [id]: can } as ComponentAmounts;
        if (direction === "load") {
          colonyItems = addComponents(colonyItems, delta, -1);
          fleetItems = addComponents(fleetItems, delta);
          free -= can;
        } else {
          fleetItems = addComponents(fleetItems, delta, -1);
          colonyItems = addComponents(colonyItems, delta);
        }
        movedAny = true;
      }
      if (!movedAny) return { ok: false, error: direction === "load" && free < 1 ? "cargo_full" : "nothing_to_transfer" };
      await tx.insert(fleetCargo).values({ fleetId, ...fleet.cargo, items: fleetItems }).onConflictDoUpdate({ target: fleetCargo.fleetId, set: { items: fleetItems } });
      await tx.update(colonies).set({ items: colonyItems }).where(eq(colonies.id, colonyId));
      return { ok: true, emperorId, fleetId, colonyId };
    });
  }

  /** Orden `fleet.transfer`: carga o descarga a mano. */
  async transfer(emperorId: string, fleetId: string, colonyId: string, direction: "load" | "unload", amounts: Partial<Cargo>): Promise<TransferResult> {
    return this.db.transaction(async (tx): Promise<TransferResult> => {
      const res = await this.move(tx, emperorId, fleetId, colonyId, direction, amounts, false);
      return res.ok ? { ok: true, emperorId, fleetId, colonyId } : res;
    });
  }

  /** Carga o descarga lo que se pueda y deja la ruta en marcha hacia la otra colonia. */
  private async routeStep(tx: Tx, emperorId: string, fleetId: string, route: FleetRoute): Promise<string[] | null> {
    const now = this.now();
    const fleet = await this.lockFleet(tx, emperorId, fleetId, now);
    // En batalla, la ruta espera a que termine (la reanuda el combate al acabar).
    if (!fleet || fleet.at === null || fleet.row.battleId) return null;
    const from = await this.colonies.lockResolved(tx, emperorId, route.fromColonyId, now);
    const to = await this.colonies.lockResolved(tx, emperorId, route.toColonyId, now);
    if (!from || !to) {
      // Una de las colonias ya no es suya: la ruta se acaba.
      await tx.delete(fleetRoutes).where(eq(fleetRoutes.fleetId, fleetId));
      return [];
    }
    const touched: string[] = [];
    if (fleet.at === to.row.systemId) {
      // En el destino: descarga todo lo que quepa.
      const r = await this.move(tx, emperorId, fleetId, to.row.id, "unload", { ...fleet.cargo }, true);
      if (r.ok && KINDS.some((k) => r.moved[k] > EPS)) touched.push(to.row.id);
    }
    if (fleet.at === from.row.systemId) {
      // En el origen: carga lo indicado, por orden, hasta llenar.
      const want: Partial<Cargo> = {};
      for (const k of route.carry) want[k] = Number.MAX_SAFE_INTEGER;
      if (route.humans) want.humans = Number.MAX_SAFE_INTEGER;
      const r = await this.move(tx, emperorId, fleetId, from.row.id, "load", want, true);
      if (r.ok && KINDS.some((k) => r.moved[k] > EPS)) touched.push(from.row.id);
    }
    // Siguiente tramo: si está en el origen, al destino; si no, al origen.
    const next = fleet.at === from.row.systemId ? to.row.systemId : from.row.systemId;
    if (next !== fleet.at) await this.fleets.moveTx(tx, emperorId, fleetId, next);
    return touched;
  }

  /** Orden `fleet.route`: guarda la ruta y da el primer paso (cargar, descargar o ir al origen). */
  async setRoute(emperorId: string, fleetId: string, route: FleetRoute): Promise<RouteResult> {
    if (route.fromColonyId === route.toColonyId || (route.carry.length === 0 && !route.humans)) return { ok: false, error: "invalid_route" };
    return this.db.transaction(async (tx): Promise<RouteResult> => {
      const now = this.now();
      const fleet = await this.lockFleet(tx, emperorId, fleetId, now);
      if (!fleet) return { ok: false, error: "no_fleet" };
      if (fleet.at === null) return { ok: false, error: "in_transit" };
      if (fleet.row.battleId) return { ok: false, error: "in_battle" };
      if (fleet.capacity.resources <= 0 && fleet.capacity.humans <= 0) return { ok: false, error: "cargo_full" };
      const from = await this.colonies.lockResolved(tx, emperorId, route.fromColonyId, now);
      const to = await this.colonies.lockResolved(tx, emperorId, route.toColonyId, now);
      if (!from || !to) return { ok: false, error: "no_colony" };
      if (from.row.systemId === to.row.systemId) return { ok: false, error: "invalid_route" };
      const carry = [...new Set(route.carry)];
      await tx
        .insert(fleetRoutes)
        .values({ fleetId, fromColonyId: from.row.id, toColonyId: to.row.id, carry, humans: route.humans })
        .onConflictDoUpdate({ target: fleetRoutes.fleetId, set: { fromColonyId: from.row.id, toColonyId: to.row.id, carry, humans: route.humans } });
      const touched = (await this.routeStep(tx, emperorId, fleetId, { ...route, carry })) ?? [];
      return { ok: true, emperorId, fleetId, colonyIds: touched };
    });
  }

  /** Orden `fleet.routeStop`, y también al dar otra orden de viaje a la flota. */
  async clearRoute(emperorId: string, fleetId: string): Promise<boolean> {
    const [own] = await this.db.select({ id: fleets.id }).from(fleets).where(and(eq(fleets.id, fleetId), eq(fleets.emperorId, emperorId))).limit(1);
    if (!own) return false;
    await this.db.delete(fleetRoutes).where(eq(fleetRoutes.fleetId, fleetId));
    return true;
  }

  /** Manejador de la llegada (dentro de la transacción del evento): si la flota tiene ruta, da el siguiente paso. */
  async onArrive(tx: Tx, fleetId: string): Promise<RouteStep | null> {
    const [route] = await tx.select().from(fleetRoutes).where(eq(fleetRoutes.fleetId, fleetId)).limit(1);
    if (!route) return null;
    const [fleet] = await tx.select({ emperorId: fleets.emperorId }).from(fleets).where(eq(fleets.id, fleetId)).limit(1);
    if (!fleet) return null;
    const touched = await this.routeStep(tx, fleet.emperorId, fleetId, {
      fromColonyId: route.fromColonyId,
      toColonyId: route.toColonyId,
      carry: route.carry as FleetRoute["carry"],
      humans: route.humans,
    });
    return { emperorId: fleet.emperorId, colonyIds: touched ?? [] };
  }
}
