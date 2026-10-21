/**
 * Textos de los artículos. Los del repositorio son `content/<idioma>/<slug>.md`,
 * cargados al compilar; los textos de la interfaz de la Wiki sí son claves i18n.
 *
 * Los administradores pueden editarlos desde la Wiki: la API (`GET /api/wiki`)
 * da la versión publicada de cada artículo editado (su última revisión), los
 * artículos nuevos y los ocultos (`WikiRemote`). Sin API (sin sesión, caída…)
 * se usa lo del repositorio, así que la Wiki sigue siendo una página estática.
 */
import type { Locale, WikiPageMeta, WikiPublished, WikiStateResponse } from "@imperium/shared";
import { articleTitle, blocksText, parseMarkdown, type Block } from "./markdown";
import { WIKI_ARTICLES, WIKI_GROUPS, type WikiGroup } from "./slugs";
import { generatedText } from "./tables";

const files = import.meta.glob<string>("./content/*/*.md", { query: "?raw", import: "default", eager: true });

export interface WikiArticle {
  slug: string;
  title: string;
  blocks: Block[];
  /** Texto plano, para el buscador. */
  text: string;
}

/** Lo que dice la API: artículos guardados, versiones publicadas (por `idioma/slug`) y si la sesión es de un administrador. */
export interface WikiRemote {
  pages: WikiPageMeta[];
  published: ReadonlyMap<string, WikiPublished>;
  admin: boolean;
}

export const EMPTY_REMOTE: WikiRemote = { pages: [], published: new Map(), admin: false };

export const sourceKey = (locale: Locale, slug: string) => `${locale}/${slug}`;

export function remoteFrom(res: WikiStateResponse): WikiRemote {
  return { pages: res.pages, published: new Map(res.published.map((p) => [sourceKey(p.locale, p.slug), p])), admin: res.admin };
}

/** Copia de `remote` con una versión publicada nueva (tras guardar). */
export function withPublished(remote: WikiRemote, p: WikiPublished): WikiRemote {
  const published = new Map(remote.published);
  published.set(sourceKey(p.locale, p.slug), p);
  return { ...remote, published };
}

/** Copia de `remote` con los datos nuevos de un artículo. */
export function withPage(remote: WikiRemote, page: WikiPageMeta): WikiRemote {
  return { ...remote, pages: [...remote.pages.filter((p) => p.slug !== page.slug), page] };
}

/** Markdown del repositorio de un artículo (o null si falta en ese idioma). */
export function articleSource(locale: Locale, slug: string): string | null {
  return files[`./content/${locale}/${slug}.md`] ?? null;
}

/** Markdown publicado: la última revisión si la hay; si no, el del repositorio. */
export function publishedSource(locale: Locale, slug: string, remote: WikiRemote = EMPTY_REMOTE): string | null {
  return remote.published.get(sourceKey(locale, slug))?.body ?? articleSource(locale, slug);
}

const cache = new Map<string, { src: string; article: WikiArticle }>();

/** Artículo ya interpretado; sin texto en ese idioma, el español. */
export function getArticle(locale: Locale, slug: string, remote: WikiRemote = EMPTY_REMOTE): WikiArticle | null {
  const src = publishedSource(locale, slug, remote) ?? (locale !== "es" ? publishedSource("es", slug, remote) : null);
  if (src === null) return null;
  const key = sourceKey(locale, slug);
  const hit = cache.get(key);
  if (hit && hit.src === src) return hit.article;
  const article = buildArticle(locale, slug, src);
  cache.set(key, { src, article });
  return article;
}

/** Interpreta un Markdown (también la vista previa del editor). */
export function buildArticle(locale: Locale, slug: string, src: string): WikiArticle {
  const blocks = parseMarkdown(src);
  return { slug, title: articleTitle(blocks) || slug, blocks, text: blocksText(blocks, (b) => generatedText(b.t, b.id, locale)) };
}

/** Un artículo en el índice. */
export interface WikiEntry {
  slug: string;
  group: WikiGroup;
  hidden: boolean;
  custom: boolean;
}

/**
 * Índice de la Wiki: los del repositorio (con su grupo cambiado u ocultos, si
 * se guardó) y, tras ellos en cada grupo, los creados desde el panel. Los
 * ocultos solo salen con `includeHidden` (administradores).
 */
export function wikiIndex(remote: WikiRemote = EMPTY_REMOTE, includeHidden = false): WikiEntry[] {
  const saved = new Map(remote.pages.map((p) => [p.slug, p]));
  const base: WikiEntry[] = WIKI_ARTICLES.map((a) => {
    const p = saved.get(a.slug);
    return { slug: a.slug, group: p?.group ?? a.group, hidden: p?.hidden ?? false, custom: false };
  });
  const custom: WikiEntry[] = remote.pages
    .filter((p) => p.custom && !WIKI_ARTICLES.some((a) => a.slug === p.slug))
    .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))
    .map((p) => ({ slug: p.slug, group: p.group, hidden: p.hidden, custom: true }));
  const out: WikiEntry[] = [];
  for (const g of WIKI_GROUPS) {
    for (const e of [...base, ...custom]) if (e.group === g && (includeHidden || !e.hidden)) out.push(e);
  }
  return out;
}

export function allArticles(locale: Locale, remote: WikiRemote = EMPTY_REMOTE, includeHidden = false): WikiArticle[] {
  return wikiIndex(remote, includeHidden)
    .map((e) => getArticle(locale, e.slug, remote))
    .filter((a): a is WikiArticle => a !== null);
}
