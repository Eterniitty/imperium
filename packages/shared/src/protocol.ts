/**
 * Protocolo del WebSocket (`/ws`). Mensajes JSON con el campo `t` (tipo); ver
 * docs/arquitectura.md §8. Los esquemas Zod de lo que envía el cliente están en
 * `schemas.ts`.
 */
import type { Emperor } from "./api";

/** Sube si cambia el protocolo de forma incompatible; el servidor rechaza versiones distintas. */
export const PROTOCOL_VERSION = 1;

/** Tamaño máximo de un mensaje del cliente, en bytes. */
export const MAX_CLIENT_MESSAGE_BYTES = 4 * 1024;

/** Tema de suscripción. De momento solo hay uno: todos los Emperadores. */
export type Topic = "emperors";

/** Emperador visto por los demás jugadores: añade si está conectado. */
export interface EmperorView extends Emperor {
  online: boolean;
}

/** Órdenes que el cliente puede dar. */
export interface CommandArgs {
  "emperor.move": { systemId: string };
}
export type CommandOp = keyof CommandArgs;

export type ClientMessage =
  | { [Op in CommandOp]: { t: "cmd"; cmdId: string; op: Op; args: CommandArgs[Op] } }[CommandOp]
  | { t: "sub"; topic: Topic };

/** Motivos por los que se rechaza una orden; el cliente los traduce con `error.*`. */
export type CommandError = "invalid_command" | "unknown_system" | "in_transit" | "already_there" | "no_emperor" | "rate_limited" | "internal";

/** Cambio sobre un tema: `v` es el nuevo valor, o null si desaparece. */
export interface DeltaOp {
  path: `emperors.${string}`;
  v: EmperorView | null;
}

export type ServerMessage =
  /** Primer mensaje tras conectar: quién eres y la hora del servidor (para corregir el reloj local). */
  | { t: "hello"; protocol: number; emperorId: string; serverTime: number }
  /** Estado completo de un tema. `seq` numera los mensajes del tema. */
  | { t: "snap"; topic: Topic; seq: number; serverTime: number; data: { emperors: EmperorView[] } }
  /** Cambios incrementales. Si `seq` no es el siguiente al último recibido, se perdió algo: pide otra `snap`. */
  | { t: "delta"; topic: Topic; seq: number; serverTime: number; ops: DeltaOp[] }
  | { t: "ack"; cmdId: string; ok: true }
  | { t: "ack"; cmdId: string; ok: false; error: CommandError };

/** Códigos de cierre propios del WebSocket (rango 4000-4999). */
export const WS_CLOSE = {
  /** Mensaje mal formado o versión incompatible: no reconectar sin recargar. */
  protocol: 4400,
  /** La sesión ya no es válida: hay que volver a identificarse. */
  unauthorized: 4401,
  /** Demasiados mensajes o conexiones. */
  rateLimited: 4429,
} as const;
