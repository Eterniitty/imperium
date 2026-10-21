/**
 * Artículos de la Wiki, en el orden del índice. Sin dependencias de Vite: lo
 * importa también `vite.config.ts` para crear una página por artículo al
 * compilar (`/wiki/<slug>/index.html`), así Caddy las sirve como archivos
 * estáticos sin reglas especiales.
 *
 * Para añadir un artículo: su slug aquí y un `<slug>.md` en `content/es` y en
 * `content/en` (los tests comprueban que no falte ninguno).
 */
export const WIKI_GROUPS = ["start", "world", "ship", "empire", "war", "people"] as const;
export type WikiGroup = (typeof WIKI_GROUPS)[number];

export const WIKI_ARTICLES = [
  { slug: "inicio", group: "start" },
  { slug: "primeros-pasos", group: "start" },
  { slug: "leyes", group: "start" },
  { slug: "universo", group: "world" },
  { slug: "niebla", group: "world" },
  { slug: "pilotar", group: "ship" },
  { slug: "combate", group: "ship" },
  { slug: "linaje", group: "ship" },
  { slug: "humanos", group: "empire" },
  { slug: "colonias", group: "empire" },
  { slug: "economia", group: "empire" },
  { slug: "humanidad", group: "empire" },
  { slug: "mercado", group: "empire" },
  { slug: "flotas", group: "empire" },
  { slug: "naves", group: "empire" },
  { slug: "guerra", group: "war" },
  { slug: "conquista", group: "war" },
  { slug: "carroneros", group: "war" },
  { slug: "companeros", group: "people" },
  { slug: "cuenta", group: "people" },
  { slug: "especies", group: "people" },
  { slug: "naves-alienigenas", group: "people" },
  { slug: "ia-territorios", group: "people" },
  { slug: "lore", group: "people" },
] as const satisfies ReadonlyArray<{ slug: string; group: WikiGroup }>;

export type WikiSlug = (typeof WIKI_ARTICLES)[number]["slug"];

export const WIKI_HOME: WikiSlug = "inicio";

export function isWikiSlug(s: string): s is WikiSlug {
  return WIKI_ARTICLES.some((a) => a.slug === s);
}

/** Artículo de una ruta: `/wiki`, `/wiki/`, `/wiki/economia`, `/wiki/economia/`. Null si no es de la Wiki o no existe. */
export function slugFromPath(pathname: string): WikiSlug | null {
  const m = /^\/wiki(?:\/([^/]*))?\/?$/.exec(pathname);
  if (!m) return null;
  const s = decodeURIComponent(m[1] ?? "");
  if (s === "") return WIKI_HOME;
  return isWikiSlug(s) ? s : null;
}

/** Ruta de un artículo (la portada, `/wiki/`). */
export function wikiPath(slug: WikiSlug): string {
  return slug === WIKI_HOME ? "/wiki/" : `/wiki/${slug}/`;
}
