#!/usr/bin/env node
// Credenciales de la puerta de entrada (una por persona invitada), en el archivo
// GATE_USERS_FILE del servidor (por defecto ~/.config/aeonarch-secreto/gate-users.json).
// El servidor lo relee solo: no hace falta reiniciarlo.
//
//   node scripts/gate-user.mjs add <nombre>     crea (o renueva) su contraseña y la muestra una vez
//   node scripts/gate-user.mjs remove <nombre>  le quita el acceso (su cookie deja de valer)
//   node scripts/gate-user.mjs list             lista los nombres
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

if (cmd === "list") {
  for (const [n, u] of Object.entries(data.users)) console.log(`${n}\t(creado ${u.createdAt ?? "?"})`);
} else if ((cmd === "add" || cmd === "remove") && name && /^[a-zA-Z0-9._-]{2,40}$/.test(name)) {
  if (cmd === "remove") {
    if (!data.users[name]) {
      console.error(`No existe: ${name}`);
      process.exit(1);
    }
    delete data.users[name];
    save();
    console.log(`Quitado: ${name}`);
  } else {
    const password = randomBytes(12).toString("base64url");
    const salt = randomBytes(16);
    data.users[name] = { hash: `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`, createdAt: new Date().toISOString().slice(0, 10) };
    save();
    console.log(`Usuario: ${name}\nContraseña: ${password}`);
  }
} else {
  console.error("Uso: node scripts/gate-user.mjs add|remove <nombre> | list   (nombre: letras, números, . _ -)");
  process.exit(1);
}
