import {
  AI_LINEAGE,
  EMPEROR_FLAGSHIP,
  FLAGSHIP_SUPPLIES,
  getDoctrine,
  HEIRS,
  HUMANS,
  LINEAGE,
  type AiPersonality,
  type HeirDoctrine,
} from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import { distance, type CommandError, type CradleView, type DeathRecord, type HeirDoctrineId, type HeirView, type LineageStatus, type RebirthPlace, type WorldPosition } from "@imperium/shared";
import {
  canAfford,
  decayedStreak,
  flagshipHumansAfter,
  gameHours,
  gestationMs,
  governorChoice,
  heirName,
  incarnateReadyAt,
  isTravelling,
  parkNearPlanet,
  pay,
  realDurationMs,
  type ParkedOrbit,
  type SystemLayout,
} from "@imperium/sim";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { ColonyService } from "../colony/service";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { battles, battleSides, colonies, emperorDeaths, emperors, heirs, installations, resourceLedger } from "../db/schema";
import { discoverAround } from "../discovery/service";
import { findSystem, pickSpawnSystem, placeFromRow, spawnCandidates } from "../emperor/world";
import { schedule, type Tx } from "../events/queue";
import { parkColumns } from "../space/flagship";

/** Margen para dar por cumplida una espera cuyo evento llega un instante antes. */
const DUE_TOLERANCE_MS = 1_000;
/** Decisiones del gobernador como poco cada tanto tiempo real (con escalas de tiempo altas). */
const MIN_GOVERN_MS = 10_000;

/** Munición máxima que fabrica la nave a bordo (con la que despierta el cuerpo nuevo). */
function onboardAmmo(kind: "cannon" | "missile"): number {
  const w = EMPEROR_FLAGSHIP.combat.weapons.find((x) => x.kind === kind);
  return w ? Math.min(w.ammo ?? 0, w.ammoRegenMax ?? w.ammo ?? 0) : 0;
}

/** Recursos de una nave recién renacida: casco entero, reserva de combustible y la munición de a bordo. */
function rebirthSupplies(now: number) {
  return {
    flagshipHull: EMPEROR_FLAGSHIP.hull,
    fuel: FLAGSHIP_SUPPLIES.emergencyFuelMax,
    fuelAt: new Date(now),
    cannonAmmo: onboardAmmo("cannon"),
    missiles: onboardAmmo("missile"),
    ammoAt: new Date(now),
    humans: LINEAGE.rebirthHumans,
    humansAt: new Date(now),
  };
}

/** Una muerte recién registrada (para avisar tras confirmar la transacción). */
export interface DeathInfo {
  emperorId: string;
  rebornAt: number;
  /** Sistema donde está previsto que renazca. */
  systemId: string;
}

/** Un renacimiento o una encarnación (para avisar tras confirmar). */
export interface RebirthInfo {
  emperorId: string;
  systemId: string;
  discovered: string[];
  /** Colonias cuyo gobernador cambió (encarnación). */
  colonies: string[];
}

/** Qué ha cambiado por una orden o una decisión del linaje. */
export interface LineageEffects {
  emperorId: string;
  colonies: string[];
  rebirth: RebirthInfo | null;
}

type Result = { ok: true; fx: LineageEffects } | { ok: false; error: CommandError };

interface CradleRow {
  colonyId: string;
  systemId: string;
  planetIndex: number;
  name: string | null;
}

/**
 * Muerte y linaje (Fase 10): la nave del Emperador cae (combate pilotado o de
 * flotas), el Emperador se gesta en una Cuna de linaje o, sin Cunas, en el
 * Núcleo Humano, y renace con el evento `lineage.rebirth`. Los Herederos se
 * gestan en las Cunas (evento `heir.born`), gobiernan una colonia propia con su
 * doctrina (evento `heir.govern`) y el Emperador puede encarnarse en ellos.
 * Reglas puras en `@imperium/sim` (lineage.ts), datos en `@imperium/content`.
 */
