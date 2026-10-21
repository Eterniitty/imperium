/**
 * Textos de los artículos: `content/<idioma>/<slug>.md`, cargados al compilar.
 * Los artículos largos viven en Markdown (más fácil de mantener que claves
 * i18n sueltas); los textos de la interfaz de la Wiki sí son claves i18n.
 */
import type { Locale } from "@imperium/shared";
import { articleTitle, blocksText, parseMarkdown, type Block } from "./markdown";
import { WIKI_ARTICLES, type WikiSlug } from "./slugs";
import { generatedText } from "./tables";

const files = import.meta.glob<string>("./content/*/*.md", { query: "?raw", import: "default", eager: true });

export interface WikiArticle {
  slug: WikiSlug;
  title: string;
  blocks: Block[];
  /** Texto plano, para el buscador. */
  text: string;
}

const cache = new Map<string, WikiArticle | null>();

/** Markdown en bruto de un artículo (o null si falta en ese idioma). */
export function articleSource(locale: Locale, slug: string): string | null {
  return files[`./content/${locale}/${slug}.md`] ?? null;
}

export function getArticle(locale: Locale, slug: WikiSlug): WikiArticle | null {
  const key = `${locale}/${slug}`;
  if (!cache.has(key)) {
    const src = articleSource(locale, slug) ?? (locale !== "es" ? articleSource("es", slug) : null);
    if (src === null) cache.set(key, null);
    else {
      const blocks = parseMarkdown(src);
      cache.set(key, { slug, title: articleTitle(blocks) || slug, blocks, text: blocksText(blocks, (b) => generatedText(b.t, b.id, locale)) });
    }
  }
  return cache.get(key)!;
}

export function allArticles(locale: Locale): WikiArticle[] {
  return WIKI_ARTICLES.map((a) => getArticle(locale, a.slug)).filter((a): a is WikiArticle => a !== null);
}
