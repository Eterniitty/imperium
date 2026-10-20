# Aeonarch — instrucciones para Claude

MMO espacial 3D para navegador. Nombre del juego: **Aeonarch**. Nombre interno del código: `imperium` (paquetes `@imperium/*`).
Idioma de trabajo: **español** (código y comentarios en español; identificadores en inglés).

## Antes de nada, lee
- `docs/diseno.md` — diseño del juego y decisiones cerradas.
- `docs/arquitectura.md` — pila técnica, simulación, protocolo, modelo de datos.
- `docs/despliegue.md` — servidor, seguridad y costes.
- `README.md` — cómo ejecutar y comprobar el proyecto.

## Estado
- Fase 1 (diseño), 2 (arquitectura) y 3 (prototipo local) terminadas.
- **Fase 4 terminada** — servidor autoritativo (Fastify + ws), acceso por correo con enlace de un solo uso, Emperador persistente (nombre único, aparece en el Núcleo Humano) y mundo compartido por WebSocket (ticket de un solo uso, `snap`/`delta`/`cmd`/`ack`, orden `emperor.move` con tiempo de viaje).
- Provisional: velocidad de viaje alta (`TRAVEL_SPEED_LYH`, 1 a.l./s) para poder verlo; el diseño pide horas. Todos los jugadores reciben todos los Emperadores (sin zonas de interés por sector). Tickets, límites y órdenes procesadas viven en memoria (un solo proceso).
- El cliente aún genera el universo localmente; servidor y cliente deben usar la misma semilla (`UNIVERSE_SEED` / `VITE_UNIVERSE_SEED`).

## Reglas del proyecto
1. Trabaja por fases. No construyas todo de golpe ni avances a arquitectura distribuida sin un prototipo jugable.
2. El servidor es la fuente de verdad; el cliente solo muestra y envía órdenes.
3. La generación procedural (`packages/procgen`) debe ser determinista: solo operaciones enteras y `+ - * / sqrt`. Nada de `Math.sin/pow/log` en lo que afecte al juego. Cambios que alteren el universo exigen subir `GENERATOR_VERSION`.
4. Especies, facciones y naves son **datos** en `packages/content`, no lógica.
5. Todo texto visible usa claves i18n (`packages/shared/src/i18n`), con español e inglés.
6. No digas que algo funciona sin haberlo ejecutado. Antes de dar algo por terminado: `pnpm test`, `pnpm typecheck` y `pnpm build`. Si cambia la interfaz, también `pnpm e2e` (pruebas en navegador) y mira las capturas.
7. Nunca subas credenciales. `.env` está en `.gitignore`; las variables se documentan en `.env.example`.
8. Commits en español, descriptivos.

## Servidor de producción (Hetzner CPX22, Ubuntu 26.04)
- Usuario de trabajo: `imperium` (sudo con contraseña). Root bloqueado por SSH; solo clave SSH.
- Cortafuegos UFW: abiertos solo OpenSSH y 80/tcp.
- PostgreSQL 18 del paquete de Ubuntu, solo en local. Usuario `imperium` por socket, sin contraseña; bases `imperium` e `imperium_test` (esta se borra en cada `pnpm test`).
- `.env` del servidor (no se sube): `APP_ENV=staging`, correo por consola (el enlace de acceso sale en `journalctl --user -u aeonarch-server`), `COOKIE_SECURE=false` hasta tener HTTPS.
- Caddy sirve el cliente compilado desde `/var/www/aeonarch` en `:80`, **protegido con usuario y contraseña** (`basicauth`, la versión de Caddy de Ubuntu usa `basicauth`, no `basic_auth`). Configuración en `/etc/caddy/Caddyfile`.
- Desplegar el cliente: `./scripts/deploy-client.sh`; el servidor: `./scripts/deploy-server.sh`. Ninguno necesita sudo (ver `docs/despliegue.md`).

### Seguridad: prioridad máxima
- **No abras el juego al público sin protección** hasta cumplir, en este orden: (1) archivos estáticos servidos desde Cloudflare (R2/caché), nunca desde el servidor; (2) puertos 80/443 aceptados solo desde las IP de Cloudflare; (3) límites por IP y cuenta; (4) vigilante de tráfico saliente con corte automático. Motivo: Hetzner cobra el tráfico saliente por encima de 20 TB y un atacante puede descargar un archivo en bucle.
- No quites el `basicauth` de Caddy ni abras puertos nuevos sin que el usuario lo pida explícitamente.
- No actives copias de seguridad, volúmenes ni balanceadores de Hetzner (cuestan dinero) sin que el usuario lo decida.
- **Nunca configures `ANTHROPIC_API_KEY`** en este servidor: el usuario usa su suscripción de Claude, y esa variable haría que se facturase como API.
- Pide confirmación antes de cualquier comando con `sudo` o de modificar `/etc`.
- Puedes borrar datos sin pedir confirmación, pero **informa siempre al usuario de qué has borrado** (qué datos, de dónde y cuántos registros o archivos).
