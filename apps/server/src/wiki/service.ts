import { and, desc, eq, max, sql } from "drizzle-orm";
import {
  isWikiSlug,
  WIKI_ARTICLES,
  type Locale,
  type WikiBylineKind,
  type WikiGroup,
  type WikiPageMeta,
  type WikiPublished,
  type WikiRevisionInfo,
} from "@imperium/shared";
import type { Database } from "../db/client";
import { emperors, wikiLog, wikiPages, wikiRevisions } from "../db/schema";
import { maskEmail } from "../auth/tokens";

/** Quien edita: su cuenta y cómo se le muestra en el historial. */
export interface WikiAuthor {
  accountId: string;
  label: string;
}

/** Error de la Wiki con el código de la API y su estado HTTP. */
export class WikiError extends Error {
  constructor(
    readonly status: number,
    readonly code: "unknown_article" | "slug_taken" | "conflict",
  ) {
    super(code);
  }
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RevisionRow = typeof wikiRevisions.$inferSelect;
type PageRow = typeof wikiPages.$inferSelect;

function pageMeta(row: PageRow): WikiPageMeta {
  return { slug: row.slug, group: row.group as WikiGroup, hidden: row.hidden, custom: row.custom, position: row.position, byline: row.byline, bylineKind: (row.bylineKind as WikiBylineKind | null) ?? null };
}

function published(row: Pick<RevisionRow, "id" | "slug" | "locale" | "body" | "createdAt">): WikiPublished {
  return { slug: row.slug, locale: row.locale as Locale, revisionId: row.id, body: row.body, at: row.createdAt.getTime() };
}

function revisionInfo(row: Omit<RevisionRow, "body" | "authorId"> & { size: number }): WikiRevisionInfo {
  return {
    id: row.id,
    slug: row.slug,
    locale: row.locale as Locale,
    note: row.note,
    author: row.authorLabel,
    at: row.createdAt.getTime(),
    size: row.size,
    restoredFrom: row.restoredFrom,
  };
}

/**
 * Wiki editable: revisiones (solo inserción), artículos nuevos u ocultos y el
 * registro de cambios. Las rutas (routes.ts) comprueban antes que quien escribe
 * es administrador.
 */
export class WikiService {
  constructor(private readonly db: Database) {}

  /** Cómo se muestra un administrador en el historial: el nombre de su Emperador o su correo enmascarado. */
  async authorFor(account: { id: string; email: string }): Promise<WikiAuthor> {
    const [emp] = await this.db.select({ name: emperors.name }).from(emperors).where(eq(emperors.accountId, account.id)).limit(1);
    return { accountId: account.id, label: emp?.name ?? maskEmail(account.email) };
  }

  /** Artículos guardados y última revisión de cada artículo e idioma. Sin `admin`, los ocultos van sin texto. */
  async state(admin: boolean): Promise<{ pages: WikiPageMeta[]; published: WikiPublished[] }> {
    const pages = (await this.db.select().from(wikiPages).orderBy(wikiPages.position, wikiPages.slug)).map(pageMeta);
    const hidden = new Set(pages.filter((p) => p.hidden).map((p) => p.slug));
    const rows = await this.db
      .selectDistinctOn([wikiRevisions.slug, wikiRevisions.locale], {
        id: wikiRevisions.id,
        slug: wikiRevisions.slug,
        locale: wikiRevisions.locale,
        body: wikiRevisions.body,
        createdAt: wikiRevisions.createdAt,
      })
      .from(wikiRevisions)
      .orderBy(wikiRevisions.slug, wikiRevisions.locale, desc(wikiRevisions.id));
    return {
      // Los ocultos del repositorio sí se listan (el cliente los quita del índice); los nuevos ocultos, no.
      pages: pages.filter((p) => admin || !(p.hidden && p.custom)),
      published: rows.filter((r) => admin || !hidden.has(r.slug)).map(published),
    };
  }

  /** El artículo existe: es del repositorio o se creó desde el panel. */
  private async exists(db: Database | Tx, slug: string): Promise<boolean> {
    if (isWikiSlug(slug)) return true;
    const [row] = await db.select({ slug: wikiPages.slug }).from(wikiPages).where(eq(wikiPages.slug, slug)).limit(1);
    return !!row;
  }

