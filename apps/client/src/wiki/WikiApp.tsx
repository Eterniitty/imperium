import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { BASE_LOCALES, translate, type I18nKey, type Locale } from "@imperium/shared";
import { allArticles, getArticle } from "./articles";
import { anchorId as anchorFor, type Block, type Inline } from "./markdown";
import { searchArticles } from "./search";
import { buildCards, buildTable } from "./tables";
import { WIKI_ARTICLES, WIKI_GROUPS, slugFromPath, wikiPath, isWikiSlug, type WikiSlug } from "./slugs";

/** Misma clave que el juego: el idioma elegido allí vale aquí y al revés. */
const LOCALE_KEY = "imperium.locale";

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch {
    // Sin almacenamiento: el idioma del navegador.
  }
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

type T = (key: I18nKey, params?: Record<string, string | number>) => string;

/** Ruta interna de un enlace del Markdown (`/wiki/economia#instalaciones`), o null si es externo. */
function internalHref(href: string): { slug: WikiSlug; hash: string; url: string } | null {
  if (!href.startsWith("/wiki")) return null;
  const [path, hash = ""] = href.split("#");
  const slug = slugFromPath(path!);
  if (!slug) return null;
  return { slug, hash, url: wikiPath(slug) + (hash ? `#${hash}` : "") };
}

function InlineView({ c, go }: { c: Inline[]; go: (url: string) => void }) {
  return (
    <>
      {c.map((i, n) => {
        switch (i.t) {
          case "text":
            return i.v;
          case "strong":
            return (
              <strong key={n}>
                <InlineView c={i.c} go={go} />
              </strong>
            );
          case "em":
            return (
              <em key={n}>
                <InlineView c={i.c} go={go} />
              </em>
            );
          case "code":
            return <code key={n}>{i.v}</code>;
          case "kbd":
            return <kbd key={n}>{i.v}</kbd>;
          case "link": {
            const internal = internalHref(i.href);
            if (internal)
              return (
                <a
                  key={n}
                  href={internal.url}
                  onClick={(e: MouseEvent) => {
                    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    go(internal.url);
                  }}
                >
                  <InlineView c={i.c} go={go} />
                </a>
              );
            const same = i.href.startsWith("#") || i.href.startsWith("/");
            return (
              <a key={n} href={i.href} {...(same ? {} : { target: "_blank", rel: "noopener" })}>
                <InlineView c={i.c} go={go} />
              </a>
            );
          }
        }
      })}
    </>
  );
}

