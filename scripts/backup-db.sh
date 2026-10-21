#!/usr/bin/env bash
# Copia de seguridad diaria de la base de datos del juego (formato propio de
# pg_dump, comprimido). Guarda las de los últimos KEEP_DAYS días en BACKUP_DIR y
# borra las más antiguas (la política de privacidad promete 14 días).
# Restaurar: pg_restore --clean --if-exists -d imperium <archivo>.dump
# Lo ejecuta el temporizador de usuario aeonarch-backup (deploy/aeonarch-backup.*).
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/aeonarch}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB="${BACKUP_DB:-imperium}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077
file="$BACKUP_DIR/$DB-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump -h /var/run/postgresql -d "$DB" -Fc -Z 6 -f "$file.part"
# Comprobación barata: el índice del archivo se puede leer.
pg_restore -l "$file.part" > /dev/null
mv "$file.part" "$file"
find "$BACKUP_DIR" -name "$DB-*.dump" -mtime +"$((KEEP_DAYS - 1))" -delete
echo "Copia hecha: $file ($(du -h "$file" | cut -f1)); copias guardadas: $(find "$BACKUP_DIR" -name "$DB-*.dump" | wc -l)"
