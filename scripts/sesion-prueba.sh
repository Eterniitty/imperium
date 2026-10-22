#!/usr/bin/env bash
# Cuenta de prueba desechable para comprobar el juego con sesión (regla 11 de CLAUDE.md).
# Solo crea cuentas con correo `prueba-<aleatorio>@example.invalid`, no lee ninguna
# otra fila de `accounts` ni de `sessions` e imprime solo el token de la sesión.
#
#   ./scripts/sesion-prueba.sh crear          → imprime el token (cookie __Host-aeon_session)
#   ./scripts/sesion-prueba.sh borrar <token> → borra esa cuenta con la API del juego
#                                               (como «Borrar cuenta» en Ajustes)
#
# Autorizado por el usuario el 22-10-2026 como única vía para tocar cuentas de prueba (regla 11).
#   ./scripts/sesion-prueba.sh limpiar        → borra, sin leer filas, las cuentas de prueba sin sesión
#                                               vigente (por si alguna se quedó colgada)
set -euo pipefail
DB="${DB:-imperium}"
API="${API:-http://127.0.0.1:3000}"
ORIGIN="${ORIGIN:-https://aeonarch.de}"
# Tokens creados por este script: `borrar` solo acepta uno de ellos (nunca el de una cuenta real).
LIST="${XDG_CACHE_HOME:-$HOME/.cache}/aeonarch-sesiones-prueba"

case "${1:-}" in
  crear)
    email="prueba-$(openssl rand -hex 6)@example.invalid"
    token="$(openssl rand -hex 32)"
    hash="$(printf %s "$token" | sha256sum | cut -d' ' -f1)"
    version="$(sed -n 's/^export const LEGAL_VERSION = "\(.*\)";$/\1/p' "$(dirname "$0")/../packages/shared/src/api.ts")"
    # Una sola sentencia: inserta la cuenta y su sesión (caduca en 3 horas) sin leer nada más.
    psql -d "$DB" -v ON_ERROR_STOP=1 -qtA -v email="$email" -v hash="$hash" -v version="$version" >/dev/null <<'SQL'
WITH a AS (
  INSERT INTO accounts (email, terms_version, terms_accepted_at)
  VALUES (:'email', :'version', now())
  RETURNING id
)
INSERT INTO sessions (id_hash, account_id, expires_at)
SELECT :'hash', a.id, now() + interval '3 hours' FROM a;
SQL
    mkdir -p "$(dirname "$LIST")"
    (umask 077 && echo "$hash" >> "$LIST")
    echo "$token"
    ;;
  borrar)
    token="${2:?falta el token}"
    [[ "$token" =~ ^[0-9a-f]{64}$ ]] || { echo "token no válido" >&2; exit 1; }
    hash="$(printf %s "$token" | sha256sum | cut -d' ' -f1)"
    grep -qx "$hash" "$LIST" 2>/dev/null || { echo "ese token no lo creó este script" >&2; exit 1; }
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/account/delete" \
      -H 'content-type: application/json' -H "origin: $ORIGIN" \
      -H "cookie: __Host-aeon_session=$token" -d '{"confirm":true}')"
    [[ "$code" == 204 ]] || { echo "no se pudo borrar (HTTP $code)" >&2; exit 1; }
    sed -i "/^$hash\$/d" "$LIST"
    echo "borrada"
    ;;
  limpiar)
    # Sus eventos pendientes primero (si no, quedarían reintentos sobre filas borradas); luego las cuentas
    # (en cascada: sesiones, Emperador, flotas…). Solo cuentas de prueba sin ninguna sesión vigente.
    psql -d "$DB" -v ON_ERROR_STOP=1 -qtA >/dev/null <<'SQL'
WITH stale AS (
  SELECT a.id FROM accounts a
  WHERE a.email LIKE 'prueba-%@example.invalid'
    AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.account_id = a.id AND s.expires_at > now())
), emps AS (
  SELECT e.id::text AS id FROM emperors e WHERE e.account_id IN (SELECT id FROM stale)
), ev AS (
  DELETE FROM scheduled_events WHERE payload->>'emperorId' IN (SELECT id FROM emps)
)
DELETE FROM accounts WHERE id IN (SELECT id FROM stale);
SQL
    echo "limpio"
    ;;
  *)
    echo "uso: $0 crear | borrar <token> | limpiar" >&2
    exit 2
    ;;
esac
