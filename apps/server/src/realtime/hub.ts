import type { FastifyBaseLogger } from "fastify";
import type { RankService } from "../rank/service";
import type { GoalService } from "../goal/service";
import type { ColonyRequestService } from "../colony/requests";
import type { ContractService } from "../contract/service";
import { distance, PROTOCOL_VERSION, type CommandError, type DeltaOp, type Emperor, type EmperorView, type Probe, type ServerMessage, type ShipDesignSnapshot, type Topic } from "@imperium/shared";
import { INTEREST } from "@imperium/content";
import { positionAt } from "@imperium/sim";
import type { ColonyService } from "../colony/service";
import type { DiscoveryService } from "../discovery/service";
import type { EmperorService } from "../emperor/service";
import type { FleetService } from "../fleet/service";
import type { HumanityService } from "../humanity/service";
import type { LineageService } from "../lineage/service";
import type { ProbeService } from "../probe/service";
import type { FlagshipService } from "../space/flagship";
import { canSee, type SocialService } from "../social/service";
import type { WarEffects, WarService } from "../war/service";
import type { SiegeEffects, SiegeService } from "../war/siege";

/** Un jugador conectado por WebSocket. */
/** Nave de una flota pilotada a distancia: de qué flota, en qué sistema y con qué casco empezó. */
export interface RemotePilot {
  shipId: string;
  fleetId: string;
  systemId: string;
  classId: string;
  hull: number;
  name: string;
  /** Nave del Astillero: su diseño (sus piezas mandan en el combate). */
  design?: ShipDesignSnapshot;
}

export interface Client {
  accountId: string;
  emperorId: string;
  /** Temas de los que recibe cambios: solo tras pedir su instantánea (`sub`). */
  subscribed: Set<Topic>;
  /** Emperadores que este cliente ve ahora: solo a ellos se les avisa de que dejan de verse. */
  known: Set<string>;
  /** Nave de una flota propia que pilota a distancia (orden `fleet.pilot`); sin ella, pilota su nave del Emperador. */
  piloting?: RemotePilot | null;
  send(msg: ServerMessage): void;
  /** Cierra la conexión (el cierre la saca del centro y del espacio local). */
  close(code: number, reason: string): void;
}

type Ack = Extract<ServerMessage, { t: "ack" }>;

/** Órdenes recordadas por cuenta para responder igual a los reintentos. */
const PROCESSED_PER_ACCOUNT = 100;

/**
 * Centro de difusión. Temas:
 * - "emperors": los Emperadores que cada jugador puede ver (según su
 *   visibilidad y sus compañeros); a cada cliente le llega solo lo suyo.
 * - "me": privado de cada Emperador (sus flotas, descubrimientos, colonias,
 *   humanos y batallas); su `seq` es propio de cada uno.
 *
 * Todo lo que lee la base de datos y envía pasa por una cola, en orden: así
 * ninguna instantánea se cruza con un cambio y `seq` no tiene huecos.
 */
export class Hub {
  private readonly clients = new Set<Client>();
  private readonly online = new Map<string, number>();
  private readonly processed = new Map<string, Map<string, Promise<Ack>>>();
  private emperorsSeq = 0;
  private readonly meSeq = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Apagando el servidor: ya no se difunde nada (la base de datos se va a cerrar). */
  private closing = false;
  /** Asedios (Fase 9b; lo enlaza `app.ts`). */
  sieges: SiegeService | null = null;

  /** Nave del Emperador (aparcamiento y recursos) para el tema `me`; la pone `buildApp`. */
  flagships: FlagshipService | null = null;
  /** Fase 10: muerte y linaje para el tema `me`; lo pone `buildApp`. */
  lineage: LineageService | null = null;
  /** Sondas de exploración en vuelo para el tema `me`; lo pone `buildApp`. */
  probes: ProbeService | null = null;
  /** Tablero de contratos (tema `me`, `contracts.all`). */
  contracts: ContractService | null = null;
  /** Rango del Emperador (tema `me`, `rank`). */
  rank: RankService | null = null;
  /** Objetivos del día y de la semana (tema `me`, `goals`). */
  goals: GoalService | null = null;
  /** Peticiones de las colonias (tema `me`, `requests`). */
  requests: ColonyRequestService | null = null;
  /** Nuevos descubrimientos de un Emperador (contratos de exploración). */
  onDiscovered: ((emperorId: string, count: number) => void) | null = null;
  /**
   * Fase 10: lo que una batalla hizo a las naves de los Emperadores (casco,
   * muertes), para el espacio local; lo pone `buildApp`.
   */
  onWarFlagships: ((fx: WarEffects) => void) | null = null;

