/**
 * Artículos de la Wiki y sus rutas. La lista del repositorio vive en
 * `@imperium/shared/wiki` (la usa también el servidor, para el panel de
 * edición); este archivo no depende de Vite: lo importa `vite.config.ts` para
 * crear una página por artículo al compilar (`/wiki/<slug>/index.html`), así
 * Caddy las sirve como archivos estáticos sin reglas especiales.
 *
 * Para añadir un artículo al repositorio: su slug en `packages/shared/src/wiki.ts`
 * y un `<slug>.md` en `content/es` y en `content/en` (los tests comprueban que no
 * falte ninguno). Los artículos creados desde el panel de edición no tienen
 * página propia en `dist`: su ruta es `/wiki/?p=<slug>`.
 */
import { isValidWikiSlug, isWikiSlug, WIKI_HOME, type WikiSlug } from "@imperium/shared/wiki";

export { WIKI_ARTICLES, WIKI_GROUPS, WIKI_HOME, isWikiSlug, type WikiGroup, type WikiSlug } from "@imperium/shared/wiki";

/** Artículo del repositorio de una ruta: `/wiki`, `/wiki/`, `/wiki/economia`, `/wiki/economia/`. Null si no es de la Wiki o no existe. */
export function slugFromPath(pathname: string): WikiSlug | null {
  const s = routeSlug(pathname);
  return s !== null && isWikiSlug(s) ? s : null;
}

/**
 * Slug de una ruta de la Wiki, exista o no (puede ser un artículo creado desde
 * el panel de edición): `/wiki/<slug>/` o `/wiki/?p=<slug>`. Null si la ruta no
 * es de la Wiki o el slug no tiene forma válida.
 */
export function routeSlug(pathname: string, search = ""): string | null {
  const m = /^\/wiki(?:\/([^/]*))?\/?$/.exec(pathname);
  if (!m) return null;
  let s = "";
  try {
    s = decodeURIComponent(m[1] ?? "");
  } catch {
    return null;
  }
  if (s === "") {
    const p = new URLSearchParams(search).get("p");
    if (p) return isValidWikiSlug(p) ? p : null;
    return WIKI_HOME;
  }
  return isValidWikiSlug(s) ? s : null;
}

/** Ruta de un artículo: la portada es `/wiki/`; los del repositorio, `/wiki/<slug>/`; los nuevos, `/wiki/?p=<slug>`. */
export function wikiPath(slug: string): string {
  if (slug === WIKI_HOME) return "/wiki/";
  return isWikiSlug(slug) ? `/wiki/${slug}/` : `/wiki/?p=${encodeURIComponent(slug)}`;
}
