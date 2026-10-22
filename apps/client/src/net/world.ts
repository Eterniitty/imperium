import { createStore } from "zustand/vanilla";
import { addHelpCall } from "../state/help";
import { useStore } from "zustand";
import {
  PROTOCOL_VERSION,
  WS_CLOSE,
  type ClientMessage,
  type CommandArgs,
  type CommandOp,
  type Battle,
  type Colony,
  type EmperorHumans,
  type EmperorView,
  type FlagshipStatus,
  type Fleet,
  type I18nKey,
  type LineageStatus,
  type ServerMessage,
  type Probe,
  type Siege,
  type Topic,
  type Wallet,
  type WsTicketResponse,
  type ContractsView,
  type RankView,
  type GoalsView,
  translate,
} from "@imperium/shared";
import { rankOf } from "@imperium/content";
import { api, authStore } from "../state/auth";
import { gameStore } from "../state/store";
import { factionName } from "../ui/aliens";
import { addSample, fleetShipId, resetSpace, spaceStore, type RemoteShip } from "./space";

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
  /** Sistemas descubiertos por el Emperador propio (niebla de guerra): solo de ellos hay detalle. */
  discovered: Record<string, true>;
  /** Colonias propias, por id (Fase 7). */
  colonies: Record<string, Colony>;
  /** Humanos de la nave del Emperador propio. */
  humans: EmperorHumans | null;
  /** Batallas propias (en curso y acabadas hace poco), por id (Fase 9a). */
  battles: Record<string, Battle>;
  /** Cartera de créditos propia (economía de la humanidad). */
  wallet: Wallet | null;
  /** Nave del Emperador propio: dónde está aparcada (y sus recursos). */
  flagship: FlagshipStatus | null;
  /** Asedios propios y a colonias propias (en curso y acabados hace poco), por id (Fase 9b). */
  sieges: Record<string, Siege>;
  /** Sondas de exploración propias en vuelo, por id. */
  probes: Record<string, Probe>;
  /** Tablero de contratos (ofertas, en curso e historial), o null si aún no llegó. */
  contracts: ContractsView | null;
  /** Rango del Emperador: su experiencia (el rango sale de `RANKS`). */
  rank: RankView | null;
  /** Objetivos del día y de la semana. */
  goals: GoalsView | null;
  /** Linaje propio (Fase 10): muerte y gestación, Cunas, Herederos. */
  lineage: LineageStatus | null;
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
  discovered: {},
  colonies: {},
  humans: null,
  battles: {},
  wallet: null,
  flagship: null,
  sieges: {},
  probes: {},
  contracts: null,
  rank: null,
  goals: null,
  lineage: null,
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
    worldStore.setState({ status: "idle", emperors: {}, fleets: {}, discovered: {}, colonies: {}, humans: null, battles: {}, wallet: null, flagship: null, sieges: {}, probes: {}, contracts: null, rank: null, goals: null, lineage: null, myEmperorId: null });
    resetSpace();
  }

  /** Envía un mensaje sin esperar respuesta (posiciones al pilotar). Sin conexión, se descarta. */
  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
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
          const discovered: Record<string, true> = {};
          for (const id of msg.data.discovered) discovered[id] = true;
          const colonies: Record<string, Colony> = {};
          for (const c of msg.data.colonies) colonies[c.id] = c;
          const battles: Record<string, Battle> = {};
          for (const b of msg.data.battles) battles[b.id] = b;
          const sieges: Record<string, Siege> = {};
          for (const x of msg.data.sieges) sieges[x.id] = x;
          const probes: Record<string, Probe> = {};
          for (const p of msg.data.probes ?? []) probes[p.id] = p;
          worldStore.setState({ fleets, discovered, colonies, humans: msg.data.humans, battles, wallet: msg.data.wallet, flagship: msg.data.flagship, sieges, lineage: msg.data.lineage, probes, contracts: msg.data.contracts ?? null, rank: msg.data.rank ?? null, goals: msg.data.goals ?? null });
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
        let discovered = state.discovered;
        let colonies = state.colonies;
        let humans = state.humans;
        let battles = state.battles;
        let wallet = state.wallet;
        let flagship = state.flagship;
        let sieges = state.sieges;
        let lineage = state.lineage;
        let probes = state.probes;
        let contracts = state.contracts;
        let rank = state.rank;
        let goals = state.goals;
        for (const op of msg.ops) {
          if (op.path === "goals") {
            noticeGoals(goals, op.v as GoalsView);
            goals = op.v as GoalsView;
            continue;
          }
          if (op.path === "rank") {
            noticeRank(rank, op.v as RankView);
            rank = op.v as RankView;
            continue;
          }
          const dot = op.path.indexOf(".");
          const kind = op.path.slice(0, dot) as "emperors" | "fleets" | "discovered" | "colonies" | "humans" | "battles" | "wallet" | "flagship" | "sieges" | "lineage" | "probes" | "contracts";
          const id = op.path.slice(dot + 1);
          if (kind === "contracts") {
            noticeContracts(contracts, op.v as ContractsView);
            contracts = op.v as ContractsView;
          } else if (kind === "probes") {
            probes = { ...probes };
            if (op.v) probes[id] = op.v as Probe;
            else delete probes[id];
          } else if (kind === "lineage") {
            noticeLineage(lineage, op.v as LineageStatus);
            lineage = op.v as LineageStatus;
          } else if (kind === "sieges") {
            sieges = { ...sieges };
            if (op.v) {
              noticeSiege(sieges[id], op.v as Siege);
              sieges[id] = op.v as Siege;
            } else delete sieges[id];
          } else if (kind === "colonies") {
            colonies = { ...colonies };
            if (op.v) colonies[id] = op.v as Colony;
            else delete colonies[id];
          } else if (kind === "battles") {
            battles = { ...battles };
            if (op.v) battles[id] = op.v as Battle;
            else delete battles[id];
          } else if (kind === "wallet") {
            wallet = op.v as Wallet;
          } else if (kind === "humans") {
            humans = op.v as EmperorHumans;
          } else if (kind === "flagship") {
            flagship = op.v as FlagshipStatus;
          } else if (kind === "discovered") {
            discovered = { ...discovered, [id]: true };
          } else if (kind === "emperors") {
            if (op.v) emperors[id] = op.v as EmperorView;
            else delete emperors[id];
          } else {
            if (op.v) fleets[id] = op.v as Fleet;
            else delete fleets[id];
          }
        }
        worldStore.setState({ emperors, fleets, discovered, colonies, humans, battles, wallet, flagship, sieges, lineage, probes, contracts, rank, goals });
        this.syncOwn();
        return;
      }
      case "space": {
        const ships: Record<string, RemoteShip> = {};
        for (const s of msg.ships) ships[s.id] = { state: s, samples: [{ t: msg.serverTime, p: s.p, q: s.q, v: s.v }] };
        spaceStore.setState({ systemId: msg.systemId, ships });
        return;
      }
      case "ship": {
        const remote = spaceStore.getState().remote;
        const selfId = remote ? fleetShipId(remote.shipId) : worldStore.getState().myEmperorId;
        if (msg.ship.id === selfId) return spaceStore.setState({ self: msg.ship });
        const ships = { ...spaceStore.getState().ships };
        const prev = ships[msg.ship.id];
        const ship: RemoteShip = { state: msg.ship, samples: prev?.samples ?? [] };
        if (!prev) addSample(ship, { t: msg.ship.p ? Date.now() + worldStore.getState().clockOffset : 0, p: msg.ship.p, q: msg.ship.q, v: msg.ship.v });
        ships[msg.ship.id] = ship;
        spaceStore.setState({ ships });
        return;
      }
      case "poses": {
        const ships = spaceStore.getState().ships;
        for (const s of msg.ships) {
          const ship = ships[s.id];
          if (ship) addSample(ship, { t: msg.serverTime, p: s.p, q: s.q, v: s.v });
        }
        return;
      }
      case "shipGone": {
        const state = spaceStore.getState();
        const ships = { ...state.ships };
        const gone = ships[msg.id];
        delete ships[msg.id];
        const last = gone?.samples.at(-1);
        const beams = { ...state.beams };
        delete beams[msg.id];
        spaceStore.setState({
          ships,
          beams,
          targetId: state.targetId === msg.id ? null : state.targetId,
          explosions: msg.reason === "destroyed" && last ? [...state.explosions, last.p] : state.explosions,
          // Saltó: se la ve entrar en su grieta (desde donde se dibujaba).
          rifts: msg.reason === "jump" && last ? [...state.rifts, { id: msg.id, phase: "jump", at: last.p, q: last.q }] : state.rifts,
        });
        return;
      }
      case "rift":
        spaceStore.setState({ rifts: [...spaceStore.getState().rifts, { id: msg.id, phase: msg.phase, at: msg.at, q: msg.q }] });
        return;
      case "shot":
        spaceStore.setState({ shots: [...spaceStore.getState().shots, msg] });
        return;
      case "supplies": {
        const { t: _t, ...supplies } = msg;
        spaceStore.setState({ supplies });
        return;
      }
      case "weapons":
        spaceStore.setState({ weapons: msg.weapons });
        return;
      case "destroyed":
        spaceStore.setState({ destroyed: { by: msg.by, systemId: msg.systemId, rebornAt: msg.rebornAt, at: Date.now() } });
        return;
      case "remoteEnded":
        spaceStore.setState({ remoteEnded: msg.reason });
        return;
      case "undocked":
        spaceStore.setState({ undocked: true });
        return;
      case "helpCall":
        addHelpCall({ from: msg.from, name: msg.name, systemId: msg.systemId });
        return;
      case "docked": {
        const fleet = worldStore.getState().fleets[msg.fleetId];
        spaceStore.setState({ docked: { fleetId: msg.fleetId, number: fleet?.number ?? 0 }, undocked: false });
        return;
      }
      // Espacio profundo y minería.
      case "field":
        spaceStore.setState({ field: msg.region });
        return;
      case "challenge": {
        if (!spaceStore.getState().challenge) gameStore.getState().notify("challenge.started");
        else if (spaceStore.getState().challenge!.wave < msg.wave) gameStore.getState().notify("challenge.wave", { n: msg.wave });
        spaceStore.setState({ challenge: { until: msg.until, kills: msg.kills, wave: msg.wave } });
        return;
      }
      case "challengeEnd": {
        spaceStore.setState({ challenge: null });
        gameStore.getState().notify(msg.record ? "challenge.record" : "challenge.end", { kills: msg.kills, best: msg.best, xp: msg.reward.xp, credits: msg.reward.credits });
        return;
      }
      case "spaceEvent": {
        const prev = spaceStore.getState().event;
        spaceStore.setState({ event: { id: msg.id, kind: msg.kind, at: msg.at, expiresAt: msg.expiresAt, decide: msg.decide } });
        if (!prev || prev.id !== msg.id) gameStore.getState().notify(msg.kind === "distress" ? "event.notice.distress" : "event.notice.salvage");
        return;
      }
      case "spaceEventEnd": {
        if (spaceStore.getState().event?.id === msg.id) spaceStore.setState({ event: null });
        const notify = gameStore.getState().notify;
        if (msg.outcome === "done") notify(msg.reward?.credits ? "event.done.distress" : "event.done.salvage", { xp: msg.reward?.xp ?? 0, credits: msg.reward?.credits ?? 0 });
        else if (msg.outcome === "trap") notify("event.trap");
        else if (msg.outcome === "expired") notify("event.expired");
        return;
      }
      case "asteroid": {
        const field = spaceStore.getState().field;
        if (!field || msg.i >= field.left.length) return;
        const left = field.left.slice();
        left[msg.i] = msg.left;
        spaceStore.setState({ field: { ...field, left } });
        return;
      }
      case "beam": {
        const beams = { ...spaceStore.getState().beams };
        if (msg.asteroid === null) delete beams[msg.id];
        else beams[msg.id] = msg.asteroid;
        spaceStore.setState({ beams });
        return;
      }
      case "hold":
        spaceStore.setState({ hold: { hold: msg.hold, capacity: msg.capacity, refining: msg.refining } });
        return;
      case "mineFail":
        spaceStore.setState({ mineFail: { reason: msg.reason, at: Date.now() } });
        return;
      case "poseRejected":
        spaceStore.setState({ correction: { p: msg.p, q: msg.q, v: msg.v } });
        return;
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

