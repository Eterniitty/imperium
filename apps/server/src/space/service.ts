import { EMPEROR_FLAGSHIP, PIRATE_RAIDER } from "@imperium/content";
import type { ServerMessage, ShipPose, ShipState, Vec3, WeaponKind } from "@imperium/shared";
import { bodiesAt, isTravelling, parkedPosition, parkedVelocity, PILOT_BOOST, PILOT_SPEED, plausibleMove, pulseLimitAt, type ParkedOrbit, type SystemLayout } from "@imperium/sim";
import type { FastifyBaseLogger } from "fastify";
import type { EmperorService } from "../emperor/service";
import type { Client } from "../realtime/hub";
import type { SocialService } from "../social/service";
import type { FlagshipService } from "./flagship";
import { Combatant, distance, forwardOf, MISSILE_LOCK_COS, normalize, rayHit, rotate } from "./combat";
import { pirateCount, pirateHome, stepPirate } from "./pirates";

/** Una nave presente en un sistema: de un Emperador o un pirata de la IA. */
interface Member {
  /** Id del Emperador, o "pirate:<sistema>:<n>" para los piratas. */
  emperorId: string;
  kind: "emperor" | "pirate";
  /** Solo piratas: dónde viven y un valor fijo para variar su forma de rodear. */
  ai?: { home: Vec3; phase: number };
  name: string;
  systemId: string;
  /** Conexiones que pilotan esta nave (normalmente una; varias pestañas a la vez). */
  clients: Set<Client>;
  pose: ShipPose;
  poseAt: number;
  /** Posiciones recientes, para dar por buenos los impactos contra donde el tirador veía al objetivo. */
  history: Array<{ t: number; p: Vec3 }>;
  /** Cambió de posición desde la última difusión. */
  dirty: boolean;
  /** Compañeros (aliados mutuos): se marcan como `ally` y no se les puede dañar. */
  allies: Set<string>;
  combat: Combatant;
  /** Escudo enviado por última vez a los demás (para difundir la recarga solo si cambia). */
  sentShield: number;
  /**
   * Solo naves de Emperadores: si nadie la pilota, está aparcada y orbita la
   * estrella desde esta posición y hora (la ven todos los presentes y se le
   * puede disparar). Null mientras alguien la pilota.
   */
  park: ParkedOrbit | null;
}

const TICK_MS = 100;
/** Cada cuánto se difunde el escudo que se recarga (no hace falta a 10 Hz). */
const SHIELD_BROADCAST_MS = 500;
/** Margen fuera del borde antes de rechazar una posición (salir del sistema es legal, pero se avisa con `leave`). */
const BOUNDARY_SLACK = 50_000;
/** Hasta cuánto atrás se buscan posiciones del objetivo para los impactos (latencia del tirador). */
const LAG_COMPENSATION_MS = 300;
const HISTORY_SIZE = 12;
/** Distancia máxima entre la nave aparcada y la primera posición al tomar los mandos. */
const BOARD_TOLERANCE = 5_000;
/** Cada cuánto se envía la posición de una nave aparcada (se mueve muy despacio). */
const PARKED_POSE_MS = 1_000;
/** Cada cuánto se repasa qué Emperadores están aparcados en cada sistema activo (llegadas, salidas). */
const PARKED_REFRESH_MS = 5_000;

/**
 * Espacio local: quién vuela en cada sistema, sus posiciones y el combate. Vive
 * en memoria (un solo proceso). Valida cada posición (no ir más rápido que la
 * nave, no salir del sistema) y cada disparo (cadencia, munición, alcance), y
 * difunde a los presentes unas 10 veces por segundo.
 */