  private async log(tx: Tx, author: WikiAuthor, entry: { action: (typeof wikiLog.$inferInsert)["action"]; slug: string; locale?: Locale; revisionId?: number; detail?: string }) {
    await tx.insert(wikiLog).values({ ...entry, authorId: author.accountId, authorLabel: author.label });
  }

  /**
   * Publica una revisión nueva. `baseRevisionId` es la revisión publicada sobre la
   * que se editó (null: el texto del repositorio); si mientras tanto otro
   * administrador guardó otra, se rechaza (conflicto) para no pisar su trabajo.
   */
  async save(
    author: WikiAuthor,
    input: { slug: string; locale: Locale; body: string; note: string; baseRevisionId: number | null },
    restoredFrom: number | null = null,
  ): Promise<WikiPublished> {
    return this.db.transaction(async (tx) => {
      if (!(await this.exists(tx, input.slug))) throw new WikiError(404, "unknown_article");
      // Una edición a la vez por artículo e idioma: la comprobación del conflicto y la inserción no se cruzan.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`wiki:${input.slug}:${input.locale}`}))`);
      const [latest] = await tx
        .select({ id: max(wikiRevisions.id) })
        .from(wikiRevisions)
        .where(and(eq(wikiRevisions.slug, input.slug), eq(wikiRevisions.locale, input.locale)));
      if ((latest?.id ?? null) !== input.baseRevisionId) throw new WikiError(409, "conflict");
      const [row] = await tx
        .insert(wikiRevisions)
        .values({
          slug: input.slug,
          locale: input.locale,
          body: input.body,
          note: input.note,
          authorId: author.accountId,
          authorLabel: author.label,
          restoredFrom,
        })
        .returning();
      await this.log(tx, author, { action: restoredFrom ? "restore" : "save", slug: input.slug, locale: input.locale, revisionId: row!.id });
      return published(row!);
    });
  }

  /** Publica de nuevo el texto de una revisión anterior (como revisión nueva: el historial no se reescribe). */
  async restore(author: WikiAuthor, revisionId: number, note: string): Promise<WikiPublished> {
    const [old] = await this.db.select().from(wikiRevisions).where(eq(wikiRevisions.id, revisionId)).limit(1);
    if (!old) throw new WikiError(404, "unknown_article");
    const [latest] = await this.db
      .select({ id: max(wikiRevisions.id) })
      .from(wikiRevisions)
      .where(and(eq(wikiRevisions.slug, old.slug), eq(wikiRevisions.locale, old.locale)));
    return this.save(
      author,
      { slug: old.slug, locale: old.locale as Locale, body: old.body, note: note || `#${old.id}`, baseRevisionId: latest?.id ?? null },
      old.id,
    );
  }

  /** Historial de un artículo (los dos idiomas o uno), de la más reciente a la más antigua. */
  async history(slug: string, locale: Locale | null): Promise<WikiRevisionInfo[]> {
    const rows = await this.db
      .select({
        id: wikiRevisions.id,
        slug: wikiRevisions.slug,
        locale: wikiRevisions.locale,
        note: wikiRevisions.note,
        authorLabel: wikiRevisions.authorLabel,
        restoredFrom: wikiRevisions.restoredFrom,
        createdAt: wikiRevisions.createdAt,
        size: sql<number>`char_length(${wikiRevisions.body})::int`,
      })
      .from(wikiRevisions)
      .where(and(eq(wikiRevisions.slug, slug), locale ? eq(wikiRevisions.locale, locale) : undefined))
      .orderBy(desc(wikiRevisions.id))
      .limit(500);
    return rows.map(revisionInfo);
  }

  async revision(id: number): Promise<(WikiRevisionInfo & { body: string }) | null> {
    const [row] = await this.db.select().from(wikiRevisions).where(eq(wikiRevisions.id, id)).limit(1);
    return row ? { ...revisionInfo({ ...row, size: row.body.length }), body: row.body } : null;
  }

