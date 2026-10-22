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

./scripts/verify.sh

echo "==> Compilando el cliente"
pnpm build

# Datos del responsable en las páginas legales (fuera del repositorio).
./scripts/fill-legal.sh

echo "==> Publicando en $WEB_ROOT"
# La carpeta pertenece al usuario de despliegue, así que no hace falta sudo.
# Preparación única: sudo mkdir -p "$WEB_ROOT" && sudo chown -R "$USER:$USER" "$WEB_ROOT"
if [ ! -w "$WEB_ROOT" ]; then
  echo "Error: no se puede escribir en $WEB_ROOT. Ejecuta una vez:" >&2
  echo "  sudo mkdir -p $WEB_ROOT && sudo chown -R $USER:$USER $WEB_ROOT" >&2
  exit 1
fi
# --delete elimina archivos antiguos; se excluyen los mapas de código fuente.
# --chmod garantiza que Caddy (otro usuario) pueda leer todo.
rsync -a --delete --exclude='*.map' --chmod=D755,F644 apps/client/dist/ "$WEB_ROOT/"

echo "==> Listo. Recarga el navegador con Ctrl+F5."