/**
 * Avisos de los asedios (Fase 9b): al defensor, cuando empieza uno contra su
 * colonia y cuando la pierde; al atacante, cuando puede desembarcar y cuando
 * toma el planeta o se rompe el asedio.
 */
/** Aviso al cumplirse un contrato (llega con su recompensa ya pagada). */
/** Objetivos recién cumplidos: aviso con su recompensa. */
function noticeGoals(prev: GoalsView | null, next: GoalsView): void {
  if (!prev) return;
  const before = new Map([...prev.daily, ...(prev.weekly ? [prev.weekly] : [])].map((g) => [g.id, g.done]));
  for (const g of [...next.daily, ...(next.weekly ? [next.weekly] : [])]) {
    if (g.done && before.get(g.id) === false) gameStore.getState().notify("goal.done", { xp: g.xp, credits: g.credits });
  }
}

/** Al subir de rango: aviso con el título nuevo. */
function noticeRank(prev: RankView | null, next: RankView): void {
  if (!prev) return;
  const after = rankOf(next.xp);
  if (after.index <= rankOf(prev.xp).index) return;
  const st = gameStore.getState();
  st.notify("rank.up", { title: translate(st.locale, `rank.title.${after.rank.id}` as I18nKey) });
}

function noticeContracts(prev: ContractsView | null, next: ContractsView): void {
  if (!prev) return;
  const before = new Map(prev.list.map((c) => [c.id, c.status]));
  for (const c of next.list) {
    if (c.status === "done" && before.get(c.id) === "active") gameStore.getState().notify("contract.done", { credits: c.credits, rep: c.reputation });
  }
}

