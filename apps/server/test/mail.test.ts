/**
 * Tests del correo real (SMTP) con un servidor SMTP falso en memoria, escuchando
 * en un puerto aleatorio de 127.0.0.1. Los de la petición de enlace completa
 * usan además la base de datos de pruebas (TEST_DATABASE_URL); sin ella se saltan.
 */
import { createServer, type AddressInfo, type Server } from "node:net";
import { sql } from "drizzle-orm";
import { simpleParser, type ParsedMail } from "mailparser";
import { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOGIN_TOKEN_PARAM, type Locale } from "@imperium/shared";
import { buildApp } from "../src/app";
import { hashToken } from "../src/auth/tokens";
import { loadConfig, parseMailFrom } from "../src/config";
import { createDb } from "../src/db/client";
import { magicLinkTokens } from "../src/db/schema";
import { describeMailError, renderLoginEmail, SmtpMailer, type Mailer, type MailLog } from "../src/mail";
import { resetTestDatabase } from "./resetDb";

const USER = "aeonarch-pruebas";
const PASS = "contraseña-de-pruebas-123";
const FROM = "Aeonarch <no-reply@aeonarch.test>";
const LINK = "http://juego.test/#login=abcDEF123_-xyz";

interface Received {
  parsed: ParsedMail;
  raw: string;
  rcpt: string[];
  secure: boolean;
}

/** Servidor SMTP falso: exige STARTTLS y usuario/contraseña, y guarda lo que recibe. */
async function startFakeSmtp(opts: { rejectRecipients?: boolean } = {}) {
  const received: Received[] = [];
  const server = new SMTPServer({
    secure: false,
    // Sin TLS no acepta la autenticación: comprueba que el cliente usa STARTTLS.
    allowInsecureAuth: false,
    authMethods: ["PLAIN", "LOGIN"],
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username === USER && auth.password === PASS) cb(null, { user: USER });
      else cb(new Error("Invalid username or password"));
    },
    onRcptTo(address, _session, cb) {
      if (opts.rejectRecipients) {
        cb(Object.assign(new Error(`<${address.address}>: Recipient address rejected`), { responseCode: 550 }));
      } else cb();
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        const raw = Buffer.concat(chunks);
        simpleParser(raw).then(
          (parsed) => {
            received.push({
              parsed,
              raw: raw.toString("utf8"),
              rcpt: session.envelope.rcptTo.map((r) => r.address),
              secure: session.secure,
            });
            cb();
          },
          (err: Error) => cb(err),
        );
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.server.address() as AddressInfo).port;
  return { port, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** Configuración SMTP completa de pruebas; `extra` sobrescribe. */
function smtpEnv(port: number, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://nadie@localhost/nada",
    PUBLIC_URL: "http://juego.test",
    COOKIE_SECURE: "false",
    MAIL_TRANSPORT: "smtp",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(port),
    SMTP_USER: USER,
    SMTP_PASS: PASS,
    MAIL_FROM: FROM,
    ...extra,
  };
}

/** Registro falso que guarda todo lo escrito, para comprobar qué se filtra. */
function memoryLog() {
  const lines: string[] = [];
  const log: MailLog = {
    info: (obj, msg) => void lines.push(JSON.stringify({ level: "info", msg, ...obj })),
    warn: (obj, msg) => void lines.push(JSON.stringify({ level: "warn", msg, ...obj })),
  };
  return { log, lines };
}

// El servidor falso usa un certificado autofirmado: solo aquí se acepta.
const TEST_TLS = { tls: { rejectUnauthorized: false } };
const FAST = { timeouts: { connection: 1000, greeting: 1000, socket: 1000, total: 2000 } };

describe("configuración del correo", () => {
  const base = { APP_ENV: "staging", DATABASE_URL: "postgres://x@localhost/x", PUBLIC_URL: "http://juego.test" };

  it("con MAIL_TRANSPORT=smtp el servidor no arranca si falta algo", () => {
    expect(() => loadConfig({ ...base, MAIL_TRANSPORT: "smtp" })).toThrow(/SMTP_HOST[\s\S]*SMTP_USER[\s\S]*SMTP_PASS[\s\S]*MAIL_FROM/);
    const full = smtpEnv(587, { APP_ENV: "staging" });
    for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]) {
      expect(() => loadConfig({ ...full, [key]: undefined })).toThrow(new RegExp(key));
    }
    expect(() => loadConfig({ ...full, MAIL_FROM: "Aeonarch" })).toThrow(/MAIL_FROM/);
    expect(loadConfig(full).MAIL_TRANSPORT).toBe("smtp");
  });

  it("TLS directo según el puerto, salvo que SMTP_SECURE diga otra cosa", () => {
    expect(loadConfig(smtpEnv(587)).SMTP_SECURE).toBe(false);
    expect(loadConfig(smtpEnv(465)).SMTP_SECURE).toBe(true);
    expect(loadConfig(smtpEnv(2465, { SMTP_SECURE: "true" })).SMTP_SECURE).toBe(true);
    expect(loadConfig(smtpEnv(465, { SMTP_SECURE: "false" })).SMTP_SECURE).toBe(false);
  });

  it("MAIL_LOG_LINKS se permite en staging pero no en producción", () => {
    expect(loadConfig(smtpEnv(587, { APP_ENV: "staging", MAIL_LOG_LINKS: "true" })).MAIL_LOG_LINKS).toBe(true);
    const production = smtpEnv(587, {
      APP_ENV: "production",
      PUBLIC_URL: "https://juego.test",
      COOKIE_SECURE: "true",
      DETAIL_SEED: "semilla-secreta-de-pruebas-larga",
    });
    expect(loadConfig(production).MAIL_LOG_LINKS).toBe(false);
    expect(() => loadConfig({ ...production, MAIL_LOG_LINKS: "true" })).toThrow(/MAIL_LOG_LINKS/);
  });

  it("lee la dirección y el dominio del remitente", () => {
    expect(parseMailFrom("Aeonarch <no-reply@Ejemplo.com>")).toEqual({ address: "no-reply@Ejemplo.com", domain: "ejemplo.com" });
    expect(parseMailFrom('"Aeonarch, el juego" <hola@mail.ejemplo.es>')?.domain).toBe("mail.ejemplo.es");
    expect(parseMailFrom("hola@ejemplo.com")?.address).toBe("hola@ejemplo.com");
    expect(parseMailFrom("Aeonarch")).toBeNull();
    expect(parseMailFrom("hola@localhost")).toBeNull();
  });
});

