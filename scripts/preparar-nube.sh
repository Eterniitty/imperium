#!/usr/bin/env bash
# Prepara un contenedor de sesión en la nube (Claude Code en claude.ai/code) para
# trabajar en Aeonarch: PostgreSQL local con bases de desarrollo y pruebas, pnpm
# y dependencias, y un .env de desarrollo. Pensado como «script de preparación»
# del entorno en la nube; se puede pegar tal cual allí o ejecutar a mano.
#
# Solo para contenedores desechables: no toca producción ni datos reales. En el
# servidor de Hetzner se niega a ejecutarse.
set -euo pipefail

if [ -d /home/imperium ] || [ "$(hostname)" = "aeonarch" ]; then
  echo "preparar-nube: esto es el servidor de producción; no se ejecuta aquí" >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

# --- PostgreSQL ---
if ! command -v psql >/dev/null 2>&1; then
  echo "==> Instalando PostgreSQL"
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq postgresql >/dev/null
fi

echo "==> Arrancando PostgreSQL"
if command -v pg_ctlcluster >/dev/null 2>&1; then
  for cluster in $(pg_lsclusters -h | awk '{print $1"/"$2}'); do
    $SUDO pg_ctlcluster "${cluster%/*}" "${cluster#*/}" start 2>/dev/null || true
  done
else
  $SUDO service postgresql start || true
fi
for _ in $(seq 1 20); do
  $SUDO -u postgres psql -qtAc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

# Rol y bases solo de desarrollo, con contraseña fija: el contenedor es desechable
# y PostgreSQL solo escucha en local.
echo "==> Creando el rol y las bases de desarrollo"
$SUDO -u postgres psql -qv ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname = 'imperium') then
    create role imperium login createdb password 'imperium';
  end if;
end $$;
SQL
for db in imperium_dev imperium_test imperium_test_b; do
  if ! $SUDO -u postgres psql -qtAc "select 1 from pg_database where datname = '$db'" | grep -q 1; then
    $SUDO -u postgres createdb -O imperium "$db"
  fi
done

# --- Node y pnpm (solo si el repositorio ya está clonado) ---
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || true)"
if [ -z "$REPO" ] || [ ! -f "$REPO/pnpm-workspace.yaml" ]; then
  REPO="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 22 ]; then
  echo "preparar-nube: hace falta Node 22 o superior (hay ${node_major})" >&2
fi

if [ -n "$REPO" ] && [ -f "$REPO/pnpm-workspace.yaml" ]; then
  cd "$REPO"
  echo "==> Instalando dependencias en $REPO"
  if ! command -v pnpm >/dev/null 2>&1; then
    $SUDO corepack enable 2>/dev/null || npm install -g pnpm@10.28.0
  fi
  pnpm install --frozen-lockfile

  if [ ! -f .env ]; then
    echo "==> Escribiendo .env de desarrollo"
    url='postgres://imperium:imperium@127.0.0.1:5432'
    cat > .env <<ENV
# .env de una sesión en la nube (desechable; lo escribió scripts/preparar-nube.sh)
APP_ENV=development
VITE_UNIVERSE_SEED=imperium-alpha
UNIVERSE_SEED=imperium-alpha
DATABASE_URL=$url/imperium_dev
TEST_DATABASE_URL=$url/imperium_test
E2E_DATABASE_URL=$url/imperium_test_b
PUBLIC_URL=http://localhost:5173
MAIL_TRANSPORT=console
COOKIE_SECURE=false
TIME_SCALE=1
ENV
  fi
else
  echo "==> Repositorio aún sin clonar: dentro de la sesión, ejecuta otra vez scripts/preparar-nube.sh"
fi

echo "==> Listo"