  constructor(
    private readonly emperors: EmperorService,
    private readonly fleets: FleetService,
    private readonly social: SocialService,
    private readonly discoveries: DiscoveryService,
    private readonly colonies: ColonyService,
    private readonly wars: WarService,
    private readonly humanity: HumanityService,
    private readonly log: FastifyBaseLogger,
    private readonly timeScale: number,
    private readonly now: () => number = Date.now,
  ) {}

  get connectionCount(): number {
    return this.clients.size;
  }

  connectionsOf(accountId: string): number {
    let n = 0;
    for (const c of this.clients) if (c.accountId === accountId) n++;
    return n;
  }

  private view(e: Emperor): EmperorView {
    // Los Emperadores de la IA (Fase 11) siempre están «conectados».
    return { ...e, online: e.ai === true || (this.online.get(e.id) ?? 0) > 0 };
  }

  /** Deja de difundir y espera a que termine lo que hubiera en la cola. */
  async close(): Promise<void> {
    this.closing = true;
    await this.queue;
  }

  /** Encola una tarea; un fallo se registra y no detiene la cola. */
  private enqueue(task: () => Promise<void>): Promise<void> {
    if (this.closing) return Promise.resolve();
    const run = this.queue.then(task).catch((err: unknown) => this.log.error(err, "Error en la difusión"));
    this.queue = run;
    return run;
  }

  add(client: Client): void {
    this.clients.add(client);
    client.send({ t: "hello", protocol: PROTOCOL_VERSION, emperorId: client.emperorId, serverTime: this.now(), timeScale: this.timeScale });
    const n = (this.online.get(client.emperorId) ?? 0) + 1;
    this.online.set(client.emperorId, n);
    if (n === 1) void this.publish(client.emperorId);
  }

  remove(client: Client): void {
    if (!this.clients.delete(client)) return;
    const n = (this.online.get(client.emperorId) ?? 1) - 1;
    if (n > 0) return void this.online.set(client.emperorId, n);
    this.online.delete(client.emperorId);
    void this.publish(client.emperorId);
  }

  /** Envía un mensaje a todas las conexiones de estos Emperadores. */
  sendToEmperors(ids: ReadonlySet<string>, msg: ServerMessage): void {
    for (const c of this.clients) if (ids.has(c.emperorId)) c.send(msg);
  }

  /** Cierra todas las conexiones de una cuenta (p. ej. al borrarla). */
  disconnectAccount(accountId: string, code: number, reason: string): void {
    for (const c of [...this.clients]) if (c.accountId === accountId) c.close(code, reason);
  }

  /** Envía la instantánea de un tema y, desde ese momento, sus cambios. */
  subscribe(client: Client, topic: Topic): Promise<void> {
    return this.enqueue(async () => {
      if (topic === "emperors") {
        await this.emperorsSnapshot(client);
      } else {
        const [fleets, discovered, colonies, humans, battles, wallet, flagship, sieges, lineage, probes, contracts, rank, goals, requests] = await Promise.all([
          this.fleets.byEmperor(client.emperorId),
          this.discoveries.list(client.emperorId),
          this.colonies.list(client.emperorId),
          this.colonies.humans(client.emperorId),
          this.wars.list(client.emperorId),
          this.humanity.wallet(client.emperorId),
          this.flagships?.status(client.emperorId) ?? null,
          this.sieges ? this.sieges.list(client.emperorId) : Promise.resolve([]),
          this.lineage ? this.lineage.status(client.emperorId) : Promise.resolve(null),
          this.probes ? this.probes.list(client.emperorId) : Promise.resolve([]),
          this.contracts ? this.contracts.view(client.emperorId) : Promise.resolve(null),
          this.rank ? this.rank.view(client.emperorId) : Promise.resolve(null),
          this.goals ? this.goals.view(client.emperorId) : Promise.resolve(null),
          this.requests ? this.requests.view(client.emperorId) : Promise.resolve(null),
        ]);
        if (!this.clients.has(client) || !humans || !wallet) return;
        client.send({
          t: "snap",
          topic,
          seq: this.meSeq.get(client.emperorId) ?? 0,
          serverTime: this.now(),
          data: { fleets, discovered, colonies, humans, battles, wallet, flagship, sieges, lineage, probes, contracts, rank, goals, requests },
        });
      }
      client.subscribed.add(topic);
    });
  }

