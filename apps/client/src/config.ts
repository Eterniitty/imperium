import { universeSeedFromString } from "@imperium/procgen";

/**
 * Semilla del universo. En la Fase 4 la enviará el servidor; mientras tanto
 * se lee de VITE_UNIVERSE_SEED (archivo .env en la raíz) o se usa la de alfa.
 */
export const UNIVERSE_SEED_TEXT = import.meta.env.VITE_UNIVERSE_SEED || "imperium-alpha";
export const UNIVERSE_SEED = universeSeedFromString(UNIVERSE_SEED_TEXT);

/** Radio de carga del mapa estelar, en sectores alrededor del foco. */
export const LOAD_RADIUS = 2;

/** Sectores que se generan como máximo por fotograma (evita tirones). */
export const SECTORS_PER_FRAME = 6;

/** Distancia a partir de la cual se recentra el origen de la escena (origen flotante). */
export const REBASE_DISTANCE = 400;
