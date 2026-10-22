#!/usr/bin/env bash
# Rellena los datos del responsable en las páginas legales compiladas
# (apps/client/dist/legal/*.html) desde ~/.config/aeonarch-secreto/legal.env.
# Esos datos nunca están en el repositorio: allí solo hay marcadores {{LEGAL_*}}.
# Uso: ./scripts/fill-legal.sh [carpeta]   (por defecto apps/client/dist/legal)
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${1:-apps/client/dist/legal}"
SECRET="${LEGAL_ENV:-$HOME/.config/aeonarch-secreto/legal.env}"
if [ ! -r "$SECRET" ]; then
  echo "Error: falta $SECRET (LEGAL_NAME, LEGAL_STREET, LEGAL_CITY, LEGAL_EMAIL)." >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$SECRET"
for v in LEGAL_NAME LEGAL_STREET LEGAL_CITY LEGAL_EMAIL; do
  if [ -z "${!v:-}" ]; then echo "Error: $v vacío en $SECRET" >&2; exit 1; fi
done
export LEGAL_NAME LEGAL_STREET LEGAL_CITY LEGAL_EMAIL
node -e '
const fs = require("fs"), path = require("path");
const dir = process.argv[1];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, "utf8");
  for (const k of ["LEGAL_NAME", "LEGAL_STREET", "LEGAL_CITY", "LEGAL_EMAIL"]) s = s.split("{{" + k + "}}").join(esc(process.env[k]));
  if (s.includes("{{LEGAL_")) { console.error("Error: marcador sin rellenar en " + p); process.exit(1); }
  fs.writeFileSync(p, s);
}
' "$DIR"
echo "==> Páginas legales rellenadas"
