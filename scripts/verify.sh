#!/usr/bin/env bash
# Comprueba los tipos antes de desplegar. Los tests ya no se pasan por defecto
# (petición del usuario, 21-10-2026: solo cuando haya un error visible); para
# pasarlos también: CON_PRUEBAS=1 ./scripts/verify.sh. Recuerda el árbol de git
# verificado en .verificado (no se sube); con cambios sin commit siempre comprueba.
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=.verificado
tree=""
if [ -z "$(git status --porcelain)" ]; then tree=$(git rev-parse 'HEAD^{tree}'); fi
if [ -n "$tree" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$tree" ]; then
  echo "==> Este código ya pasó tests y tipos: no se repiten"
  exit 0
fi
if [ "${CON_PRUEBAS:-0}" = "1" ]; then
  echo "==> Comprobando (tests y tipos)"
  pnpm test
else
  echo "==> Comprobando tipos (tests omitidos; CON_PRUEBAS=1 para pasarlos)"
fi
pnpm typecheck
if [ -n "$tree" ]; then echo "$tree" > "$STAMP"; fi
