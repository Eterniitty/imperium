import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  LEGAL_VERSION,
  LOGIN_TOKEN_PARAM,
  MAGIC_LINK_TTL_MINUTES,
  type ApiError,
  type AuthAccount,
  type AuthMeResponse,
  type AuthPeekResponse,
  type Locale,
} from "@imperium/shared";
import { AuthRequestBodySchema, AuthVerifyBodySchema } from "@imperium/shared/schemas";
import type { ServerConfig } from "../config";
import type { Database } from "../db/client";
import { accounts, magicLinkTokens, sessions } from "../db/schema";
import { describeMailError, type Mailer } from "../mail";
import { emailRateKey, ipRateKey, RateLimiter } from "./rateLimit";
import { generateToken, hashToken, maskEmail, normalizeEmail } from "./tokens";

/**
 * Nombre de la cookie de sesión. Con HTTPS lleva el prefijo `__Host-`, que obliga
 * al navegador a exigir Secure, `path=/` y ningún Domain: un subdominio no puede
 * plantar una sesión falsa.
 */
export function sessionCookieName(config: Pick<ServerConfig, "COOKIE_SECURE">): string {
  return config.COOKIE_SECURE ? "__Host-aeon_session" : "aeon_session";
}
const SESSION_TTL_DAYS = 30;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface AuthDeps {
  config: ServerConfig;
  db: Database;
  mailer: Mailer;
}

