#!/usr/bin/env bash
# Despliega el servidor de juego: descarga los últimos cambios, comprueba,
# compila y reinicia el servicio de usuario de systemd. No necesita sudo.
# Uso (desde la raíz del repositorio, en el servidor): ./scripts/deploy-server.sh
set -euo pipefail

SERVICE=aeonarch-server
UNIT_DIR="$HOME/.config/systemd/user"
cd "$(dirname "$0")/.."

echo "==> Descargando cambios de GitHub"
git pull --ff-only

echo "==> Instalando dependencias"
pnpm install --frozen-lockfile

./scripts/verify.sh

echo "==> Compilando el servidor"
pnpm --filter @imperium/server build

echo "==> Instalando el servicio $SERVICE"
mkdir -p "$UNIT_DIR"
install -m 644 "deploy/$SERVICE.service" "$UNIT_DIR/$SERVICE.service"
systemctl --user daemon-reload
systemctl --user enable "$SERVICE" >/dev/null
systemctl --user restart "$SERVICE"

echo "==> Comprobando que responde"
for _ in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3000/api/health; then
    echo
    if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
      echo "Aviso: sin 'linger' el servicio se para al cerrar la sesión y no arranca con el sistema." >&2
      echo "  Ejecuta una vez: sudo loginctl enable-linger $USER" >&2
    fi
    echo "==> Listo."
    exit 0
  fi
  sleep 0.5
done
echo "Error: el servidor no responde. Registro: journalctl --user -u $SERVICE -n 50" >&2
exit 1
