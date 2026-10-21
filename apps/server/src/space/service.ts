import { AIM_ASSIST, BODY_COLLISION, EMPEROR_FLAGSHIP, ESCORT, FLAGSHIP_DOCK, SHIP_COLLISION, FLAGSHIP_HIT_RADIUS_M, FLAGSHIP_LENGTH_M, FLAGSHIP_HOLD, FLAGSHIP_REPAIR, FLAGSHIP_SUPPLIES, LINEAGE, STAR_HEAT, getAlienShipClass, getShipClass, MINING, PIRATE_AI, type ShipClassId } from "@imperium/content";
import { HEAT_CAUSE, HORIZON_CAUSE, IMPACT_CAUSE, isDeepId, type CommandError, type EscortOrder, type ServerMessage, type ShipPose, type Quat, type ShipState, type Vec3, type WeaponKind } from "@imperium/shared";
import { addToHold, arriveVelocity, avoidObstacles, escortSlot, bodiesAt, fleetRallyPoint, fleetSlotPosition, friendInLine, jinkVector, nextPirateMode, packTarget, type PirateMode, type PirateObstacle, insideEventHorizon, starHeatDps, gravitySpeedBound, isTravelling, miningYield, parkedPosition, planetPosition, parkedVelocity, PILOT_BOOST, PILOT_MAX_SPEED, PILOT_SPEED, plausibleMove, pulseLimitAt, leadPoint, projectileSpeed, sweepHit, type Hold, type ParkedOrbit, type SystemLayout } from "@imperium/sim";
import type { FastifyBaseLogger } from "fastify";
import type { EmperorService } from "../emperor/service";
import type { Client, RemotePilot } from "../realtime/hub";
import type { SocialService } from "../social/service";
import type { FlagshipService } from "./flagship";
import type { DeepSpaceService } from "./deep";
import { Combatant, type StoredSupplies, distance, forwardOf, HIT_RADIUS, MISSILE_LOCK_COS, normalize, rotate } from "./combat";
import { pirateFlight, pirateHome, piratesOf, stepPirate } from "./pirates";
import { PendingArrivals, RIFT_ARRIVE_WINDOW_MS, riftNear, type RiftNotice } from "./rift";

/** Una nave presente en un sistema: de un Emperador o un pirata de la IA. */
interface Member {
  /** Id del Emperador, o "pirate:<sistema>:<n>" para los piratas. */
  emperorId: string;
  kind: "emperor" | "pirate" | "fleet";
  /** Solo naves de flota (pilotadas a distancia o escoltas): su Emperador, su clase, su flota y su nave (en la base de datos). */
  owner?: string;
  /** Solo escoltas de la IA (Fase 9d): a quién escoltan, su sitio en la formación y su modo. */
  escort?: { leader: string; slot: number; mode: PirateMode; holdAt?: Vec3 };
  classId?: string;
  fleetId?: string;
  shipId?: string;
  /** Solo piratas: dónde viven, un valor fijo para variar su forma de rodear, su clase de nave, su puntería y su modo (Fase 9d). */
  ai?: { home: Vec3; phase: number; classId: string; aimJitter: number; mode?: PirateMode };
  /** Radio de impacto (metros): las naves grandes son más fáciles de acertar. */
  radius: number;
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
  /** Compañeros (aliados mutuos): se marcan como `ally` (con fuego amigo: también se les puede dañar). */
  allies: Set<string>;
  combat: Combatant;
  /** Escudo enviado por última vez a los demás (para difundir la recarga solo si cambia). */
  sentShield: number;
  /** Casco enviado por última vez (la reparación a bordo también se difunde de vez en cuando). */
  sentHull?: number;
  /**
   * Solo naves de Emperadores: si nadie la pilota, está aparcada y orbita la
   * estrella desde esta posición y hora (la ven todos los presentes y se le
   * puede disparar). Null mientras alguien la pilota.
   */
  park: ParkedOrbit | null;
  /** Solo Emperadores: colonias propias en el sistema (para reponer) y cuándo se consultaron. */
  colonies?: { list: Array<{ colonyId: string; planetIndex: number }>; at: number; loading: boolean };
  /** Reposición en curso (una a la vez) y hasta cuándo se muestra "reponiendo". */
  resupplyPending?: boolean;
  resupplyingUntil?: number;
  /** Energía y combustible enviados por última vez al piloto (para no repetirlos). */
  sentSupplies?: string;
  /** Cuándo tomó los mandos y si ya anunció su grieta de llegada (solo una por vez). */
  boardedAt?: number;
  riftArrived?: boolean;
  /** Espacio profundo: asteroide al que apunta su láser de minería (null: apagado). */
  beam?: number | null;
  /** Último pulso de minería aceptado (hora del servidor) y si hay uno en curso. */
  mineAt?: number;
  minePending?: boolean;
  /** Refinado en curso (una operación a la vez). */
  refinePending?: boolean;
  /** Hasta cuándo no cuenta otro choque contra un cuerpo (`BODY_COLLISION.cooldownSec`). */
  bodyBumpUntil?: number;
  /** Solo la nave del Emperador: orden a sus escoltas (por defecto, seguir) y su blanco si es «atacar». */
  escortOrder?: { order: EscortOrder; targetId: string | null };
  /** Solo la nave del Emperador: acoplada en la nave nodriza de esta flota, que espera en `at` (punto del sistema). */
  dock?: { fleetId: string; slot: number; colonyPlanet: number | null; reach: number } | null;
}

