/** Buscador de la Wiki: sin índices externos, sobre el texto de los artículos. */

/** Minúsculas y sin tildes, para comparar «economia» con «Economía». */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface Searchable {
  slug: string;
  title: string;
  text: string;
}

export interface SearchHit {
  slug: string;
  title: string;
  /** Trozo de texto alrededor de la primera coincidencia. */
  snippet: string;
  score: number;
}

/**
 * Artículos que contienen todas las palabras de la consulta, de más a menos
 * relevantes (pesa más aparecer en el título).
 */
export function searchArticles(articles: readonly Searchable[], query: string, limit = 20): SearchHit[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const a of articles) {
    const title = fold(a.title);
    const text = fold(a.text);
    let score = 0;
    let ok = true;
    for (const w of words) {
      const inTitle = title.includes(w);
      let count = 0;
      for (let i = text.indexOf(w); i !== -1 && count < 50; i = text.indexOf(w, i + w.length)) count++;
      if (!inTitle && count === 0) {
        ok = false;
        break;
      }
      score += (inTitle ? 20 : 0) + count;
    }
    if (!ok) continue;
    hits.push({ slug: a.slug, title: a.title, snippet: snippet(a.text, text, words), score });
  }
  return hits.sort((x, y) => y.score - x.score || x.title.localeCompare(y.title)).slice(0, limit);
}

/** Unos 160 caracteres alrededor de la primera palabra encontrada (el texto plegado mide lo mismo que el original). */
function snippet(original: string, folded: string, words: string[]): string {
  const flat = original.replace(/\s+/g, " ");
  const flatFolded = folded.replace(/\s+/g, " ");
  let at = -1;
  for (const w of words) {
    const i = flatFolded.indexOf(w);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return flat.slice(0, 160).trim() + (flat.length > 160 ? "…" : "");
  const start = Math.max(0, at - 60);
  const end = Math.min(flat.length, at + 100);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}
