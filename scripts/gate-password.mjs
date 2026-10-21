#!/usr/bin/env node
// Crea la contraseña de la puerta de entrada (apps/server/src/gate): la pide
// sin mostrarla (o, con --generar, crea una aleatoria y la escribe en pantalla)
// y saca las líneas GATE_PASSWORD_HASH y GATE_SECRET para el .env del servidor.
// La contraseña nunca va en los argumentos (se vería en la lista de procesos).
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const hash = (password) => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
};

const out = (password) => {
  console.log(`GATE_PASSWORD_HASH=${hash(password)}`);
  console.log(`GATE_SECRET=${randomBytes(32).toString("hex")}`);
};

if (process.argv.includes("--generar")) {
  const password = randomBytes(12).toString("base64url");
  console.error(`Contraseña: ${password}`);
  out(password);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  rl._writeToOutput = () => {};
  process.stderr.write("Contraseña: ");
  rl.question("", (password) => {
    rl.close();
    process.stderr.write("\n");
    out(password);
  });
}
