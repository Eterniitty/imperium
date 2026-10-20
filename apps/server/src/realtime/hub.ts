import type { FastifyBaseLogger } from "fastify";
import { PROTOCOL_VERSION, type CommandError, type DeltaOp, type Emperor, type EmperorView, type ServerMessage, type Topic } from "@imperium/shared";
import type { EmperorService } from "../emperor/service";
import type { FleetService } from "../fleet/service";
import { canSee, type SocialService } from "../social/service";

/** Un jugador conectado por WebSocket. */
export interface Client {
  accountId: string;
  emperorId: string;
  /** Temas de los que recibe cambios: solo tras pedir su instantánea (`sub`). */
  subscribed: Set<Topic>;
  /** Emperadores que este cliente ve ahora: solo a ellos se les avisa de que dejan de verse. */
  known: Set<string>;
  send(msg: ServerMessage): void;
}

type Ack = Extract<ServerMessage, { t: "ack" }>;

/** Órdenes recordadas por cuenta para responder igual a los reintentos. */
const PROCESSED_PER_ACCOUNT = 100;

/**
 * Centro de difusión. Temas:
 * - "emperors": los Emperadores que cada jugador puede ver (según su
 *   visibilidad y sus compañeros); a cada cliente le llega solo lo suyo.
 * - "me": privado de cada Emperador (sus flotas); su `seq` es propio de cada uno.
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

  constructor(
    private readonly emperors: EmperorService,
    private readonly fleets: FleetService,
    private readonly social: SocialService,
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
    return { ...e, online: (this.online.get(e.id) ?? 0) > 0 };
  }

  /** Encola una tarea; un fallo se registra y no detiene la cola. */
  private enqueue(task: () => Promise<void>): Promise<void> {
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
        const fleets = await this.fleets.byEmperor(client.emperorId);
        if (!this.clients.has(client)) return;
        client.send({ t: "snap", topic, seq: this.meSeq.get(client.emperorId) ?? 0, serverTime: this.now(), data: { fleets } });
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
