#!/usr/bin/env bash
# Despliega el cliente en el servidor: descarga los últimos cambios, comprueba,
# compila y copia el resultado a la carpeta que sirve Caddy.
# Uso (desde la raíz del repositorio, en el servidor): ./scripts/deploy-client.sh
set -euo pipefail

WEB_ROOT="${WEB_ROOT:-/var/www/aeonarch}"
cd "$(dirname "$0")/.."

echo "==> Descargando cambios de GitHub"
git pull --ff-only

echo "==> Instalando dependencias"
pnpm install --frozen-lockfile

echo "==> Comprobando (tests y tipos)"
pnpm test
pnpm typecheck

echo "==> Compilando el cliente"
pnpm build

echo "==> Publicando en $WEB_ROOT (pide la contraseña de sudo)"
sudo mkdir -p "$WEB_ROOT"
# --delete elimina archivos antiguos; se excluyen los mapas de código fuente.
sudo rsync -a --delete --exclude='*.map' apps/client/dist/ "$WEB_ROOT/"

echo "==> Listo. Recarga el navegador con Ctrl+F5."
