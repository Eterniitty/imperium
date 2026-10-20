import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  LOGIN_TOKEN_PARAM,
  MAGIC_LINK_TTL_MINUTES,
  type ApiError,
  type AuthAccount,
  type AuthMeResponse,
  type Locale,
} from "@imperium/shared";
import { AuthRequestBodySchema, AuthVerifyBodySchema } from "@imperium/shared/schemas";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { accounts, magicLinkTokens, sessions } from "../db/schema";
import type { Mailer } from "../mail";
import { RateLimiter } from "./rateLimit";
import { generateToken, hashToken, normalizeEmail } from "./tokens";

export const SESSION_COOKIE = "aeon_session";
const SESSION_TTL_DAYS = 30;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface AuthDeps {
  config: ServerConfig;
  db: Database;
  mailer: Mailer;
}

/** Cuenta asociada a la cookie de sesión, o null si no hay sesión válida. */
export async function accountFromRequest(db: Database, req: FastifyRequest): Promise<AuthAccount | null> {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const rows = await db
    .select({ id: accounts.id, email: accounts.email, locale: accounts.locale })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(and(eq(sessions.idHash, hashToken(sessionId)), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  const row = rows[0];
  return row ? { ...row, locale: row.locale as Locale } : null;
}

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

export async function authRoutes(app: FastifyInstance, { config, db, mailer }: AuthDeps) {
  // Límites para pedir enlaces: frenan el abuso del correo y el spam a terceros.
  const perIp = new RateLimiter(10, 15 * MINUTE);
  const perEmail = new RateLimiter(3, 15 * MINUTE);
  // Límite para canjear: frena intentos de adivinar tokens (de todos modos imposibles con 256 bits).
  const verifyPerIp = new RateLimiter(30, 15 * MINUTE);

  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "lax",
  } as const;

  app.post("/api/auth/request", async (req, reply) => {
    const parsed = AuthRequestBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const email = normalizeEmail(parsed.data.email);
    if (!perIp.consume(req.ip) || !perEmail.consume(email)) return fail(reply, 429, "rate_limited");

    const token = generateToken();
    await db.insert(magicLinkTokens).values({
      tokenHash: hashToken(token),
      email,
      locale: parsed.data.locale,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * MINUTE),
      requestIp: req.ip,
    });
    // Limpieza de enlaces caducados hace más de un día (barata gracias al índice).
    await db.delete(magicLinkTokens).where(lt(magicLinkTokens.expiresAt, new Date(Date.now() - DAY)));

    const link = `${config.PUBLIC_URL}/?${LOGIN_TOKEN_PARAM}=${token}`;
    await mailer.sendLoginLink(email, link, parsed.data.locale);
    // La respuesta es la misma exista o no la cuenta: no revela qué correos están registrados.
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/auth/verify", async (req, reply) => {
    if (!verifyPerIp.consume(req.ip)) return fail(reply, 429, "rate_limited");
    const parsed = AuthVerifyBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");

    const sessionId = generateToken();
    const account = await db.transaction(async (tx) => {
      // Marcar como usado y leer en una sola sentencia: dos canjes simultáneos
      // del mismo enlace no pueden tener éxito los dos.
      const [link] = await tx
        .update(magicLinkTokens)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(magicLinkTokens.tokenHash, hashToken(parsed.data.token)),
            isNull(magicLinkTokens.usedAt),
            gt(magicLinkTokens.expiresAt, sql`now()`),
          ),
        )
        .returning({ email: magicLinkTokens.email, locale: magicLinkTokens.locale });
      if (!link) return null;

      const [acc] = await tx
        .insert(accounts)
        .values({ email: link.email, locale: link.locale, lastLoginAt: sql`now()` })
        .onConflictDoUpdate({ target: accounts.email, set: { lastLoginAt: sql`now()` } })
        .returning({ id: accounts.id, email: accounts.email, locale: accounts.locale });
      if (!acc) throw new Error("No se pudo crear o leer la cuenta");

      await tx.insert(sessions).values({
        idHash: hashToken(sessionId),
        accountId: acc.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * DAY),
        ip: req.ip,
      });
      return acc;
    });
    if (!account) return fail(reply, 400, "invalid_or_expired");

    reply.setCookie(SESSION_COOKIE, sessionId, { ...cookieOptions, maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 });
    return { account: { ...account, locale: account.locale as Locale } } satisfies AuthMeResponse;
  });

  app.get("/api/auth/me", async (req, reply) => {
    const account = await accountFromRequest(db, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    return { account } satisfies AuthMeResponse;
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const sessionId = req.cookies[SESSION_COOKIE];
    if (sessionId) await db.delete(sessions).where(eq(sessions.idHash, hashToken(sessionId)));
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.code(204).send();
  });
}
