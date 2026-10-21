#!/usr/bin/env node
// Credenciales de la puerta de entrada (una por persona invitada), en el archivo
// GATE_USERS_FILE del servidor (por defecto ~/.config/aeonarch-secreto/gate-users.json).
// El servidor lo relee solo: no hace falta reiniciarlo.
//
//   node scripts/gate-user.mjs add [nota]       crea una credencial con usuario y contraseña aleatorios
//                                               (la nota, p. ej. para quién es, solo se guarda para `list`)
//   node scripts/gate-user.mjs remove <usuario> le quita el acceso (su cookie deja de valer)
//   node scripts/gate-user.mjs list             lista los usuarios y sus notas
//
// Los usuarios son aleatorios a propósito: un nombre adivinable deja la puerta
// a una sola contraseña de distancia.
import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

if (cmd === "list") {
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
  console.error("Uso: node scripts/gate-user.mjs add [nota] | remove <usuario> | list");
  process.exit(1);
}