  // --- Zonas de interés (`INTEREST`) ---

  /** Última posición conocida de cada Emperador (para las zonas de interés). */
  private where = new Map<string, Emperor>();

  /** ¿Entra `target` en la zona de interés de `viewerId`? Sin posición conocida de alguno, sí. */
  private inInterest(viewerId: string, target: Emperor): boolean {
    const viewer = this.where.get(viewerId);
    if (!viewer || viewerId === target.id) return true;
    const now = this.now();
    return distance(positionAt(viewer, now), positionAt(target, now)) <= INTEREST.rangeLy;
  }

  /** Lista de Emperadores de la zona de un cliente (al suscribirse o al moverse él). */
  private async emperorsSnapshot(client: Client): Promise<void> {
    const [all, visibility, mine] = await Promise.all([this.emperors.all(), this.social.visibilities(), this.social.mutualAllies(client.emperorId)]);
    if (!this.clients.has(client)) return;
    for (const e of all) this.where.set(e.id, e);
    // Los compañeros son mutuos: el objetivo tiene al cliente como compañero si el cliente lo tiene a él; se ven siempre, estén donde estén.
    const visible = all.filter(
      (e) => canSee(client.emperorId, e.id, visibility.get(e.id) ?? "hidden", mine.has(e.id) ? new Set([client.emperorId]) : new Set()) && (mine.has(e.id) || this.inInterest(client.emperorId, e)),
    );
    client.known = new Set(visible.map((e) => e.id));
    client.send({ t: "snap", topic: "emperors", seq: this.emperorsSeq, serverTime: this.now(), data: { emperors: visible.map((e) => this.view(e)) } });
  }

  private send(topic: Topic, seq: number, ops: DeltaOp[], to: (c: Client) => boolean): void {
    const msg: ServerMessage = { t: "delta", topic, seq, serverTime: this.now(), ops };
    for (const c of this.clients) if (c.subscribed.has(topic) && to(c)) c.send(msg);
  }

