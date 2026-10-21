/**
 * Panel de edición de la Wiki (solo administradores; el servidor lo comprueba
 * en cada escritura). Editor de Markdown con vista previa en vivo, idioma,
 * nota, historial con diferencias y restauración, tablas del juego para
 * insertar, y ocultar o cambiar de grupo el artículo.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BASE_LOCALES, WIKI_BODY_MAX, WIKI_NOTE_MAX, WIKI_SLUG_MAX, WIKI_TITLE_MAX, isValidWikiSlug, type I18nKey, type Locale, type WikiPageMeta, type WikiPublished, type WikiRevisionInfo } from "@imperium/shared";
import { wikiApi } from "./api";
import { articleSource, buildArticle, sourceKey, wikiIndex, type WikiRemote } from "./articles";
import { diffChunks, diffLines } from "./diff";
import { BlockView, type T } from "./render";
import { WIKI_GROUPS, type WikiGroup } from "./slugs";
import { GEN_CARDS, GEN_TABLES } from "./tables";

type Tab = "text" | "preview" | "history";

const fmtDate = (locale: Locale, ms: number) => new Date(ms).toLocaleString(locale === "es" ? "es-ES" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Aviso de idioma desactualizado: el otro idioma tiene una edición posterior a la última de este. */
export function staleLocale(remote: WikiRemote, slug: string): { stale: Locale; fresh: Locale } | null {
  const at = (l: Locale) => remote.published.get(sourceKey(l, slug))?.at ?? 0;
  const [a, b] = BASE_LOCALES as [Locale, Locale];
  if (at(a) === at(b)) return null;
  return at(a) < at(b) ? { stale: a, fresh: b } : { stale: b, fresh: a };
}

interface Draft {
  text: string;
  /** Texto publicado al empezar (para saber si hay cambios). */
  original: string;
  /** Revisión publicada sobre la que se edita (null: la del repositorio). */
  base: number | null;
  /** Sin texto en este idioma: se partió del otro. */
  from: Locale | null;
}

