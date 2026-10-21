import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { ConnectionOptions } from "node:tls";
import nodemailer, { type Transporter } from "nodemailer";
import { LEGAL_PAGES, MAGIC_LINK_TTL_MINUTES, translate, type Locale } from "@imperium/shared";
import { maskEmail, maskEmailsIn } from "./auth/tokens";
import { parseMailFrom, type ServerConfig } from "./config";

export interface Mailer {
  sendLoginLink(to: string, link: string, locale: Locale): Promise<void>;
}

/** Lo que el correo necesita del registro (el de Fastify lo cumple; los tests usan uno falso). */
export interface MailLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * Correo por consola: escribe el enlace en el registro del servidor en lugar de
 * enviarlo. Solo para desarrollo y pruebas; la configuración lo prohíbe en producción.
 */
class ConsoleMailer implements Mailer {
  constructor(private readonly log: MailLog) {}

  async sendLoginLink(to: string, link: string, locale: Locale): Promise<void> {
    const subject = translate(locale, "mail.login.subject");
    this.log.info({ mail: { to, subject, link } }, "Enlace de acceso (correo por consola)");
  }
}

// --- Contenido del correo ---

export interface LoginEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Correo con el enlace de acceso, en texto y en HTML. Sobrio a propósito: sin
 * imágenes remotas, sin píxeles de seguimiento, sin enlaces acortados ni
 * redirigidos (el enlace es la dirección pública tal cual). El HTML usa solo
 * estilos en línea, que es lo que respetan los clientes de correo.
 */