export class SpaceService {
  private readonly members = new Map<string, Member>();
  private readonly rooms = new Map<string, Set<Member>>();
  /** Estado de combate por Emperador; dura aunque salga del sistema. */
  private readonly combatants = new Map<string, Combatant>();
  /** Sistemas cuyo aparcamiento se está repasando (para no solapar consultas) y cuándo se repasó cada uno. */
  private readonly refreshing = new Set<string>();
  private readonly refreshedAt = new Map<string, number>();
  /** Se llama cuando cambia la nave de un Emperador para su dueño (aparcada en otro sitio); la pone `buildApp`. */
  onFlagship: (emperorId: string) => void = () => {};
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();
  private lastShieldBroadcast = 0;
  /** Piratas destruidos y hasta cuándo no reaparecen. */
  private readonly deadPirates = new Map<string, number>();
  /** Uniones en curso, para no validar dos veces a la vez la misma nave. */
  private readonly joining = new Map<string, Promise<Member | null>>();

  constructor(
    private readonly flagships: FlagshipService,
    private readonly emperors: EmperorService,
    private readonly social: SocialService,
    private readonly log: FastifyBaseLogger,
    /** Se llama cuando un Emperador renace en otro sistema (para difundirlo). */
    private readonly onRespawn: (emperorId: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts.clear();
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timeouts.delete(t);
      fn();
    }, ms);
    this.timeouts.add(t);
  }

  /** Disposición del sistema (depende de su detalle secreto; la guarda FlagshipService). */
  private layout(systemId: string): SystemLayout | null {
    return this.flagships.layout(systemId);
  }

  private boundary(systemId: string): number {
    return this.layout(systemId)?.boundary ?? 0;
  }

  /**
   * Velocidad más alta posible entre dos puntos: la del pulso alejándose del
   * cuerpo más cercano (el caso más permisivo) en el mejor de los dos extremos,
   * y nunca menos que la de maniobra con impulso.
   */
  private maxSpeedAt(systemId: string, a: Vec3, b: Vec3, now: number): number {
    const layout = this.layout(systemId);
    if (!layout) return PILOT_SPEED * PILOT_BOOST;
    const bodies = bodiesAt(layout, now);
    return Math.max(PILOT_SPEED * PILOT_BOOST, pulseLimitAt(a, null, bodies), pulseLimitAt(b, null, bodies));
  }

  private combatantOf(emperorId: string): Combatant {
    let c = this.combatants.get(emperorId);
    if (!c) this.combatants.set(emperorId, (c = new Combatant(EMPEROR_FLAGSHIP.hull, EMPEROR_FLAGSHIP.combat, this.now())));
    return c;
  }

  private stateFor(m: Member, viewer: Member | null): ShipState {
    return {
      id: m.emperorId,
      kind: m.kind,
      name: m.name,
      ally: viewer !== null && viewer !== m && viewer.allies.has(m.emperorId),
      ...m.pose,
      hull: Math.round(m.combat.hull),
      hullMax: m.combat.hullMax,
      shield: Math.round(m.combat.shield),
      shieldMax: m.combat.shieldMax,
    };
  }

  private sendTo(m: Member, msg: ServerMessage): void {
    for (const c of m.clients) c.send(msg);
  }

  /** Estado de una nave a todos los del sistema (cada uno con su marca de compañero), ella incluida. */
  private broadcastState(m: Member): void {
    m.sentShield = Math.round(m.combat.shield);
    for (const o of this.rooms.get(m.systemId) ?? []) this.sendTo(o, { t: "ship", ship: this.stateFor(m, o) });
  }

  private sendWeapons(m: Member): void {
    this.sendTo(m, { t: "weapons", weapons: m.combat.weaponsView(this.now()) });
  }

  /** Posición recibida de un cliente que pilota en `systemId`. */
  async pose(client: Client, systemId: string, pose: ShipPose): Promise<void> {
    let m: Member | null | undefined = this.members.get(client.emperorId);
    if (!m || m.systemId !== systemId) {
      m = await this.join(client, systemId, pose);
      if (!m) return;
    }
    if (m.park) {
      // Al tomar los mandos se cargan sus compañeros (una nave aparcada no los necesitaba).
      m.allies = await this.social.mutualAllies(m.emperorId);
      if (m.park) this.board(m, client, pose);
      return;
    }
    m.clients.add(client);
    const t = this.now();
    const outside = Math.hypot(...pose.p) > this.boundary(systemId) + BOUNDARY_SLACK;
    if (outside || !plausibleMove(m.pose.p, pose.p, (t - m.poseAt) / 1000, this.maxSpeedAt(systemId, m.pose.p, pose.p, t))) {
      // Posición imposible: se ignora y la nave vuelve a la última válida.
      client.send({ t: "poseRejected", ...m.pose });
      return;
    }
    m.pose = pose;
    m.poseAt = t;
    m.history.push({ t, p: pose.p });
    if (m.history.length > HISTORY_SIZE) m.history.shift();
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
    const [allies, status] = await Promise.all([this.social.mutualAllies(emperor.id), this.flagships.status(emperor.id)]);
    if (!status || status.systemId !== systemId) return null;
    // Mientras se consultaba, pudo entrar ya (otra pestaña, o el repaso de aparcadas).
    const already = this.members.get(emperor.id);
    if (already?.systemId === systemId) {
      already.allies = allies;
      return already;
    }

    // Si estaba en otro sistema, sale de él.
    this.leave(emperor.id, "left");
    const room = await this.ensureRoom(systemId);
    // Mientras se repasaban las aparcadas, pudo entrar (las incluye a todas las del sistema).
    const parked = this.members.get(emperor.id);
    if (parked?.systemId === systemId) {
      parked.allies = allies;
      return parked;
    }
    // Entra aparcada donde la dejó; `board` le da los mandos si la posición cuadra.
    const m = this.addParked(systemId, room, emperor.id, emperor.name, status.park);
    m.allies = allies;
    this.log.debug({ emperorId: emperor.id, systemId }, "Nave entra en el sistema");
    return m;
  }

  /** Sala de un sistema: la crea con sus piratas y las naves aparcadas allí si no estaba activa. */
  private async ensureRoom(systemId: string): Promise<Set<Member>> {
    let room = this.rooms.get(systemId);
    if (!room) {
      this.rooms.set(systemId, (room = new Set()));
      this.spawnPirates(systemId, room);
      await this.refreshParked(systemId);
    }
    return this.rooms.get(systemId) ?? room;
  }

  /** Añade a la sala una nave de Emperador aparcada (sin piloto) y avisa a los presentes. */
  private addParked(systemId: string, room: Set<Member>, emperorId: string, name: string, park: ParkedOrbit): Member {
    const now = this.now();
    const p = parkedPosition(park, now);
    const m: Member = {
      emperorId,
      kind: "emperor",
      name,
      systemId,
      clients: new Set(),
      pose: { p, q: [0, 0, 0, 1], v: parkedVelocity(park, now) },
      poseAt: now,
      history: [{ t: now, p }],
      dirty: false,
      allies: new Set(),
      combat: this.combatantOf(emperorId),
      sentShield: -1,
      park,
    };
    for (const o of room) this.sendTo(o, { t: "ship", ship: this.stateFor(m, o) });
    room.add(m);
    this.members.set(emperorId, m);
    return m;
  }

  /**
   * Toma los mandos de una nave aparcada: la primera posición tiene que estar
   * junto a donde orbita ahora (si no, se le indica dónde está). El piloto recibe
   * las demás naves del sistema, su casco, escudo y armas.
   */
  private board(m: Member, client: Client, pose: ShipPose): void {
    const now = this.now();
    const at = parkedPosition(m.park!, now);
    if (distance(at, pose.p) > BOARD_TOLERANCE) {
      client.send({ t: "poseRejected", p: at, q: pose.q, v: [0, 0, 0] });
      return;
    }
    m.park = null;
    m.clients.add(client);
    m.pose = pose;
    m.poseAt = now;
    m.history = [{ t: now, p: pose.p }];
    m.dirty = true;
    const room = this.rooms.get(m.systemId) ?? new Set<Member>();
    client.send({ t: "space", systemId: m.systemId, serverTime: now, ships: [...room].filter((o) => o !== m).map((o) => this.stateFor(o, m)) });
    client.send({ t: "ship", ship: this.stateFor(m, m) });
    this.sendWeapons(m);
  }

  /**
   * Repasa qué Emperadores están en un sistema activo: añade los que han llegado
   * (aparcados) y quita los aparcados que ya no están (saltaron, renacieron).
   */
  private async refreshParked(systemId: string): Promise<void> {
    if (this.refreshing.has(systemId)) return;
    this.refreshing.add(systemId);
    this.refreshedAt.set(systemId, this.now());
    try {
      const present = await this.flagships.parkedIn(systemId);
      const room = this.rooms.get(systemId);
      if (!room) return;
      const ids = new Set(present.map((p) => p.emperorId));
      for (const o of [...room]) if (o.kind === "emperor" && o.park && !ids.has(o.emperorId)) this.leave(o.emperorId, "left");
      for (const p of present) {
        if (!this.members.has(p.emperorId) && this.rooms.get(systemId) === room) this.addParked(systemId, room, p.emperorId, p.name, p.park);
      }
    } catch (err) {
      this.log.error(err, "Error al repasar las naves aparcadas");
    } finally {
      this.refreshing.delete(systemId);
    }
  }

  /**
   * La nave se queda sin piloto: aparca donde está (con lo que se haya movido
   * desde la última posición) y empieza a orbitar. Se guarda para que siga ahí
   * tras reiniciar el servidor, y se avisa a su dueño.
   */
  private park(m: Member): void {
    const now = this.now();
    const ahead = Math.min(0.5, Math.max(0, (now - m.poseAt) / 1000));
    const p: Vec3 = [m.pose.p[0] + m.pose.v[0] * ahead, m.pose.p[1] + m.pose.v[1] * ahead, m.pose.p[2] + m.pose.v[2] * ahead];
    m.park = { p, at: now };
    m.pose = { p, q: m.pose.q, v: parkedVelocity(m.park, now) };
    m.poseAt = now;
    m.dirty = true;
    const id = m.emperorId;
    void this.flagships
      .savePark(id, m.park)
      .then(() => this.onFlagship(id))
      .catch((err: unknown) => this.log.error(err, "Error al guardar la nave aparcada"));
  }

  /** Guarda dónde están las naves pilotadas, como si se aparcasen (al apagar el servidor). */
  async flushParks(): Promise<void> {
    const now = this.now();
    await Promise.all(
      [...this.members.values()]
        .filter((m) => m.kind === "emperor" && !m.park)
        .map((m) => this.flagships.savePark(m.emperorId, { p: m.pose.p, at: now }).catch((err: unknown) => this.log.error(err, "Error al guardar la nave aparcada"))),
    );
  }

  /** Sin pilotos, el sistema se "duerme": se dejan de simular piratas y naves aparcadas. */
  private sleepIfEmpty(systemId: string): void {
    const room = this.rooms.get(systemId);
    if (!room || [...room].some((o) => o.clients.size > 0)) return;
    for (const o of room) {
      this.members.delete(o.emperorId);
      // El estado de combate de los Emperadores dura (no se cura saliendo y entrando); el de los piratas, no.
      if (o.kind === "pirate") this.combatants.delete(o.emperorId);
    }
    this.rooms.delete(systemId);
    this.refreshedAt.delete(systemId);
  }

  /** La nave deja su sistema (vuelve al mapa, salta, se desconecta, cae…). */
  leave(emperorId: string, reason: "left" | "destroyed"): void {
    const m = this.members.get(emperorId);
    if (!m) return;
    this.members.delete(emperorId);
    const room = this.rooms.get(m.systemId);
    room?.delete(m);
    for (const o of room ?? []) this.sendTo(o, { t: "shipGone", id: emperorId, reason });
    this.sleepIfEmpty(m.systemId);
  }

  /** Crea los piratas que viven en el sistema (los que no estén muertos esperando reaparecer). */
  private spawnPirates(systemId: string, room: Set<Member>): void {
    const count = pirateCount(systemId);
    const now = this.now();
    for (let i = 0; i < count; i++) {
      const id = `pirate:${systemId}:${i}`;
      if (this.members.has(id) || (this.deadPirates.get(id) ?? 0) > now) continue;
      this.deadPirates.delete(id);
      const layout = this.layout(systemId);
      if (!layout) return;
      const home = pirateHome(systemId, i, layout, now);
      const combat = new Combatant(PIRATE_RAIDER.hull, PIRATE_RAIDER.combat, now);
      this.combatants.set(id, combat);
      const m: Member = {
        emperorId: id,
        kind: "pirate",
        ai: { home, phase: (i * 0.37) % 1 },
        name: "",
        systemId,
        clients: new Set(),
        pose: { p: home, q: [0, 0, 0, 1], v: [0, 0, 0] },
        poseAt: now,
        history: [{ t: now, p: home }],
        dirty: true,
        allies: new Set(),
        combat,
        sentShield: -1,
        park: null,
      };
      for (const o of room) this.sendTo(o, { t: "ship", ship: this.stateFor(m, o) });
      room.add(m);
      this.members.set(id, m);
    }
  }

  /** Una conexión se cierra o deja de pilotar: si era la última de su nave, la nave se queda aparcada. */
  leaveClient(client: Client): void {
    const m = this.members.get(client.emperorId);
    if (!m || !m.clients.delete(client)) return;
    if (m.clients.size > 0) return;
    this.park(m);
    this.sleepIfEmpty(m.systemId);
  }

  /** Estado de combate de un Emperador (para tests y diagnóstico). */
  combatOf(emperorId: string): Combatant {
    return this.combatantOf(emperorId);
  }

  /** Naves presentes en un sistema (para tests y diagnóstico). */
  shipsIn(systemId: string): string[] {
    return [...(this.rooms.get(systemId) ?? [])].map((m) => m.emperorId);
  }

  /** ¿Puede `a` dañar a `b`? No a sí mismo, ni a sus compañeros, ni un pirata a otro. */
  private hostile(a: Member, b: Member): boolean {
    if (a === b || (a.kind === "pirate" && b.kind === "pirate")) return false;
    return !a.allies.has(b.emperorId);
  }

  /** Posiciones de un objetivo a tener en cuenta: la actual y las recientes (latencia del tirador). */
  private recentPositions(o: Member, now: number): Vec3[] {
    return [o.pose.p, ...o.history.filter((h) => now - h.t <= LAG_COMPENSATION_MS).map((h) => h.p)];
  }

  /** Disparo de la nave de este cliente. Lo que no cumple las reglas se ignora. */
  fire(client: Client, weapon: WeaponKind, dirIn: Vec3, targetId?: string): void {
    const m = this.members.get(client.emperorId);
    if (m) this.fireFrom(m, weapon, dirIn, targetId);
  }

  /** Disparo de cualquier nave (jugador o pirata), con las mismas reglas para todas. */
  private fireFrom(m: Member, weapon: WeaponKind, dirIn: Vec3, targetId?: string): void {
    const dir = normalize(dirIn);
    if (!m || !dir) return;
    const room = this.rooms.get(m.systemId);
    if (!room) return;
    const now = this.now();

    let target: Member | null = null;
    let hitDistance: number | null = null;
    if (weapon === "missile") {
      // Misil: objetivo fijado, enemigo, a tiro y delante del morro.
      target = targetId ? (this.members.get(targetId) ?? null) : null;
      const def = m.combat.weapons.get("missile")?.def;
      if (!def || !target || target.systemId !== m.systemId || !this.hostile(m, target)) return;
      const d = distance(m.pose.p, target.pose.p);
      const to = normalize([target.pose.p[0] - m.pose.p[0], target.pose.p[1] - m.pose.p[1], target.pose.p[2] - m.pose.p[2]]);
      const fwd = forwardOf(m.pose.q);
      if (d > def.rangeU || !to || to[0] * fwd[0] + to[1] * fwd[1] + to[2] * fwd[2] < MISSILE_LOCK_COS) return;
      hitDistance = d;
    }
    const def = m.combat.tryFire(weapon, now);
    if (!def) return;
    // El disparo sale de la boca del arma (alternando entre las de cada lado), no del centro de la nave.
    const muzzle = m.combat.nextMuzzle(weapon);
    const off = rotate(m.pose.q, muzzle.offset);
    const from: Vec3 = [m.pose.p[0] + off[0], m.pose.p[1] + off[1], m.pose.p[2] + off[2]];
    // El proyectil hereda la velocidad de la nave en su dirección (si no, a toda máquina se quedaría atrás).
    const v = m.pose.v;
    const speed = def.speedU + Math.max(0, v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]);

    if (weapon === "cannon") {
      // Cañón: el enemigo más cercano que el proyectil roza (ahora o hace un instante).
      for (const o of room) {
        if (!this.hostile(m, o)) continue;
        for (const p of this.recentPositions(o, now)) {
          const t = rayHit(from, dir, p, def.rangeU);
          if (t !== null && (hitDistance === null || t < hitDistance)) {
            hitDistance = t;
            target = o;
          }
        }
      }
    }

    const hitAt = target && hitDistance !== null ? now + (hitDistance / speed) * 1000 : null;
    const shot: ServerMessage = {
      t: "shot",
      id: m.emperorId,
      weapon,
      from,
      muzzle: muzzle.index,
      dir,
      target: weapon === "missile" ? (target?.emperorId ?? null) : null,
      speed,
      range: def.rangeU,
      serverTime: now,
      hitAt,
    };
    for (const o of room) this.sendTo(o, shot);
    this.sendWeapons(m);

    if (target && hitAt !== null) {
      const victim = target;
      const attacker = m;
      // Quien derriba: el nombre del Emperador, o vacío para un pirata (el cliente lo traduce).
      const by = attacker.kind === "pirate" ? "" : attacker.name;
      this.later(hitAt - now, () => this.hit(victim.emperorId, def.damage, by, weapon === "missile" ? attacker.systemId : null));
    }
  }

  /** Llega un impacto. Si el objetivo ya no está (saltó, se fue), se pierde; un misil lo sigue dentro del sistema. */
  private hit(victimId: string, damage: number, attackerName: string, missileSystem: string | null): void {
    const v = this.members.get(victimId);
    if (!v || (missileSystem !== null && v.systemId !== missileSystem)) return;
    const destroyed = v.combat.damage(damage, this.now());
    this.broadcastState(v);
    if (destroyed) void this.destroy(v, attackerName);
  }

  /** Nave destruida: sale del sistema y el Emperador renace en el Núcleo Humano con la nave reparada. */
  private async destroy(v: Member, by: string): Promise<void> {
    if (v.kind === "pirate") {
      this.leave(v.emperorId, "destroyed");
      this.combatants.delete(v.emperorId);
      this.deadPirates.set(v.emperorId, this.now() + PIRATE_RAIDER.respawnSec * 1000);
      return;
    }
    const clients = [...v.clients];
    this.leave(v.emperorId, "destroyed");
    v.combat.restore(this.now());
    try {
      const emperor = await this.emperors.respawn(v.emperorId);
      if (!emperor) return;
      for (const c of clients) c.send({ t: "destroyed", by, systemId: emperor.location.systemId });
      this.onRespawn(v.emperorId);
    } catch (err) {
      this.log.error(err, "Error al hacer renacer a un Emperador");
    }
  }

  /** Mueve los piratas y los hace disparar cuando tienen a un enemigo delante y a tiro. */
  private stepPirates(now: number): void {
    const dt = TICK_MS / 1000;
    for (const room of this.rooms.values()) {
      for (const m of room) {
        if (m.kind !== "pirate" || !m.ai) continue;
        // El enemigo más cercano dentro de su radio de detección.
        let target: Member | null = null;
        let best = PIRATE_RAIDER.aggroRangeU;
        for (const o of room) {
          // Solo naves pilotadas: una nave aparcada, sin nadie a bordo, no les llama la atención.
          if (o.kind !== "emperor" || o.clients.size === 0) continue;
          const d = distance(m.pose.p, o.pose.p);
          if (d < best) {
            best = d;
            target = o;
          }
        }
        const step = stepPirate(m.pose.p, m.pose.v, m.ai.home, target?.pose.p ?? null, dt, m.ai.phase);
        m.pose = step;
        m.poseAt = now;
        m.history.push({ t: now, p: step.p });
        if (m.history.length > HISTORY_SIZE) m.history.shift();
        m.dirty = true;
        if (target) {
          const to = normalize([target.pose.p[0] - step.p[0], target.pose.p[1] - step.p[1], target.pose.p[2] - step.p[2]]);
          const cannon = PIRATE_RAIDER.combat.weapons[0]!;
          // Puntería imperfecta (unos 4°): de lejos fallan más, de cerca casi nunca.
          const j = () => (Math.random() - 0.5) * 0.14;
          if (to && best <= cannon.rangeU) this.fireFrom(m, "cannon", [to[0] + j(), to[1] + j(), to[2] + j()]);
        }
      }
      // Reaparecen los que ya cumplieron su espera.
      const any = room.values().next().value as Member | undefined;
      if (any) this.spawnPirates(any.systemId, room);
    }
  }

  /** Naves aparcadas: avanzan por su órbita; y, de vez en cuando, se repasa quién está en cada sistema. */
  private stepParked(now: number): void {
    for (const [systemId, room] of this.rooms) {
      for (const m of room) {
        if (!m.park || now - m.poseAt < PARKED_POSE_MS) continue;
        const p = parkedPosition(m.park, now);
        m.pose = { p, q: m.pose.q, v: parkedVelocity(m.park, now) };
        m.poseAt = now;
        m.history.push({ t: now, p });
        if (m.history.length > HISTORY_SIZE) m.history.shift();
        m.dirty = true;
      }
      if (now - (this.refreshedAt.get(systemId) ?? 0) < PARKED_REFRESH_MS) continue;
      // Una sala sin pilotos (alguien entró y no llegó a tomar los mandos) se duerme.
      if (![...room].some((o) => o.clients.size > 0)) this.sleepIfEmpty(systemId);
      else void this.refreshParked(systemId);
    }
  }

  private tick(): void {
    const now = this.now();
    this.stepPirates(now);
    this.stepParked(now);
    for (const room of this.rooms.values()) {
      const changed = [...room].filter((m) => m.dirty);
      if (changed.length > 0) {
        for (const m of changed) m.dirty = false;
        const ships = changed.map((m) => ({ id: m.emperorId, ...m.pose }));
        for (const m of room) this.sendTo(m, { t: "poses", serverTime: now, ships: ships.filter((s) => s.id !== m.emperorId) });
      }
    }
    // Recarga de escudos: se calcula siempre y se difunde de vez en cuando.
    const broadcast = now - this.lastShieldBroadcast >= SHIELD_BROADCAST_MS;
    if (broadcast) this.lastShieldBroadcast = now;
    for (const m of this.members.values()) {
      m.combat.regenShield(TICK_MS / 1000, now);
      if (broadcast && Math.round(m.combat.shield) !== m.sentShield) this.broadcastState(m);
    }
  }
}
