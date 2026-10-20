import type { Engine } from "./engine/Engine";

/** Referencia al motor activo, para que la interfaz pueda darle órdenes. */
export const engineRef: { current: Engine | null } = { current: null };
