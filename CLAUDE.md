# Aeonarch — instrucciones para Claude

MMO espacial 3D para navegador. Nombre del juego: **Aeonarch**. Nombre interno del código: `imperium` (paquetes `@imperium/*`).
Idioma de trabajo: **español** (código y comentarios en español; identificadores en inglés).

## Antes de nada, lee
- `docs/diseno.md` — diseño del juego y decisiones cerradas.
- `docs/arquitectura.md` — pila técnica, simulación, protocolo, modelo de datos.
- `docs/despliegue.md` — servidor, seguridad y costes.
- `README.md` — cómo ejecutar y comprobar el proyecto.
- `docs/hoja-de-ruta.md` — fases pendientes en orden; la siguiente es la primera sin marcar.
- `docs/lore.md` — lore del universo (Emperadores, las tres leyes, la Gran Hostilidad, especies). Las especies ya están en el juego (Fase 11); el diseño debe respetarlo.

## Estado
- Fase 1 (diseño), 2 (arquitectura) y 3 (prototipo local) terminadas.
- **Fase 4 terminada** — servidor autoritativo (Fastify + ws), acceso por correo con enlace de un solo uso, Emperador persistente (nombre único, aparece en el Núcleo Humano) y mundo compartido por WebSocket (ticket de un solo uso, `snap`/`delta`/`cmd`/`ack`, orden `emperor.move` con tiempo de viaje).
- **Fases 5 y 6 terminadas** (ver `docs/hoja-de-ruta.md`): escala de tiempo, cola de eventos, flotas, niebla de guerra, pilotar la nave (primera y tercera persona, salto con J, teclas configurables), vuelo compartido en el sistema (`SpaceService`, en memoria) y combate en tiempo real (cañones, misiles, escudos; servidor autoritativo) con piratas Carroñeros de la IA fuera del Núcleo Humano. Fase 7 hecha a continuación.
- **Fase 7 terminada** (humanos, planetas y economía; ver `docs/hoja-de-ruta.md` y `docs/arquitectura.md` §4 y §10): humanos en la nave del Emperador (Ley II), reclamar y renombrar planetas, colonias con población y existencias resueltas perezosamente (`@imperium/sim` economy.ts, datos en `@imperium/content` economy.ts), instalaciones y naves en cola de construcción (evento `colony.build`) y libro `resource_ledger` solo inserción. **Fase 8 (logística) terminada**: bodegas, carga y descarga, rutas automáticas. **Fase 9a terminada** (combate de flotas por rondas en el servidor, `WarService` y `packages/sim/src/battle.ts`; huir, convoyes que esperan, contactos e intercepción; panel «Batallas»; falta mostrarla en 3D). Siguiente: 9d (IA de naves), luego 9b.
- **Economía de la humanidad y mercado global hechos** (21-10-2026; `docs/arquitectura.md` «Implementado: economía de la humanidad y mercado global», migración `0011`): créditos (₢) por población, tesoro del Núcleo (aporte del 10 %), proyectos comunes con bonificaciones globales y mercado con libro de órdenes, comisión y envíos según la distancia (`HumanityService`, `MarketService`; reglas en `packages/sim` humanity.ts y market.ts, datos en `packages/content` humanity.ts). Paneles «Humanidad» y «Mercado» (créditos en la barra superior). Para reponer combustible y munición en colonias propias, usar `ColonyService.adjustStock`.
- **Fase 11 (especies alienígenas, territorios e IA) hecha en lo básico** (21-10-2026; `docs/arquitectura.md` «Implementado (Fase 11)», migración `0012`, `PROTOCOL_VERSION` 7): todas las especies del lore salvo los Precursores tienen territorio (capa determinista y **secreta** de `packages/procgen` territory.ts con semilla derivada de `DETAIL_SEED`; **no cambió `GENERATOR_VERSION`**), naves propias (`packages/content` aliens.ts) e IA (`apps/server/src/ai/`: `AlienService`, eventos `ai.region`; actores como filas `emperors.kind = 'alien'`). Rencor y tributos (`alien.tribute`), Nómadas en el mercado, Emperadores humanos de la IA básicos (`kind = 'ai'`, evento `ai.emperor`, `AI_EMPERORS`). El Núcleo Humano es seguro (anillos 0–1) y hay gracia para Emperadores nuevos. Cliente: halos de territorio en el mapa (solo lo descubierto), presencia alienígena en el detalle de sistema, territorio en las flotas, avistamientos y facciones conocidas en «Batallas». Wiki: «Especies» ampliada e «IA y territorios».
- Niebla de guerra: el detalle de los sistemas depende de la semilla secreta `DETAIL_SEED` del servidor (obligatoria en producción; no cambiarla con partidas en marcha). El cliente ya no lo genera: lo pide a `GET /api/systems/:id` y solo lo recibe si su Emperador lo ha descubierto (tabla `discoveries`). Para generar un detalle en el servidor, usa `DiscoveryService.detail`.
- Escala de los sistemas en metros (`packages/sim/src/systemLayout.ts` y `flight.ts`): nave ~45 m (`SHIP_SCALE`), planetas de km, estrellas de cientos de km; búfer de profundidad logarítmico (los ShaderMaterial propios pasan por `withLogDepth`).
- Privacidad: el servidor solo envía cada Emperador a quien puede verlo (visibilidad `public`/`allies`/`hidden`, compañeros mutuos en `emperor_allies`). La música es solo generativa (Web Audio), sin archivos.
- El juego corre en **tiempo real** (`TIME_SCALE=1`, también en el servidor de pruebas); las pruebas automáticas usan escalas altas para no esperar. Tickets, límites, órdenes procesadas, el espacio local y el estado de combate viven en memoria (un solo proceso; se pierden al reiniciar).
- Legal (Alemania/RGPD): páginas estáticas en `apps/client/public/legal/` (es/en: aviso legal, privacidad, términos), servidas sin `basicauth`. Al pedir enlace se aceptan (versión `LEGAL_VERSION` en `packages/shared/src/api.ts`: súbela si cambias esos textos). Ajustes → Cuenta permite descargar los datos (`GET /api/account/export`) y borrar la cuenta (`POST /api/account/delete`). Si añades tablas con datos de un jugador, inclúyelas en la exportación y comprueba que se borran en cascada.
- Legal completo (21-10-2026): contrato de encargo (art. 28) firmado con Hetzner; los de Cloudflare y Brevo van incluidos en sus condiciones. Datos del responsable en las páginas legales: {{LEGAL_NAME}}, {{LEGAL_STREET}}, {{LEGAL_CITY}}, {{LEGAL_EMAIL}}.
- Copias de seguridad: diarias y **solo en local** (`~/backups/aeonarch/`, 14 días, temporizador de usuario `aeonarch-backup`). El usuario no quiere copias en GitHub.
- **Wiki** (`/wiki`, página aparte del juego, segunda entrada de Vite `apps/client/wiki/index.html`): al compilar se copia a `dist/wiki/<tema>/index.html` por artículo, así Caddy la sirve como archivos estáticos (detrás del `basicauth`, como el juego) sin cambiar el Caddyfile. Enlazada desde la barra superior y la portada.
- Diseño de la IA de naves (Fase 9d: pilotaje, tácticas de grupo, emboscadas, Carroñeros, milicia y Emperadores humanos de la IA) en `docs/ia-naves.md`. El usuario quiere una IA buena y completa.