function BlockView({ b, t, locale, go }: { b: Block; t: T; locale: Locale; go: (url: string) => void }): ReactNode {
  switch (b.t) {
    case "h": {
      const H = `h${b.level}` as "h1" | "h2" | "h3";
      return (
        <H id={b.id}>
          <InlineView c={b.c} go={go} />
          {b.level > 1 && (
            <a className="wiki-anchor" href={`#${b.id}`} aria-hidden tabIndex={-1}>
              #
            </a>
          )}
        </H>
      );
    }
    case "p":
      return (
        <p>
          <InlineView c={b.c} go={go} />
        </p>
      );
    case "ul":
    case "ol": {
      const L = b.t;
      return (
        <L>
          {b.items.map((it, n) => (
            <li key={n}>
              <InlineView c={it} go={go} />
            </li>
          ))}
        </L>
      );
    }
    case "quote":
      return (
        <div className={`wiki-callout wiki-callout-${b.kind}`} role={b.kind === "quote" ? undefined : "note"}>
          {b.kind !== "quote" && <span className="wiki-callout-label">{t(b.kind === "dev" ? "wiki.inDevelopment" : "wiki.note")}</span>}
          <InlineView c={b.c} go={go} />
        </div>
      );
    case "table":
      return (
        <div className="wiki-table-wrap">
          <table>
            <thead>
              <tr>
                {b.head.map((h, n) => (
                  <th key={n}>
                    <InlineView c={h} go={go} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, n) => (
                <tr key={n}>
                  {r.map((c, m) => (
                    <td key={m}>
                      <InlineView c={c} go={go} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "cards": {
      const cards = buildCards(b.id, locale);
      if (!cards) return null;
      return (
        <div className="wiki-cards" data-cards={b.id}>
          {cards.map((c) => (
            <section key={c.title} className="wiki-card">
              <header>
                <h3 id={anchorFor(c.title)}>{c.title}</h3>
                <span className="wiki-badge">{c.badge}</span>
              </header>
              <p className="wiki-card-motto">{c.subtitle}</p>
              <p>{c.text}</p>
              {c.items.length > 0 && (
                <ul>
                  {c.items.map((i) => (
                    <li key={i.name}>
                      <strong>{i.name}</strong> <span className="wiki-badge small">{i.badge}</span> — {i.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <p className="wiki-gen-note">{t("wiki.generated")}</p>
        </div>
      );
    }
    case "gen": {
      const table = buildTable(b.id, locale);
      if (!table) return null;
      return (
        <div className="wiki-table-wrap">
          <table className="wiki-gen" data-table={b.id}>
            <thead>
              <tr>
                {table.head.map((h, n) => (
                  <th key={n} className={table.numeric?.includes(n) ? "num" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, n) => (
                <tr key={n}>
                  {r.map((c, m) => (
                    <td key={m} className={table.numeric?.includes(m) ? "num" : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="wiki-gen-note">{t("wiki.generated")}</p>
        </div>
      );
    }
  }
}

export function WikiApp() {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [path, setPath] = useState(() => location.pathname);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const t: T = (key, params) => translate(locale, key, params);

  const slug = slugFromPath(path);
  const article = slug ? getArticle(locale, slug) : null;
  const articles = useMemo(() => allArticles(locale), [locale]);
  const hits = useMemo(() => searchArticles(articles, query), [articles, query]);

  const setLocale = (l: Locale) => {
    try {
      localStorage.setItem(LOCALE_KEY, l);
    } catch {
      // Sin almacenamiento: solo esta visita.
    }
    setLocaleState(l);
  };

  const go = (url: string) => {
    history.pushState(null, "", url);
    setPath(location.pathname);
    setQuery("");
    setMenuOpen(false);
    const hash = url.split("#")[1];
    requestAnimationFrame(() => {
      const el = hash ? document.getElementById(hash) : null;
      if (el) el.scrollIntoView();
      else window.scrollTo(0, 0);
    });
  };

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${article ? `${article.title} · ` : ""}${t("wiki.title")} · Aeonarch`;
  });

  // Al cargar con un #ancla, ir a ella cuando el artículo ya está dibujado.
  useEffect(() => {
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, []);

  const index = WIKI_ARTICLES.findIndex((a) => a.slug === slug);
  const prev = index > 0 ? WIKI_ARTICLES[index - 1]!.slug : null;
  const next = index >= 0 && index < WIKI_ARTICLES.length - 1 ? WIKI_ARTICLES[index + 1]!.slug : null;
  const navLink = (s: WikiSlug, children: ReactNode, className?: string) => (
    <a
      className={className}
      href={wikiPath(s)}
      aria-current={s === slug && !query ? "page" : undefined}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(wikiPath(s));
      }}
    >
      {children}
    </a>
  );
  const toc = article ? article.blocks.filter((b): b is Extract<Block, { t: "h" }> => b.t === "h" && b.level === 2) : [];

  return (
    <div className="wiki">
      <header className="wiki-top">
        <button className="wiki-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="wiki-nav" aria-label={t(menuOpen ? "wiki.closeMenu" : "wiki.menu")}>
          ☰
        </button>
        {navLink(
          "inicio",
          <>
            <span className="wiki-brand-mark">✦</span> {t("app.title")} <span className="wiki-brand-sub">{t("wiki.title")}</span>
          </>,
          "wiki-brand",
        )}
        <input
          className="wiki-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("wiki.searchPlaceholder")}
          aria-label={t("wiki.search")}
        />
        <div className="wiki-lang" role="group" aria-label={t("hud.language")}>
          {BASE_LOCALES.map((l) => (
            <button key={l} className={l === locale ? "active" : undefined} aria-pressed={l === locale} onClick={() => setLocale(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <a className="wiki-game hide-sm" href="/">
          {t("wiki.backToGame")}
        </a>
      </header>

      <div className="wiki-body">
        <nav id="wiki-nav" className={menuOpen ? "wiki-nav open" : "wiki-nav"} aria-label={t("wiki.menu")}>
          {WIKI_GROUPS.map((g) => (
            <section key={g}>
              <h2>{t(`wiki.group.${g}`)}</h2>
              <ul>
                {WIKI_ARTICLES.filter((a) => a.group === g).map((a) => (
                  <li key={a.slug}>
                    {navLink(a.slug, getArticle(locale, a.slug)?.title ?? a.slug)}
                    {a.slug === slug && !query && toc.length > 1 && (
                      <ul className="wiki-toc" aria-label={t("wiki.contents")}>
                        {toc.map((h) => (
                          <li key={h.id}>
                            <a href={`#${h.id}`} onClick={() => setMenuOpen(false)}>
                              {h.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <a className="wiki-game show-sm" href="/">
            {t("wiki.backToGame")}
          </a>
        </nav>

        <main className="wiki-main">
          {query.trim() ? (
            <section className="wiki-results" aria-live="polite">
              <h1>{t("wiki.results", { q: query.trim() })}</h1>
              {hits.length === 0 ? (
                <p className="muted">{t("wiki.noResults", { q: query.trim() })}</p>
              ) : (
                <ul>
                  {hits.map((h) => (
                    <li key={h.slug}>
                      {isWikiSlug(h.slug) && navLink(h.slug, h.title)}
                      <p className="muted">{h.snippet}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : article ? (
            <article className="wiki-article">
              {article.blocks.map((b, n) => (
                <BlockView key={n} b={b} t={t} locale={locale} go={go} />
              ))}
              <nav className="wiki-pager">
                {prev ? navLink(prev, <>← {getArticle(locale, prev)?.title}</>, "prev") : <span />}
                {next ? navLink(next, <>{getArticle(locale, next)?.title} →</>, "next") : <span />}
              </nav>
            </article>
          ) : (
            <article className="wiki-article">
              <h1>{t("wiki.title")}</h1>
              <p>{t("wiki.notFound")}</p>
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
