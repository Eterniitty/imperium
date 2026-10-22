-- Rol de solo lectura para Claude («claude_ro»), regla 11 de CLAUDE.md (RGPD):
-- lee las tablas del juego, pero no las de la cuenta (correo), las sesiones (IP)
-- ni los enlaces de acceso (correo e IP). De `accounts` solo ve una vista sin el correo.
--
-- Se ejecuta como superusuario (lo hace el usuario, no Claude), y otra vez tras
-- cada migración que cree tablas (da permiso a las nuevas):
--   sudo -u postgres psql -d imperium -f scripts/claude-ro.sql
--
-- Para entrar como claude_ro desde el usuario del sistema `imperium` (sin contraseña),
-- una vez y con `sudo`:
--   /etc/postgresql/18/main/pg_ident.conf:  claude  imperium  claude_ro
--   /etc/postgresql/18/main/pg_hba.conf, ANTES de la línea `local all all peer`:
--     local  imperium  claude_ro  peer map=claude
--   sudo systemctl reload postgresql
-- Luego: psql -U claude_ro -d imperium
--
-- Ojo: el rol `imperium` (el del servidor del juego) lo sigue leyendo todo. Este
-- rol es la forma de consultar sin riesgo, no una frontera frente a ese rol.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claude_ro') THEN
    CREATE ROLE claude_ro LOGIN;
  END IF;
END
$$;

ALTER ROLE claude_ro SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE imperium TO claude_ro;
GRANT USAGE ON SCHEMA public TO claude_ro;

-- Todas las tablas del juego, salvo las de datos personales (se recalcula en cada ejecución).
DO $$
DECLARE
  t record;
BEGIN
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM claude_ro';
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('accounts', 'sessions', 'magic_link_tokens')
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO claude_ro', t.tablename);
  END LOOP;
END
$$;

-- Cuentas sin el correo: id, idioma y fechas (para unir con `emperors.account_id`).
CREATE OR REPLACE VIEW public.accounts_ro AS
  SELECT id, locale, created_at, last_login_at, terms_version, terms_accepted_at FROM public.accounts;
GRANT SELECT ON public.accounts_ro TO claude_ro;
