import { EMPEROR_FLAGSHIP } from "@imperium/content";
import { universeSeedFromString } from "@imperium/procgen";
import type { ShipPose, ShipState } from "@imperium/shared";
import { isTravelling, plausibleMove, systemLayout } from "@imperium/sim";
import type { FastifyBaseLogger } from "fastify";
import type { ServerConfig } from "../config";
import type { EmperorService } from "../emperor/service";
import { systemDetailFor } from "../emperor/world";
import type { Client } from "../realtime/hub";
import type { SocialService } from "../social/service";

/** Una nave presente en un sistema. */
interface Member {
  emperorId: string;
  name: string;
  systemId: string;
  /** Conexiones que pilotan esta nave (normalmente una; varias pestañas a la vez). */
  clients: Set<Client>;
  pose: ShipPose;
  poseAt: number;
  /** Cambió de posición desde la última difusión. */
  dirty: boolean;
  /** Compañeros (aliados mutuos), para marcar `ally` y, más adelante, evitar el fuego amigo. */
  allies: Set<string>;
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
}

const TICK_MS = 100;
/** Margen fuera del borde antes de rechazar una posición (salir del sistema es legal, pero se avisa con `leave`). */
const BOUNDARY_SLACK = 30;

/**
 * Espacio local: quién vuela en cada sistema, sus posiciones y su estado. Vive
 * en memoria (un solo proceso). Valida cada posición (no ir más rápido que la
 * nave, no salir del sistema) y difunde a los presentes unas 10 veces por segundo.
 */
export class SpaceService {
  private readonly members = new Map<string, Member>();
  private readonly rooms = new Map<string, Set<Member>>();
  private readonly boundaries = new Map<string, number>();
  private readonly seed: number;
  private readonly timer: ReturnType<typeof setInterval>;
  /** Uniones en curso, para no validar dos veces a la vez la misma nave. */
  private readonly joining = new Map<string, Promise<Member | null>>();

  constructor(
    config: Pick<ServerConfig, "UNIVERSE_SEED">,
    private readonly emperors: EmperorService,
    private readonly social: SocialService,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = universeSeedFromString(config.UNIVERSE_SEED);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private boundary(systemId: string): number {
    let b = this.boundaries.get(systemId);
    if (b === undefined) {
      const detail = systemDetailFor(this.seed, systemId);
      b = detail ? systemLayout(detail).boundary : 0;
      this.boundaries.set(systemId, b);
    }
    return b;
  }

  private stateFor(m: Member, viewer: Member | null): ShipState {
    return {
      id: m.emperorId,
      name: m.name,
      ally: viewer !== null && viewer.allies.has(m.emperorId),
      ...m.pose,
      hull: m.hull,
      hullMax: m.hullMax,
      shield: m.shield,
      shieldMax: m.shieldMax,
    };
  }

  private sendTo(m: Member, msg: Parameters<Client["send"]>[0]): void {
    for (const c of m.clients) c.send(msg);
  }

  /** Posición recibida de un cliente que pilota en `systemId`. */
  async pose(client: Client, systemId: string, pose: ShipPose): Promise<void> {
    let m: Member | null | undefined = this.members.get(client.emperorId);
    if (!m || m.systemId !== systemId) {
      m = await this.join(client, systemId, pose);
      if (!m) return;
    }
    m.clients.add(client);
    const t = this.now();
    const outside = Math.hypot(...pose.p) > this.boundary(systemId) + BOUNDARY_SLACK;
    if (outside || !plausibleMove(m.pose.p, pose.p, (t - m.poseAt) / 1000)) {
      // Posición imposible: se ignora y la nave vuelve a la última válida.
      client.send({ t: "poseRejected", ...m.pose });
      return;
    }
    m.pose = pose;
    m.poseAt = t;
    m.dirty = true;
  }

  /**
   * Comprueba que el Emperador está de verdad en ese sistema (no viajando) y lo
   * añade. La primera posición tiene que estar dentro del sistema.
   */
  private join(client: Client, systemId: string, pose: ShipPose): Promise<Member | null> {
    const key = `${client.emperorId}:${systemId}`;
    let pending = this.joining.get(key);
    if (!pending) {
      pending = this.doJoin(client, systemId, pose).finally(() => this.joining.delete(key));
      this.joining.set(key, pending);
    }
    return pending;
  }

  private async doJoin(client: Client, systemId: string, pose: ShipPose): Promise<Member | null> {
    const emperor = await this.emperors.byId(client.emperorId);
    if (!emperor || isTravelling(emperor, this.now()) || emperor.location.systemId !== systemId) return null;
    if (Math.hypot(...pose.p) > this.boundary(systemId) + BOUNDARY_SLACK) return null;
    const allies = await this.social.mutualAllies(emperor.id);

    // Si estaba en otro sistema, sale de él.
    this.leave(emperor.id, "left");
    const m: Member = {
      emperorId: emperor.id,
      name: emperor.name,
      systemId,
      clients: new Set([client]),
      pose,
      poseAt: this.now(),
      dirty: false,
      allies,
      hull: EMPEROR_FLAGSHIP.hull,
      hullMax: EMPEROR_FLAGSHIP.hull,
      shield: EMPEROR_FLAGSHIP.shield,
      shieldMax: EMPEROR_FLAGSHIP.shield,
    };
    let room = this.rooms.get(systemId);
    if (!room) this.rooms.set(systemId, (room = new Set()));

    client.send({ t: "space", systemId, serverTime: this.now(), ships: [...room].map((o) => this.stateFor(o, m)) });
    for (const o of room) this.sendTo(o, { t: "ship", ship: this.stateFor(m, o) });
    room.add(m);
    this.members.set(emperor.id, m);
    this.log.debug({ emperorId: emperor.id, systemId }, "Nave entra en el sistema");
    return m;
  }

  /** La nave deja su sistema (vuelve al mapa, salta, se desconecta…). */
  leave(emperorId: string, reason: "left" | "destroyed"): void {
    const m = this.members.get(emperorId);
    if (!m) return;
    this.members.delete(emperorId);
    const room = this.rooms.get(m.systemId);
    room?.delete(m);
    if (room && room.size === 0) this.rooms.delete(m.systemId);
    for (const o of room ?? []) this.sendTo(o, { t: "shipGone", id: emperorId, reason });
  }

  /** Una conexión se cierra o deja de pilotar: si era la última de su nave, la nave sale. */
  leaveClient(client: Client): void {
    const m = this.members.get(client.emperorId);
    if (!m || !m.clients.delete(client)) return;
    if (m.clients.size === 0) this.leave(m.emperorId, "left");
  }

  /** Naves presentes en un sistema (para tests y diagnóstico). */
  shipsIn(systemId: string): string[] {
    return [...(this.rooms.get(systemId) ?? [])].map((m) => m.emperorId);
  }

  private tick(): void {
    const serverTime = this.now();
    for (const room of this.rooms.values()) {
      const changed = [...room].filter((m) => m.dirty);
      if (changed.length === 0) continue;
      for (const m of changed) m.dirty = false;
      const ships = changed.map((m) => ({ id: m.emperorId, ...m.pose }));
      for (const m of room) this.sendTo(m, { t: "poses", serverTime, ships: ships.filter((s) => s.id !== m.emperorId) });
    }
  }
}