- El cliente aún genera el mapa estelar (posiciones y clases de estrella) localmente; servidor y cliente deben usar la misma semilla (`UNIVERSE_SEED` / `VITE_UNIVERSE_SEED`).

## Trabajo en curso y pendiente (21-10-2026, al pasar a otra sesión)
1. **Fase 9a hecha** (commit `c4640f7`): ver `docs/arquitectura.md` («Implementado (Fase 9a)»). Pendiente de la 9a: representar la batalla en 3D.
2. **Colonias independientes hechas** (commit `8be8a4f`): al borrar la cuenta, las colonias quedan con `emperor_id` null, congeladas (nadie las resuelve), encargos cancelados con reembolso; `claims` las muestra como «Independiente». **En la 9b, al conquistar una, poner `resolved_at` a la hora de la conquista** (si no, cobraría el tiempo congelado).
3. **Desplegar** (1 y 2 ya hechos; migraciones nuevas 0009, 0010, 0011 —economía de la humanidad— y 0012 —Fase 11—): `pnpm build`, `pnpm e2e:rapido` y `./scripts/deploy-server.sh` y `./scripts/deploy-client.sh`. Hay commits sin desplegar: tope de peticiones por IP en la API, portada «Alfa · en desarrollo», copia de seguridad en la política de privacidad.
4. **Fase 9d (IA de naves)**, lanzar con un agente siguiendo `docs/ia-naves.md` cuando esté la 9a. Añadirla a `docs/hoja-de-ruta.md` (9d antes de 9b).
5. **Correo propio** (sin Brevo): Hetzner bloquea el puerto 25 en cuentas nuevas (cuenta creada el 20-10-2026; suelen desbloquearlo tras un mes y la primera factura). Cuando lo desbloqueen: DNS inverso `mail.aeonarch.de` (lo pone el usuario en Hetzner), DKIM propio, envío directo y pruebas a Gmail/Outlook/Proton; luego quitar Brevo de la política de privacidad. Mailjet descartado. Mientras, Brevo (su rastreo de clics por `r.mail.aeonarch.de` hace que Safari avise al abrir el enlace).
6. **Modelos 3D de las naves alienígenas** (tras fusionar el pilotaje, que toca `shipModel.ts`): los datos ya están: `SpeciesDefinition.visual` (silueta, colores primario/secundario/emisivo) y `ALIEN_SHIP_CLASSES[].model` (eslora en m, forma del casco, motores) y `combat` (armas y escudo en tiempo real). Al fusionar la rama del pilotaje: su migración `0011_romantic_maddog` choca en número con `0011_stormy_vance_astro` de main (y ya existe la `0012` de la Fase 11): hay que renumerarla y regenerar el journal.
7. El usuario tiene **más cambios que pedir** (lo dijo al volver a casa): pregúntale al empezar.
8. Recomendado al usuario: verificación en dos pasos en Hetzner, Cloudflare y Brevo; cambiar la contraseña de sudo al terminar el proyecto.

