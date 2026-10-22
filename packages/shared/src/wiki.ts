/**
 * Wiki: artículos del repositorio y tipos de su API de edición. Sin
 * dependencias (lo importa también `apps/client/vite.config.ts` a través de
 * `apps/client/src/wiki/slugs.ts`, para crear una página por artículo).
 *
 * Los artículos del repositorio son `apps/client/src/wiki/content/<idioma>/<slug>.md`.
 * Los administradores pueden editarlos desde la propia Wiki: cada edición es una
 * revisión en la base de datos (`wiki_revisions`, solo inserción) y la versión
 * publicada es la última revisión de cada artículo e idioma o, si no hay
 * ninguna, el Markdown del repositorio. También pueden crear artículos nuevos y
 * ocultar cualquiera (`wiki_pages`).
 */
import type { Locale } from "./i18n/index";

export const WIKI_GROUPS = ["start", "world", "ship", "empire", "war", "people", "lore", "books"] as const;
/**
 * Tipo de atribución de un libro (la frase la forma el idioma: «Escrito por X»,
 * «Extracto de las memorias de X», «Relato anónimo»…). También sirve de
 * categoría en la biblioteca.
 */
export const WIKI_BYLINE_KINDS = ["written", "memoirs", "attributed", "transcript", "anonymous", "compiled", "translated", "oral", "fragment", "diary", "letter", "report"] as const;
export type WikiBylineKind = (typeof WIKI_BYLINE_KINDS)[number];
export type WikiGroup = (typeof WIKI_GROUPS)[number];

/** Artículos del repositorio, en el orden del índice. Para añadir uno: su slug aquí y un `.md` en cada idioma. */
export const WIKI_ARTICLES = [
  { slug: "inicio", group: "start" },
  { slug: "primeros-pasos", group: "start" },
  { slug: "leyes", group: "start" },
  { slug: "universo", group: "world" },
  { slug: "niebla", group: "world" },
  { slug: "pilotar", group: "ship" },
  { slug: "combate", group: "ship" },
  { slug: "linaje", group: "ship" },
  { slug: "espacio-profundo", group: "ship" },
  { slug: "humanos", group: "empire" },
  { slug: "colonias", group: "empire" },
  { slug: "economia", group: "empire" },
  { slug: "humanidad", group: "empire" },
  { slug: "mercado", group: "empire" },
  { slug: "flotas", group: "empire" },
  { slug: "naves", group: "empire" },
  { slug: "astillero", group: "empire" },
  { slug: "fabricacion", group: "empire" },
  { slug: "tecnologia", group: "empire" },
  { slug: "metas", group: "empire" },
  { slug: "contratos", group: "empire" },
  { slug: "guerra", group: "war" },
  { slug: "conquista", group: "war" },
  { slug: "carroneros", group: "war" },
  { slug: "companeros", group: "people" },
  { slug: "cuenta", group: "people" },
  { slug: "especies", group: "people" },
  { slug: "naves-alienigenas", group: "people" },
  { slug: "ia-territorios", group: "people" },
  { slug: "lore", group: "lore" },
] as const satisfies ReadonlyArray<{ slug: string; group: WikiGroup }>;

export type WikiSlug = (typeof WIKI_ARTICLES)[number]["slug"];

export const WIKI_HOME: WikiSlug = "inicio";

export function isWikiSlug(s: string): s is WikiSlug {
  return WIKI_ARTICLES.some((a) => a.slug === s);
}

/** Forma de un slug: minúsculas, cifras y guiones sueltos (`naves-alienigenas`). */
export const WIKI_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const WIKI_SLUG_MAX = 48;
/** Tamaño máximo del Markdown de un artículo, en caracteres (el más largo del repositorio ronda los 6000). */
export const WIKI_BODY_MAX = 60_000;
export const WIKI_NOTE_MAX = 200;
export const WIKI_TITLE_MAX = 80;
/** Firma de un artículo (sobre todo de los libros): «Lyra Venn, Emperatriz del Velo». */
export const WIKI_BYLINE_MAX = 120;

export function isValidWikiSlug(s: string): boolean {
  return s.length > 0 && s.length <= WIKI_SLUG_MAX && WIKI_SLUG_RE.test(s);
}

/** Datos guardados de un artículo: los nuevos y los del repositorio a los que se cambió el grupo o se ocultaron. */
export interface WikiPageMeta {
  slug: string;
  group: WikiGroup;
  hidden: boolean;
  /** Creado desde el panel de edición (no está en el repositorio). */
  custom: boolean;
  /** Orden de los artículos nuevos dentro de su grupo (van tras los del repositorio). */
  position: number;
  /** Firma que se muestra bajo el título (los libros llevan su autor), o null. */
  byline: string | null;
  /** Cómo se atribuye (null: «Escrito por»). */
  bylineKind: WikiBylineKind | null;
}

/** Versión publicada (última revisión) de un artículo en un idioma. */
export interface WikiPublished {
  slug: string;
  locale: Locale;
  revisionId: number;
  body: string;
  /** Fecha de la revisión (ms). */
  at: number;
}

/**
 * Respuesta de `GET /api/wiki` (pública): artículos guardados y versiones
 * publicadas. Los ocultos salen en `pages`, pero su texto solo se envía a los
 * administradores.
 */
export interface WikiStateResponse {
  pages: WikiPageMeta[];
  published: WikiPublished[];
  admin: boolean;
}

/** Respuesta de `GET /api/wiki/me`: si la sesión es de un administrador (lo decide el servidor). */
export interface WikiMeResponse {
  admin: boolean;
}

/** Una revisión en el historial (solo administradores). */
export interface WikiRevisionInfo {
  id: number;
  slug: string;
  locale: Locale;
  note: string;
  /** Nombre del Emperador o correo enmascarado de quien la hizo; null si su cuenta se borró. */
  author: string | null;
  at: number;
  /** Caracteres del texto. */
  size: number;
  /** Revisión restaurada, si esta es una restauración. */
  restoredFrom: number | null;
}

/** Respuesta de `GET /api/wiki/history?slug=&locale=`. */
export interface WikiHistoryResponse {
  revisions: WikiRevisionInfo[];
}

/** Respuesta de `GET /api/wiki/revisions/:id`. */
export interface WikiRevisionResponse {
  revision: WikiRevisionInfo & { body: string };
}

/** Respuesta de `POST /api/wiki/save` y `POST /api/wiki/restore`. */
export interface WikiSaveResponse {
  published: WikiPublished;
}

/** Respuesta de `POST /api/wiki/create` y `POST /api/wiki/meta`. */
export interface WikiPageResponse {
  page: WikiPageMeta;
  published?: WikiPublished;
}
