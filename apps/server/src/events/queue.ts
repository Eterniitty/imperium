import type { FastifyBaseLogger } from "fastify";
import { asc, eq, lte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { scheduledEvents } from "../db/schema";

/** Transacción de Drizzle: los manejadores escriben dentro de la del evento. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Tipos de evento y su carga útil. */
export interface EventPayloads {
  /** Una flota llega a su destino. */
  "fleet.arrive": { fleetId: string };
  /** El Emperador llega a un sistema tras un salto (para descubrir lo que cubre su escáner). */
  "emperor.arrive": { emperorId: string; systemId: string };
  /** Termina una construcción de una colonia (instalación o nave). */
  "colony.build": { buildId: string };
  /** Recálculo periódico de la cartera de créditos de un Emperador (economía de la humanidad). */
  "economy.settle": { emperorId: string };
  /** Llega un envío de la red del Núcleo (compra del mercado o aporte a un proyecto). */
  "shipment.arrive": { shipmentId: string };
  /** Comprobar si el tesoro ya puede pagar un proyecto común que tiene todos sus recursos. */
  "humanity.fund": { projectId: string };
  /** Siguiente ronda de una batalla de flotas (Fase 9a). */
  "battle.round": { battleId: string };
  /** Decisión de la IA alienígena en una región activa (Fase 11). */
  "ai.region": { regionKey: string };
  /** Una partida de asalto de los Carroñeros (incursión a una ruta) se marcha. */
  "ai.raidEnd": { fleetId: string };
  /** Decisión de un Emperador humano de la IA (Fase 11). */
  "ai.emperor": { emperorId: string };
  /** Resolución periódica de un asedio (Fase 9b). */
  "siege.tick": { siegeId: string };
  /** Fase 10: termina la gestación de un Emperador caído y renace. */
  "lineage.rebirth": { emperorId: string };
  /** Fase 10: nace un Heredero gestado en una Cuna. */
  "heir.born": { heirId: string };
  /** Fase 10: decisión del gobernador (Heredero) de una colonia. */
  "heir.govern": { heirId: string };
  /** Autogestión: la IA encarga instalaciones en las colonias de un jugador que la activó. */
  "colony.govern": { emperorId: string };
  /** Una sonda de exploración llega a su destino. */
  "probe.arrive": { probeId: string };
}
export type EventKind = keyof EventPayloads;

/**
 * Manejador de un tipo de evento. Escribe en la transacción del evento y puede
 * devolver una función que se ejecuta tras confirmarla (p. ej. avisar a los
 * jugadores): así nadie recibe un cambio que luego se deshace.
 */
export type EventHandler<K extends EventKind> = (tx: Tx, payload: EventPayloads[K]) => Promise<(() => void) | void>;

/** Programa un evento dentro de una transacción (así se crea o no junto con lo que lo causa). */
export async function schedule<K extends EventKind>(tx: Tx | Database, kind: K, dueAt: Date, payload: EventPayloads[K]): Promise<void> {
  await tx.insert(scheduledEvents).values({ kind, dueAt, payload });
}

const POLL_MS = 250;
const BATCH = 50;

/**
 * Trabajador de la cola. Toma los eventos vencidos de uno en uno, cada uno en
 * su transacción con `FOR UPDATE SKIP LOCKED` (varios trabajadores no se
 * pisan), lo procesa y lo borra. Un evento que falla se aplaza 30 s.
 */
export class EventWorker {
  private handlers = new Map<string, EventHandler<EventKind>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly db: Database,
    private readonly log: FastifyBaseLogger,
  ) {}

  on<K extends EventKind>(kind: K, handler: EventHandler<K>): void {
    this.handlers.set(kind, handler as EventHandler<EventKind>);
  }

  start(): void {
    this.stopped = false;
    this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  private tick = () => {
    this.running = this.drain()
      .then(() => undefined)
      .catch((err: unknown) => this.log.error(err, "Error en la cola de eventos"))
      .finally(() => {
        this.running = null;
        if (!this.stopped) this.timer = setTimeout(this.tick, POLL_MS);
      });
  };

  /** Procesa todos los eventos vencidos (hasta un lote). Devuelve cuántos procesó. */
  async drain(): Promise<number> {
    let done = 0;
    while (done < BATCH && !this.stopped) {
      const after = await this.db.transaction(async (tx) => {
        const [event] = await tx
          .select()
          .from(scheduledEvents)
          .where(lte(scheduledEvents.dueAt, sql`now()`))
          .orderBy(asc(scheduledEvents.dueAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!event) return null;
        try {
          const handler = this.handlers.get(event.kind);
          if (!handler) throw new Error(`Evento sin manejador: ${event.kind}`);
          // Punto de guardado: si el manejador falla, se deshace solo lo suyo.
          const notify = await tx.transaction((sp) => handler(sp, event.payload as EventPayloads[EventKind]));
          await tx.delete(scheduledEvents).where(eq(scheduledEvents.id, event.id));
          return { notify: notify ?? null };
        } catch (err) {
          // Se aplaza para que un evento defectuoso no bloquee a los demás.
          this.log.error({ err, eventId: event.id, kind: event.kind }, "Fallo al procesar un evento; se reintentará");
          await tx.update(scheduledEvents).set({ dueAt: sql`now() + interval '30 seconds'` }).where(eq(scheduledEvents.id, event.id));
          return { notify: null };
        }
      });
      if (!after) break;
      done++;
      after.notify?.();
    }
    return done;
  }
}