## Reglas del proyecto
1. Trabaja por fases. No construyas todo de golpe ni avances a arquitectura distribuida sin un prototipo jugable.
2. El servidor es la fuente de verdad; el cliente solo muestra y envía órdenes.
3. La generación procedural (`packages/procgen`) debe ser determinista: solo operaciones enteras y `+ - * / sqrt`. Nada de `Math.sin/pow/log` en lo que afecte al juego. Cambios que alteren el universo exigen subir `GENERATOR_VERSION`.
4. Especies, facciones y naves son **datos** en `packages/content`, no lógica.
5. Todo texto visible usa claves i18n (`packages/shared/src/i18n`), con español e inglés.
6. No digas que algo funciona sin haberlo ejecutado. Para no perder tiempo (petición del usuario, que considera lentas las comprobaciones):
   - Con cada cambio: solo `pnpm typecheck` y los tests de lo tocado (`pnpm exec vitest run <archivos>`); `pnpm test` entero (~40 s) antes de hacer commit.
   - Antes de desplegar: `pnpm build` y `pnpm e2e:rapido` (~3 min: las pruebas sin la etiqueta `@lento`).
   - `pnpm e2e` completo (~15 min: resoluciones, planetas, multijugador, colonias) solo al cerrar una fase o si se toca el motor 3D, la interfaz general o el multijugador; mejor en segundo plano mientras se sigue trabajando. Mira las capturas si cambió la interfaz.