  /**
   * Difunde el estado actual de un Emperador (leído de la base de datos al
   * enviarlo) a quien puede verlo. A quien lo veía y ya no, le llega su baja;
   * a los demás, nada. Todos los clientes avanzan `seq` para no ver huecos.
   */
  publish(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      const [e, visibility, allies] = await Promise.all([this.emperors.byId(emperorId), this.social.visibility(emperorId), this.social.mutualAllies(emperorId)]);
      const before = this.where.get(emperorId);
      if (e) this.where.set(emperorId, e);
      else this.where.delete(emperorId);
      const seq = ++this.emperorsSeq;
      const path = `emperors.${emperorId}` as const;
      for (const c of this.clients) {
        if (!c.subscribed.has("emperors")) continue;
        const sees = e !== null && canSee(c.emperorId, emperorId, visibility, allies) && (allies.has(c.emperorId) || this.inInterest(c.emperorId, e));
        let ops: DeltaOp[] = [];
        if (sees) {
          ops = [{ path, v: this.view(e) }];
          c.known.add(emperorId);
        } else if (c.known.delete(emperorId)) {
          ops = [{ path, v: null }];
        }
        c.send({ t: "delta", topic: "emperors", seq, serverTime: this.now(), ops });
      }
      // Se movió: su zona de interés cambia y sus clientes reciben de nuevo la lista.
      const moved = !!e && (!before || before.location.systemId !== e.location.systemId || (before.travel?.arriveAt ?? 0) !== (e.travel?.arriveAt ?? 0));
      if (moved) for (const c of [...this.clients]) if (c.emperorId === emperorId && c.subscribed.has("emperors")) await this.emperorsSnapshot(c);
    });
  }

  /** Envía a su dueño el estado actual de una flota. */
  publishFleet(emperorId: string, fleetId: string): Promise<void> {
    return this.enqueue(async () => {
      const fleet = await this.fleets.byId(fleetId);
      const seq = (this.meSeq.get(emperorId) ?? 0) + 1;
      this.meSeq.set(emperorId, seq);
      this.send("me", seq, [{ path: `fleets.${fleetId}`, v: fleet }], (c) => c.emperorId === emperorId);
    });
  }

  /** La flota ya no es de este Emperador (la regaló): desaparece de su lista. */
  publishFleetGone(emperorId: string, fleetId: string): Promise<void> {
    return this.enqueue(async () => {
      this.send("me", this.nextMeSeq(emperorId), [{ path: `fleets.${fleetId}`, v: null }], (c) => c.emperorId === emperorId);
    });
  }

  /** Emperadores con alguna conexión abierta ahora. */
  onlineEmperors(): string[] {
    return [...new Set([...this.clients].map((c) => c.emperorId).filter((id): id is string => !!id))];
  }

  /** Envía a su dueño las peticiones de sus colonias. */
  publishRequests(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.requests) return;
      const v = await this.requests.view(emperorId);
      this.send("me", this.nextMeSeq(emperorId), [{ path: "requests", v }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño sus objetivos del día y de la semana. */
  publishGoals(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.goals) return;
      const view = await this.goals.view(emperorId);
      this.send("me", this.nextMeSeq(emperorId), [{ path: "goals", v: view }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño su experiencia (rango). */
  publishRank(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.rank) return;
      const v = await this.rank.view(emperorId);
      this.send("me", this.nextMeSeq(emperorId), [{ path: "rank", v }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño su tablero de contratos. */
  publishContracts(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.contracts) return;
      const view = await this.contracts.view(emperorId);
      this.send("me", this.nextMeSeq(emperorId), [{ path: "contracts.all", v: view }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño el estado actual de una colonia (null si ya no es suya). */
  publishColony(emperorId: string, colonyId: string): Promise<void> {
    return this.enqueue(async () => {
      const colony = await this.colonies.byId(emperorId, colonyId);
      this.send("me", this.nextMeSeq(emperorId), [{ path: `colonies.${colonyId}`, v: colony }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño todas sus colonias (cuando cambia algo que afecta a varias, como la capital). */
  publishColonies(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      const list = await this.colonies.list(emperorId);
      if (list.length === 0) return;
      this.send(
        "me",
        this.nextMeSeq(emperorId),
        list.map((c) => ({ path: `colonies.${c.id}` as const, v: c })),
        (c) => c.emperorId === emperorId,
      );
    });
  }

  /** Envía a su dueño los humanos de la nave del Emperador (tras desembarcar). */
  publishHumans(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      const humans = await this.colonies.humans(emperorId);
      if (!humans) return;
      this.send("me", this.nextMeSeq(emperorId), [{ path: `humans.${emperorId}`, v: humans }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño su cartera de créditos (tras comprar, vender, cobrar o aportar). */
  publishWallet(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.online.has(emperorId)) return;
      const wallet = await this.humanity.wallet(emperorId);
      if (!wallet) return;
      this.send("me", this.nextMeSeq(emperorId), [{ path: `wallet.${emperorId}`, v: wallet }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño el estado de su nave (dónde está aparcada, sus recursos). */
  publishFlagship(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      const status = await this.flagships?.status(emperorId);
      if (!status) return;
      this.send("me", this.nextMeSeq(emperorId), [{ path: `flagship.${emperorId}`, v: status }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño el estado de su linaje (muerte y gestación, Cunas, Herederos; Fase 10). */
  publishLineage(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.online.has(emperorId)) return;
      const status = await this.lineage?.status(emperorId);
      if (!status) return;
      this.send("me", this.nextMeSeq(emperorId), [{ path: `lineage.${emperorId}`, v: status }], (c) => c.emperorId === emperorId);
    });
  }

  /** Envía a su dueño una sonda en vuelo (o null: ya llegó). */
  publishProbe(emperorId: string, probeId: string, probe: Probe | null): Promise<void> {
    return this.enqueue(async () => {
      if (!this.online.has(emperorId)) return;
      this.send("me", this.nextMeSeq(emperorId), [{ path: `probes.${probeId}`, v: probe }], (c) => c.emperorId === emperorId);
    });
  }

  private nextMeSeq(emperorId: string): number {
    const seq = (this.meSeq.get(emperorId) ?? 0) + 1;
    this.meSeq.set(emperorId, seq);
    return seq;
  }

  /** Envía a cada bando el estado de una batalla (rondas, pérdidas, resultado), visto desde su lado. */
  publishBattle(battleId: string): Promise<void> {
    return this.enqueue(async () => {
      for (const emperorId of await this.wars.participants(battleId)) {
        const battle = await this.wars.view(emperorId, battleId);
        this.send("me", this.nextMeSeq(emperorId), [{ path: `battles.${battleId}`, v: battle }], (c) => c.emperorId === emperorId);
      }
    });
  }

  /** Difunde lo que ha cambiado por una batalla: flotas (también las destruidas), colonias y la propia batalla. */
  publishWar(fx: WarEffects): void {
    for (const [fleetId, emperorId] of fx.fleets) void this.publishFleet(emperorId, fleetId);
    for (const [colonyId, emperorId] of fx.colonies) void this.publishColony(emperorId, colonyId);
    for (const battleId of fx.battles) void this.publishBattle(battleId);
    if (fx.hulls.size > 0 || fx.deaths.length > 0) this.onWarFlagships?.(fx);
  }

  /** Envía a atacante y defensor el estado de un asedio, visto desde su lado (Fase 9b). */
  publishSiege(siegeId: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.sieges) return;
      for (const emperorId of await this.sieges.participants(siegeId)) {
        const siege = await this.sieges.view(emperorId, siegeId);
        this.send("me", this.nextMeSeq(emperorId), [{ path: `sieges.${siegeId}`, v: siege }], (c) => c.emperorId === emperorId);
      }
    });
  }

  /** Difunde lo que ha cambiado por un asedio: el asedio, flotas, colonias (también la perdida), carteras y humanos. */
  publishSiegeFx(fx: SiegeEffects): void {
    for (const [fleetId, emperorId] of fx.fleets) void this.publishFleet(emperorId, fleetId);
    for (const emperorId of fx.allColonies) void this.publishColonies(emperorId);
    for (const [colonyId, emperorId] of fx.colonies) void this.publishColony(emperorId, colonyId);
    for (const id of fx.wallets) void this.publishWallet(id);
    for (const id of fx.humans) void this.publishHumans(id);
    for (const siegeId of fx.sieges) void this.publishSiege(siegeId);
  }

  /** Avisa a su dueño de los sistemas que acaba de descubrir (niebla de guerra). */
  publishDiscovered(emperorId: string, systemIds: string[]): Promise<void> {
    if (systemIds.length) this.onDiscovered?.(emperorId, systemIds.length);
    return this.enqueue(async () => {
      if (systemIds.length === 0) return;
      const seq = (this.meSeq.get(emperorId) ?? 0) + 1;
      this.meSeq.set(emperorId, seq);
      this.send("me", seq, systemIds.map((id) => ({ path: `discovered.${id}` as const, v: true as const })), (c) => c.emperorId === emperorId);
    });
  }

  /**
   * Ejecuta una orden una sola vez por `cmdId`: si el cliente la reintenta (por
   * ejemplo, tras reconectar), recibe la misma respuesta sin repetirla.
   */
  command(client: Client, cmdId: string, run: () => Promise<{ ok: true } | { ok: false; error: CommandError }>): Promise<Ack> {
    let seen = this.processed.get(client.accountId);
    if (!seen) this.processed.set(client.accountId, (seen = new Map()));
    const previous = seen.get(cmdId);
    if (previous) return previous;

    const ack = run().then(
      (r): Ack => (r.ok ? { t: "ack", cmdId, ok: true } : { t: "ack", cmdId, ok: false, error: r.error }),
      (err: unknown): Ack => {
        this.log.error(err, "Error al ejecutar una orden");
        seen.delete(cmdId); // un fallo interno sí se puede reintentar
        return { t: "ack", cmdId, ok: false, error: "internal" };
      },
    );
    seen.set(cmdId, ack);
    if (seen.size > PROCESSED_PER_ACCOUNT) seen.delete(seen.keys().next().value!);
    return ack;
  }
}
