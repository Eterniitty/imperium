#!/usr/bin/env node
// Credenciales de la puerta de entrada (una por persona invitada), en el archivo
// GATE_USERS_FILE del servidor (por defecto ~/.config/aeonarch-secreto/gate-users.json).
// El servidor lo relee solo: no hace falta reiniciarlo.
//
//   node scripts/gate-user.mjs add [nota]       crea una credencial con usuario y contraseña aleatorios
//                                               (la nota, p. ej. para quién es, solo se guarda para `list`)
//   node scripts/gate-user.mjs remove <usuario> le quita el acceso (su cookie deja de valer)
//   node scripts/gate-user.mjs list             lista los usuarios y sus notas
//   node scripts/gate-user.mjs log [n]          últimos n accesos a la puerta (30 por defecto): quién, cuándo,
//                                               desde qué IP y navegador, y los intentos rechazados
//
// Los usuarios son aleatorios a propósito: un nombre adivinable deja la puerta
// a una sola contraseña de distancia.
import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const file = process.env.GATE_USERS_FILE ?? join(homedir(), ".config", "aeonarch-secreto", "gate-users.json");
const [cmd, name] = process.argv.slice(2);
const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { users: {} };
data.users ??= {};

const save = () => {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
};

const random = (n) => {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(randomBytes(n), (b) => abc[b % abc.length]).join("");
};

if (cmd === "log") {
  const logFile = process.env.GATE_LOG_FILE ?? join(dirname(file), "gate-access.log");
  const n = Number(name ?? 30) || 30;
  const lines = existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).slice(-n) : [];
  const notes = Object.fromEntries(Object.entries(data.users).map(([u, v]) => [u, v.note ?? ""]));
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      const who = e.user + (notes[e.user] ? ` (${notes[e.user]})` : "");
      const what = e.ok ? "ENTRA" : e.reason === "device" ? "BLOQUEADO (no es un ordenador)" : "FALLO (contraseña)";
      console.log(`${e.at.replace("T", " ").slice(0, 19)}  ${what.padEnd(30)}  ${who.padEnd(32)}  ${e.ip}  ${e.ua}`);
    } catch {}
  }
  if (lines.length === 0) console.log("Sin accesos registrados todavía.");
} else if (cmd === "list") {
  for (const [n, u] of Object.entries(data.users)) console.log(`${n}\t${u.note ?? ""}\t(creado ${u.createdAt ?? "?"})`);
} else if (cmd === "add") {
  const user = `aeon-${random(10)}`;
  const password = randomBytes(15).toString("base64url");
  const salt = randomBytes(16);
  data.users[user] = { hash: `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`, createdAt: new Date().toISOString().slice(0, 10), ...(name ? { note: process.argv.slice(3).join(" ").slice(0, 80) } : {}) };
  save();
  console.log(`Usuario: ${user}\nContraseña: ${password}`);
} else if (cmd === "remove" && name) {
  {
    if (!data.users[name]) {
      console.error(`No existe: ${name}`);
      process.exit(1);
    }
    delete data.users[name];
    save();
    console.log(`Quitado: ${name}`);
  }
} else {
  console.error("Uso: node scripts/gate-user.mjs add [nota] | remove <usuario> | list | log [n]");
  process.exit(1);
}
