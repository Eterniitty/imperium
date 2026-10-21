#!/usr/bin/env bash
# Pasa los tests y los tipos, salvo que este mismo código ya los haya pasado.
# Recuerda el árbol de git verificado en .verificado (no se sube). Con cambios
# sin commit siempre comprueba. Uso: ./scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=.verificado
tree=""
if [ -z "$(git status --porcelain)" ]; then tree=$(git rev-parse 'HEAD^{tree}'); fi
if [ -n "$tree" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$tree" ]; then
  echo "==> Este código ya pasó tests y tipos: no se repiten"
  exit 0
fi
echo "==> Comprobando (tests y tipos)"
pnpm test
pnpm typecheck
if [ -n "$tree" ]; then echo "$tree" > "$STAMP"; fi