export function WikiEditor({
  slug,
  locale,
  remote,
  t,
  go,
  onDirty,
  onPublished,
  onPage,
  onClose,
}: {
  slug: string;
  locale: Locale;
  remote: WikiRemote;
  t: T;
  go: (url: string) => void;
  /** Avisa de si hay cambios sin publicar (para preguntar antes de salir del editor). */
  onDirty: (dirty: boolean) => void;
  onPublished: (p: WikiPublished) => void;
  onPage: (p: WikiPageMeta) => void;
  onClose: () => void;
}) {
  const [editLocale, setEditLocale] = useState<Locale>(locale);
  const [drafts, setDrafts] = useState<Partial<Record<Locale, Draft>>>({});
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<Tab>("text");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  /** Texto publicado ahora en un idioma (sin caer al otro idioma). */
  const publishedIn = (l: Locale) => remote.published.get(sourceKey(l, slug));
  const currentText = (l: Locale) => publishedIn(l)?.body ?? articleSource(l, slug);

  // Al abrir un idioma por primera vez, su borrador parte del texto publicado.
  useEffect(() => {
    if (drafts[editLocale]) return;
    const own = currentText(editLocale);
    const other = BASE_LOCALES.find((l) => l !== editLocale)!;
    const text = own ?? currentText(other) ?? "";
    setDrafts((d) => ({ ...d, [editLocale]: { text, original: own ?? "", base: publishedIn(editLocale)?.revisionId ?? null, from: own === null ? other : null } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editLocale]);

  const draft = drafts[editLocale];
  const dirty = BASE_LOCALES.some((l) => drafts[l] && drafts[l]!.text !== drafts[l]!.original);

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  // Aviso del navegador al salir con cambios sin publicar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  const preview = useMemo(() => (draft ? buildArticle(editLocale, slug, draft.text) : null), [draft, editLocale, slug]);
  const unknownTables = useMemo(
    () => (preview?.blocks ?? []).flatMap((b) => ((b.t === "gen" && !GEN_TABLES[b.id]) || (b.t === "cards" && !GEN_CARDS[b.id]) ? [b.id] : [])),
    [preview],
  );
  const stale = staleLocale(remote, slug);
  const entry = wikiIndex(remote, true).find((e) => e.slug === slug);
  const title = buildArticle(editLocale, slug, currentText(editLocale) ?? currentText("es") ?? "").title;

  const setText = (text: string) => setDrafts((d) => ({ ...d, [editLocale]: { ...d[editLocale]!, text } }));
  const fail = (key: I18nKey) => setMessage({ kind: "error", text: t(key) });

  const close = () => {
    if (dirty && !confirm(t("wiki.edit.unsaved"))) return;
    onClose();
  };

  /** Inserta `{{tabla:id}}` en el cursor, en su propia línea. */
  const insert = (snippet: string) => {
    const el = area.current;
    const text = draft?.text ?? "";
    const at = el ? el.selectionStart : text.length;
    const before = text.slice(0, at);
    const after = text.slice(at);
    const pre = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const post = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    setText(before + pre + snippet + post + after);
    setTab("text");
    requestAnimationFrame(() => {
      const pos = (before + pre + snippet).length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const publish = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setMessage(null);
    const res = await wikiApi.save({ slug, locale: editLocale, body: draft.text, note, baseRevisionId: draft.base });
    setBusy(false);
    if (!res.ok) return fail(res.error);
    const p = res.data.published;
    setDrafts((d) => ({ ...d, [editLocale]: { text: p.body, original: p.body, base: p.revisionId, from: null } }));
    setNote("");
    setMessage({ kind: "ok", text: t("wiki.edit.published") });
    onPublished(p);
  };

  const setMeta = async (change: { hidden?: boolean; group?: WikiGroup }) => {
    setBusy(true);
    const res = await wikiApi.meta({ slug, ...change });
    setBusy(false);
    if (!res.ok) return fail(res.error);
    onPage(res.data.page);
  };

  /** Tras restaurar (en el historial): el borrador pasa a ser lo publicado. */
  const restored = (p: WikiPublished, text: string) => {
    setDrafts((d) => ({ ...d, [p.locale]: { text: p.body, original: p.body, base: p.revisionId, from: null } }));
    setMessage({ kind: "ok", text });
    onPublished(p);
  };

  const tooLong = (draft?.text.length ?? 0) > WIKI_BODY_MAX;
  const tabs: Array<[Tab, I18nKey]> = [
    ["text", "wiki.edit.text"],
    ["preview", "wiki.edit.preview"],
    ["history", "wiki.edit.history"],
  ];

  return (
    <section className="wiki-editor" aria-label={t("wiki.edit.heading", { title })}>
      <header className="wiki-editor-head">
        <h1>{t("wiki.edit.heading", { title })}</h1>
        <button className="wiki-btn" onClick={close}>
          {t("wiki.edit.close")}
        </button>
      </header>

      <div className="wiki-editor-bar">
        <div className="wiki-lang" role="group" aria-label={t("wiki.edit.language")}>
          {BASE_LOCALES.map((l) => {
            const d = drafts[l];
            return (
              <button key={l} className={l === editLocale ? "active" : undefined} aria-pressed={l === editLocale} onClick={() => setEditLocale(l)}>
                {l.toUpperCase()}
                {d && d.text !== d.original ? " •" : ""}
              </button>
            );
          })}
        </div>
        <div className="wiki-tabs" role="tablist">
          {tabs.map(([id, key]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`${tab === id ? "active" : ""} ${id === "preview" ? "wiki-tab-preview" : ""}`} onClick={() => setTab(id)}>
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      {stale && (
        <p className="wiki-editor-warn" role="status">
          {t("wiki.edit.outdated", { stale: t(`wiki.lang.${stale.stale}`), fresh: t(`wiki.lang.${stale.fresh}`) })}
        </p>
      )}
      {draft?.from && <p className="wiki-editor-warn">{t("wiki.edit.missingLocale", { lang: t(`wiki.lang.${editLocale}`), from: t(`wiki.lang.${draft.from}`) })}</p>}
      {entry?.hidden && <p className="wiki-editor-warn">{t("wiki.edit.hiddenNote")}</p>}

      {tab === "history" ? (
        <WikiHistory key={editLocale} slug={slug} locale={editLocale} remote={remote} t={t} onRestored={restored} />
      ) : (
        draft && (
          <div className={`wiki-editor-panes ${tab === "preview" ? "show-preview" : "show-text"}`}>
            <div className="wiki-editor-text">
              <textarea
                ref={area}
                value={draft.text}
                onChange={(e) => setText(e.target.value)}
                spellCheck
                lang={editLocale}
                aria-label={t("wiki.edit.textLabel", { lang: t(`wiki.lang.${editLocale}`) })}
              />
              <p className={tooLong ? "wiki-editor-count error" : "wiki-editor-count"}>
                {t("wiki.edit.chars", { n: draft.text.length, max: WIKI_BODY_MAX })}
                {tooLong && ` · ${t("wiki.edit.tooLong")}`}
              </p>
              <details className="wiki-editor-tables">
                <summary>{t("wiki.edit.tables")}</summary>
                <p className="muted">{t("wiki.edit.tablesHelp")}</p>
                <div className="wiki-chips">
                  {Object.keys(GEN_TABLES).map((id) => (
                    <button key={id} className="wiki-chip" onClick={() => insert(`{{tabla:${id}}}`)}>
                      tabla:{id}
                    </button>
                  ))}
                  {Object.keys(GEN_CARDS).map((id) => (
                    <button key={id} className="wiki-chip" onClick={() => insert(`{{fichas:${id}}}`)}>
                      fichas:{id}
                    </button>
                  ))}
                </div>
              </details>
              <p className="wiki-editor-help muted">{t("wiki.edit.syntax")}</p>
            </div>
            <div className="wiki-editor-preview" aria-label={t("wiki.edit.preview")}>
              {unknownTables.map((id) => (
                <p key={id} className="wiki-editor-warn">
                  {t("wiki.edit.unknownTable", { id })}
                </p>
              ))}
              <article className="wiki-article">
                {preview?.blocks.map((b, n) => (
                  <BlockView key={n} b={b} t={t} locale={editLocale} go={go} />
                ))}
              </article>
            </div>
          </div>
        )
      )}

      {tab !== "history" && (
        <div className="wiki-editor-publish">
          <label>
            <span>{t("wiki.edit.note")}</span>
            <input value={note} maxLength={WIKI_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={t("wiki.edit.notePlaceholder")} />
          </label>
          <button className="wiki-btn primary" disabled={busy || !draft || draft.text === draft.original || tooLong} onClick={() => void publish()}>
            {busy ? t("wiki.edit.publishing") : t("wiki.edit.publish")}
          </button>
        </div>
      )}
      {message && (
        <p className={message.kind === "ok" ? "wiki-editor-ok" : "wiki-editor-error"} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}

      {entry && (
        <details className="wiki-editor-settings">
          <summary>{t("wiki.edit.settings")}</summary>
          <label>
            <span>{t("wiki.edit.group")}</span>
            <select value={entry.group} disabled={busy} onChange={(e) => void setMeta({ group: e.target.value as WikiGroup })}>
              {WIKI_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t(`wiki.group.${g}`)}
                </option>
              ))}
            </select>
          </label>
          <button className="wiki-btn" disabled={busy} onClick={() => void setMeta({ hidden: !entry.hidden })}>
            {entry.hidden ? t("wiki.edit.show") : t("wiki.edit.hide")}
          </button>
        </details>
      )}
    </section>
  );
}

/** Historial de un artículo en un idioma: elegir una versión, ver sus diferencias con la publicada y restaurarla. */
function WikiHistory({ slug, locale, remote, t, onRestored }: { slug: string; locale: Locale; remote: WikiRemote; t: T; onRestored: (p: WikiPublished, message: string) => void }) {
  const [revisions, setRevisions] = useState<WikiRevisionInfo[] | null>(null);
  const [error, setError] = useState<I18nKey | null>(null);
  /** Versión elegida: una revisión (id) o el texto del repositorio ("repo"). */
  const [selected, setSelected] = useState<number | "repo" | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = remote.published.get(sourceKey(locale, slug));
  const repo = articleSource(locale, slug);
  const published = current?.body ?? repo ?? "";

  useEffect(() => {
    let live = true;
    void wikiApi.history(slug, locale).then((res) => {
      if (!live) return;
      if (res.ok) setRevisions(res.data.revisions);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [slug, locale, current?.revisionId]);

  const pick = async (id: number | "repo") => {
    setSelected(id);
    setBody(null);
    if (id === "repo") return setBody(repo ?? "");
    const res = await wikiApi.revision(id);
    if (res.ok) setBody(res.data.revision.body);
    else setError(res.error);
  };

  const restore = async () => {
    if (selected === null || busy) return;
    setBusy(true);
    setError(null);
    const res =
      selected === "repo"
        ? await wikiApi.save({ slug, locale, body: repo ?? "", note: t("wiki.edit.repoNote"), baseRevisionId: current?.revisionId ?? null })
        : await wikiApi.restore(selected);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onRestored(res.data.published, selected === "repo" ? t("wiki.edit.published") : t("wiki.edit.restoreDone", { id: selected }));
    setSelected(null);
    setBody(null);
  };

  const chunks = body === null ? null : diffChunks(diffLines(published, body));

  return (
    <div className="wiki-history">
      {error && (
        <p className="wiki-editor-error" role="alert">
          {t(error)}
        </p>
      )}
      {revisions === null && !error && <p className="muted">{t("wiki.loading")}</p>}
      {revisions && revisions.length === 0 && <p className="muted">{t("wiki.edit.historyEmpty")}</p>}
      <ul className="wiki-history-list">
        {(revisions ?? []).map((r) => (
          <li key={r.id}>
            <button className={selected === r.id ? "active" : undefined} aria-pressed={selected === r.id} onClick={() => void pick(r.id)}>
              <strong>{t("wiki.edit.revision", { id: r.id })}</strong>
              {r.id === current?.revisionId && <span className="wiki-badge small">{t("wiki.edit.current")}</span>}
              <span className="muted">
                {" "}
                · {fmtDate(locale, r.at)} · {r.author ?? t("wiki.edit.anonymous")}
                {r.restoredFrom ? ` · ${t("wiki.edit.restoredFrom", { id: r.restoredFrom })}` : ""}
              </span>
              {r.note && <span className="wiki-history-note">{r.note}</span>}
            </button>
          </li>
        ))}
        {repo !== null && (
          <li>
            <button className={selected === "repo" ? "active" : undefined} aria-pressed={selected === "repo"} onClick={() => void pick("repo")}>
              <strong>{t("wiki.edit.repo")}</strong>
              {!current && <span className="wiki-badge small">{t("wiki.edit.current")}</span>}
            </button>
          </li>
        )}
      </ul>
      {selected === null ? (
        <p className="muted">{t("wiki.edit.pickRevision")}</p>
      ) : chunks === null ? (
        <p className="muted">{t("wiki.loading")}</p>
      ) : (
        <div className="wiki-diff-wrap">
          <h2>{t("wiki.edit.diff")}</h2>
          {chunks.length === 0 ? (
            <p className="muted">{t("wiki.edit.noDiff")}</p>
          ) : (
            <pre className="wiki-diff" data-testid="wiki-diff">
              {chunks.map((c, n) =>
                c.t === "gap" ? (
                  <span key={n} className="gap">
                    ⋯ {c.count}
                    {"\n"}
                  </span>
                ) : (
                  <span key={n} className={c.t}>
                    {c.t === "add" ? "+ " : c.t === "del" ? "− " : "  "}
                    {c.text}
                    {"\n"}
                  </span>
                ),
              )}
            </pre>
          )}
          <button className="wiki-btn primary" disabled={busy || chunks.length === 0} onClick={() => void restore()}>
            {t("wiki.edit.restore")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Crear un artículo nuevo: dirección (slug), título y grupo del índice. */
export function WikiCreate({ locale, t, onCreated, onCancel }: { locale: Locale; t: T; onCreated: (page: WikiPageMeta, published: WikiPublished | undefined) => void; onCancel: () => void }) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState<WikiGroup>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const validSlug = isValidWikiSlug(slug);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validSlug || !title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await wikiApi.create({ slug, group, locale, title });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onCreated(res.data.page, res.data.published);
  };

  return (
    <section className="wiki-editor">
      <header className="wiki-editor-head">
        <h1>{t("wiki.edit.createHeading")}</h1>
      </header>
      <form className="wiki-create" onSubmit={(e) => void submit(e)}>
        <label>
          <span>{t("wiki.edit.articleTitle")}</span>
          <input value={title} maxLength={WIKI_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          <span>{t("wiki.edit.slug")}</span>
          <input
            value={slug}
            maxLength={WIKI_SLUG_MAX}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            aria-invalid={slug !== "" && !validSlug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
          <small className="muted">{t("wiki.edit.slugHelp")}</small>
        </label>
        <label>
          <span>{t("wiki.edit.group")}</span>
          <select value={group} onChange={(e) => setGroup(e.target.value as WikiGroup)}>
            {WIKI_GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`wiki.group.${g}`)}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="wiki-editor-error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="wiki-create-actions">
          <button type="button" className="wiki-btn" onClick={onCancel}>
            {t("wiki.edit.cancel")}
          </button>
          <button type="submit" className="wiki-btn primary" disabled={busy || !validSlug || !title.trim()}>
            {t("wiki.edit.create")}
          </button>
        </div>
      </form>
    </section>
  );
}
