import { generateToken, hashToken } from "../auth/tokens";

/** Validez de un ticket: lo justo para abrir la conexión. */
export const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 10_000;

export interface TicketOwner {
  accountId: string;
  emperorId: string;
}

/**
 * Tickets de un solo uso para abrir el WebSocket. Se piden por HTTP con la
 * cookie de sesión y se presentan al conectar, así la sesión no viaja en la URL.
 * En memoria (un solo proceso de servidor) y solo con el hash, como los enlaces.
 */
export class TicketStore {
  private readonly tickets = new Map<string, TicketOwner & { expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(owner: TicketOwner): string | null {
    const t = this.now();
    for (const [hash, entry] of this.tickets) if (entry.expiresAt <= t) this.tickets.delete(hash);
    // Ante una avalancha, mejor rechazar que agotar la memoria.
    if (this.tickets.size >= MAX_TICKETS) return null;
    const ticket = generateToken();
    this.tickets.set(hashToken(ticket), { ...owner, expiresAt: t + TICKET_TTL_MS });
    return ticket;
  }

  /** Gasta el ticket. Devuelve su dueño, o null si no existe, ya se usó o caducó. */
  consume(ticket: string): TicketOwner | null {
    const hash = hashToken(ticket);
    const entry = this.tickets.get(hash);
    if (!entry) return null;
    this.tickets.delete(hash);
    return entry.expiresAt > this.now() ? { accountId: entry.accountId, emperorId: entry.emperorId } : null;
  }
}
