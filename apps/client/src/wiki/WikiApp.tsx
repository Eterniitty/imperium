import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BASE_LOCALES, translate, type Locale } from "@imperium/shared";
import { wikiApi } from "./api";
import { allArticles, EMPTY_REMOTE, getArticle, remoteFrom, wikiIndex, withPage, withPublished, type WikiRemote } from "./articles";
import type { Block } from "./markdown";
import { BlockView, type T } from "./render";
import { searchArticles } from "./search";
import { WIKI_GROUPS, WIKI_HOME, isWikiSlug, routeSlug, wikiPath } from "./slugs";
import { WikiCreate, WikiEditor } from "./WikiEditor";

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

export function WikiApp() {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [url, setUrl] = useState(() => ({ path: location.pathname, search: location.search }));
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // Ediciones publicadas, artículos nuevos u ocultos y si la sesión es de un administrador.
  const [remote, setRemote] = useState<WikiRemote>(EMPTY_REMOTE);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
  const dirty = useRef(false);
  const t: T = (key, params) => translate(locale, key, params);

  const admin = remote.admin;
  const entries = useMemo(() => wikiIndex(remote, admin), [remote, admin]);
  const slug = routeSlug(url.path, url.search);
  const entry = slug ? entries.find((e) => e.slug === slug) : undefined;
  const article = entry ? getArticle(locale, entry.slug, remote) : null;
  const articles = useMemo(() => allArticles(locale, remote, admin), [locale, remote, admin]);
  const hits = useMemo(() => searchArticles(articles, query), [articles, query]);

  // La versión publicada (con las ediciones de los administradores). Si falla, se queda lo del repositorio.
  useEffect(() => {
    let live = true;
    void wikiApi.state().then((res) => {
      if (!live) return;
      if (res.ok) setRemote(remoteFrom(res.data));
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const setLocale = (l: Locale) => {
    try {
      localStorage.setItem(LOCALE_KEY, l);
    } catch {
      // Sin almacenamiento: solo esta visita.
    }
    setLocaleState(l);
  };

  const go = (to: string) => {
    if (mode !== "view" && dirty.current && !confirm(t("wiki.edit.unsaved"))) return;
    history.pushState(null, "", to);
    setUrl({ path: location.pathname, search: location.search });
    setQuery("");
    setMenuOpen(false);
    setMode("view");
    dirty.current = false;
    const hash = to.split("#")[1];
    requestAnimationFrame(() => {
      const el = hash ? document.getElementById(hash) : null;
      if (el) el.scrollIntoView();
      else window.scrollTo(0, 0);
    });
  };

  useEffect(() => {
    const onPop = () => {
      setUrl({ path: location.pathname, search: location.search });
      setMode("view");
    };
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
  }, [loaded]);

  const index = entries.findIndex((e) => e.slug === slug);
  const prev = index > 0 ? entries[index - 1]!.slug : null;
  const next = index >= 0 && index < entries.length - 1 ? entries[index + 1]!.slug : null;
  const titleOf = (s: string) => getArticle(locale, s, remote)?.title ?? s;
  const navLink = (s: string, children: ReactNode, className?: string) => (
    <a
      className={className}
      href={wikiPath(s)}
      aria-current={s === slug && !query && mode === "view" ? "page" : undefined}
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

  let main: ReactNode;
  if (query.trim()) {
    main = (
      <section className="wiki-results" aria-live="polite">
        <h1>{t("wiki.results", { q: query.trim() })}</h1>
        {hits.length === 0 ? (
          <p className="muted">{t("wiki.noResults", { q: query.trim() })}</p>
        ) : (
          <ul>
            {hits.map((h) => (
              <li key={h.slug}>
                {navLink(h.slug, h.title)}
                <p className="muted">{h.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  } else if (mode === "create" && admin) {
    main = (
      <WikiCreate
        locale={locale}
        t={t}
        onCancel={() => setMode("view")}
        onCreated={(page, published) => {
          setRemote((r) => (published ? withPublished(withPage(r, page), published) : withPage(r, page)));
          history.pushState(null, "", wikiPath(page.slug));
          setUrl({ path: location.pathname, search: location.search });
          setMode("edit");
        }}
      />
    );
  } else if (mode === "edit" && admin && entry) {
    main = (
      <WikiEditor
        key={entry.slug}
        slug={entry.slug}
        locale={locale}
        remote={remote}
        t={t}
        go={() => {}}
        onDirty={(d) => {
          dirty.current = d;
        }}
        onPublished={(p) => setRemote((r) => withPublished(r, p))}
        onPage={(p) => setRemote((r) => withPage(r, p))}
        onClose={() => {
          dirty.current = false;
          setMode("view");
        }}
      />
    );
  } else if (article && entry) {
    main = (
      <article className={entry.group === "books" ? "wiki-article wiki-book" : "wiki-article"}>
        {admin && (
          <div className="wiki-admin-bar">
            {entry.hidden && <span className="wiki-badge">{t("wiki.edit.hidden")}</span>}
            <button className="wiki-btn" onClick={() => setMode("edit")} title={t("wiki.edit.editTitle")}>
              ✎ {t("wiki.edit.edit")}
            </button>
          </div>
        )}
        {article.blocks.map((b, n) => (
          <Fragment key={n}>
            <BlockView b={b} t={t} locale={locale} go={go} />
            {/* La firma, bajo el título. */}
            {n === 0 && entry.byline && <p className="wiki-byline">{t("wiki.byline", { name: entry.byline })}</p>}
          </Fragment>
        ))}
        <nav className="wiki-pager">
          {prev ? navLink(prev, <>← {titleOf(prev)}</>, "prev") : <span />}
          {next ? navLink(next, <>{titleOf(next)} →</>, "next") : <span />}
        </nav>
      </article>
    );
  } else {
    main = (
      <article className="wiki-article">
        <h1>{t("wiki.title")}</h1>
        {/* Un artículo nuevo solo se conoce tras preguntar a la API. */}
        <p>{slug && !isWikiSlug(slug) && !loaded ? t("wiki.loading") : t("wiki.notFound")}</p>
      </article>
    );
  }

  return (
    <div className="wiki">
      <header className="wiki-top">
        <button className="wiki-menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="wiki-nav" aria-label={t(menuOpen ? "wiki.closeMenu" : "wiki.menu")}>
          ☰
        </button>
        {navLink(
          WIKI_HOME,
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
          {admin && (
            <section className="wiki-nav-admin">
              <h2>{t("wiki.edit.admin")}</h2>
              <button
                className="wiki-btn"
                onClick={() => {
                  if (mode === "edit" && dirty.current && !confirm(t("wiki.edit.unsaved"))) return;
                  dirty.current = false;
                  setQuery("");
                  setMenuOpen(false);
                  setMode("create");
                }}
              >
                + {t("wiki.edit.newArticle")}
              </button>
            </section>
          )}
          {/* Los grupos vacíos (p. ej. «Libros» antes del primero) no salen en el índice. */}
          {WIKI_GROUPS.filter((g) => entries.some((e) => e.group === g)).map((g) => (
            <section key={g}>
              <h2>{t(`wiki.group.${g}`)}</h2>
              <ul>
                {entries
                  .filter((e) => e.group === g)
                  .map((e) => (
                    <li key={e.slug} className={e.hidden ? "hidden-article" : undefined}>
                      {navLink(e.slug, titleOf(e.slug))}
                      {e.slug === slug && !query && mode === "view" && toc.length > 1 && (
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

        <main className="wiki-main">{main}</main>
      </div>
    </div>
  );
}