export class LineageService {
  private readonly seed: number;
  private readonly timeScale: number;
  /** ¿Recibió daño hace poco en el combate pilotado? (lo enlaza `app.ts` con `SpaceService`). */
  inCombat: (emperorId: string) => boolean = () => false;
  /** Disposición de un sistema (para aparecer junto al planeta de la Cuna); la pone `app.ts`. */
  layoutOf: (systemId: string) => SystemLayout | null = () => null;

  constructor(
    private readonly db: Database,
    config: Pick<ServerConfig, "UNIVERSE_SEED" | "TIME_SCALE">,
    private readonly colonyService: ColonyService,
    private readonly log: FastifyBaseLogger | null = null,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
    this.timeScale = config.TIME_SCALE;
  }

  private systemName(systemId: string): string {
    return findSystem(this.seed, systemId)?.name ?? systemId;
  }

  private colonyName(c: { name: string | null; systemId: string; planetIndex: number }): string {
    return c.name ?? this.colonyService.planetName(c.systemId, c.planetIndex);
  }

  // --- Cunas ---

  /** Colonias propias con Cuna de linaje. */
  private async cradles(db: Database | Tx, emperorId: string): Promise<CradleRow[]> {
    return db
      .selectDistinct({ colonyId: colonies.id, systemId: colonies.systemId, planetIndex: colonies.planetIndex, name: colonies.name })
      .from(colonies)
      .innerJoin(installations, and(eq(installations.colonyId, colonies.id), eq(installations.kind, "lineage_cradle")))
      .where(eq(colonies.emperorId, emperorId))
      .orderBy(asc(colonies.id));
  }

  /**
   * Cuna donde renacer: la preferida si sigue siendo suya; si no, la más
   * cercana a `from` (donde cayó). Null si no tiene ninguna.
   */
  private async pickCradle(db: Database | Tx, emperorId: string, preferred: string | null, from: WorldPosition | null): Promise<CradleRow | null> {
    const list = await this.cradles(db, emperorId);
    if (list.length === 0) return null;
    const pref = preferred ? list.find((c) => c.colonyId === preferred) : undefined;
    if (pref) return pref;
    if (!from) return list[0]!;
    const d = (c: CradleRow) => {
      const s = findSystem(this.seed, c.systemId);
      return s ? distance(from, s.position) : Number.POSITIVE_INFINITY;
    };
    return [...list].sort((a, b) => d(a) - d(b))[0]!;
  }

  /** Órbita junto al planeta de una colonia (o null: el sitio por defecto del sistema). */
  private parkAt(systemId: string, planetIndex: number, now: number): ParkedOrbit | null {
    const layout = this.layoutOf(systemId);
    return layout ? parkNearPlanet(layout, planetIndex, now) : null;
  }

  // --- Muerte y renacimiento ---

  /**
   * El Emperador cae (su nave llega a casco 0), dentro de la transacción de
   * quien llama. Pierde los humanos de a bordo (se asientan en el libro), la
   * racha sube y empieza la gestación en su Cuna (o en el Núcleo Humano).
   * Devuelve null si ya estaba muerto o no existe.
   */
  async dieTx(tx: Tx, emperorId: string, info: { systemId: string; cause: "combat" | "battle"; by: string | null }): Promise<DeathInfo | null> {
    const [e] = await tx.select().from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
    if (!e || e.deadAt || e.kind === "alien") return null;
    const now = this.now();
    const place = placeFromRow(this.seed, e, now);
    const streak = decayedStreak(e.deathStreak, e.lastDeathAt?.getTime() ?? null, now, this.timeScale) + 1;
    const cradle = await this.pickCradle(tx, emperorId, e.preferredCradleId, place.location.position);
    const systemId = cradle?.systemId ?? pickSpawnSystem(this.seed).id;
    const rebornAt = now + gestationMs(streak, cradle === null, this.timeScale);
    const aboard = flagshipHumansAfter(e.humans, gameHours(e.humansAt.getTime(), now, this.timeScale));
    await tx
      .update(emperors)
      .set({
        // Donde cayó (sin viaje); la nave deja de estar en ningún sitio.
        systemId: place.location.systemId,
        destSystemId: null,
        departAt: null,
        arriveAt: null,
        deadAt: new Date(now),
        rebornAt: new Date(rebornAt),
        rebirthColonyId: cradle?.colonyId ?? null,
        deathStreak: streak,
        lastDeathAt: new Date(now),
        humans: 0,
        humansAt: new Date(now),
        flagshipHull: 0,
        updatedAt: sql`now()`,
      })
      .where(eq(emperors.id, emperorId));
    if (aboard > 0)
      await tx.insert(resourceLedger).values({ emperorId, colonyId: null, reason: "death", ref: `emperor:${emperorId}`, humans: -aboard });
    await tx.insert(emperorDeaths).values({
      emperorId,
      systemId: info.systemId,
      cause: info.cause,
      killer: info.by,
      streak,
      diedAt: new Date(now),
      rebornAt: new Date(rebornAt),
      rebirthSystemId: systemId,
    });
    await schedule(tx, "lineage.rebirth", new Date(rebornAt), { emperorId });
    return { emperorId, rebornAt, systemId };
  }

