import type { FastifyBaseLogger } from "fastify";
import type { CommandError, Emperor, EmperorView, ServerMessage } from "@imperium/shared";
import type { EmperorService } from "../emperor/service";

/** Un jugador conectado por WebSocket. */
export interface Client {
  accountId: string;
  emperorId: string;
  /** Recibe los cambios solo tras pedir la instantánea (`sub`). */
  subscribed: boolean;
  send(msg: ServerMessage): void;
}

type Ack = Extract<ServerMessage, { t: "ack" }>;

/** Órdenes recordadas por cuenta para responder igual a los reintentos. */
const PROCESSED_PER_ACCOUNT = 100;

/**
 * Centro de difusión del tema "emperors": quién está conectado, la instantánea
 * y los cambios. Todo lo que lee la base de datos y envía pasa por una cola, en
 * orden: así ninguna instantánea se cruza con un cambio y `seq` no tiene huecos.
 */
export class Hub {
  private readonly clients = new Set<Client>();
  private readonly online = new Map<string, number>();
  private readonly processed = new Map<string, Map<string, Promise<Ack>>>();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly emperors: EmperorService,
    private readonly log: FastifyBaseLogger,
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

  /** Envía la instantánea y, desde ese momento, los cambios. */
  subscribe(client: Client): Promise<void> {
    return this.enqueue(async () => {
      const all = await this.emperors.all();
      if (!this.clients.has(client)) return;
      client.send({ t: "snap", topic: "emperors", seq: this.seq, serverTime: this.now(), data: { emperors: all.map((e) => this.view(e)) } });
      client.subscribed = true;
    });
  }

  /** Difunde el estado actual de un Emperador (leído de la base de datos al enviarlo). */
  publish(emperorId: string): Promise<void> {
    return this.enqueue(async () => {
      const e = await this.emperors.byId(emperorId);
      this.seq++;
      const msg: ServerMessage = {
        t: "delta",
        topic: "emperors",
        seq: this.seq,
        serverTime: this.now(),
        ops: [{ path: `emperors.${emperorId}`, v: e ? this.view(e) : null }],
      };
      for (const c of this.clients) if (c.subscribed) c.send(msg);
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

  /** Cierra todas las conexiones (al apagar el servidor). */
  closeAll(close: (c: Client) => void): void {
    for (const c of this.clients) close(c);
  }
}