/** Clave (e id de la nave en el espacio) de una nave de flota pilotada a distancia. */
const fleetShipKey = (shipId: string) => `ship:${shipId}`;

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
/** Cada cuánto se envían energía y combustible al piloto (si cambian). */
const SUPPLIES_SEND_MS = 500;
/** Cada cuánto se guardan los recursos de las naves que han cambiado. */
const SUPPLIES_FLUSH_MS = 15_000;
/** Cada cuánto se recuerda dónde está cada nave pilotada en su sistema (memoria de posición, `system_parks`). */
const MEMORY_FLUSH_MS = 60_000;
/** Cada cuánto se repone junto a las colonias y se vuelven a consultar. */
const RESUPPLY_MS = 2_000;
const COLONIES_REFRESH_MS = 30_000;
/** Por encima de esta velocidad (con margen) la nave va con el pulso, que gasta combustible y energía. */
const PULSE_THRESHOLD = PILOT_SPEED * PILOT_BOOST * 1.3;
/** Coseno del cono de los montajes del cañón de una insignia. */
const CANNON_GIMBAL_COS = Math.cos((AIM_ASSIST.cannonGimbalDeg * Math.PI) / 180);

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
  private lastSuppliesSend = 0;
  private lastSuppliesFlush = 0;
  private lastMemoryFlush = 0;
  private lastResupply = 0;
  /** Se llama cuando cambian las existencias de una colonia al reponer (para enviarla a su dueño). */
  onColony: (emperorId: string, colonyId: string) => void = () => {};
  /** Piratas destruidos y hasta cuándo no reaparecen. */
  private readonly deadPirates = new Map<string, number>();
  /** Espacio profundo: contenido de las regiones y minería (lo pone `buildApp`). */
  deep: DeepSpaceService | null = null;
  /** La bodega de una flota cambió (reposición acoplada): avisar a su dueño. */
  onFleetCargo: ((emperorId: string, fleetId: string) => void) | null = null;
  /** Naves de flota pilotadas a distancia: guardar su casco al dejarlas y borrarlas si las destruyen (los pone el servidor). */
  fleetShips: {
    saveHull(emperorId: string, fleetId: string, shipId: string, hull: number): Promise<void>;
    destroyed(emperorId: string, fleetId: string, shipId: string): Promise<void>;
    /** Naves armadas de las flotas paradas en el sistema que salen a escoltar (Fase 9d). */
    escorts(emperorId: string, systemId: string, max: number): Promise<Array<{ fleetId: string; shipId: string; classId: string; hull: number }>>;
  } | null = null;
  /** Emperadores con la refinería de a bordo encendida (volátiles de la bodega → combustible). */
  private readonly refining = new Set<string>();
  /** Uniones en curso, para no validar dos veces a la vez la misma nave. */
  private readonly joining = new Map<string, Promise<Member | null>>();
  /** Grietas de llegada anunciadas antes de que la nave entre en el sistema. */
  private readonly riftArrivals = new PendingArrivals();
  /** Choques entre naves: pareja → hasta cuándo no vuelve a contar (hora del servidor). */
  private readonly bumps = new Map<string, number>();
  /**
   * Fase 10: la nave de un Emperador cae en el combate pilotado. Registra la
   * muerte (gestación en una Cuna o en el Núcleo) y devuelve cuándo y dónde
   * renace; la pone `buildApp` (`LineageService.die` y avisos).
   */
  onDeath: (emperorId: string, systemId: string, by: string) => Promise<{ rebornAt: number; systemId: string } | null> = async () => null;

  constructor(
    private readonly flagships: FlagshipService,
    private readonly emperors: EmperorService,
    private readonly social: SocialService,
    private readonly log: FastifyBaseLogger,
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
   * y nunca menos que la de maniobra con impulso más lo que se gana cayendo por
   * la gravedad (cota de escape desde el borde de la esfera de influencia).
   */
  private maxSpeedAt(systemId: string, a: Vec3, b: Vec3, now: number): number {
    // Espacio profundo: no hay cuerpos que limiten el pulso.
    if (isDeepId(systemId)) return PILOT_MAX_SPEED;
    const layout = this.layout(systemId);
    if (!layout) return PILOT_SPEED * PILOT_BOOST;
    const bodies = bodiesAt(layout, now);
    const falling = Math.max(gravitySpeedBound(a, bodies), gravitySpeedBound(b, bodies));
    return Math.max(PILOT_SPEED * PILOT_BOOST + falling, pulseLimitAt(a, null, bodies), pulseLimitAt(b, null, bodies));
  }

  /**
   * Estado de combate de la nave de un Emperador. Se guarda en memoria mientras
   * dura el proceso (el casco no se cura saliendo y entrando); los recursos
   * (combustible, munición) vienen de la base de datos la primera vez, o de
   * nuevo si cambiaron fuera (salto cuántico).
   */
  private combatantOf(emperorId: string, supplies?: StoredSupplies | null): Combatant {
    let c = this.combatants.get(emperorId);
    if (!c) this.combatants.set(emperorId, (c = new Combatant(EMPEROR_FLAGSHIP.hull, EMPEROR_FLAGSHIP.combat, this.now(), supplies ?? undefined)));
    else if (supplies && (c.stale || !c.hasReactor)) c.load(supplies, this.now());
    return c;
  }

  /** Energía y combustible al piloto, si han cambiado (o siempre, con `force`). */
  private sendSupplies(m: Member, now: number, force = false): void {
    if (m.clients.size === 0) return;
    const r = m.combat.reactorView(now);
    if (!r) return;
    const msg = {
      t: "supplies" as const,
      energy: Math.round(r.energy),
      energyMax: r.energyMax,
      fuel: Math.round(r.fuel * 10) / 10,
      fuelMax: r.fuelMax,
      resupplying: (m.resupplyingUntil ?? 0) > now,
    };
    const key = `${msg.energy}|${msg.fuel}|${msg.resupplying}`;
    if (!force && key === m.sentSupplies) return;
    m.sentSupplies = key;
    this.sendTo(m, msg);
  }

  /** Guarda los recursos de una nave si han cambiado. */
  private async saveSupplies(emperorId: string, c: Combatant): Promise<void> {
    if (!c.dirty || !c.hasReactor || c.stale) return;
    c.dirty = false;
    try {
      await this.flagships.saveSupplies(emperorId, c.stored(this.now()));
    } catch (err) {
      c.dirty = true;
      this.log.error(err, "Error al guardar los recursos de una nave");
    }
  }

  /**
   * Guarda ya los recursos de un Emperador (antes de que otro los lea de la base
   * de datos, como el salto cuántico) y, con `stale`, los marca para volver a
   * leerlos después.
   */
  async flushSupplies(emperorId: string): Promise<void> {
    const c = this.combatants.get(emperorId);
    if (c) await this.saveSupplies(emperorId, c);
  }

  /** Los recursos guardados cambiaron fuera (salto cuántico): se vuelven a leer al entrar en el siguiente sistema. */
  suppliesChanged(emperorId: string): void {
    const c = this.combatants.get(emperorId);
    if (c) c.stale = true;
  }

  private stateFor(m: Member, viewer: Member | null): ShipState {
    const owner = m.owner ?? m.emperorId;
    const classId = m.ai?.classId ?? m.classId;
    return {
      id: m.emperorId,
      kind: m.kind,
      ...(classId ? { classId } : {}),
      name: m.name,
      // Compañeros, y las naves propias entre sí (la insignia aparcada y la nave de flota que se pilota).
      ally: viewer !== null && viewer !== m && (viewer.allies.has(owner) || (viewer.owner ?? viewer.emperorId) === owner),
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
    m.sentHull = Math.round(m.combat.hull);
    for (const o of this.rooms.get(m.systemId) ?? []) this.sendTo(o, { t: "ship", ship: this.stateFor(m, o) });
  }

  private sendWeapons(m: Member): void {
    this.sendTo(m, { t: "weapons", weapons: m.combat.weaponsView(this.now()) });
  }

  /** Posición recibida de un cliente que pilota en `systemId`. */
  async pose(client: Client, systemId: string, pose: ShipPose): Promise<void> {
    let m: Member | null | undefined = this.members.get(this.keyOf(client));
    if (!m || m.systemId !== systemId) {
      m = client.piloting ? await this.joinFleetShip(client, systemId, pose) : await this.join(client, systemId, pose);
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
    const dt = Math.max(0, Math.min(1, (t - m.poseAt) / 1000));
    // Con el pulso (más rápido que el impulso) se gasta combustible; sin combustible, no hay pulso.
    const pulsing = distance(m.pose.p, pose.p) / (dt + 0.15) > PULSE_THRESHOLD;
    const noFuel = pulsing && !m.combat.spendPulse(dt, t);
    if (outside || noFuel || !plausibleMove(m.pose.p, pose.p, (t - m.poseAt) / 1000, this.maxSpeedAt(systemId, m.pose.p, pose.p, t))) {
      // Posición imposible: se ignora y la nave vuelve a la última válida.
      client.send({ t: "poseRejected", ...m.pose });
      return;
    }
    this.collideBodies(m, pose, t);
    if (this.members.get(m.emperorId) !== m) return;
    m.pose = pose;
    m.poseAt = t;
    m.history.push({ t, p: pose.p });
    if (m.history.length > HISTORY_SIZE) m.history.shift();
    m.dirty = true;
  }

  /**
   * Choques contra la estrella, planetas, lunas y asteroides. El cliente mantiene
   * la nave sobre la superficie y le quita la velocidad hacia dentro; aquí se ve
   * en dos posiciones seguidas: la nueva toca un cuerpo y, respecto a él, la nave
   * ha perdido de golpe la velocidad hacia dentro que traía en la anterior. El
   * daño depende de esa velocidad (`BODY_COLLISION`).
   */
  private collideBodies(m: Member, pose: ShipPose, now: number): void {
    if (now < (m.bodyBumpUntil ?? 0)) return;
    let impact = 0;
    for (const c of this.contactBodies(m.systemId, now)) {
      const d = distance(pose.p, c.center);
      if (d > c.reach + BODY_COLLISION.contactSlackM || d < 1e-3) continue;
      const n: Vec3 = [(pose.p[0] - c.center[0]) / d, (pose.p[1] - c.center[1]) / d, (pose.p[2] - c.center[2]) / d];
      const inward = (v: Vec3) => -((v[0] - c.v[0]) * n[0] + (v[1] - c.v[1]) * n[1] + (v[2] - c.v[2]) * n[2]);
      const before = inward(m.pose.v);
      if (before > impact && inward(pose.v) < before * 0.5) impact = before;
    }
    if (impact < BODY_COLLISION.minImpactMps) return;
    m.bodyBumpUntil = now + BODY_COLLISION.cooldownSec * 1000;
    const destroyed = m.combat.damage((impact - BODY_COLLISION.minImpactMps) * BODY_COLLISION.damagePerMps, now);
    this.broadcastState(m);
    if (destroyed) void this.destroy(m, IMPACT_CAUSE);
  }

  /** Cuerpos sólidos de un sistema o región con su velocidad (m/s) y la distancia de contacto desde su centro. */
  private contactBodies(systemId: string, now: number): Array<{ center: Vec3; v: Vec3; reach: number }> {
    if (isDeepId(systemId)) {
      // Los asteroides no se mueven; el cliente los encoge al minarlos (por eso el margen sale de su radio inicial).
      const region = this.deep?.region(systemId);
      return (region?.asteroids ?? []).map((a) => ({ center: a.p, v: [0, 0, 0], reach: a.r * 0.85 + FLAGSHIP_HIT_RADIUS_M }));
    }
    const layout = this.layout(systemId);
    if (!layout) return [];
    const at = bodiesAt(layout, now);
    const before = bodiesAt(layout, now - 500);
    // Un agujero negro no tiene superficie: lo que lo cruza no vuelve (`heatShips`).
    const solid = (b: (typeof at)[number]) => !(b.body.kind === "star" && layout.starClass === "BH");
    return at.flatMap((b, i) => {
      if (!solid(b)) return [];
      const [x = 0, y = 0, z = 0] = b.center;
      const [px = 0, py = 0, pz = 0] = before[i]!.center;
      return {
        center: [x, y, z],
        v: [(x - px) * 2, (y - py) * 2, (z - pz) * 2],
        // El mismo contacto que el cliente (`SystemView.collide`).
        reach: b.body.kind === "star" ? b.radius * 1.05 : b.radius + FLAGSHIP_LENGTH_M * 0.6,
      };
    }) as Array<{ center: Vec3; v: Vec3; reach: number }>;
  }

  // --- Naves de flota pilotadas a distancia (orden `fleet.pilot`) ---

  /** Clave de la nave que pilota este cliente: la de su flota si pilota a distancia; si no, la de su Emperador. */
  private keyOf(client: Client): string {
    return client.piloting ? fleetShipKey(client.piloting.shipId) : client.emperorId;
  }

  /**
   * Empieza a pilotar a distancia una nave de flota (ya validada: flota propia,
   * parada y fuera de batalla). Si pilotaba su nave del Emperador, esta se
   * queda aparcada. La nave entra en el espacio compartido con su primera posición.
   */
  startRemote(client: Client, pilot: RemotePilot): void {
    if (client.piloting) this.endRemote(client, "left");
    else this.leaveClient(client);
    client.piloting = pilot;
  }

  /** Deja de pilotar a distancia: la nave vuelve a su flota con el casco que le quede. */
  endRemote(client: Client, reason: "left" | "destroyed"): void {
    const pilot = client.piloting;
    if (!pilot) return;
    client.piloting = null;
    const key = fleetShipKey(pilot.shipId);
    const m = this.members.get(key);
    if (m) {
      m.clients.delete(client);
      if (m.clients.size === 0) {
        const hull = Math.round(m.combat.hull);
        this.leave(key, "left");
        this.combatants.delete(key);
        void this.fleetShips?.saveHull(m.owner!, m.fleetId!, m.shipId!, hull).catch((err: unknown) => this.log.error(err, "Error al guardar el casco de una nave de flota"));
      }
    }
    if (reason === "destroyed") client.send({ t: "remoteEnded", reason });
  }

  /**
   * Acopla la nave del Emperador que pilota este cliente en la nave nodriza de
   * una flota (ya validada): la flota espera en su sitio (`slot`) junto al punto
   * de reunión del sistema, y la nave tiene que estar a menos de `reach`.
   */
  dock(client: Client, fleetId: string, slot: number, colonyPlanet: number | null, reach: number): CommandError | null {
    const m = this.members.get(client.emperorId);
    if (client.piloting || !m || m.park || !m.clients.has(client)) return "too_far";
    const at = this.dockPoint(m.systemId, slot, colonyPlanet, this.now());
    if (!at || distance(m.pose.p, at) > reach) return "too_far";
    m.dock = { fleetId, slot, colonyPlanet, reach };
    return null;
  }

  /** Dónde espera ahora la flota en la que se acopla (se mueve con su planeta). */
  private dockPoint(systemId: string, slot: number, colonyPlanet: number | null, now: number): Vec3 | null {
    const layout = this.layout(systemId);
    return layout ? fleetSlotPosition(fleetRallyPoint(layout, colonyPlanet, now), slot) : null;
  }

  undock(client: Client): void {
    const m = this.members.get(client.emperorId);
    if (m) m.dock = null;
  }

  /** Sistema en el que pilota este cliente su nave del Emperador (null si no la pilota). */
  pilotingIn(client: Client): string | null {
    const m = client.piloting ? null : this.members.get(client.emperorId);
    return m && !m.park && m.clients.has(client) ? m.systemId : null;
  }

  /** La flota se va (orden de viaje o intercepción): quien pilotaba una de sus naves deja de hacerlo. */
  releaseFleet(fleetId: string): void {
    for (const m of [...this.members.values()]) if (m.escort && m.fleetId === fleetId) this.dismissEscort(m);
    for (const m of this.members.values()) {
      if (m.dock?.fleetId !== fleetId) continue;
      m.dock = null;
      this.sendTo(m, { t: "undocked" });
    }
    for (const m of [...this.members.values()]) {
      if (m.kind !== "fleet" || m.fleetId !== fleetId) continue;
      for (const c of [...m.clients]) {
        this.endRemote(c, "left");
        c.send({ t: "remoteEnded", reason: "left" });
      }
    }
  }

  // --- Escoltas de la IA (Fase 9d, `ESCORT`) ---

  /** La nave del Emperador toma los mandos: las naves armadas de sus flotas paradas aquí salen a escoltarla. */
  private async spawnEscorts(leader: Member): Promise<void> {
    if (!this.fleetShips || isDeepId(leader.systemId)) return;
    let list: Awaited<ReturnType<NonNullable<SpaceService["fleetShips"]>["escorts"]>>;
    try {
      list = await this.fleetShips.escorts(leader.emperorId, leader.systemId, ESCORT.maxShips);
    } catch (err) {
      return this.log.error(err, "Error al buscar las escoltas");
    }
    const room = this.rooms.get(leader.systemId);
    // Mientras se consultaba pudo dejar de pilotar.
    if (!room || leader.park || this.members.get(leader.emperorId) !== leader) return;
    const now = this.now();
    list.forEach((e, i) => {
      const key = fleetShipKey(e.shipId);
      // Ya está en el espacio (pilotada a distancia o escoltando).
      if (this.members.has(key)) return;
      const cls = getShipClass(e.classId as ShipClassId);
      if (!cls) return;
      const combat = new Combatant(cls.hull, cls.combat, now);
      combat.hull = Math.max(1, Math.min(cls.hull, e.hull));
      this.combatants.set(key, combat);
      const p = escortSlot(leader.pose.p, leader.pose.q, i);
      const m: Member = {
        emperorId: key,
        kind: "fleet",
        owner: leader.emperorId,
        classId: cls.id,
        fleetId: e.fleetId,
        shipId: e.shipId,
        escort: { leader: leader.emperorId, slot: i, mode: "hunt" },
        radius: Math.max(HIT_RADIUS, cls.model.lengthM * 0.45),
        name: leader.name,
        systemId: leader.systemId,
        clients: new Set(),
        pose: { p, q: leader.pose.q, v: leader.pose.v },
        poseAt: now,
        history: [{ t: now, p }],
        dirty: true,
        allies: leader.allies,
        combat,
        sentShield: -1,
        park: null,
      };
      for (const o of room) this.sendTo(o, { t: "ship", ship: this.stateFor(m, o) });
      room.add(m);
      this.members.set(key, m);
    });
  }

  /** Orden a las escoltas de la nave que pilota este cliente. */
  orderEscorts(client: Client, order: EscortOrder, targetId: string | null): CommandError | null {
    const m = client.piloting ? null : this.members.get(client.emperorId);
    if (!m || m.park || !m.clients.has(client)) return "not_present";
    if (order === "attack") {
      const t = targetId ? this.members.get(targetId) : undefined;
      if (!t || t.systemId !== m.systemId || (t.owner ?? t.emperorId) === m.emperorId) return "no_target";
    }
    m.escortOrder = { order, targetId: order === "attack" ? targetId : null };
    return null;
  }

  /** Una escolta vuelve a su flota con el casco que le quede. */
  private dismissEscort(m: Member): void {
    const hull = Math.round(m.combat.hull);
    this.leave(m.emperorId, "left");
    this.combatants.delete(m.emperorId);
    void this.fleetShips?.saveHull(m.owner!, m.fleetId!, m.shipId!, hull).catch((err: unknown) => this.log.error(err, "Error al guardar el casco de una escolta"));
  }

  private dismissEscorts(leaderId: string): void {
    for (const m of [...this.members.values()]) if (m.escort?.leader === leaderId) this.dismissEscort(m);
  }

  /**
   * Un paso de las escoltas: en formación detrás de su Emperador (si se quedan
   * muy atrás, se reúnen de un salto); si un Carroñero se acerca a él, van a
   * por el más cercano, con la misma disciplina de fuego que los piratas.
   */
  private stepEscorts(now: number): void {
    const dt = TICK_MS / 1000;
    for (const [systemId, room] of this.rooms) {
      const escorts = [...room].filter((m) => m.escort);
      if (escorts.length === 0) continue;
      const pirates = [...room].filter((o) => o.kind === "pirate" && o.combat.hull > 0);
      const obstacles = this.pirateObstacles(systemId, now);
      for (const m of escorts) {
        const e = m.escort!;
        const leader = this.members.get(e.leader);
        if (!leader || leader.park || leader.systemId !== m.systemId) {
          this.dismissEscort(m);
          continue;
        }
        const order = leader.escortOrder ?? { order: "follow" as const, targetId: null };
        let target: Member | null = null;
        if (order.order === "attack") {
          // El blanco que fijó el Emperador (cualquier nave ajena: también otros jugadores).
          const t = order.targetId ? this.members.get(order.targetId) : undefined;
          if (t && t.systemId === m.systemId && t.combat.hull > 0) target = t;
          else leader.escortOrder = { order: "follow", targetId: null };
        } else if (order.order !== "recall") {
          // Seguir: los Carroñeros cerca del Emperador; mantener: los que se acerquen a la escolta.
          const center = order.order === "hold" ? m.pose.p : leader.pose.p;
          let best: number = ESCORT.engageRangeU;
          for (const o of pirates) {
            const d = distance(center, o.pose.p);
            if (d < best) {
              best = d;
              target = o;
            }
          }
        }
        // Mantener posición: su sitio es donde estaba al recibir la orden (quieta).
        if (order.order === "hold") e.holdAt ??= m.pose.p;
        else e.holdAt = undefined;
        const slot = e.holdAt ?? escortSlot(leader.pose.p, leader.pose.q, e.slot);
        let step: { p: Vec3; v: Vec3; q: Quat };
        if (!target && !e.holdAt && distance(m.pose.p, slot) > ESCORT.catchUpM) {
          // Se quedó atrás (el Emperador va con el pulso): se reúne con él.
          step = { p: slot, v: leader.pose.v, q: leader.pose.q };
        } else if (target) {
          const toward = normalize([target.pose.p[0] - m.pose.p[0], target.pose.p[1] - m.pose.p[1], target.pose.p[2] - m.pose.p[2]]);
          const underFire = now - m.combat.lastHitAt < PIRATE_AI.underFireSec * 1000;
          step = stepPirate(m.pose.p, m.pose.v, slot, target.pose.p, dt, (e.slot * 0.37) % 1, { speedU: ESCORT.speedU, preferredRangeU: ESCORT.preferredRangeU }, {
            mode: "hunt",
            threat: target.pose.p,
            avoid: avoidObstacles(m.pose.p, m.pose.v, obstacles, ESCORT.speedU),
            jink: underFire && toward ? jinkVector(toward, (e.slot * 0.37) % 1, now / 1000, ESCORT.speedU) : null,
          });
        } else {
          const want = arriveVelocity(m.pose.p, slot, e.holdAt ? [0, 0, 0] : leader.pose.v, Math.max(ESCORT.speedU, Math.hypot(...leader.pose.v) * 1.2));
          const avoid = avoidObstacles(m.pose.p, m.pose.v, obstacles, ESCORT.speedU);
          const k = 1 - Math.exp(-dt * 2);
          const v: Vec3 = [m.pose.v[0] + (want[0] + avoid[0] - m.pose.v[0]) * k, m.pose.v[1] + (want[1] + avoid[1] - m.pose.v[1]) * k, m.pose.v[2] + (want[2] + avoid[2] - m.pose.v[2]) * k];
          step = { p: [m.pose.p[0] + v[0] * dt, m.pose.p[1] + v[1] * dt, m.pose.p[2] + v[2] * dt], v, q: leader.pose.q };
        }
        m.pose = step;
        m.poseAt = now;
        m.history.push({ t: now, p: step.p });
        if (m.history.length > HISTORY_SIZE) m.history.shift();
        m.dirty = true;
        if (!target) continue;
        const dist = distance(step.p, target.pose.p);
        const cannon = m.combat.weapons.get("cannon");
        const lead = cannon ? leadPoint(step.p, step.v, target.pose.p, target.pose.v, cannon.def.speedU) : null;
        const aim = lead?.dir ?? normalize([target.pose.p[0] - step.p[0], target.pose.p[1] - step.p[1], target.pose.p[2] - step.p[2]]);
        const j = () => (Math.random() - 0.5) * ESCORT.aimJitter;
        // Nunca con su Emperador ni otra escolta en la línea de tiro.
        const friends = [leader, ...escorts.filter((o) => o !== m)].map((o) => o.pose.p);
        if (aim && cannon && dist <= cannon.def.rangeU && !friendInLine(step.p, aim, dist, friends)) this.fireFrom(m, "cannon", [aim[0] + j(), aim[1] + j(), aim[2] + j()]);
        const missile = m.combat.weapons.get("missile");
        if (aim && missile && dist <= missile.def.rangeU && (missile.ammo ?? 0) > 0 && now >= missile.readyAt) this.fireFrom(m, "missile", aim, target.emperorId);
      }
    }
  }

  /** Primera posición de una nave de flota pilotada: entra en la sala de su sistema (dentro del borde). */
  private async joinFleetShip(client: Client, systemId: string, pose: ShipPose): Promise<Member | null> {
    const pilot = client.piloting;
    if (!pilot || pilot.systemId !== systemId) return null;
    if (Math.hypot(...pose.p) > this.boundary(systemId) + BOUNDARY_SLACK) return null;
    const cls = getShipClass(pilot.classId as ShipClassId);
    if (!cls) return null;
    const key = fleetShipKey(pilot.shipId);
    const room = await this.ensureRoom(systemId);
    const already = this.members.get(key);
    if (already) {
      // Era una escolta de la IA: ahora la pilota el jugador.
      already.escort = undefined;
      already.clients.add(client);
      return already;
    }
    // Mientras se preparaba la sala pudo dejar de pilotarla.
    if (client.piloting !== pilot) return null;
    const now = this.now();
    const combat = new Combatant(cls.hull, cls.combat, now);
    combat.hull = Math.max(1, Math.min(cls.hull, pilot.hull));
    this.combatants.set(key, combat);
    const m: Member = {
      emperorId: key,
      kind: "fleet",
      owner: client.emperorId,
      classId: cls.id,
      fleetId: pilot.fleetId,
      shipId: pilot.shipId,
      radius: Math.max(HIT_RADIUS, cls.model.lengthM * 0.45),
      name: pilot.name,
      systemId,
      clients: new Set([client]),
      pose,
      poseAt: now,
      history: [{ t: now, p: pose.p }],
      dirty: true,
      allies: await this.social.mutualAllies(client.emperorId),
      combat,
      sentShield: -1,
      park: null,
    };
    for (const o of room) this.sendTo(o, { t: "ship", ship: this.stateFor(m, o) });
    room.add(m);
    this.members.set(key, m);
    client.send({ t: "space", systemId, serverTime: now, ships: [...room].filter((o) => o !== m).map((o) => this.stateFor(o, m)) });
    client.send({ t: "ship", ship: this.stateFor(m, m) });
    this.sendWeapons(m);
    return m;
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
    // Fase 10: un Emperador caído (gestándose) no tiene nave que pilotar.
    if (!emperor || emperor.gestating || isTravelling(emperor, this.now()) || emperor.location.systemId !== systemId) return null;
    if (Math.hypot(...pose.p) > this.boundary(systemId) + BOUNDARY_SLACK) return null;
    const [allies, status, supplies] = await Promise.all([
      this.social.mutualAllies(emperor.id),
      this.flagships.status(emperor.id),
      this.flagships.supplies(emperor.id),
    ]);
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
    const m = this.addParked(systemId, room, emperor.id, emperor.name, status.park, supplies);
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
  private addParked(systemId: string, room: Set<Member>, emperorId: string, name: string, park: ParkedOrbit, supplies: StoredSupplies | null): Member {
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
      combat: this.combatantOf(emperorId, supplies),
      sentShield: -1,
      park,
      radius: FLAGSHIP_HIT_RADIUS_M,
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
    this.sendSupplies(m, now, true);
    m.boardedAt = now;
    m.riftArrived = false;
    // Llegó de un salto: los presentes ven abrirse su grieta.
    const arrival = this.riftArrivals.take(m.emperorId, now);
    if (arrival) this.relayRift(m, arrival);
    void this.sendHold(m);
    void this.spawnEscorts(m);
    // Espacio profundo: el contenido de la región (secreto: solo a quien está en ella).
    if (isDeepId(m.systemId) && this.deep) {
      const deep = this.deep;
      void deep
        .view(m.systemId)
        .then((region) => {
          if (region) client.send({ t: "field", region });
          // Los láseres de minería que ya estaban encendidos.
          for (const o of this.rooms.get(m.systemId) ?? []) if (o !== m && o.beam != null) client.send({ t: "beam", id: o.emperorId, asteroid: o.beam });
        })
        .catch((err: unknown) => this.log.error(err, "Error al cargar una región de espacio profundo"));
    }
  }

  /** Bodega y refinería al piloto (o a la conexión indicada). */
  private async sendHold(m: Member, hold?: Hold): Promise<void> {
    try {
      const h = hold ?? (await this.flagships.hold(m.emperorId));
      this.sendTo(m, { t: "hold", hold: h, capacity: FLAGSHIP_HOLD.capacity, refining: this.refining.has(m.emperorId) });
    } catch (err) {
      this.log.error(err, "Error al leer la bodega");
    }
  }

  /**
   * Pulso del láser de minería de un piloto en el espacio profundo: si el
   * asteroide está a su alcance (desde el casco de la nave hasta su superficie), le queda
   * algo y hay sitio en la bodega y energía, extrae lo de un intervalo
   * (`MINING`). `null` apaga el láser. Los demás presentes ven el láser y el
   * asteroide que se agota.
   */
  mine(client: Client, asteroid: number | null): void {
    const m = this.members.get(this.keyOf(client));
    const deep = this.deep;
    if (!m || m.park || !deep || !isDeepId(m.systemId)) return;
    const room = this.rooms.get(m.systemId);
    const setBeam = (a: number | null) => {
      if ((m.beam ?? null) === a) return;
      m.beam = a;
      for (const o of room ?? []) if (o !== m) this.sendTo(o, { t: "beam", id: m.emperorId, asteroid: a });
    };
    if (asteroid === null) return setBeam(null);
    const now = this.now();
    // Un pulso por intervalo, como mucho (el cliente los manda a ese ritmo).
    if (m.minePending || now - (m.mineAt ?? 0) < MINING.tickSec * 1000 * 0.7) return;
    const fail = (reason: "range" | "empty" | "full" | "energy" | "none") => {
      setBeam(null);
      client.send({ t: "mineFail", reason });
    };
    const region = deep.region(m.systemId);
    const a = region?.asteroids[asteroid];
    if (!a) return fail("none");
    if (distance(m.pose.p, a.p) - a.r - FLAGSHIP_HIT_RADIUS_M > MINING.rangeM + 50) return fail("range");
    const dt = Math.min(MINING.tickSec * 1.5, (now - (m.mineAt ?? 0)) / 1000);
    if (!m.combat.spendEnergy(MINING.energyPerSec * dt, now)) return fail("energy");
    m.mineAt = now;
    m.minePending = true;
    setBeam(asteroid);
    const regionId = m.systemId;
    const want = MINING.unitsPerSec * dt;
    void (async () => {
      const left = deep.left(regionId, asteroid, now);
      if (left <= 0.01) return fail("empty");
      const take = Math.min(want, left);
      // Primero la bodega (con la fila bloqueada): lo que quepa es lo que se extrae.
      const stored = await this.flagships.updateHold(m.emperorId, (hold) => {
        const { hold: next, added } = addToHold(hold, miningYield(a.kind, take));
        return added > 1e-6 ? { hold: next, result: { hold: next, added } } : null;
      });
      if (!stored) return fail("full");
      const res = await deep.mine(regionId, asteroid, stored.added);
      for (const o of this.rooms.get(regionId) ?? []) this.sendTo(o, { t: "asteroid", i: asteroid, left: Math.round(res.left * 10) / 10 });
      void this.sendHold(m, stored.hold);
    })()
      .catch((err: unknown) => this.log.error(err, "Error al minar"))
      .finally(() => (m.minePending = false));
  }

  /** Enciende o apaga la refinería de a bordo (funciona mientras la nave está en un sistema o región activos). */
  async setRefining(emperorId: string, on: boolean): Promise<void> {
    if (on) this.refining.add(emperorId);
    else this.refining.delete(emperorId);
    const m = this.members.get(emperorId);
    if (m) await this.sendHold(m);
  }

  /** La bodega cambió fuera del espacio local (descarga en una colonia): al piloto. */
  holdChanged(emperorId: string): void {
    const m = this.members.get(emperorId);
    if (m) void this.sendHold(m);
  }

  /**
   * Refinería de a bordo: convierte despacio los volátiles de la bodega en
   * combustible (peor rendimiento que en una colonia). Se apaga sola sin
   * volátiles o con el depósito lleno.
   */
  private refineAll(now: number): void {
    const sec = RESUPPLY_MS / 1000;
    for (const id of this.refining) {
      const m = this.members.get(id);
      if (!m || !m.combat.hasReactor || m.combat.stale || m.refinePending) continue;
      const missing = m.combat.missing(now).fuel;
      if (missing < 0.05) {
        this.refining.delete(id);
        void this.sendHold(m);
        continue;
      }
      const fuelWanted = Math.min(missing, FLAGSHIP_HOLD.refineFuelPerSec * sec);
      m.refinePending = true;
      void this.flagships
        .updateHold(id, (hold) => {
          const have = hold.volatiles ?? 0;
          const used = Math.min(have, fuelWanted * FLAGSHIP_HOLD.refineVolatilesPerFuel);
          if (used <= 1e-6) return null;
          return { hold: { ...hold, volatiles: have - used }, result: { hold: { ...hold, volatiles: have - used }, fuel: used / FLAGSHIP_HOLD.refineVolatilesPerFuel } };
        })
        .then((res) => {
          if (!res) {
            // Sin volátiles en la bodega: la refinería se apaga.
            this.refining.delete(id);
            return this.sendHold(m);
          }
          m.combat.refill({ fuel: res.fuel, cannon: 0, missiles: 0, hull: 0 }, this.now());
          this.sendSupplies(m, this.now());
          return this.sendHold(m, res.hold);
        })
        .catch((err: unknown) => this.log.error(err, "Error en la refinería de a bordo"))
        .finally(() => (m.refinePending = false));
    }
  }

  /**
   * Grieta del salto cuántico anunciada por un piloto: se reenvía a los demás
   * de su sistema si está junto a su nave. La de llegada puede llegar antes que
   * la nave (se guarda) y solo vale una vez tras tomar los mandos.
   */
  rift(client: Client, notice: RiftNotice): void {
    // Las naves de flota no saltan.
    if (client.piloting) return;
    const m = this.members.get(client.emperorId);
    const now = this.now();
    const piloting = !!m && !m.park && m.clients.has(client);
    if (notice.phase === "arrive" && !piloting) return this.riftArrivals.hold(client.emperorId, notice, now);
    if (!m || !piloting) return;
    if (notice.phase === "arrive" && (m.riftArrived || now - (m.boardedAt ?? 0) > RIFT_ARRIVE_WINDOW_MS)) return;
    this.relayRift(m, notice);
  }

  private relayRift(m: Member, notice: RiftNotice): void {
    if (!riftNear(notice, m.pose.p)) return;
    if (notice.phase === "arrive") m.riftArrived = true;
    const msg: ServerMessage = { t: "rift", id: m.emperorId, phase: notice.phase, at: notice.at, q: notice.q, serverTime: this.now() };
    for (const o of this.rooms.get(m.systemId) ?? []) if (o !== m) this.sendTo(o, msg);
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
        if (!this.members.has(p.emperorId) && this.rooms.get(systemId) === room) this.addParked(systemId, room, p.emperorId, p.name, p.park, p.supplies);
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
    m.dock = null;
    this.dismissEscorts(m.emperorId);
    m.pose = { p, q: m.pose.q, v: parkedVelocity(m.park, now) };
    m.poseAt = now;
    m.dirty = true;
    const id = m.emperorId;
    void this.saveSupplies(id, m.combat);
    if (!isDeepId(m.systemId)) void this.flagships.rememberPosition(id, m.systemId, p).catch((err: unknown) => this.log.error(err, "Error al recordar la posición de una nave"));
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
    await this.rememberPiloted();
    await Promise.all([...this.combatants].filter(([id]) => !id.startsWith("pirate:")).map(([id, c]) => this.saveSupplies(id, c)));
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

  /**
   * Dónde está ahora la nave de un Emperador en el espacio local (pilotada o
   * aparcada en un sistema activo), o null si su sistema no está activo.
   */
  positionOf(emperorId: string): { systemId: string; p: Vec3 } | null {
    const m = this.members.get(emperorId);
    if (!m || m.kind !== "emperor") return null;
    return { systemId: m.systemId, p: m.park ? parkedPosition(m.park, this.now()) : m.pose.p };
  }

  /** Memoria de posición: recuerda dónde están las naves pilotadas, por si el proceso se reinicia o el Emperador renace en otro sitio. */
  private async rememberPiloted(): Promise<void> {
    await Promise.all(
      [...this.members.values()]
        .filter((m) => m.kind === "emperor" && !m.park && !isDeepId(m.systemId))
        .map((m) => this.flagships.rememberPosition(m.emperorId, m.systemId, m.pose.p).catch((err: unknown) => this.log.error(err, "Error al recordar la posición de una nave"))),
    );
  }

  /** La nave deja su sistema (vuelve al mapa, salta —`jump`, entra en su grieta—, se desconecta, cae…). */
  leave(emperorId: string, reason: "left" | "destroyed" | "jump"): void {
    const m = this.members.get(emperorId);
    if (!m) return;
    if (m.kind === "emperor") this.dismissEscorts(emperorId);
    this.members.delete(emperorId);
    const room = this.rooms.get(m.systemId);
    room?.delete(m);
    for (const o of room ?? []) this.sendTo(o, { t: "shipGone", id: emperorId, reason });
    this.sleepIfEmpty(m.systemId);
  }

  /** Crea los piratas que viven en el sistema (los que no estén muertos esperando reaparecer). */
  private spawnPirates(systemId: string, room: Set<Member>): void {
    const specs = piratesOf(systemId);
    const now = this.now();
    specs.forEach((spec, i) => {
      const id = `pirate:${systemId}:${i}`;
      if (this.members.has(id) || (this.deadPirates.get(id) ?? 0) > now) return;
      const cls = getAlienShipClass(spec.classId);
      const layout = this.layout(systemId);
      if (!layout || !cls) return;
      this.deadPirates.delete(id);
      const home = pirateHome(systemId, i, layout, now);
      const combat = new Combatant(cls.hull, cls.combat, now);
      this.combatants.set(id, combat);
      const m: Member = {
        emperorId: id,
        kind: "pirate",
        ai: { home, phase: (i * 0.37) % 1, classId: cls.id, aimJitter: spec.aimJitter },
        radius: Math.max(HIT_RADIUS, cls.model.lengthM * 0.45),
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
    });
  }

  /** Una conexión se cierra o deja de pilotar: si era la última de su nave, la nave se queda aparcada. */
  leaveClient(client: Client): void {
    if (client.piloting) return this.endRemote(client, "left");
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

  /**
   * ¿Puede un disparo de `a` dañar a `b`? Cualquier nave salvo la propia: hay
   * PvP y fuego amigo (petición del usuario, 21-10-2026), así que un proyectil
   * que roza a un compañero o a otro pirata también le hace daño.
   */
  private canHit(a: Member, b: Member): boolean {
    return a !== b;
  }

  /** Posiciones de un objetivo a tener en cuenta: la actual y las recientes (latencia del tirador). */
  private recentPositions(o: Member, now: number): Vec3[] {
    return [o.pose.p, ...o.history.filter((h) => now - h.t <= LAG_COMPENSATION_MS).map((h) => h.p)];
  }

  /** Disparo de la nave de este cliente. Lo que no cumple las reglas se ignora. */
  fire(client: Client, weapon: WeaponKind, dirIn: Vec3, targetId?: string): void {
    const m = this.members.get(this.keyOf(client));
    if (m) this.fireFrom(m, weapon, dirIn, targetId);
  }

  /**
   * Disparo de cualquier nave (jugador o pirata), con las mismas reglas para
   * todas. Cañón: en la dirección `dir`, que para las naves de los Emperadores
   * tiene que estar dentro del cono de sus montajes (`AIM_ASSIST.cannonGimbalDeg`
   * alrededor del morro; la puntería automática del cliente apunta ahí al punto
   * de adelanto). Los piratas llevan torretas (cualquier dirección). Misil: a la
   * nave `target`, cualquiera menos la propia (fijarla es decisión del piloto),
   * a tiro y delante del morro. Los impactos se calculan contra el movimiento
   * de cada nave (no contra una foto fija) y valen para cualquier nave que se
   * cruce en la trayectoria (fuego amigo incluido).
   */
  private fireFrom(m: Member, weapon: WeaponKind, dirIn: Vec3, targetId?: string): void {
    let dir = normalize(dirIn);
    if (!m || !dir) return;
    const room = this.rooms.get(m.systemId);
    if (!room) return;
    const now = this.now();
    const fwd = forwardOf(m.pose.q);

    let target: Member | null = null;
    let hitDistance: number | null = null;
    if (weapon === "missile") {
      // Misil: objetivo fijado, a tiro y delante del morro. Sale hacia él.
      target = targetId ? (this.members.get(targetId) ?? null) : null;
      const def = m.combat.weapons.get("missile")?.def;
      if (!def || !target || target.systemId !== m.systemId || !this.canHit(m, target)) return;
      const d = distance(m.pose.p, target.pose.p);
      const to = normalize([target.pose.p[0] - m.pose.p[0], target.pose.p[1] - m.pose.p[1], target.pose.p[2] - m.pose.p[2]]);
      if (d > def.rangeU || !to || to[0] * fwd[0] + to[1] * fwd[1] + to[2] * fwd[2] < MISSILE_LOCK_COS) return;
      hitDistance = d;
      dir = to;
    } else if (m.kind !== "pirate") {
      // Cañón de una nave pilotada: solo dentro del cono de los montajes.
      if (dir[0] * fwd[0] + dir[1] * fwd[1] + dir[2] * fwd[2] < CANNON_GIMBAL_COS) return;
    }
    const def = m.combat.tryFire(weapon, now);
    if (!def) return;
    // El disparo sale de la boca del arma (alternando entre las de cada lado), no del centro de la nave.
    const muzzle = m.combat.nextMuzzle(weapon);
    const off = rotate(m.pose.q, muzzle.offset);
    const from: Vec3 = [m.pose.p[0] + off[0], m.pose.p[1] + off[1], m.pose.p[2] + off[2]];
    // El proyectil hereda la velocidad de la nave en su dirección (si no, a toda máquina se quedaría atrás).
    const speed = projectileSpeed(def.speedU, m.pose.v, dir);

    if (weapon === "cannon") {
      // Cañón: la primera nave que el proyectil toca (donde está ahora o donde estaba hace un instante, por la latencia del tirador).
      const maxTime = def.rangeU / speed;
      let best: number | null = null;
      for (const o of room) {
        if (!this.canHit(m, o)) continue;
        for (const p of this.recentPositions(o, now)) {
          const t = sweepHit(from, dir, speed, p, o.pose.v, maxTime, o.radius);
          if (t !== null && (best === null || t < best)) {
            best = t;
            target = o;
          }
        }
      }
      hitDistance = best === null ? null : best * speed;
    } else if (target && hitDistance !== null) {
      // Misil: si otra nave se cruza en el camino hacia el blanco, el impacto es suyo.
      const maxTime = hitDistance / speed;
      let best = maxTime;
      for (const o of room) {
        if (o === target || !this.canHit(m, o)) continue;
        const t = sweepHit(from, dir, speed, o.pose.p, o.pose.v, maxTime, o.radius);
        if (t !== null && t < best) {
          best = t;
          target = o;
        }
      }
      hitDistance = best * speed;
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

  /**
   * Nave destruida. Un pirata reaparece al rato. La de un Emperador sale del
   * sistema y el Emperador cae (Fase 10): su cuerpo nuevo se gesta en una Cuna
   * o en el Núcleo Humano; la nave nueva se lee de la base de datos al renacer.
   */
  private async destroy(v: Member, by: string): Promise<void> {
    if (v.kind === "fleet") {
      const clients = [...v.clients];
      this.leave(v.emperorId, "destroyed");
      this.combatants.delete(v.emperorId);
      for (const c of clients) {
        c.piloting = null;
        c.send({ t: "remoteEnded", reason: "destroyed" });
      }
      try {
        await this.fleetShips?.destroyed(v.owner!, v.fleetId!, v.shipId!);
      } catch (err) {
        this.log.error(err, "Error al borrar una nave de flota destruida");
      }
      return;
    }
    if (v.kind === "pirate") {
      this.leave(v.emperorId, "destroyed");
      this.combatants.delete(v.emperorId);
      this.deadPirates.set(v.emperorId, this.now() + PIRATE_AI.respawnSec * 1000);
      return;
    }
    const clients = [...v.clients];
    const systemId = v.systemId;
    this.leave(v.emperorId, "destroyed");
    this.combatants.delete(v.emperorId);
    try {
      const death = await this.onDeath(v.emperorId, systemId, by);
      if (!death) return;
      for (const c of clients) c.send({ t: "destroyed", by, systemId: death.systemId, rebornAt: death.rebornAt });
    } catch (err) {
      this.log.error(err, "Error al registrar la muerte de un Emperador");
    }
  }

  /**
   * Fase 10: la nave de un Emperador cayó en una batalla de flotas por rondas
   * (ya registrada en la base de datos): sale del sistema y su piloto lo sabe.
   */
  kill(emperorId: string, by: string, rebornAt: number, rebirthSystemId: string): void {
    const m = this.members.get(emperorId);
    const clients = m ? [...m.clients] : [];
    this.leave(emperorId, "destroyed");
    this.combatants.delete(emperorId);
    for (const c of clients) c.send({ t: "destroyed", by, systemId: rebirthSystemId, rebornAt });
  }

  /**
   * Fase 10: el Emperador cambió de sitio fuera del pilotaje (renació o se
   * encarnó en un Heredero): su nave deja el sistema donde estuviera y sus
   * recursos se vuelven a leer. Con `fresh` (cuerpo nuevo), también el escudo.
   */
  relocated(emperorId: string, fresh: boolean): void {
    this.leave(emperorId, "left");
    if (fresh) this.combatants.delete(emperorId);
    else this.suppliesChanged(emperorId);
  }

  /** ¿Recibió daño hace poco la nave de este Emperador? (no puede encarnarse en pleno combate). */
  inCombat(emperorId: string): boolean {
    const c = this.combatants.get(emperorId);
    return !!c && c.lastHitAt > 0 && this.now() - c.lastHitAt < LINEAGE.incarnateCombatLockSec * 1000;
  }

  /** Casco en memoria de la nave de un Emperador (o null si no está activa): el del combate de flotas parte de él. */
  liveHull(emperorId: string): number | null {
    const c = this.combatants.get(emperorId);
    return c && c.hasReactor && !c.stale ? c.hull : null;
  }

  /** El combate de flotas por rondas cambió el casco de la nave (ya guardado): se aplica y se difunde. */
  setHull(emperorId: string, hull: number): void {
    const c = this.combatants.get(emperorId);
    if (!c) return;
    c.hull = Math.max(0, Math.min(c.hullMax, hull));
    const m = this.members.get(emperorId);
    if (m) this.broadcastState(m);
  }

  /**
   * Mueve los piratas y los hace disparar cuando tienen a un enemigo delante y a
   * tiro: el cañón a su alcance y, si llevan, misiles (con el blanco delante
   * del morro). Cada clase vuela a su velocidad y a su distancia preferida
   * (los arponeros se pegan, los bombarderos se quedan lejos) y apunta con el
   * error de su nivel de peligro.
   */
  /**
   * IA de los Carroñeros (Fase 9d, reglas en `packages/sim` ai/pirate.ts): la
   * manada de cada sistema elige una presa común (la más débil cerca de ella),
   * cada pirata caza, huye con el casco bajo o se reagrupa hasta recargar el
   * escudo, esquiva cuando le dan y los cuerpos siempre, y no dispara con un
   * compañero en la línea de tiro.
   */
  private stepPirates(now: number): void {
    const dt = TICK_MS / 1000;
    for (const [systemId, room] of this.rooms) {
      const pack = [...room].filter((m) => m.kind === "pirate" && m.ai);
      if (pack.length > 0) {
        // Solo naves pilotadas: una nave aparcada, sin nadie a bordo, no les llama la atención.
        const enemies = [...room].filter((o) => o.kind !== "pirate" && (o.clients.size > 0 || o.escort) && o.combat.hull > 0);
        const preyId = packTarget(
          pack.map((m) => m.pose.p),
          enemies.map((o) => ({ id: o.emperorId, p: o.pose.p, hull: o.combat.hull, shield: o.combat.shield })),
        );
        const obstacles = this.pirateObstacles(systemId, now);
        for (const m of pack) this.stepPirate(m, pack, enemies, preyId, obstacles, dt, now);
      }
      // Reaparecen los que ya cumplieron su espera.
      const any = room.values().next().value as Member | undefined;
      if (any) this.spawnPirates(any.systemId, room);
    }
  }

  /** Lo que los piratas no deben tocar: planetas y lunas (con margen) y la estrella con su zona de calor. */
  private pirateObstacles(systemId: string, now: number): PirateObstacle[] {
    const layout = isDeepId(systemId) ? null : this.layout(systemId);
    if (!layout) return [];
    return bodiesAt(layout, now).map((b) => ({
      center: [b.center[0] ?? 0, b.center[1] ?? 0, b.center[2] ?? 0] as const,
      radius: b.body.kind === "star" && layout.starClass ? b.radius * STAR_HEAT[layout.starClass].zoneRadii : b.radius,
    }));
  }

  private stepPirate(m: Member, pack: Member[], enemies: Member[], preyId: string | null, obstacles: PirateObstacle[], dt: number, now: number): void {
    const ai = m.ai!;
    // El enemigo más cercano (amenaza) y la presa: la de la manada si está a tiro de detección; si no, la más cercana.
    let nearest: Member | null = null;
    let nearestD = Infinity;
    for (const o of enemies) {
      const d = distance(m.pose.p, o.pose.p);
      if (d < nearestD) {
        nearestD = d;
        nearest = o;
      }
    }
    const prey = enemies.find((o) => o.emperorId === preyId);
    let target: Member | null = prey && distance(m.pose.p, prey.pose.p) <= PIRATE_AI.packRadiusU ? prey : nearestD <= PIRATE_AI.aggroRangeU ? nearest : null;
    const underFire = now - m.combat.lastHitAt < PIRATE_AI.underFireSec * 1000;
    ai.mode = nextPirateMode(ai.mode ?? "hunt", m.combat.hull / m.combat.hullMax, m.combat.shieldMax > 0 ? m.combat.shield / m.combat.shieldMax : 1, underFire, nearest ? nearestD : null);
    if (ai.mode !== "hunt") target = null;
    const best = target ? distance(m.pose.p, target.pose.p) : Infinity;
    const flight = pirateFlight(ai.classId);
    const toward = target ? normalize([target.pose.p[0] - m.pose.p[0], target.pose.p[1] - m.pose.p[1], target.pose.p[2] - m.pose.p[2]]) : null;
    const intent = {
      mode: ai.mode,
      threat: nearest?.pose.p ?? null,
      avoid: avoidObstacles(m.pose.p, m.pose.v, obstacles, flight.speedU),
      jink: underFire && toward ? jinkVector(toward, ai.phase, now / 1000, flight.speedU) : null,
    };
    const step = stepPirate(m.pose.p, m.pose.v, ai.home, target?.pose.p ?? null, dt, ai.phase, flight, intent);
    m.pose = step;
    m.poseAt = now;
    m.history.push({ t: now, p: step.p });
    if (m.history.length > HISTORY_SIZE) m.history.shift();
    m.dirty = true;
    if (target) {
      const to = normalize([target.pose.p[0] - step.p[0], target.pose.p[1] - step.p[1], target.pose.p[2] - step.p[2]]);
      // El cañón apunta al punto de adelanto (los impactos se calculan contra el movimiento del blanco).
      const cannonDef = m.combat.weapons.get("cannon")?.def;
      const lead = cannonDef ? leadPoint(step.p, step.v, target.pose.p, target.pose.v, cannonDef.speedU) : null;
      // Puntería imperfecta: de lejos fallan más, de cerca casi nunca.
      const jitter = ai.aimJitter;
      const j = () => (Math.random() - 0.5) * jitter;
      const cannon = m.combat.weapons.get("cannon");
      const aim = lead?.dir ?? to;
      // Disciplina de fuego: nunca con un compañero de manada en la línea de tiro.
      const friends = pack.filter((o) => o !== m).map((o) => o.pose.p);
      if (aim && cannon && best <= cannon.def.rangeU && !friendInLine(step.p, aim, best, friends)) this.fireFrom(m, "cannon", [aim[0] + j(), aim[1] + j(), aim[2] + j()]);
      const missile = m.combat.weapons.get("missile");
      if (to && missile && best <= missile.def.rangeU && (missile.ammo ?? 0) > 0 && now >= missile.readyAt) this.fireFrom(m, "missile", to, target.emperorId);
    }
  }

  /**
   * Reposición: una nave (pilotada o aparcada) junto a un planeta con colonia
   * propia toma combustible y munición de sus existencias, poco a poco.
   */
  private resupplyAll(now: number): void {
    for (const m of this.members.values()) {
      if (m.kind !== "emperor" || !m.combat.hasReactor || m.combat.stale) continue;
      if (m.dock) {
        this.resupplyDocked(m, now);
        continue;
      }
      const cols = m.colonies;
      if (!cols || (!cols.loading && now - cols.at >= COLONIES_REFRESH_MS)) {
        const state: NonNullable<Member["colonies"]> = { list: cols?.list ?? [], at: now, loading: true };
        m.colonies = state;
        void this.flagships
          .coloniesIn(m.emperorId, m.systemId)
          .then((list) => Object.assign(state, { list, loading: false }))
          .catch((err: unknown) => {
            state.loading = false;
            this.log.error(err, "Error al consultar las colonias para reponer");
          });
      }
      if (m.resupplyPending || !m.colonies?.list.length) continue;
      const missing = m.combat.missing(now);
      if (missing.fuel < 0.5 && missing.cannon < 1 && missing.missiles < 1 && missing.hull < 0.5) continue;
      const layout = this.layout(m.systemId);
      if (!layout) continue;
      const near = m.colonies.list.find((c) => {
        const planet = layout.planets.find((p) => p.index === c.planetIndex);
        if (!planet) return false;
        const at = planetPosition(planet, now);
        return distance(m.pose.p, [at.x, at.y, at.z]) - planet.size <= FLAGSHIP_SUPPLIES.resupplyRangeM;
      });
      if (!near) continue;
      const sec = RESUPPLY_MS / 1000;
      const want = {
        fuel: Math.min(missing.fuel, FLAGSHIP_SUPPLIES.resupplyFuelPerSec * sec),
        cannon: Math.min(missing.cannon, Math.ceil(FLAGSHIP_SUPPLIES.resupplyCannonPerSec * sec)),
        missiles: Math.min(missing.missiles, Math.ceil(FLAGSHIP_SUPPLIES.resupplyMissilesPerSec * sec)),
        hull: Math.min(missing.hull, FLAGSHIP_REPAIR.colonyPerSec * sec),
      };
      m.resupplyPending = true;
      void this.flagships
        .resupply(m.emperorId, near.colonyId, want)
        .then((got) => {
          const added = m.combat.refill(got, this.now());
          if (added.fuel > 0 || added.cannon > 0 || added.missiles > 0 || added.hull > 0) {
            m.resupplyingUntil = this.now() + RESUPPLY_MS + 1000;
            this.sendWeapons(m);
            this.sendSupplies(m, this.now());
            if (added.hull > 0) this.broadcastState(m);
            this.onColony(m.emperorId, near.colonyId);
          }
        })
        .catch((err: unknown) => this.log.error(err, "Error al reponer la nave"))
        .finally(() => (m.resupplyPending = false));
    }
  }

  /** Acoplada en una nave nodriza: se repone de la bodega de su flota; si se aleja, se desacopla. */
  private resupplyDocked(m: Member, now: number): void {
    const dock = m.dock!;
    const at = this.dockPoint(m.systemId, dock.slot, dock.colonyPlanet, now);
    if (m.park || !at || distance(m.pose.p, at) > dock.reach * 2) {
      m.dock = null;
      this.sendTo(m, { t: "undocked" });
      return;
    }
    if (m.resupplyPending) return;
    const missing = m.combat.missing(now);
    if (missing.fuel < 0.5 && missing.cannon < 1 && missing.missiles < 1 && missing.hull < 0.5) return;
    const sec = RESUPPLY_MS / 1000;
    const want = {
      fuel: Math.min(missing.fuel, FLAGSHIP_DOCK.fuelPerSec * sec),
      cannon: Math.min(missing.cannon, Math.ceil(FLAGSHIP_DOCK.cannonPerSec * sec)),
      missiles: Math.min(missing.missiles, Math.ceil(FLAGSHIP_DOCK.missilesPerSec * sec)),
      hull: Math.min(missing.hull, FLAGSHIP_DOCK.hullPerSec * sec),
    };
    m.resupplyPending = true;
    void this.flagships
      .resupplyFromFleet(m.emperorId, dock.fleetId, want)
      .then((got) => {
        const added = m.combat.refill(got, this.now());
        if (added.fuel > 0 || added.cannon > 0 || added.missiles > 0 || added.hull > 0) {
          m.resupplyingUntil = this.now() + RESUPPLY_MS + 1000;
          this.sendWeapons(m);
          this.sendSupplies(m, this.now());
          if (added.hull > 0) this.broadcastState(m);
          this.onFleetCargo?.(m.emperorId, dock.fleetId);
        }
      })
      .catch((err: unknown) => this.log.error(err, "Error al reponer la nave en su nave nodriza"))
      .finally(() => (m.resupplyPending = false));
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

  /**
   * Choques entre naves: dos naves que se tocan (suma de sus radios)
   * acercándose reciben daño según la velocidad de acercamiento, como mucho una
   * vez cada `SHIP_COLLISION.cooldownSec` por pareja. El rebote lo hace cada
   * cliente con su nave; los piratas se separan aquí.
   */
  private collideShips(now: number): void {
    for (const room of this.rooms.values()) {
      const list = [...room];
      for (let i = 0; i < list.length; i++) {
        for (let k = i + 1; k < list.length; k++) {
          const a = list[i]!;
          const b = list[k]!;
          if (a.combat.hull <= 0 || b.combat.hull <= 0) continue;
          const d = distance(a.pose.p, b.pose.p);
          const reach = a.radius + b.radius;
          if (d >= reach || d < 1e-3) continue;
          const n: Vec3 = [(b.pose.p[0] - a.pose.p[0]) / d, (b.pose.p[1] - a.pose.p[1]) / d, (b.pose.p[2] - a.pose.p[2]) / d];
          const closing = -((b.pose.v[0] - a.pose.v[0]) * n[0] + (b.pose.v[1] - a.pose.v[1]) * n[1] + (b.pose.v[2] - a.pose.v[2]) * n[2]);
          // Los piratas (los mueve el servidor) se apartan.
          for (const [m, sign] of [[a, -1], [b, 1]] as const) {
            if (m.kind !== "pirate") continue;
            const push = (reach - d) * (a.kind === "pirate" && b.kind === "pirate" ? 0.5 : 1);
            m.pose = { ...m.pose, p: [m.pose.p[0] + n[0] * push * sign, m.pose.p[1] + n[1] * push * sign, m.pose.p[2] + n[2] * push * sign] };
            m.dirty = true;
          }
          if (closing < SHIP_COLLISION.minClosingMps) continue;
          const key = a.emperorId < b.emperorId ? `${a.emperorId}|${b.emperorId}` : `${b.emperorId}|${a.emperorId}`;
          if (now < (this.bumps.get(key) ?? 0)) continue;
          this.bumps.set(key, now + SHIP_COLLISION.cooldownSec * 1000);
          const damage = Math.min(SHIP_COLLISION.maxDamage, closing * SHIP_COLLISION.damagePerMps);
          for (const [victim, other] of [[a, b], [b, a]] as const) {
            const destroyed = victim.combat.damage(damage, now);
            this.broadcastState(victim);
            if (destroyed) void this.destroy(victim, other.kind === "pirate" ? "" : other.name);
          }
        }
      }
    }
    if (this.bumps.size > 256) for (const [key, until] of this.bumps) if (until < now) this.bumps.delete(key);
  }

  /**
   * Calor de las estrellas (`STAR_HEAT`) sobre las naves pilotadas, y el
   * horizonte de sucesos de los agujeros negros, que las destruye al cruzarlo.
   * Las aparcadas orbitan fuera de la zona; los piratas no se acercan.
   */
  private heatShips(now: number): void {
    for (const [systemId, room] of this.rooms) {
      if (isDeepId(systemId)) continue;
      const layout = this.layout(systemId);
      if (!layout?.starClass) continue;
      for (const m of room) {
        if (m.kind === "pirate" || m.park || m.combat.hull <= 0) continue;
        const d = Math.hypot(...m.pose.p);
        if (insideEventHorizon(layout, d)) {
          m.combat.damage(m.combat.hull + m.combat.shield, now);
          void this.destroy(m, HORIZON_CAUSE);
          continue;
        }
        const dps = starHeatDps(layout, d);
        // El estado se difunde con la recarga de escudos (`tick`).
        if (dps > 0 && m.combat.damage((dps * TICK_MS) / 1000, now)) void this.destroy(m, HEAT_CAUSE);
      }
    }
  }

  private tick(): void {
    const now = this.now();
    this.stepPirates(now);
    this.stepEscorts(now);
    this.stepParked(now);
    this.collideShips(now);
    this.heatShips(now);
    if (now - this.lastSuppliesSend >= SUPPLIES_SEND_MS) {
      this.lastSuppliesSend = now;
      for (const m of this.members.values()) if (m.kind === "emperor") this.sendSupplies(m, now);
    }
    if (now - this.lastSuppliesFlush >= SUPPLIES_FLUSH_MS) {
      this.lastSuppliesFlush = now;
      for (const [id, c] of this.combatants) if (!id.startsWith("pirate:")) void this.saveSupplies(id, c);
    }
    if (now - this.lastMemoryFlush >= MEMORY_FLUSH_MS) {
      this.lastMemoryFlush = now;
      void this.rememberPiloted();
    }
    if (now - this.lastResupply >= RESUPPLY_MS) {
      this.lastResupply = now;
      this.resupplyAll(now);
      this.refineAll(now);
    }
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
      // Fase 10: la tripulación repara el casco poco a poco.
      if (m.kind === "emperor") m.combat.repairHull(TICK_MS / 1000, now);
      if (broadcast && (Math.round(m.combat.shield) !== m.sentShield || Math.round(m.combat.hull) !== m.sentHull)) this.broadcastState(m);
    }
  }
}