describe("contenido del correo", () => {
  it("en el idioma pedido, con el enlace, la caducidad y el aviso", () => {
    const es = renderLoginEmail(LINK, "es");
    expect(es.subject).toBe("Tu enlace de acceso a Aeonarch");
    expect(es.text).toContain(LINK);
    expect(es.text).toContain("15 minutos");
    expect(es.text).toContain("Si no lo has pedido tú");
    expect(es.html).toContain('<html lang="es">');
    expect(es.html).toContain(`href="${LINK}"`);

    const en = renderLoginEmail(LINK, "en");
    expect(en.subject).toBe("Your Aeonarch sign-in link");
    expect(en.text).toContain("15 minutes");
    expect(en.html).toContain('<html lang="en">');
    // Sin imágenes ni recursos remotos.
    for (const mail of [es, en]) expect(mail.html).not.toMatch(/<img|src=|url\(/i);
  });

  it("escapa el enlace en el HTML", () => {
    expect(renderLoginEmail('http://x.test/#a"<b>&', "es").html).not.toContain('"<b>&');
  });

  it("los errores para el registro no llevan direcciones ni credenciales", () => {
    const err = Object.assign(new Error("Can't send mail - all recipients were rejected: 550 <andrea@ejemplo.com>: rejected"), {
      code: "EENVELOPE",
      responseCode: 550,
      command: "AUTH PLAIN AGFlb25hcmNoAHNlY3JldG8=",
    });
    const described = describeMailError(err);
    expect(described).toMatchObject({ code: "EENVELOPE", responseCode: 550, command: "AUTH" });
    expect(described.message).toContain("an***@ejemplo.com");
    expect(JSON.stringify(described)).not.toContain("andrea@");
    expect(JSON.stringify(described)).not.toContain("AGFlb25hcmNo");
  });
});

describe("SmtpMailer con un servidor SMTP falso", () => {
  let smtp: Awaited<ReturnType<typeof startFakeSmtp>>;
  beforeAll(async () => {
    smtp = await startFakeSmtp();
  });
  afterAll(() => smtp.close());
  beforeEach(() => {
    smtp.received.length = 0;
  });

  for (const locale of ["es", "en"] as Locale[]) {
    it(`envía el enlace por STARTTLS, con texto, HTML y cabeceras correctas (${locale})`, async () => {
      const { log } = memoryLog();
      const mailer = new SmtpMailer(loadConfig(smtpEnv(smtp.port)), log, TEST_TLS);
      await mailer.sendLoginLink("ana@ejemplo.com", LINK, locale);
      mailer.close();

      expect(smtp.received).toHaveLength(1);
      const { parsed, rcpt, secure, raw } = smtp.received[0]!;
      const expected = renderLoginEmail(LINK, locale);
      expect(secure).toBe(true);
      expect(rcpt).toEqual(["ana@ejemplo.com"]);
      expect(parsed.from?.value[0]?.address).toBe("no-reply@aeonarch.test");
      expect(parsed.subject).toBe(expected.subject);
      expect(parsed.text).toContain(LINK);
      expect(parsed.text).toContain(locale === "es" ? "15 minutos" : "15 minutes");
      expect(parsed.html).toContain(`href="${LINK}"`);
      expect(parsed.html).toContain(`lang="${locale}"`);
      expect(parsed.messageId).toMatch(/^<[0-9a-f-]{36}@aeonarch\.test>$/);
      expect(parsed.date).toBeInstanceOf(Date);
      expect(raw).toMatch(/^Content-Type: multipart\/alternative/im);
      expect(parsed.headers.get("auto-submitted")).toBe("auto-generated");
    });
  }

  it("verify: correcta con buenas credenciales; con malas avisa sin escribir la contraseña", async () => {
    const good = memoryLog();
    const ok = new SmtpMailer(loadConfig(smtpEnv(smtp.port)), good.log, TEST_TLS);
    expect(await ok.verify()).toBe(true);
    ok.close();

    const bad = memoryLog();
    const wrong = new SmtpMailer(loadConfig(smtpEnv(smtp.port, { SMTP_PASS: "clave-equivocada-xyz" })), bad.log, TEST_TLS);
    expect(await wrong.verify()).toBe(false);
    wrong.close();
    expect(bad.lines.some((l) => l.includes('"level":"warn"') && l.includes("SMTP"))).toBe(true);
    expect(bad.lines.join("\n")).not.toContain("clave-equivocada-xyz");
  });

  it("MAIL_LOG_LINKS escribe el enlace en el registro con el correo enmascarado", async () => {
    const { log, lines } = memoryLog();
    const mailer = new SmtpMailer(loadConfig(smtpEnv(smtp.port, { MAIL_LOG_LINKS: "true" })), log, TEST_TLS);
    await mailer.sendLoginLink("andrea@ejemplo.com", LINK, "es");
    mailer.close();
    expect(smtp.received).toHaveLength(1);
    const logged = lines.join("\n");
    expect(logged).toContain(LINK);
    expect(logged).toContain("an***@ejemplo.com");
    expect(logged).not.toContain("andrea@");
    expect(logged).not.toContain(PASS);
  });

  it("sin MAIL_LOG_LINKS el enlace no aparece en el registro", async () => {
    const { log, lines } = memoryLog();
    const mailer = new SmtpMailer(loadConfig(smtpEnv(smtp.port)), log, TEST_TLS);
    await mailer.sendLoginLink("ana@ejemplo.com", LINK, "es");
    mailer.close();
    expect(lines.join("\n")).not.toContain(LINK);
  });

  it("un servidor que no responde no cuelga el envío", async () => {
    // Acepta la conexión pero nunca saluda.
    const silent: Server = createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as AddressInfo).port;
    const mailer = new SmtpMailer(loadConfig(smtpEnv(port)), memoryLog().log, { ...TEST_TLS, ...FAST });
    const started = Date.now();
    await expect(mailer.sendLoginLink("ana@ejemplo.com", LINK, "es")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
    mailer.close();
    silent.close();
  });
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("petición de enlace con correo real", () => {
  const database = createDb(TEST_DATABASE_URL ?? "");
  let smtp: Awaited<ReturnType<typeof startFakeSmtp>>;
  let rejecting: Awaited<ReturnType<typeof startFakeSmtp>>;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeAll(async () => {
    await resetTestDatabase(database);
    smtp = await startFakeSmtp();
    rejecting = await startFakeSmtp({ rejectRecipients: true });
  });
  beforeEach(async () => {
    smtp.received.length = 0;
    failures.length = 0;
    await database.db.execute(sql`TRUNCATE accounts, magic_link_tokens, sessions CASCADE`);
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  afterAll(async () => {
    await smtp.close();
    await rejecting.close();
    await database.close();
  });

  /** Errores del envío, para comprobar que el fallo ocurrió de verdad (la respuesta no lo dice). */
  const failures: unknown[] = [];

  async function appWithSmtp(port: number) {
    const config = loadConfig(smtpEnv(port));
    const smtpMailer = new SmtpMailer(config, memoryLog().log, { ...TEST_TLS, ...FAST });
    const mailer: Mailer = {
      sendLoginLink: (to, link, locale) =>
        smtpMailer.sendLoginLink(to, link, locale).catch((err: unknown) => {
          failures.push(err);
          throw err;
        }),
    };
    app = await buildApp(config, { db: database.db, mailer });
    return app;
  }

  const request = (a: NonNullable<typeof app>, email: string, locale: Locale) =>
    a.inject({ method: "POST", url: "/api/auth/request", payload: { email, locale }, remoteAddress: "10.0.0.1" });

  it("envía el correo con un enlace válido en el idioma pedido", async () => {
    const a = await appWithSmtp(smtp.port);
    const res = await request(a, "Ana@Ejemplo.com", "en");
    expect(res.statusCode).toBe(202);
    expect(smtp.received).toHaveLength(1);
    const { parsed, rcpt } = smtp.received[0]!;
    expect(rcpt).toEqual(["ana@ejemplo.com"]);
    expect(parsed.subject).toBe("Your Aeonarch sign-in link");

    const link = /http:\/\/juego\.test\/#login=[A-Za-z0-9_-]+/.exec(parsed.text ?? "")?.[0] ?? "";
    expect(parsed.html).toContain(`href="${link}"`);
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get(LOGIN_TOKEN_PARAM) ?? "";
    const rows = await database.db.select().from(magicLinkTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashToken(token));

    // El enlace del correo sirve para entrar.
    const verified = await a.inject({ method: "POST", url: "/api/auth/verify", payload: { token } });
    expect(verified.statusCode).toBe(200);
  });

  it("si el servidor SMTP rechaza el envío, la respuesta es la de siempre", async () => {
    const ok = await request(await appWithSmtp(smtp.port), "ana@ejemplo.com", "es");
    await app?.close();
    const rejected = await request(await appWithSmtp(rejecting.port), "ana@ejemplo.com", "es");
    expect(rejected.statusCode).toBe(ok.statusCode);
    expect(rejected.body).toBe(ok.body);
    expect(rejected.body).not.toMatch(/ana|550|reject/i);
    expect(failures).toHaveLength(1);
    expect(rejecting.received).toHaveLength(0);
  });

  it("si el servidor SMTP está caído, la respuesta es la de siempre y no se cuelga", async () => {
    // Un puerto que se acaba de liberar: nadie escucha.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const res = await request(await appWithSmtp(port), "ana@ejemplo.com", "es");
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(failures).toHaveLength(1);
  });

  it("los límites de envío por correo se mantienen", async () => {
    const a = await appWithSmtp(smtp.port);
    for (let i = 0; i < 4; i++) expect((await request(a, "ana@ejemplo.com", "es")).statusCode).toBe(202);
    // 3 por correo cada 15 minutos: el cuarto se responde igual pero no se envía.
    expect(smtp.received).toHaveLength(3);
  });
});
