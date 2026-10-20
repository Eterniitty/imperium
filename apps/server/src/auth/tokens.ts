import { createHash, randomBytes } from "node:crypto";

/** Token aleatorio de 32 bytes en base64url (43 caracteres), apto para URL y cookie. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash SHA-256 en hexadecimal: lo único que se guarda en la base de datos. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Normaliza un correo para usarlo como identificador de cuenta. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** "ana@ejemplo.com" → "an***@ejemplo.com": suficiente para reconocer la cuenta propia. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/** Enmascara cualquier dirección de correo que aparezca en un texto (p. ej. la respuesta de un servidor SMTP). */
export function maskEmailsIn(text: string): string {
  return text.replace(/[^\s<>"'(),;:[\]]+@[^\s<>"'(),;:[\]]+/g, (email) => maskEmail(email));
}
