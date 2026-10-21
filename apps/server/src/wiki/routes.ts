import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiError, AuthAccount, WikiHistoryResponse, WikiMeResponse, WikiPageResponse, WikiRevisionResponse, WikiSaveResponse, WikiStateResponse } from "@imperium/shared";
import { isValidWikiSlug } from "@imperium/shared";
import { LocaleSchema, WikiCreateBodySchema, WikiMetaBodySchema, WikiRestoreBodySchema, WikiSaveBodySchema } from "@imperium/shared/schemas";
import { accountFromRequest, sessionCookieName } from "../auth/routes";
import { RateLimiter } from "../auth/rateLimit";
import { maskEmail } from "../auth/tokens";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { WikiError, type WikiService } from "./service";

export interface WikiDeps {
  config: ServerConfig;
  db: Database;
  wiki: WikiService;
}

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/** Si la cuenta es de un administrador: su correo está en `ADMIN_EMAILS`. Lo decide solo el servidor. */
export function isAdmin(config: Pick<ServerConfig, "ADMIN_EMAILS">, account: Pick<AuthAccount, "email"> | null): boolean {
  return !!account && config.ADMIN_EMAILS.has(account.email.toLowerCase());
}

/**
 * Wiki editable (`/api/wiki/*`). Leer es público (tras el `basicauth` de Caddy,
 * como todo); escribir, solo para administradores.
 *
 * Protección CSRF de las escrituras, como el resto de la API: cookie de sesión
 * `SameSite=Lax` (otra web no la envía en un POST), solo cuerpos JSON (un
 * formulario ajeno no puede enviarlos sin permiso del navegador) y, además,
 * cabecera `Origin` obligatoria e igual a `PUBLIC_URL`, como al pedir el
 * WebSocket.
 */
export async function wikiRoutes(app: FastifyInstance, { config, db, wiki }: WikiDeps) {
  const cookieName = sessionCookieName(config);
  const allowedOrigin = new URL(config.PUBLIC_URL).origin;
  // Escrituras por administrador: de sobra para editar, poco para un abuso.
  const writesPerAccount = new RateLimiter(60, 10 * 60_000);

  /** Administrador de la sesión para escribir; si no lo es, ya ha respondido con el error. */
  async function adminFor(req: FastifyRequest, reply: FastifyReply, write: boolean): Promise<AuthAccount | null> {
    if (write && req.headers.origin !== allowedOrigin) {
      await fail(reply, 403, "invalid_request");
      return null;
    }
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) {
      await fail(reply, 401, "unauthenticated");
      return null;
    }
    if (!isAdmin(config, account)) {
      await fail(reply, 403, "forbidden");
      return null;
    }
    if (write && !writesPerAccount.consume(account.id)) {
      await fail(reply, 429, "rate_limited");
      return null;
    }
    return account;
  }

  async function handle<T>(reply: FastifyReply, run: () => Promise<T>): Promise<T | FastifyReply> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof WikiError) return fail(reply, err.status, err.code);
      throw err;
    }
  }

  app.get("/api/wiki", async (req, reply) => {
    const admin = isAdmin(config, await accountFromRequest(db, cookieName, req));
    reply.header("Cache-Control", "no-store");
    return { ...(await wiki.state(admin)), admin } satisfies WikiStateResponse;
  });

  app.get("/api/wiki/me", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return { admin: isAdmin(config, await accountFromRequest(db, cookieName, req)) } satisfies WikiMeResponse;
  });

  app.get<{ Querystring: { slug?: string; locale?: string } }>("/api/wiki/history", async (req, reply) => {
    if (!(await adminFor(req, reply, false))) return reply;
    const slug = req.query.slug ?? "";
    const locale = req.query.locale === undefined ? null : LocaleSchema.safeParse(req.query.locale);
    if (!isValidWikiSlug(slug) || (locale && !locale.success)) return fail(reply, 400, "invalid_request");
    return { revisions: await wiki.history(slug, locale?.data ?? null) } satisfies WikiHistoryResponse;
  });

  app.get<{ Params: { id: string } }>("/api/wiki/revisions/:id", async (req, reply) => {
    if (!(await adminFor(req, reply, false))) return reply;
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) return fail(reply, 400, "invalid_request");
    const revision = await wiki.revision(id);
    if (!revision) return fail(reply, 404, "unknown_article");
    return { revision } satisfies WikiRevisionResponse;
  });

  // Un artículo puede ocupar hasta WIKI_BODY_MAX caracteres (más bytes en UTF-8).
  app.post("/api/wiki/save", { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const account = await adminFor(req, reply, true);
    if (!account) return reply;
    const parsed = WikiSaveBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    return handle(reply, async () => {
      const published = await wiki.save(await wiki.authorFor(account), parsed.data);
      req.log.info({ wiki: { action: "save", slug: published.slug, locale: published.locale, revision: published.revisionId, by: maskEmail(account.email) } }, "Wiki: artículo editado");
      return { published } satisfies WikiSaveResponse;
    });
  });

  app.post("/api/wiki/restore", async (req, reply) => {
    const account = await adminFor(req, reply, true);
    if (!account) return reply;
    const parsed = WikiRestoreBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    return handle(reply, async () => {
      const published = await wiki.restore(await wiki.authorFor(account), parsed.data.revisionId, parsed.data.note);
      req.log.info({ wiki: { action: "restore", slug: published.slug, locale: published.locale, from: parsed.data.revisionId, by: maskEmail(account.email) } }, "Wiki: revisión restaurada");
      return { published } satisfies WikiSaveResponse;
    });
  });

  app.post("/api/wiki/create", async (req, reply) => {
    const account = await adminFor(req, reply, true);
    if (!account) return reply;
    const parsed = WikiCreateBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    return handle(reply, async () => {
      const res = await wiki.create(await wiki.authorFor(account), parsed.data);
      req.log.info({ wiki: { action: "create", slug: res.page.slug, by: maskEmail(account.email) } }, "Wiki: artículo nuevo");
      return res satisfies WikiPageResponse;
    });
  });

  app.post("/api/wiki/meta", async (req, reply) => {
    const account = await adminFor(req, reply, true);
    if (!account) return reply;
    const parsed = WikiMetaBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    return handle(reply, async () => {
      const page = await wiki.setMeta(await wiki.authorFor(account), parsed.data);
      req.log.info({ wiki: { action: "meta", slug: page.slug, hidden: page.hidden, group: page.group, by: maskEmail(account.email) } }, "Wiki: datos del artículo");
      return { page } satisfies WikiPageResponse;
    });
  });
}
