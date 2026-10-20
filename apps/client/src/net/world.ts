import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  PROTOCOL_VERSION,
  WS_CLOSE,
  type CommandArgs,
  type CommandOp,
  type EmperorView,
  type Fleet,
  type I18nKey,
  type ServerMessage,
  type Topic,
  type WsTicketResponse,
} from "@imperium/shared";
import { api, authStore } from "../state/auth";

/**
 * Estado del mundo compartido que llega por el WebSocket:
 * - idle: sin conexión pedida (pantalla de inicio o modo sin servidor).
 * - connecting / open / closed: estado del WebSocket; si se cae, reconecta solo.
 */
export type WorldStatus = "idle" | "connecting" | "open" | "closed";

export interface WorldState {
  status: WorldStatus;
  /** Todos los Emperadores, por id. */
  emperors: Record<string, EmperorView>;
  /** Flotas propias, por id. */
  fleets: Record<string, Fleet>;
  /** Escala del tiempo de juego del servidor (para estimar duraciones de viaje). */
  timeScale: number;
  myEmperorId: string | null;
  /** Diferencia entre el reloj del servidor y el local, en milisegundos. */
  clockOffset: number;
}

export const worldStore = createStore<WorldState>()(() => ({
  status: "idle",
  emperors: {},
  fleets: {},
  timeScale: 1,
  myEmperorId: null,
  clockOffset: 0,
}));

export function useWorld<T>(selector: (s: WorldState) => T): T {
  return useStore(worldStore, selector);
}

/** Hora actual según el servidor: la que hay que usar con las horas de los viajes. */
export function serverNow(): number {
  return Date.now() + worldStore.getState().clockOffset;
}

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

type Pending = { resolve: (error: I18nKey | null) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Conexión con el servidor de juego. Una sola por pestaña. Pide un ticket por
 * HTTP, abre `/ws`, se suscribe a los Emperadores y aplica los cambios. Si la
 * conexión se cae, vuelve a conectar con esperas crecientes.
 */
class Connection {
  private ws: WebSocket | null = null;
  private wanted = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq: Record<Topic, number> = { emperors: -1, me: -1 };
  private pending = new Map<string, Pending>();

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    void this.open();
  }

  stop(): void {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close(1000, "bye");
    this.ws = null;
    this.failPending();
    worldStore.setState({ status: "idle", emperors: {}, fleets: {}, myEmperorId: null });
  }

  /** Envía una orden y espera su confirmación. Devuelve el error traducible, o null si se aceptó. */
  command<Op extends CommandOp>(op: Op, args: CommandArgs[Op]): Promise<I18nKey | null> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve("error.network");
    const cmdId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmdId);
        resolve("error.network");
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(cmdId, { resolve, timer });
      ws.send(JSON.stringify({ t: "cmd", cmdId, op, args }));
    });
  }

  private failPending(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve("error.network");
    }
    this.pending.clear();
  }

  private async open(): Promise<void> {
    worldStore.setState({ status: "connecting" });
    const res = await api<WsTicketResponse>("POST", "/api/ws/ticket");
    if (!this.wanted) return;
    if (!res.ok) {
      // Sin sesión no tiene sentido reintentar: hay que volver a identificarse.
      if (res.status === 401) return this.giveUp(true);
      return this.retry();
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws?v=${PROTOCOL_VERSION}&ticket=${encodeURIComponent(res.data.ticket)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify({ t: "sub", topic: "emperors" }));
      ws.send(JSON.stringify({ t: "sub", topic: "me" }));
    };
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.failPending();
      if (!this.wanted) return;
      if (e.code === WS_CLOSE.unauthorized) return this.giveUp(true);
      // Un error de protocolo no se arregla reintentando: falta recargar con un cliente nuevo.
      if (e.code === WS_CLOSE.protocol) return this.giveUp(false);
      this.retry();
    };
  }

  private retry(): void {
    worldStore.setState({ status: "closed" });
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.retryTimer = setTimeout(() => void this.open(), delay);
  }

  private giveUp(signedOut: boolean): void {
    this.wanted = false;
    worldStore.setState({ status: "closed" });
    if (signedOut) authStore.setState({ status: "anonymous", account: null, emperor: null, error: "error.unauthenticated" });
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case "hello":
        worldStore.setState({ myEmperorId: msg.emperorId, clockOffset: msg.serverTime - Date.now(), timeScale: msg.timeScale });
        return;
      case "snap": {
        this.lastSeq[msg.topic] = msg.seq;
        if (msg.topic === "emperors") {
          const emperors: Record<string, EmperorView> = {};
          for (const e of msg.data.emperors) emperors[e.id] = e;
          worldStore.setState({ status: "open", emperors });
          this.syncOwn();
        } else {
          const fleets: Record<string, Fleet> = {};
          for (const f of msg.data.fleets) fleets[f.id] = f;
          worldStore.setState({ fleets });
        }
        return;
      }
      case "delta": {
        if (msg.seq !== this.lastSeq[msg.topic] + 1) {
          // Se perdió algún cambio: se pide el estado completo de nuevo.
          this.ws?.send(JSON.stringify({ t: "sub", topic: msg.topic }));
          return;
        }
        this.lastSeq[msg.topic] = msg.seq;
        const state = worldStore.getState();
        const emperors = { ...state.emperors };
        const fleets = { ...state.fleets };
        for (const op of msg.ops) {
          const [kind, id] = op.path.split(".") as ["emperors" | "fleets", string];
          if (kind === "emperors") {
            if (op.v) emperors[id] = op.v as EmperorView;
            else delete emperors[id];
          } else {
            if (op.v) fleets[id] = op.v as Fleet;
            else delete fleets[id];
          }
        }
        worldStore.setState({ emperors, fleets });
        this.syncOwn();
        return;
      }
      case "ack": {
        const p = this.pending.get(msg.cmdId);
        if (!p) return;
        this.pending.delete(msg.cmdId);
        clearTimeout(p.timer);
        p.resolve(msg.ok ? null : `error.${msg.error}`);
        return;
      }
    }
  }

  /** El Emperador propio también vive en el estado de la sesión (pantalla de inicio, paneles). */
  private syncOwn(): void {
    const { myEmperorId, emperors } = worldStore.getState();
    const own = myEmperorId ? emperors[myEmperorId] : undefined;
    if (!own) return;
    const { online: _online, ...emperor } = own;
    authStore.setState({ emperor });
  }
}

export const connection = new Connection();
