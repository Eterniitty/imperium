/**
 * Grietas del salto cuántico: solo visuales, pero las ven todos los del
 * sistema. El piloto anuncia la suya (`rift` del cliente) y el servidor la
 * reenvía a los demás de la sala, con la misma visibilidad que las posiciones.
 * Aquí, sin red: comprobar que la grieta está junto a la nave y guardar la de
 * llegada hasta que la nave entre en el sistema (llega antes que su primera
 * posición).
 */
import { FLAGSHIP_LENGTH_M, QUANTUM_RIFT } from "@imperium/content";
import type { Quat, RiftPhase, Vec3 } from "@imperium/shared";
import { distance } from "./combat";

export interface RiftNotice {
  phase: RiftPhase;
  at: Vec3;
  q: Quat;
}

/** Distancia máxima (m) entre la grieta y la nave que la abre. */
export const RIFT_MAX_OFFSET = FLAGSHIP_LENGTH_M * QUANTUM_RIFT.maxOffsetLengths;
/** Una grieta de llegada se guarda (y se acepta tras tomar los mandos) durante este tiempo. */
export const RIFT_ARRIVE_WINDOW_MS = 20_000;

/** ¿Está la grieta junto a la nave (y su orientación es un cuaternión)? */
export function riftNear(notice: RiftNotice, shipAt: Vec3): boolean {
  const [x, y, z, w] = notice.q;
  const len = Math.hypot(x, y, z, w);
  return len > 0.9 && len < 1.1 && distance(notice.at, shipAt) <= RIFT_MAX_OFFSET;
}

/** Grietas de llegada anunciadas antes de que la nave esté en el sistema. */
export class PendingArrivals {
  private readonly held = new Map<string, { notice: RiftNotice; until: number }>();

  hold(emperorId: string, notice: RiftNotice, now: number): void {
    this.held.set(emperorId, { notice, until: now + RIFT_ARRIVE_WINDOW_MS });
    // Limpieza perezosa: no se acumulan grietas de quien nunca llegó a entrar.
    if (this.held.size > 256) for (const [id, h] of this.held) if (h.until < now) this.held.delete(id);
  }

  take(emperorId: string, now: number): RiftNotice | null {
    const h = this.held.get(emperorId);
    this.held.delete(emperorId);
    return h && h.until >= now ? h.notice : null;
  }
}
