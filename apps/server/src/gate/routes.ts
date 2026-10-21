import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ipRateKey, RateLimiter } from "../auth/rateLimit";
import type { ServerConfig } from "../config";
import { GATE_PAGE } from "./page";

/**
 * Puerta de entrada mientras el juego no está abierto al público: sustituye al
 * `basicauth` de Caddy. Caddy pregunta a `/puerta/check` antes de cada petición
 * (`forward_auth`); sin la cookie de la puerta, el navegador va a `/puerta/`,
 * una página propia con usuario y contraseña. Hay una credencial en el `.env`
 * (`GATE_USER`, `GATE_PASSWORD_HASH`) y, si se indica, más en `GATE_USERS_FILE`
 * (una por persona invitada; `scripts/gate-user.mjs`). La cookie lleva el
 * usuario y va firmada con `GATE_SECRET`; dura `COOKIE_DAYS` y deja de valer
 * si se quita ese usuario. Sin secreto, la puerta no deja pasar a nadie.
 */
const COOKIE = "aeon_gate";
const COOKIE_DAYS = 7;

/** Contraseña → `scrypt$<sal>$<hash>` (la misma función que scripts/gate-password.mjs). */
export function hashGatePassword(password: string, salt: Buffer): string {
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), want.length);
  return timingSafeEqual(want, got);
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const sign = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");

/** Valor de la cookie: usuario, caducidad y firma de ambos. */
function cookieValue(secret: string, user: string, until: number): string {
  return `${Buffer.from(user).toString("base64url")}.${until}.${sign(secret, `${user}|${until}`)}`;
}

/** Usuario de una cookie válida (firmada, sin caducar), o null. */
function cookieUser(secret: string, value: string | undefined, now: number): string | null {
  if (!value) return null;
  const [userText, untilText, mac] = value.split(".");
  const until = Number(untilText);
  if (!userText || !mac || !Number.isFinite(until) || until < now) return null;
  const user = Buffer.from(userText, "base64url").toString();
  return sameText(mac, sign(secret, `${user}|${until}`)) ? user : null;
}

/** Credenciales del archivo `GATE_USERS_FILE` (`{ users: { nombre: { hash } } }`), releído cuando cambia. */
function usersFile(path: string | undefined): () => Map<string, string> {
  let mtime = -1;
  let checkedAt = 0;
  let users = new Map<string, string>();
  return () => {
    if (!path) return users;
    const now = Date.now();
    if (now - checkedAt < 2000) return users;
    checkedAt = now;
    try {
      const m = statSync(path).mtimeMs;
      if (m !== mtime) {
        mtime = m;
        const data = JSON.parse(readFileSync(path, "utf8")) as { users?: Record<string, { hash?: string }> };
        users = new Map(Object.entries(data.users ?? {}).flatMap(([name, u]) => (u.hash ? [[name, u.hash] as [string, string]] : [])));
      }
    } catch {
      // Sin archivo (o mal escrito): solo vale la credencial del .env.
      users = new Map();
      mtime = -1;
    }
    return users;
  };
}

/** Solo se vuelve a rutas propias (nada de redirigir a otra web). */
function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/)[^\s\\]*$/.test(next) && !next.startsWith("/puerta") ? next : "/";
}

const LoginBody = z.object({ user: z.string().max(100), password: z.string().max(200), next: z.string().max(500).optional() });

export async function gateRoutes(app: FastifyInstance, { config }: { config: ServerConfig }) {
  const secret = config.GATE_SECRET;
  const fileUsers = usersFile(config.GATE_USERS_FILE);
  /** Hash de la contraseña de un usuario (el del .env o los del archivo). */
  const hashOf = (name: string): string | null => {
    if (config.GATE_USER && config.GATE_PASSWORD_HASH && sameText(name, config.GATE_USER)) return config.GATE_PASSWORD_HASH;
    return fileUsers().get(name) ?? null;
  };
  // Intentos de entrar: pocos por IP (fuerza bruta) y un tope general.
  const perIp = new RateLimiter(8, 10 * 60_000);
  const global = new RateLimiter(200, 60_000);

  const allowed = (req: FastifyRequest) => {
    if (!secret) return false;
    const name = cookieUser(secret, req.cookies[COOKIE], Date.now());
    return name !== null && hashOf(name) !== null;
  };

  // Caddy (forward_auth): 2xx deja pasar; si no, el navegador va a la puerta.
  app.get("/puerta/check", async (req, reply: FastifyReply) => {
    if (allowed(req)) return reply.code(204).send();
    const uri = typeof req.headers["x-forwarded-uri"] === "string" ? req.headers["x-forwarded-uri"] : "/";
    // La API y el WebSocket no son páginas: un 401 basta.
    if (uri.startsWith("/api/") || uri.startsWith("/ws")) return reply.code(401).send();
    return reply.redirect(`/puerta/?next=${encodeURIComponent(safeNext(uri))}`, 302);
  });

  app.get("/puerta/", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'");
    return reply.type("text/html; charset=utf-8").send(GATE_PAGE);
  });

  app.post("/puerta/entrar", async (req, reply) => {
    if (!perIp.consume(ipRateKey(req.ip)) || !global.consume("global")) return reply.code(429).send({ error: "rate_limited" });
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const name = parsed.data.user.trim();
    const hash = secret ? hashOf(name) : null;
    if (!hash || !checkPassword(parsed.data.password, hash)) return reply.code(401).send({ error: "wrong" });
    const until = Date.now() + COOKIE_DAYS * 24 * 3600_000;
    reply.setCookie(COOKIE, cookieValue(secret!, name, until), {
      path: "/",
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      maxAge: COOKIE_DAYS * 24 * 3600,
    });
    return { ok: true, next: safeNext(parsed.data.next) };
  });

  app.post("/puerta/salir", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
}