function noticeSiege(prev: Siege | undefined, next: Siege): void {
  const planet = next.colonyName ?? next.planetName;
  const enemy = next.attackerFactionId ? factionName(gameStore.getState().locale, next.attackerFactionId) : next.attackerName;
  const notify = gameStore.getState().notify;
  if (next.role === "defender") {
    if (!prev && next.outcome === "ongoing") notify("siege.notice.attacked", { planet, enemy });
    else if (prev?.outcome === "ongoing" && next.outcome === "captured") notify("siege.notice.lost", { planet, enemy });
    else if (prev?.outcome === "ongoing" && (next.outcome === "broken" || next.outcome === "lifted")) notify("siege.notice.relieved", { planet });
  } else {
    if (prev && prev.state !== "ready" && next.state === "ready" && next.outcome === "ongoing") notify("siege.notice.ready", { planet });
    else if (prev?.outcome === "ongoing" && next.outcome === "captured") notify("siege.notice.captured", { planet });
    else if (prev?.outcome === "ongoing" && next.outcome === "broken") notify("siege.notice.broken", { planet });
  }
}

/**
 * Avisos del linaje (Fase 10): renacer (en una Cuna, en el Núcleo o en un
 * Heredero) y el nacimiento de un Heredero.
 */
function noticeLineage(prev: LineageStatus | null, next: LineageStatus): void {
  if (!prev) return;
  const notify = gameStore.getState().notify;
  if (prev.dead && !next.dead) {
    const last = next.deaths[0];
    const kind = last?.rebirthKind ?? "core";
    notify(kind === "heir" ? "lineage.notice.incarnated" : kind === "cradle" ? "lineage.notice.rebornCradle" : "lineage.notice.rebornCore", { generation: next.generation });
  } else if (!prev.dead && !next.dead && next.generation > prev.generation) {
    notify("lineage.notice.incarnated", { generation: next.generation });
  }
  for (const h of next.heirs) {
    const before = prev.heirs.find((x) => x.id === h.id);
    if (before?.state === "gestating" && h.state === "active") notify("lineage.notice.heirBorn", { name: h.name, colony: h.colonyName });
  }
}