  /** Artículo nuevo: sus datos y una primera revisión con el título, en el idioma indicado. */
  async create(author: WikiAuthor, input: { slug: string; group: WikiGroup; locale: Locale; title: string }): Promise<{ page: WikiPageMeta; published: WikiPublished }> {
    return this.db.transaction(async (tx) => {
      if (await this.exists(tx, input.slug)) throw new WikiError(409, "slug_taken");
      const [last] = await tx.select({ p: max(wikiPages.position) }).from(wikiPages);
      const [page] = await tx
        .insert(wikiPages)
        .values({ slug: input.slug, group: input.group, custom: true, position: (last?.p ?? 0) + 1 })
        .onConflictDoNothing()
        .returning();
      if (!page) throw new WikiError(409, "slug_taken");
      // El título empieza el texto; el renderizador lo escapa (no se interpreta HTML).
      const [row] = await tx
        .insert(wikiRevisions)
        .values({ slug: input.slug, locale: input.locale, body: `# ${input.title}\n\n`, note: "", authorId: author.accountId, authorLabel: author.label })
        .returning();
      await this.log(tx, author, { action: "create", slug: input.slug, locale: input.locale, revisionId: row!.id, detail: input.group });
      return { page: pageMeta(page), published: published(row!) };
    });
  }

  /** Ocultar o mostrar un artículo, o cambiarlo de grupo en el índice. */
  async setMeta(author: WikiAuthor, input: { slug: string; hidden?: boolean; group?: WikiGroup; byline?: string; bylineKind?: WikiBylineKind | null }): Promise<WikiPageMeta> {
    return this.db.transaction(async (tx) => {
      if (!(await this.exists(tx, input.slug))) throw new WikiError(404, "unknown_article");
      const base = WIKI_ARTICLES.find((a) => a.slug === input.slug);
      const [current] = await tx.select().from(wikiPages).where(eq(wikiPages.slug, input.slug)).for("update");
      const next = {
        group: input.group ?? (current?.group as WikiGroup | undefined) ?? base!.group,
        hidden: input.hidden ?? current?.hidden ?? false,
        byline: input.byline !== undefined ? input.byline.trim() || null : (current?.byline ?? null),
        bylineKind: input.bylineKind !== undefined ? input.bylineKind : (current?.bylineKind ?? null),
      };
      const [row] = await tx
        .insert(wikiPages)
        .values({ slug: input.slug, ...next, custom: false })
        .onConflictDoUpdate({ target: wikiPages.slug, set: { ...next, updatedAt: sql`now()` } })
        .returning();
      if (input.hidden !== undefined && input.hidden !== (current?.hidden ?? false)) {
        await this.log(tx, author, { action: input.hidden ? "hide" : "show", slug: input.slug });
      }
      if (input.group !== undefined && input.group !== (current?.group ?? base?.group)) {
        await this.log(tx, author, { action: "group", slug: input.slug, detail: input.group });
      }
      if (input.bylineKind !== undefined && next.bylineKind !== (current?.bylineKind ?? null)) {
        await this.log(tx, author, { action: "byline", slug: input.slug, detail: `kind:${next.bylineKind ?? ""}` });
      }
      if (input.byline !== undefined && next.byline !== (current?.byline ?? null)) {
        await this.log(tx, author, { action: "byline", slug: input.slug, detail: next.byline ?? "" });
      }
      return pageMeta(row!);
    });
  }

  /** Lo que hizo una cuenta en la Wiki (exportación de datos). */
  async exportFor(accountId: string) {
    return {
      revisions: await this.db.select().from(wikiRevisions).where(eq(wikiRevisions.authorId, accountId)),
      log: await this.db.select().from(wikiLog).where(eq(wikiLog.authorId, accountId)),
    };
  }

  /**
   * Al borrar la cuenta: sus revisiones se quedan (son contenido público de la
   * Wiki) pero sin autor. Es la única modificación que admiten esas tablas.
   */
  async anonymize(tx: Tx, accountId: string): Promise<void> {
    await tx.update(wikiRevisions).set({ authorId: null, authorLabel: null }).where(eq(wikiRevisions.authorId, accountId));
    await tx.update(wikiLog).set({ authorId: null, authorLabel: null }).where(eq(wikiLog.authorId, accountId));
  }
}
