#!/usr/bin/env bash
# Pasa el mundo a la galaxia de ~30 000 estrellas (GENERATOR_VERSION 3) y lo
# empieza de cero. Lo ejecuta el usuario (el revisor del modo automático no
# deja a Claude vaciar la base): ./scripts/galaxia-30k.sh --si
#
# 1. Copia de la base y del código.
# 2. Revierte en main el commit que aparcó la galaxia de 30 000 estrellas.
# 3. Para el servidor y vacía las tablas del juego (se conservan las cuentas,
#    las sesiones y la Wiki: al entrar se crea un Emperador nuevo).
# 4. Despliega el servidor (crea de nuevo la IA y las facciones) y el cliente.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-}" != "--si" ]; then
  echo "Esto BORRA todo el mundo del juego (Emperadores, colonias, flotas, descubrimientos…)."
  echo "Se conservan las cuentas, las sesiones y la Wiki. Para hacerlo: $0 --si"
  exit 1
fi

PARKING_COMMIT=c4be053

echo "==> Copias de seguridad"
./scripts/backup-db.sh
stamp=$(date +%Y%m%d-%H%M%S)
cp "$(ls -t ~/backups/aeonarch/imperium-*.dump | head -1)" ~/backups/aeonarch/proyecto/mundo-antes-de-galaxia-30k-$stamp.dump
(cd .. && tar --exclude=node_modules --exclude=dist --exclude=.claude -czf ~/backups/aeonarch/proyecto/imperium-$stamp-antes-de-galaxia-30k.tar.gz imperium)

echo "==> Galaxia de ~30 000 estrellas (revertir $PARKING_COMMIT)"
if ! grep -q "GENERATOR_VERSION = 3" packages/shared/src/constants.ts; then
  git revert --no-edit "$PARKING_COMMIT"
  git push -q origin main
fi
grep -q "GENERATOR_VERSION = 3" packages/shared/src/constants.ts

echo "==> Parando el servidor y vaciando las tablas del juego"
systemctl --user stop aeonarch-server
tables=$(psql -d imperium -Atc "select string_agg(quote_ident(relname), ', ') from pg_stat_user_tables where relname not in ('accounts','sessions','magic_link_tokens','wiki_revisions','wiki_log','wiki_pages','__drizzle_migrations')")
psql -d imperium -v ON_ERROR_STOP=1 -c "TRUNCATE $tables RESTART IDENTITY CASCADE;"

echo "==> Desplegando"
./scripts/deploy-server.sh
./scripts/deploy-client.sh
echo "==> Hecho: galaxia de ~30 000 estrellas, mundo nuevo. Recarga con Ctrl+F5."