export function renderLoginEmail(link: string, locale: Locale): LoginEmail {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key, { minutes: MAGIC_LINK_TTL_MINUTES });
  const subject = t("mail.login.subject");
  // Enlaces a las páginas legales, en la misma dirección pública que el enlace de acceso.
  const origin = new URL(link).origin;
  const pages = LEGAL_PAGES[locale];
  const legal = [
    { label: t("legal.privacy"), url: origin + pages.privacy },
    { label: t("legal.terms"), url: origin + pages.terms },
    { label: t("legal.imprint"), url: origin + pages.imprint },
  ];
  const text = [
    "AEONARCH",
    "",
    t("mail.login.intro"),
    "",
    link,
    "",
    t("mail.login.expires"),
    "",
    t("mail.login.ignore"),
    "",
    "-- ",
    t("mail.login.footer"),
    t("mail.login.account"),
    ...legal.map((l) => `${l.label}: ${l.url}`),
    "",
  ].join("\n");

  const href = escapeHtml(link);
  const muted = "color:#4a5260;";
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#eef0f3;color:#1b1f24;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;">
<div role="article" aria-label="${escapeHtml(subject)}" lang="${locale}" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d5d9e0;border-radius:8px;padding:32px 28px;">
<p style="margin:0 0 24px;font-size:14px;font-weight:700;letter-spacing:0.3em;color:#1b2a41;">AEONARCH</p>
<p style="margin:0 0 24px;">${escapeHtml(t("mail.login.intro"))}</p>
<p style="margin:0 0 24px;"><a href="${href}" style="display:inline-block;background:#1b2a41;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:6px;">${escapeHtml(t("mail.login.button"))}</a></p>
<p style="margin:0 0 8px;font-size:14px;${muted}">${escapeHtml(t("mail.login.copy"))}</p>
<p style="margin:0 0 24px;font-size:14px;word-break:break-all;"><a href="${href}" style="color:#1b2a41;">${href}</a></p>
<p style="margin:0 0 12px;">${escapeHtml(t("mail.login.expires"))}</p>
<p style="margin:0 0 24px;">${escapeHtml(t("mail.login.ignore"))}</p>
<hr style="border:none;border-top:1px solid #d5d9e0;margin:0 0 16px;">
<p style="margin:0 0 8px;font-size:13px;${muted}">${escapeHtml(t("mail.login.footer"))}</p>
<p style="margin:0 0 8px;font-size:13px;${muted}">${escapeHtml(t("mail.login.account"))}</p>
<p style="margin:0;font-size:13px;${muted}">${legal.map((l) => `<a href="${escapeHtml(l.url)}" style="color:#4a5260;">${escapeHtml(l.label)}</a>`).join(" · ")}</p>
</div>
</body>
</html>
`;
  return { subject, text, html };
}

// --- Envío por SMTP ---

/** Tiempos de espera del SMTP (ms). Un servidor lento o caído no puede colgar las peticiones. */
export interface SmtpTimeouts {
  connection: number;
  greeting: number;
  socket: number;
  /** Tope total de un envío o de la comprobación, pase lo que pase por debajo. */
  total: number;
}

const DEFAULT_TIMEOUTS: SmtpTimeouts = { connection: 10_000, greeting: 10_000, socket: 15_000, total: 20_000 };

export interface SmtpMailerOptions {
  timeouts?: Partial<SmtpTimeouts>;
  /** Solo para los tests (servidor SMTP falso con certificado propio). Nunca desde el entorno. */
  tls?: ConnectionOptions;
}

type SmtpConfig = Pick<
  ServerConfig,
  "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASS" | "MAIL_FROM" | "MAIL_LOG_LINKS"
>;

/**
 * Error de correo apto para el registro: código, respuesta del servidor y
 * mensaje, con las direcciones de correo enmascaradas (el servidor SMTP suele
 * repetir la del destinatario al rechazarla). Nunca incluye la contraseña.
 */
export function describeMailError(err: unknown): { code?: string; responseCode?: number; command?: string; message: string } {
  if (!(err instanceof Error)) return { message: maskEmailsIn(String(err)).slice(0, 300) };
  const e = err as Error & { code?: unknown; responseCode?: unknown; command?: unknown };
  return {
    ...(typeof e.code === "string" ? { code: e.code } : {}),
    ...(typeof e.responseCode === "number" ? { responseCode: e.responseCode } : {}),
    // AUTH PLAIN lleva las credenciales en la propia orden: solo se registra el verbo.
    ...(typeof e.command === "string" ? { command: e.command.split(" ")[0] } : {}),
    message: maskEmailsIn(e.message).slice(0, 300),
  };
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`El servidor SMTP no respondió en ${ms} ms`), { code: "ETIMEDOUT" })), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Correo real por SMTP (un proveedor de correo transaccional). Exige cifrado:
 * TLS directo en el puerto 465 (o con SMTP_SECURE=true) y STARTTLS obligatorio en
 * los demás; el certificado del servidor siempre se comprueba.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly fromDomain: string;
  private readonly timeouts: SmtpTimeouts;

  constructor(
    private readonly config: SmtpConfig,
    private readonly log: MailLog,
    options: SmtpMailerOptions = {},
  ) {
    const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass, MAIL_FROM: from } = config;
    const sender = from ? parseMailFrom(from) : null;
    // La configuración ya lo valida; esto solo protege usos directos.
    if (!host || !user || !pass || !from || !sender) throw new Error("Faltan SMTP_HOST, SMTP_USER, SMTP_PASS o MAIL_FROM");
    this.from = from;
    this.fromDomain = sender.domain;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.transport = nodemailer.createTransport({
      host,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      // Sin TLS directo, STARTTLS es obligatorio: la contraseña nunca viaja en claro.
      requireTLS: !config.SMTP_SECURE,
      auth: { user, pass },
      // El nombre del certificado se comprueba contra SMTP_HOST (SNI no admite direcciones IP).
      tls: { ...(isIP(host) ? {} : { servername: host }), minVersion: "TLSv1.2", ...options.tls },
      connectionTimeout: this.timeouts.connection,
      greetingTimeout: this.timeouts.greeting,
      socketTimeout: this.timeouts.socket,
      dnsTimeout: this.timeouts.connection,
      // El correo no lee archivos ni descarga nada.
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
    });
  }

  /**
   * Comprueba al arrancar que se puede conectar y autenticar. Si falla, el
   * servidor sigue en marcha (el proveedor puede estar caído un rato), pero lo
   * deja claro en el registro.
   */
  async verify(): Promise<boolean> {
    const smtp = {
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE,
      user: maskEmailsIn(this.config.SMTP_USER ?? ""),
    };
    try {
      await withDeadline(this.transport.verify(), this.timeouts.total);
      this.log.info({ smtp }, "Conexión SMTP comprobada: el correo real está listo");
      return true;
    } catch (err) {
      this.log.warn(
        { smtp, error: describeMailError(err) },
        "No se pudo comprobar la conexión SMTP: los enlaces de acceso no llegarán hasta corregirlo (revisa SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER y SMTP_PASS)",
      );
      return false;
    }
  }

  async sendLoginLink(to: string, link: string, locale: Locale): Promise<void> {
    if (this.config.MAIL_LOG_LINKS) {
      // Solo en staging (la configuración lo prohíbe en producción), para probar el correo real.
      this.log.info({ mail: { to: maskEmail(to), link } }, "Enlace de acceso (MAIL_LOG_LINKS; también se envía por correo)");
    }
    const { subject, text, html } = renderLoginEmail(link, locale);
    await withDeadline(
      this.transport.sendMail({
        from: this.from,
        to,
        subject,
        text,
        html,
        date: new Date(),
        // Message-ID del dominio del remitente: los filtros de spam desconfían de los ajenos.
        messageId: `<${randomUUID()}@${this.fromDomain}>`,
        headers: {
          // Correo automático: que nadie (ni los autorrespondedores) conteste.
          "Auto-Submitted": "auto-generated",
          "X-Auto-Response-Suppress": "All",
          // Sin rastreo de clics ni aperturas en Mailjet (los demás proveedores las ignoran):
          // el enlace de acceso no debe pasar por un redirector ajeno.
          "X-Mailjet-TrackClick": "0",
          "X-Mailjet-TrackOpen": "0",
        },
      }),
      this.timeouts.total,
    );
  }

  close(): void {
    this.transport.close();
  }
}

export function createMailer(config: ServerConfig, log: MailLog): Mailer {
  switch (config.MAIL_TRANSPORT) {
    case "console":
      return new ConsoleMailer(log);
    case "smtp": {
      const mailer = new SmtpMailer(config, log);
      // En segundo plano: el servidor arranca aunque el proveedor no responda.
      void mailer.verify();
      return mailer;
    }
  }
}
