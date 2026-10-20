import { readFileSync } from "node:fs";

/** Registro del servidor de pruebas. */
export const SERVER_LOG = "test-results/server.log";

/** Último enlace de acceso enviado a `email`, leído del registro del servidor de pruebas. */
export async function lastLoginLink(email: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const links = readFileSync(SERVER_LOG, "utf8")
      .split("\n")
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as { mail?: { to: string; link: string } };
          return entry.mail?.to === email ? [entry.mail.link] : [];
        } catch {
          return [];
        }
      });
    const link = links.at(-1);
    if (link) return link;
    if (Date.now() > deadline) throw new Error(`No llegó ningún enlace para ${email}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
