/** Dibujo de los bloques de un artículo (la Wiki y la vista previa del editor). Todo es texto de React: no se interpreta HTML. */
import type { MouseEvent, ReactNode } from "react";
import { translate, type I18nKey, type Locale } from "@imperium/shared";
import { anchorId as anchorFor, type Block, type Inline } from "./markdown";
import { routeSlug, wikiPath } from "./slugs";
import { buildCards, buildTable } from "./tables";

export type T = (key: I18nKey, params?: Record<string, string | number>) => string;

export const translator = (locale: Locale): T => (key, params) => translate(locale, key, params);

/** Ruta interna de un enlace del Markdown (`/wiki/economia#instalaciones`), o null si es externo. */
function internalHref(href: string): { slug: string; hash: string; url: string } | null {
  if (!href.startsWith("/wiki")) return null;
  const [rest, hash = ""] = href.split("#");
  const [path, search = ""] = rest!.split("?");
  const slug = routeSlug(path!, search);
  if (!slug) return null;
  return { slug, hash, url: wikiPath(slug) + (hash ? `#${hash}` : "") };
}

export function InlineView({ c, go }: { c: Inline[]; go: (url: string) => void }) {
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

export function BlockView({ b, t, locale, go }: { b: Block; t: T; locale: Locale; go: (url: string) => void }): ReactNode {
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
            <section key={c.title} className="wiki-card" style={c.color ? { borderLeft: `3px solid ${c.color}` } : undefined}>
              <header>
                {c.color && <span className="wiki-card-dot" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />}
                <h3 id={anchorFor(c.title)}>{c.title}</h3>
                <span className="wiki-badge">{c.badge}</span>
              </header>
              <p className="wiki-card-motto">{c.subtitle}</p>
              <p>{c.text}</p>
              {c.facts && c.facts.length > 0 && (
                <dl className="wiki-card-facts">
                  {c.facts.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {c.table && (
                <div className="wiki-table-wrap">
                  <table className="wiki-gen">
                    <thead>
                      <tr>
                        {c.table.head.map((h, n) => (
                          <th key={n} className={c.table!.numeric?.includes(n) ? "num" : undefined}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {c.table.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((cell, n) => (
                            <td key={n} className={c.table!.numeric?.includes(n) ? "num" : undefined}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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