  /** Igual que `dieTx`, en su propia transacción (combate pilotado). */
  async die(emperorId: string, info: { systemId: string; cause: "combat" | "battle"; by: string | null }): Promise<DeathInfo | null> {
    return this.db.transaction((tx) => this.dieTx(tx, emperorId, info));
  }

  /**
   * Manejador del evento `lineage.rebirth`: el cuerpo nuevo despierta en la
   * Cuna elegida si sigue siendo suya (si no, en otra; sin ninguna, en el
   * Núcleo Humano), con la nave nueva junto al planeta, casco entero, la
   * reserva de combustible, la munición de a bordo y unos pocos humanos.
   */
  async rebirth(tx: Tx, emperorId: string): Promise<RebirthInfo | null> {
    const [e] = await tx.select().from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
    if (!e?.deadAt || !e.rebornAt) return null;
    const now = this.now();
    if (e.rebornAt.getTime() > now + DUE_TOLERANCE_MS) {
      await schedule(tx, "lineage.rebirth", e.rebornAt, { emperorId });
      return null;
    }
    const [death] = await tx.select().from(emperorDeaths).where(eq(emperorDeaths.emperorId, emperorId)).orderBy(desc(emperorDeaths.diedAt)).limit(1);
    const from = findSystem(this.seed, e.systemId)?.position ?? null;
    const list = await this.cradles(tx, emperorId);
    const cradle = list.find((c) => c.colonyId === e.rebirthColonyId) ?? (await this.pickCradle(tx, emperorId, e.preferredCradleId, from));
    let systemId: string;
    if (cradle) systemId = cradle.systemId;
    else {
      // Al Núcleo: el sistema previsto al morir (si era del Núcleo) o uno al azar.
      const planned = death?.rebirthSystemId ?? null;
      systemId = planned && this.coreSpawns().has(planned) ? planned : pickSpawnSystem(this.seed).id;
    }
    const park = cradle ? this.parkAt(cradle.systemId, cradle.planetIndex, now) : null;
    await tx
      .update(emperors)
      .set({
        systemId,
        destSystemId: null,
        departAt: null,
        arriveAt: null,
        ...parkColumns(park),
        ...rebirthSupplies(now),
        deadAt: null,
        rebornAt: null,
        rebirthColonyId: null,
        generation: e.generation + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(emperors.id, emperorId));
    if (death) await tx.update(emperorDeaths).set({ rebirthKind: cradle ? "cradle" : "core", rebirthSystemId: systemId }).where(eq(emperorDeaths.id, death.id));
    await tx.insert(resourceLedger).values({ emperorId, colonyId: null, reason: "rebirth", ref: cradle ? `colony:${cradle.colonyId}` : "core", humans: LINEAGE.rebirthHumans });
    const system = findSystem(this.seed, systemId)!;
    const discovered = await discoverAround(tx, this.seed, emperorId, system, EMPEROR_FLAGSHIP.scannerRangeLy);
    return { emperorId, systemId, discovered, colonies: [] };
  }

  /** Sistemas del Núcleo Humano donde puede aparecer un Emperador (en caché). */
  private coreSpawns(): Set<string> {
    this.spawnIds ??= new Set(spawnCandidates(this.seed).map((s) => s.id));
    return this.spawnIds;
  }
  private spawnIds: Set<string> | null = null;

  // --- Estado para el jugador ---

  /** Linaje de un Emperador (tema `me`), o null si no existe. */
  async status(emperorId: string): Promise<LineageStatus | null> {
    const [e] = await this.db.select().from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    if (!e) return null;
    const now = this.now();
    const [cradleRows, heirRows, deathRows] = await Promise.all([
      this.cradles(this.db, emperorId),
      this.db
        .select({ heir: heirs, systemId: colonies.systemId, planetIndex: colonies.planetIndex, colonyName: colonies.name })
        .from(heirs)
        .innerJoin(colonies, eq(colonies.id, heirs.colonyId))
        .where(eq(heirs.emperorId, emperorId))
        .orderBy(asc(heirs.createdAt)),
      this.db.select().from(emperorDeaths).where(eq(emperorDeaths.emperorId, emperorId)).orderBy(desc(emperorDeaths.diedAt)).limit(LINEAGE.recentDeaths),
    ]);
    const heirByColony = new Map(heirRows.map((h) => [h.heir.colonyId, h.heir.id]));
    const cradles: CradleView[] = cradleRows.map((c) => ({
      colonyId: c.colonyId,
      colonyName: this.colonyName(c),
      systemId: c.systemId,
      systemName: this.systemName(c.systemId),
      heirId: heirByColony.get(c.colonyId) ?? null,
    }));
    const heirsView: HeirView[] = heirRows.map(({ heir, systemId, planetIndex, colonyName }) => ({
      id: heir.id,
      name: heir.name,
      colonyId: heir.colonyId,
      colonyName: this.colonyName({ name: colonyName, systemId, planetIndex }),
      systemId,
      systemName: this.systemName(systemId),
      doctrine: heir.doctrine as HeirDoctrineId,
      builds: heir.builds,
      state: heir.state as HeirView["state"],
      readyAt: heir.readyAt?.getTime() ?? null,
    }));
    const deaths: DeathRecord[] = deathRows.map((d) => ({
      id: d.id,
      systemId: d.systemId,
      systemName: this.systemName(d.systemId),
      cause: d.cause as DeathRecord["cause"],
      by: d.killer,
      streak: d.streak,
      diedAt: d.diedAt.getTime(),
      rebornAt: d.rebornAt.getTime(),
      rebirthKind: (d.rebirthKind as DeathRecord["rebirthKind"]) ?? null,
    }));
    const streak = decayedStreak(e.deathStreak, e.lastDeathAt?.getTime() ?? null, now, this.timeScale);
    let dead: LineageStatus["dead"] = null;
    if (e.deadAt && e.rebornAt) {
      const cradle = cradleRows.find((c) => c.colonyId === e.rebirthColonyId);
      const planned = deathRows[0]?.rebirthSystemId ?? e.systemId;
      const place: RebirthPlace = cradle
        ? { kind: "cradle", systemId: cradle.systemId, systemName: this.systemName(cradle.systemId), colonyId: cradle.colonyId, colonyName: this.colonyName(cradle) }
        : { kind: "core", systemId: planned, systemName: this.systemName(planned), colonyId: null, colonyName: null };
      dead = { diedAt: e.deadAt.getTime(), rebornAt: e.rebornAt.getTime(), place };
    }
    return {
      generation: e.generation,
      dead,
      streak,
      nextGestationMs: gestationMs(streak + 1, cradleRows.length === 0, this.timeScale),
      preferredCradleId: cradleRows.some((c) => c.colonyId === e.preferredCradleId) ? e.preferredCradleId : null,
      cradles,
      heirs: heirsView,
      deaths,
      incarnateReadyAt: incarnateReadyAt(e.incarnatedAt?.getTime() ?? null, this.timeScale),
    };
  }

  /** ¿Está muerto (gestándose)? */
  async isDead(db: Database | Tx, emperorId: string): Promise<boolean> {
    const [e] = await db.select({ deadAt: emperors.deadAt }).from(emperors).where(eq(emperors.id, emperorId)).limit(1);
    return !!e?.deadAt;
  }

  // --- Órdenes ---

  /** Orden `lineage.prefer`: Cuna preferida para renacer (o null: la más cercana). */
  async prefer(emperorId: string, colonyId: string | null): Promise<Result> {
    if (colonyId && !(await this.cradles(this.db, emperorId)).some((c) => c.colonyId === colonyId)) return { ok: false, error: "no_cradle" };
    await this.db.update(emperors).set({ preferredCradleId: colonyId }).where(eq(emperors.id, emperorId));
    return { ok: true, fx: { emperorId, colonies: [], rebirth: null } };
  }

  /**
   * Orden `heir.gestate`: gesta un Heredero en la Cuna de una colonia propia que
   * no tenga otro. Paga `HEIRS.cost` de sus existencias y `HEIRS.population`
   * habitantes, y nace a las `HEIRS.gestationHours` (evento `heir.born`).
   */
  async gestate(emperorId: string, colonyId: string, doctrine: HeirDoctrine): Promise<Result> {
    if (!getDoctrine(doctrine)) return { ok: false, error: "invalid_command" };
    return this.db.transaction(async (tx): Promise<Result> => {
      const [e] = await tx.select({ id: emperors.id, heirsBorn: emperors.heirsBorn }).from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
      if (!e) return { ok: false, error: "no_emperor" };
      if (!(await this.cradles(tx, emperorId)).some((c) => c.colonyId === colonyId)) return { ok: false, error: "no_cradle" };
      const mine = await tx.select({ id: heirs.id, colonyId: heirs.colonyId }).from(heirs).where(eq(heirs.emperorId, emperorId));
      if (mine.some((h) => h.colonyId === colonyId)) return { ok: false, error: "colony_has_heir" };
      if (mine.length >= HEIRS.maxPerEmperor) return { ok: false, error: "heir_limit" };
      const now = this.now();
      const locked = await this.colonyService.lockResolved(tx, emperorId, colonyId, now);
      if (!locked) return { ok: false, error: "no_colony" };
      if (!canAfford(locked.state.stock, HEIRS.cost)) return { ok: false, error: "insufficient_resources" };
      if (locked.state.population < HEIRS.population + HUMANS.minColonistsBase) return { ok: false, error: "not_enough_humans" };
      await this.colonyService.writeState(tx, colonyId, { population: locked.state.population - HEIRS.population, stock: pay(locked.state.stock, HEIRS.cost) }, now);
      const readyAt = now + realDurationMs(HEIRS.gestationHours, this.timeScale);
      const [heir] = await tx
        .insert(heirs)
        .values({ emperorId, colonyId, name: heirName(e.heirsBorn), doctrine, state: "gestating", readyAt: new Date(readyAt) })
        .returning({ id: heirs.id });
      await tx.update(emperors).set({ heirsBorn: e.heirsBorn + 1 }).where(eq(emperors.id, emperorId));
      const c = HEIRS.cost;
      await tx.insert(resourceLedger).values({
        emperorId,
        colonyId,
        reason: "heir",
        ref: `heir:${heir!.id}`,
        metal: -c.metal,
        volatiles: -c.volatiles,
        crystal: -c.crystal,
        alloys: -c.alloys,
        humans: -HEIRS.population,
      });
      await schedule(tx, "heir.born", new Date(readyAt), { heirId: heir!.id });
      return { ok: true, fx: { emperorId, colonies: [colonyId], rebirth: null } };
    });
  }

  /**
   * Pone (o quita, con null) al gobernador de una colonia propia: la colonia se
   * resuelve antes hasta ahora, así la nueva extracción cuenta desde este momento.
   */
  private async setGovernor(tx: Tx, emperorId: string, colonyId: string, doctrine: string | null, now: number): Promise<void> {
    const locked = await this.colonyService.lockResolved(tx, emperorId, colonyId, now);
    if (!locked) return;
    await this.colonyService.writeState(tx, colonyId, locked.state, now);
    await tx.update(colonies).set({ governor: doctrine }).where(eq(colonies.id, colonyId));
  }

  /** Manejador del evento `heir.born`: el Heredero nace y empieza a gobernar su colonia. */
  async born(tx: Tx, heirId: string): Promise<LineageEffects | null> {
    const [heir] = await tx.select().from(heirs).where(eq(heirs.id, heirId)).for("update").limit(1);
    if (!heir || heir.state !== "gestating") return null;
    const now = this.now();
    if (heir.readyAt && heir.readyAt.getTime() > now + DUE_TOLERANCE_MS) {
      await schedule(tx, "heir.born", heir.readyAt, { heirId });
      return null;
    }
    await tx.update(heirs).set({ state: "active", readyAt: null }).where(eq(heirs.id, heirId));
    await this.setGovernor(tx, heir.emperorId, heir.colonyId, heir.doctrine, now);
    await schedule(tx, "heir.govern", new Date(now + this.governMs()), { heirId });
    return { emperorId: heir.emperorId, colonies: [heir.colonyId], rebirth: null };
  }

  private governMs(): number {
    return Math.max(MIN_GOVERN_MS, realDurationMs(HEIRS.governEveryHours, this.timeScale));
  }

  /** Orden `heir.doctrine`: cambia la doctrina del Heredero y si encarga instalaciones. */
  async setDoctrine(emperorId: string, heirId: string, doctrine: HeirDoctrine, builds: boolean): Promise<Result> {
    if (!getDoctrine(doctrine)) return { ok: false, error: "invalid_command" };
    return this.db.transaction(async (tx): Promise<Result> => {
      const [heir] = await tx.select().from(heirs).where(and(eq(heirs.id, heirId), eq(heirs.emperorId, emperorId))).for("update").limit(1);
      if (!heir) return { ok: false, error: "no_heir" };
      await tx.update(heirs).set({ doctrine, builds }).where(eq(heirs.id, heirId));
      if (heir.state === "active" && heir.doctrine !== doctrine) await this.setGovernor(tx, emperorId, heir.colonyId, doctrine, this.now());
      return { ok: true, fx: { emperorId, colonies: [heir.colonyId], rebirth: null } };
    });
  }

  /** Orden `heir.assign`: el Heredero nacido pasa a gobernar otra colonia propia sin Heredero. */
  async assign(emperorId: string, heirId: string, colonyId: string): Promise<Result> {
    return this.db.transaction(async (tx): Promise<Result> => {
      const [heir] = await tx.select().from(heirs).where(and(eq(heirs.id, heirId), eq(heirs.emperorId, emperorId))).for("update").limit(1);
      if (!heir) return { ok: false, error: "no_heir" };
      if (heir.state !== "active") return { ok: false, error: "heir_not_ready" };
      if (heir.colonyId === colonyId) return { ok: false, error: "already_there" };
      const [target] = await tx.select({ id: colonies.id }).from(colonies).where(and(eq(colonies.id, colonyId), eq(colonies.emperorId, emperorId))).limit(1);
      if (!target) return { ok: false, error: "no_colony" };
      const [taken] = await tx.select({ id: heirs.id }).from(heirs).where(eq(heirs.colonyId, colonyId)).limit(1);
      if (taken) return { ok: false, error: "colony_has_heir" };
      const now = this.now();
      await this.setGovernor(tx, emperorId, heir.colonyId, null, now);
      await tx.update(heirs).set({ colonyId }).where(eq(heirs.id, heirId));
      await this.setGovernor(tx, emperorId, colonyId, heir.doctrine, now);
      return { ok: true, fx: { emperorId, colonies: [heir.colonyId, colonyId], rebirth: null } };
    });
  }

  /**
   * Orden `heir.incarnate`: el Emperador se encarna en un Heredero nacido. Despierta
   * en su colonia con su nave (que aparece junto al planeta) y el Heredero se
   * consume (la colonia se queda sin gobernador). Vivo, conserva lo que llevaba
   * la nave, pero no puede hacerlo viajando, en una batalla ni en pleno combate.
   * Muerto, deja de esperar la gestación y despierta como al renacer. Como mucho
   * una vez cada `LINEAGE.incarnateCooldownHours`.
   */
  async incarnate(emperorId: string, heirId: string): Promise<Result> {
    return this.db.transaction(async (tx): Promise<Result> => {
      const [e] = await tx.select().from(emperors).where(eq(emperors.id, emperorId)).for("update").limit(1);
      if (!e) return { ok: false, error: "no_emperor" };
      const [heir] = await tx.select().from(heirs).where(and(eq(heirs.id, heirId), eq(heirs.emperorId, emperorId))).for("update").limit(1);
      if (!heir) return { ok: false, error: "no_heir" };
      if (heir.state !== "active") return { ok: false, error: "heir_not_ready" };
      const now = this.now();
      if (incarnateReadyAt(e.incarnatedAt?.getTime() ?? null, this.timeScale) > now) return { ok: false, error: "cooldown" };
      const dead = e.deadAt !== null;
      if (!dead) {
        const place = placeFromRow(this.seed, e, now);
        if (isTravelling(place, now)) return { ok: false, error: "in_transit" };
        if (this.inCombat(emperorId)) return { ok: false, error: "in_combat" };
        const [fighting] = await tx
          .select({ id: battles.id })
          .from(battles)
          .innerJoin(battleSides, eq(battleSides.battleId, battles.id))
          .where(and(eq(battles.systemId, place.location.systemId), isNull(battles.endedAt), eq(battleSides.emperorId, emperorId)))
          .limit(1);
        if (fighting) return { ok: false, error: "in_battle" };
      }
      const [colony] = await tx.select().from(colonies).where(and(eq(colonies.id, heir.colonyId), eq(colonies.emperorId, emperorId))).limit(1);
      if (!colony) return { ok: false, error: "no_colony" };
      await this.setGovernor(tx, emperorId, colony.id, null, now);
      await tx.delete(heirs).where(eq(heirs.id, heirId));
      const park = this.parkAt(colony.systemId, colony.planetIndex, now);
      await tx
        .update(emperors)
        .set({
          systemId: colony.systemId,
          destSystemId: null,
          departAt: null,
          arriveAt: null,
          ...parkColumns(park),
          ...(dead ? { ...rebirthSupplies(now), deadAt: null, rebornAt: null, rebirthColonyId: null } : {}),
          generation: e.generation + 1,
          incarnatedAt: new Date(now),
          updatedAt: sql`now()`,
        })
        .where(eq(emperors.id, emperorId));
      if (dead) {
        const [death] = await tx.select({ id: emperorDeaths.id }).from(emperorDeaths).where(eq(emperorDeaths.emperorId, emperorId)).orderBy(desc(emperorDeaths.diedAt)).limit(1);
        if (death) await tx.update(emperorDeaths).set({ rebirthKind: "heir", rebirthSystemId: colony.systemId }).where(eq(emperorDeaths.id, death.id));
        await tx.insert(resourceLedger).values({ emperorId, colonyId: colony.id, reason: "rebirth", ref: `heir:${heirId}`, humans: LINEAGE.rebirthHumans });
      }
      const system = findSystem(this.seed, colony.systemId)!;
      const discovered = await discoverAround(tx, this.seed, emperorId, system, EMPEROR_FLAGSHIP.scannerRangeLy);
      return { ok: true, fx: { emperorId, colonies: [colony.id], rebirth: { emperorId, systemId: colony.systemId, discovered, colonies: [colony.id] } } };
    });
  }

  // --- Gobernadores ---

  /**
   * Manejador del evento `heir.govern`: programa la siguiente decisión y, tras
   * confirmar, el gobernador encarga lo que pida su doctrina (con la orden
   * de un jugador, `ColonyService.build`).
   */
  async govern(tx: Tx, heirId: string): Promise<(() => Promise<LineageEffects | null>) | null> {
    const [heir] = await tx.select().from(heirs).where(eq(heirs.id, heirId)).limit(1);
    if (!heir || heir.state !== "active") return null;
    await schedule(tx, "heir.govern", new Date(this.now() + this.governMs()), { heirId });
    if (!heir.builds) return null;
    return async () => {
      const colony = await this.colonyService.byId(heir.emperorId, heir.colonyId);
      if (!colony) return null;
      const next = governorChoice(heir.doctrine, colony.installations, colony.builds.length, colony.stock);
      if (!next) return null;
      const res = await this.colonyService.build(heir.emperorId, colony.id, "installation", next);
      return res.ok ? { emperorId: heir.emperorId, colonies: [colony.id], rebirth: null } : null;
    };
  }

  // --- Emperadores de la IA ---

  /**
   * Turno de linaje de un Emperador de la IA (lo llama `AiEmperorService`), con
   * las órdenes de un jugador: gesta Herederos en sus Cunas, los reparte por
   * sus colonias y, si ha caído y le queda mucho de gestación, se encarna en uno.
   * La Cuna la construye la propia IA en su capital (`AI_LINEAGE.cradle`).
   */
  async aiTurn(emperorId: string, personality: AiPersonality): Promise<LineageEffects[]> {
    const def = AI_LINEAGE[personality];
    const out: LineageEffects[] = [];
    const status = await this.status(emperorId);
    if (!status) return out;
    const now = this.now();
    // Caído: mejor un Heredero ya que esperar una gestación larga.
    const ready = status.heirs.find((h) => h.state === "active");
    if (status.dead && ready && status.incarnateReadyAt <= now && status.dead.rebornAt - now > realDurationMs(0.5, this.timeScale)) {
      const res = await this.incarnate(emperorId, ready.id);
      if (res.ok) out.push(res.fx);
      return out;
    }
    // Herederos que ya nacieron en una Cuna: a gobernar una colonia sin Heredero (así la Cuna queda libre).
    const ownColonies = await this.db.select({ id: colonies.id }).from(colonies).where(eq(colonies.emperorId, emperorId)).orderBy(asc(colonies.foundedAt));
    const governed = new Set(status.heirs.map((h) => h.colonyId));
    const cradleIds = new Set(status.cradles.map((c) => c.colonyId));
    for (const h of status.heirs) {
      if (h.state !== "active" || !cradleIds.has(h.colonyId)) continue;
      const free = ownColonies.find((c) => !governed.has(c.id) && !cradleIds.has(c.id));
      if (!free) break;
      const res = await this.assign(emperorId, h.id, free.id);
      if (res.ok) {
        out.push(res.fx);
        governed.delete(h.colonyId);
        governed.add(free.id);
      }
    }
    // Gestar hasta los que quiere su personalidad.
    if (status.heirs.length < def.heirs) {
      const cradle = status.cradles.find((c) => !governed.has(c.colonyId));
      if (cradle) {
        const res = await this.gestate(emperorId, cradle.colonyId, def.doctrine);
        if (res.ok) out.push(res.fx);
      }
    }
    return out;
  }

  /** Para la exportación de datos: sus Herederos y sus muertes. */
  async exportFor(emperorId: string) {
    return {
      heirs: await this.db.select().from(heirs).where(eq(heirs.emperorId, emperorId)),
      deaths: await this.db.select().from(emperorDeaths).where(eq(emperorDeaths.emperorId, emperorId)),
    };
  }

  /** Ids de los Herederos de un Emperador (para borrar sus eventos al borrar la cuenta). */
  async heirIds(db: Database | Tx, emperorId: string): Promise<string[]> {
    return (await db.select({ id: heirs.id }).from(heirs).where(eq(heirs.emperorId, emperorId))).map((r) => r.id);
  }

}
