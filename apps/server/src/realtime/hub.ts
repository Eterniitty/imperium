import type { FastifyBaseLogger } from "fastify";
import { PROTOCOL_VERSION, type CommandError, type DeltaOp, type Emperor, type EmperorView, type ServerMessage, type Topic } from "@imperium/shared";
import type { ColonyService } from "../colony/service";
import type { DiscoveryService } from "../discovery/service";
import type { EmperorService } from "../emperor/service";
import type { FleetService } from "../fleet/service";
import type { HumanityService } from "../humanity/service";
import { canSee, type SocialService } from "../social/service";
import type { WarEffects, WarService } from "../war/service";

/** Un jugador conectado por WebSocket. */
export interface Client {
  accountId: string;
  emperorId: string;
  /** Temas de los que recibe cambios: solo tras pedir su instantánea (`sub`). */
  subscribed: Set<Topic>;
  /** Emperadores que este cliente ve ahora: solo a ellos se les avisa de que dejan de verse. */
  known: Set<string>;
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

  /** Cierra todas las conexiones de una cuenta (p. ej. al borrarla). */
  disconnectAccount(accountId: string, code: number, reason: string): void {
    for (const c of [...this.clients]) if (c.accountId === accountId) c.close(code, reason);
  }

  /** Envía la instantánea de un tema y, desde ese momento, sus cambios. */
  subscribe(client: Client, topic: Topic): Promise<void> {
    return this.enqueue(async () => {
      if (topic === "emperors") {
        const [all, visibility, mine] = await Promise.all([this.emperors.all(), this.social.visibilities(), this.social.mutualAllies(client.emperorId)]);
        if (!this.clients.has(client)) return;
        // Los compañeros son mutuos: el objetivo tiene al cliente como compañero si el cliente lo tiene a él.
        const visible = all.filter((e) => canSee(client.emperorId, e.id, visibility.get(e.id) ?? "hidden", mine.has(e.id) ? new Set([client.emperorId]) : new Set()));
        client.known = new Set(visible.map((e) => e.id));
        client.send({ t: "snap", topic, seq: this.emperorsSeq, serverTime: this.now(), data: { emperors: visible.map((e) => this.view(e)) } });
      } else {
        const [fleets, discovered, colonies, humans, battles, wallet] = await Promise.all([
          this.fleets.byEmperor(client.emperorId),
          this.discoveries.list(client.emperorId),
          this.colonies.list(client.emperorId),
          this.colonies.humans(client.emperorId),
          this.wars.list(client.emperorId),
          this.humanity.wallet(client.emperorId),
        ]);
        if (!this.clients.has(client) || !humans || !wallet) return;
        client.send({
          t: "snap",
          topic,
          seq: this.meSeq.get(client.emperorId) ?? 0,
          serverTime: this.now(),
          data: { fleets, discovered, colonies, humans, battles, wallet },
        });
      }
      client.subscribed.add(topic);
    });
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
      const seq = ++this.emperorsSeq;
      const path = `emperors.${emperorId}` as const;
      for (const c of this.clients) {
        if (!c.subscribed.has("emperors")) continue;
        const sees = e !== null && canSee(c.emperorId, emperorId, visibility, allies);
        let ops: DeltaOp[] = [];
        if (sees) {
          ops = [{ path, v: this.view(e) }];
          c.known.add(emperorId);
        } else if (c.known.delete(emperorId)) {
          ops = [{ path, v: null }];
        }
        c.send({ t: "delta", topic: "emperors", seq, serverTime: this.now(), ops });
      }
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
  }

  /** Avisa a su dueño de los sistemas que acaba de descubrir (niebla de guerra). */
  publishDiscovered(emperorId: string, systemIds: string[]): Promise<void> {
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
