import type { FastifyBaseLogger } from "fastify";
import { translate, type Locale } from "@imperium/shared";
import type { ServerConfig } from "./config";

export interface Mailer {
  sendLoginLink(to: string, link: string, locale: Locale): Promise<void>;
}

/**
 * Correo por consola: escribe el enlace en el registro del servidor en lugar de
 * enviarlo. Solo para desarrollo y pruebas; la configuración lo prohíbe en producción.
 */
class ConsoleMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}

  async sendLoginLink(to: string, link: string, locale: Locale): Promise<void> {
    const subject = translate(locale, "mail.login.subject");
    this.log.info({ mail: { to, subject, link } }, "Enlace de acceso (correo por consola)");
  }
}

export function createMailer(config: ServerConfig, log: FastifyBaseLogger): Mailer {
  switch (config.MAIL_TRANSPORT) {
    case "console":
      return new ConsoleMailer(log);
    case "smtp":
      // Llegará con el dominio propio (SPF, DKIM y DMARC); ver docs/despliegue.md.
      throw new Error("MAIL_TRANSPORT=smtp todavía no está implementado");
  }
}
