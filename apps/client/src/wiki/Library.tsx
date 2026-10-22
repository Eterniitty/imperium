import { useState, type ReactNode } from "react";
import { WIKI_BYLINE_KINDS, type Locale, type WikiBylineKind } from "@imperium/shared";
import { sourceKey, type WikiEntry, type WikiRemote } from "./articles";
import type { T } from "./render";

/** Slug de la biblioteca (no es un artículo: es el catálogo de los libros). */
export const LIBRARY_SLUG = "biblioteca";
/** Libros por página (se cargan más con «Mostrar más»). */
const PAGE = 24;

/** Color del lomo según el tipo de libro. */
const KIND_COLOR: Record<WikiBylineKind, string> = {
  written: "#8a6a3a",
  memoirs: "#6f4e7c",
  attributed: "#5c6f7c",
  transcript: "#4f7c6a",
  anonymous: "#555b66",
  compiled: "#7c6a3f",
  translated: "#3f6a7c",
  oral: "#7c4f3f",
  fragment: "#6a6a6a",
  diary: "#7c3f5c",
  letter: "#a07a3a",
  report: "#3f4f7c",
};

interface Book {
  slug: string;
  title: string;
  author: string;
  kind: WikiBylineKind;
  at: number;
}

function booksOf(entries: WikiEntry[], remote: WikiRemote, locale: Locale, titleOf: (s: string) => string): Book[] {
  return entries
    .filter((e) => e.group === "books")
    .map((e) => ({ slug: e.slug, title: titleOf(e.slug), author: e.byline ?? "", kind: e.bylineKind ?? "written", at: remote.published.get(sourceKey(locale, e.slug))?.at ?? 0 }));
}

/** Un lomo: título, autor y tipo, con su color. */
function Spine({ b, t, link }: { b: Book; t: T; link: (slug: string, children: ReactNode, className?: string) => ReactNode }) {
  return (
    <div style={{ display: "contents" }}>
      {link(
        b.slug,
        <span className="wiki-spine-inner" style={{ display: "contents" }}>
          <span className="wiki-spine-kind">{t(`wiki.bylineKind.${b.kind}`)}</span>
          <strong>{b.title}</strong>
          {b.author && <small>{b.author}</small>}
        </span>,
        "wiki-spine",
      )}
    </div>
  );
}

/**
 * Biblioteca de la Wiki: con cientos de libros, en vez de una lista, un
 * catálogo con buscador (título o autor), filtro por tipo, orden y carga por
 * páginas, en lomos de colores. Solo maquetación: el texto de los libros no se toca.
 */
export function Library({ entries, remote, locale, t, titleOf, link }: { entries: WikiEntry[]; remote: WikiRemote; locale: Locale; t: T; titleOf: (s: string) => string; link: (slug: string, children: ReactNode, className?: string) => ReactNode }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<WikiBylineKind | "">("");
  const [sort, setSort] = useState<"title" | "new">("title");
  const [shown, setShown] = useState(PAGE);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const all = booksOf(entries, remote, locale, titleOf);
  const list = all
    .filter((b) => (!kind || b.kind === kind) && (!q.trim() || norm(`${b.title} ${b.author}`).includes(norm(q.trim()))))
    .sort((a, b) => (sort === "new" ? b.at - a.at : a.title.localeCompare(b.title, locale)));
  return (
    <section className="wiki-article wiki-library">
      <h1>{t("wiki.library")}</h1>
      <p className="muted">{t("wiki.library.count", { n: list.length })}</p>
      <div className="wiki-library-tools">
        <input type="search" value={q} placeholder={t("wiki.library.search")} aria-label={t("wiki.library.search")} onChange={(e) => (setQ(e.target.value), setShown(PAGE))} />
        <select value={kind} onChange={(e) => (setKind(e.target.value as WikiBylineKind | ""), setShown(PAGE))} aria-label={t("wiki.edit.bylineKind")}>
          <option value="">{t("wiki.library.allKinds")}</option>
          {WIKI_BYLINE_KINDS.filter((k) => all.some((b) => b.kind === k)).map((k) => (
            <option key={k} value={k}>
              {t(`wiki.bylineKind.${k}`)}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as "title" | "new")}>
          <option value="title">{t("wiki.library.sort.title")}</option>
          <option value="new">{t("wiki.library.sort.new")}</option>
        </select>
      </div>
      {list.length === 0 ? (
        <p className="muted">{t("wiki.library.empty")}</p>
      ) : (
        <div className="wiki-shelf">
          {list.slice(0, shown).map((b) => (
            <div key={b.slug} className="wiki-spine-wrap" style={{ ["--spine" as string]: KIND_COLOR[b.kind], display: "contents" }}>
              <Spine b={b} t={t} link={link} />
            </div>
          ))}
        </div>
      )}
      {list.length > shown && (
        <p>
          <button className="wiki-btn" onClick={() => setShown(shown + PAGE)}>
            {t("wiki.library.more")}
          </button>
        </p>
      )}
    </section>
  );
}

/** Libros relacionados (mismo tipo o, si no hay, cualquiera), al final de cada libro. */
export function RelatedBooks({ slug, entries, remote, locale, t, titleOf, link }: { slug: string; entries: WikiEntry[]; remote: WikiRemote; locale: Locale; t: T; titleOf: (s: string) => string; link: (slug: string, children: ReactNode, className?: string) => ReactNode }) {
  const all = booksOf(entries, remote, locale, titleOf);
  const me = all.find((b) => b.slug === slug);
  if (!me) return null;
  const others = all.filter((b) => b.slug !== slug);
  const same = others.filter((b) => b.kind === me.kind || (me.author && b.author === me.author));
  const pick = (same.length ? same : others).slice(0, 4);
  if (pick.length === 0) return null;
  return (
    <aside className="wiki-related">
      <h2>{t("wiki.library.related")}</h2>
      <div className="wiki-shelf">
        {pick.map((b) => (
          <div key={b.slug} style={{ ["--spine" as string]: KIND_COLOR[b.kind], display: "contents" }}>
            <Spine b={b} t={t} link={link} />
          </div>
        ))}
      </div>
    </aside>
  );
}