7. Nunca subas credenciales. `.env` está en `.gitignore`; las variables se documentan en `.env.example`.
8. Commits en español, descriptivos.
9. **Cada sistema nuevo o cambiado se documenta en la Wiki** (`/wiki`): artículos en `apps/client/src/wiki/content/es/*.md` y `en/*.md` (los dos idiomas), índice en `apps/client/src/wiki/slugs.ts`. Las cifras no se copian a mano: se muestran con tablas generadas desde `packages/content` (`apps/client/src/wiki/tables.ts`, `{{tabla:<id>}}`). Lo que aún no existe se marca con `> [!dev]` («En desarrollo»). `apps/client/test/wiki.test.ts` comprueba idiomas, enlaces y tablas.

## Servidor de producción (Hetzner CPX22, Ubuntu 26.04)
- Usuario de trabajo: `imperium` (sudo con contraseña). Root bloqueado por SSH; solo clave SSH.
- Dominio **`aeonarch.de`** en Cloudflare (plan Free; token de API en `.env` como `CLOUDFLARE_API_TOKEN`, solo para esa zona). Cortafuegos UFW: OpenSSH abierto; 80/443 **solo desde las IP de Cloudflare** (no quitar las reglas de SSH).
- PostgreSQL 18 del paquete de Ubuntu, solo en local. Usuario `imperium` por socket, sin contraseña; bases `imperium` e `imperium_test` (esta se borra en cada `pnpm test`).
- `.env` del servidor (no se sube): `APP_ENV=staging`, correo real por SMTP de Brevo (`MAIL_TRANSPORT=smtp`, `SMTP_*`; con `MAIL_LOG_LINKS=true` el enlace también sale en `journalctl --user -u aeonarch-server`), `PUBLIC_URL=https://aeonarch.de`, `COOKIE_SECURE=true`, `CLOUDFLARE_API_TOKEN`, `E2E_DATABASE_URL` (base de las pruebas de navegador: `imperium_test_b`).
- Caddy sirve `aeonarch.de` por HTTPS (certificado de origen de Cloudflare, SSL Full strict) y el cliente compilado desde `/var/www/aeonarch`. **Protegido con usuario y contraseña** (`basicauth`, salvo `/legal/*`; la versión de Caddy de Ubuntu usa `basicauth`, no `basic_auth`). El usuario `tester` se eliminó el 21-10-2026; el nuevo y su contraseña solo los tiene el usuario (nunca en el repositorio). Configuración en `/etc/caddy/Caddyfile` (referencia: `deploy/Caddyfile`).
- Desplegar el cliente: `./scripts/deploy-client.sh`; el servidor: `./scripts/deploy-server.sh`. Ninguno necesita sudo (ver `docs/despliegue.md`).

### Seguridad: prioridad máxima
- **No abras el juego al público sin protección** hasta cumplir, en este orden: (1) archivos estáticos servidos desde Cloudflare (R2/caché), nunca desde el servidor; (2) puertos 80/443 aceptados solo desde las IP de Cloudflare; (3) límites por IP y cuenta; (4) vigilante de tráfico saliente con corte automático (**hecho**: `aeonarch-egress`, corta Caddy a 15 TB/mes; ver docs/despliegue.md). Motivo: Hetzner cobra el tráfico saliente por encima de 20 TB y un atacante puede descargar un archivo en bucle.
- No quites el `basicauth` de Caddy ni abras puertos nuevos sin que el usuario lo pida explícitamente.
- No actives copias de seguridad, volúmenes ni balanceadores de Hetzner (cuestan dinero) sin que el usuario lo decida.
- **Nunca configures `ANTHROPIC_API_KEY`** en este servidor: el usuario usa su suscripción de Claude, y esa variable haría que se facturase como API.
- Pide confirmación antes de cualquier comando con `sudo` o de modificar `/etc`.
- Puedes borrar datos sin pedir confirmación, pero **informa siempre al usuario de qué has borrado** (qué datos, de dónde y cuántos registros o archivos).