/** Cuenta asociada a la cookie de sesión, o null si no hay sesión válida. */
export async function accountFromRequest(db: Database, cookieName: string, req: FastifyRequest): Promise<AuthAccount | null> {
  const sessionId = req.cookies[cookieName];
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

// Vive en tokens.ts (también lo usa el correo); se reexporta para no romper importaciones.
export { maskEmail };

function fail(reply: FastifyReply, status: number, error: ApiError["error"]) {
  return reply.code(status).send({ error } satisfies ApiError);
}

/** Condición de enlace válido: existe, no se ha usado y no ha caducado. */
function usableLink(token: string) {
  return and(eq(magicLinkTokens.tokenHash, hashToken(token)), isNull(magicLinkTokens.usedAt), gt(magicLinkTokens.expiresAt, sql`now()`));
}

export async function authRoutes(app: FastifyInstance, { config, db, mailer }: AuthDeps) {
  // Límites para pedir enlaces: frenan el abuso del correo y el spam a terceros.
  const perIp = new RateLimiter(config.AUTH_REQUESTS_PER_IP, 15 * MINUTE);
  const perEmail = new RateLimiter(3, 15 * MINUTE);
  // Tope global de envíos: protege la reputación del dominio aunque el atacante reparta IP y correos.
  const globalSends = new RateLimiter(60, MINUTE);
  // Límite para consultar y canjear: frena intentos de adivinar tokens (de todos modos imposibles con 256 bits).
  const verifyPerIp = new RateLimiter(30, 15 * MINUTE);

  const cookieName = sessionCookieName(config);
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
    if (!perIp.consume(ipRateKey(req.ip)) || !globalSends.consume("global")) return fail(reply, 429, "rate_limited");
    // Superado el límite del correo se responde igual pero sin enviar nada: así nadie
    // puede bloquear el acceso de otra persona pidiendo enlaces a su nombre.
    if (!perEmail.consume(emailRateKey(email))) return reply.code(202).send({ ok: true });

    const token = generateToken();
    await db.insert(magicLinkTokens).values({
      tokenHash: hashToken(token),
      email,
      locale: parsed.data.locale,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * MINUTE),
      requestIp: req.ip,
      termsVersion: LEGAL_VERSION,
    });
    // Limpieza de enlaces caducados hace más de un día (barata gracias al índice).
    await db.delete(magicLinkTokens).where(lt(magicLinkTokens.expiresAt, new Date(Date.now() - DAY)));

    const link = `${config.PUBLIC_URL}/#${LOGIN_TOKEN_PARAM}=${token}`;
    try {
      await mailer.sendLoginLink(email, link, parsed.data.locale);
    } catch (err) {
      // Si el envío falla se registra (correo enmascarado, sin el enlace) y se responde
      // igual: la respuesta no puede servir para averiguar nada sobre el destinatario.
      req.log.error({ mail: { to: maskEmail(email), error: describeMailError(err) } }, "No se pudo enviar el enlace de acceso");
    }
    // La respuesta es la misma exista o no la cuenta: no revela qué correos están registrados.
    return reply.code(202).send({ ok: true });
  });

  // Consulta a qué cuenta lleva un enlace sin gastarlo. El cliente lo muestra y
  // pide confirmación antes de canjear: abrir un enlace ajeno (que alguien te pasa
  // para meterte en su cuenta) ya no inicia sesión sin que te des cuenta.
  app.post("/api/auth/peek", async (req, reply) => {
    if (!verifyPerIp.consume(ipRateKey(req.ip))) return fail(reply, 429, "rate_limited");
    const parsed = AuthVerifyBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const [link] = await db.select({ email: magicLinkTokens.email }).from(magicLinkTokens).where(usableLink(parsed.data.token)).limit(1);
    if (!link) return fail(reply, 400, "invalid_or_expired");
    return { email: maskEmail(link.email) } satisfies AuthPeekResponse;
  });

  app.post("/api/auth/verify", async (req, reply) => {
    if (!verifyPerIp.consume(ipRateKey(req.ip))) return fail(reply, 429, "rate_limited");
    const parsed = AuthVerifyBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");

    const previousSession = req.cookies[cookieName];
    const sessionId = generateToken();
    const account = await db.transaction(async (tx) => {
      // Marcar como usado y leer en una sola sentencia: dos canjes simultáneos
      // del mismo enlace no pueden tener éxito los dos.
      const [link] = await tx
        .update(magicLinkTokens)
        .set({ usedAt: sql`now()` })
        .where(usableLink(parsed.data.token))
        .returning({ email: magicLinkTokens.email, locale: magicLinkTokens.locale, termsVersion: magicLinkTokens.termsVersion });
      if (!link) return null;

      // Al entrar, los demás enlaces pendientes de ese correo dejan de valer.
      await tx
        .update(magicLinkTokens)
        .set({ usedAt: sql`now()` })
        .where(and(eq(magicLinkTokens.email, link.email), isNull(magicLinkTokens.usedAt)));

      // Se guarda qué versión de los términos aceptó al pedir el enlace, y cuándo.
      const terms = link.termsVersion ? { termsVersion: link.termsVersion, termsAcceptedAt: sql`now()` } : {};
      const [acc] = await tx
        .insert(accounts)
        .values({ email: link.email, locale: link.locale, lastLoginAt: sql`now()`, ...terms })
        .onConflictDoUpdate({ target: accounts.email, set: { lastLoginAt: sql`now()`, ...terms } })
        .returning({ id: accounts.id, email: accounts.email, locale: accounts.locale });
      if (!acc) throw new Error("No se pudo crear o leer la cuenta");

      // La sesión anterior de este navegador, si la había, se cierra.
      if (previousSession) await tx.delete(sessions).where(eq(sessions.idHash, hashToken(previousSession)));
      await tx.insert(sessions).values({
        idHash: hashToken(sessionId),
        accountId: acc.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * DAY),
        ip: req.ip,
      });
      return acc;
    });
    if (!account) return fail(reply, 400, "invalid_or_expired");

    reply.setCookie(cookieName, sessionId, { ...cookieOptions, maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 });
    return { account: { ...account, locale: account.locale as Locale } } satisfies AuthMeResponse;
  });

  app.get("/api/auth/me", async (req, reply) => {
    const account = await accountFromRequest(db, cookieName, req);
    if (!account) return fail(reply, 401, "unauthenticated");
    return { account } satisfies AuthMeResponse;
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const sessionId = req.cookies[cookieName];
    if (sessionId) await db.delete(sessions).where(eq(sessions.idHash, hashToken(sessionId)));
    reply.clearCookie(cookieName, cookieOptions);
    return reply.code(204).send();
  });
}
