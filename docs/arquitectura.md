# Aeonarch — Arquitectura

Arquitectura técnica prevista. El diseño de juego está en [diseno.md](diseno.md) y el despliegue en [despliegue.md](despliegue.md).

## 1. Pila tecnológica

| Capa | Tecnología | Motivo |
|---|---|---|
| Monorepo | **pnpm** workspaces, TypeScript estricto | Código compartido entre cliente, servidor e IA. |
| Cliente UI | **React** | Menús, paneles, HUD. |
| Cliente 3D | **Three.js** con **motor propio fuera de React** | El bucle de render no pasa por la reconciliación de React; React solo dibuja la interfaz. |
| Empaquetado | **Vite** | Arranque rápido y HMR. |
| Servidor HTTP | **Fastify** | Rápido, tipado, con buen ecosistema de plugins. |
| Tiempo real | **ws** con **protocolo propio** | Ver abajo. |
| Validación | **Zod** | Esquemas compartidos para órdenes y mensajes. |
| Base de datos | **PostgreSQL** + **Drizzle** | Transacciones, bloqueos de fila, SQL explícito. |
| Caché / pub-sub | **Redis** | Difusión entre procesos, límites de tasa, sesiones efímeras. |
| Correo | **SMTP** | Enlaces mágicos de acceso. |
| Infraestructura | **Docker Compose** + **Caddy** | Un solo servidor, HTTPS automático. |

### ¿Por qué ws y no Colyseus?
- El juego no es una sala cerrada: es un mundo persistente dividido en sectores, con suscripciones dinámicas por zona de interés. El modelo de "salas" de Colyseus encaja mal.
- La autoridad de la simulación está en la base de datos y en la cola de eventos, no en el estado en memoria de una sala.
- Un protocolo propio y pequeño (ver §8) da control total sobre deltas, suscripciones e idempotencia, sin capas de sincronización automática que habría que sortear.

## 2. Estructura de carpetas

```
apps/
  client/     Cliente web (React + motor Three.js)
  server/     API HTTP, WebSocket, simulación autoritativa
  ai/         Procesos de IA (gobernadores, alienígenas, Emperadores IA)
packages/
  shared/     Tipos, constantes, esquemas Zod, protocolo
  procgen/    Generación procedural determinista por semilla
  sim/        Reglas de simulación puras (economía, combate, movimiento)
  content/    Fichas de especies, facciones y naves como datos
docs/
```

## 3. Niveles de simulación

| Nivel | Qué cubre | Frecuencia |
|---|---|---|
| **N0** | Combate en tiempo real (nave del Emperador + escolta) | Ticks rápidos (~10–20 Hz) en memoria |
| **N1** | Movimiento y encuentros dentro de un sector activo | Segundos |
| **N2** | Economía, construcción, asedios, combates de flotas por rondas | Eventos programados (minutos/horas) |
| **N3** | Sectores sin actividad | Nada; se resuelven perezosamente al consultarse |

## 4. Resolución perezosa de la economía

No hay un tick global que recorra todas las colonias. Cada inventario guarda el **último instante resuelto** y sus **tasas** de producción/consumo. Al leerlo o modificarlo se calcula el estado actual como `valor + tasa × Δt` (con topes de almacenamiento y agotamiento). Solo se programa un evento cuando algo cambia de forma discreta (se llena un almacén, se agota un recurso, termina una construcción).

## 5. Cola de eventos programados

- Tabla `scheduled_events` con `due_at`, tipo, carga útil y sector.
- Los trabajadores toman lotes con:

```sql
SELECT id, kind, payload
FROM scheduled_events
WHERE due_at <= now() AND sector_id = ANY($1)
ORDER BY due_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

- `SKIP LOCKED` permite varios trabajadores sin pisarse. Cada evento se procesa en su propia transacción y se marca como hecho en la misma.

## 6. Un único escritor por sector

- Cada sector activo tiene **un único proceso escritor**, obtenido mediante un **arrendamiento** (lease) con caducidad en la base de datos (`sector_leases`).
- El escritor renueva el arrendamiento periódicamente; si muere, otro lo toma al caducar.
- Esto evita condiciones de carrera entre procesos sin bloqueos distribuidos complejos.

## 7. Integridad de datos

- **Libro de recursos solo inserción** (`resource_ledger`): cada movimiento (producción, consumo, transferencia, saqueo) es un asiento inmutable. Los saldos se pueden reconstruir y auditar.
- **Idempotencia de órdenes**: cada orden lleva un `cmdId` generado por el cliente; el servidor guarda los ya procesados y responde lo mismo ante reintentos.

### Tubería de órdenes

Igual para jugadores y para las tres capas de IA:

1. **Recepción** (WS o interna).
2. **Validación de esquema** (Zod).
3. **Autorización**: ¿el actor controla esa entidad?
4. **Deduplicación** por `cmdId`.
5. **Validación de reglas** (`packages/sim`): recursos, alcance, estado.
6. **Aplicación** transaccional + asientos en el libro + eventos programados.
7. **Respuesta** (`ack`) y **difusión** de cambios (`delta`/`evt`) a los suscritos.

## 8. Protocolo WebSocket

Mensajes JSON con campo `t` (tipo). Ejemplos:

```jsonc
// Cliente → servidor: orden
{ "t": "cmd", "cmdId": "c-01J9...", "op": "fleet.move", "args": { "fleetId": "f-12", "to": [3, -1, 7] } }

// Servidor → cliente: confirmación
{ "t": "ack", "cmdId": "c-01J9...", "ok": true }
{ "t": "ack", "cmdId": "c-01J9...", "ok": false, "error": "insufficient_volatiles" }

// Cliente → servidor: suscripción a una zona de interés
{ "t": "sub", "topic": "sector:3:-1:7" }

// Servidor → cliente: instantánea inicial
{ "t": "snap", "topic": "sector:3:-1:7", "seq": 1042, "data": { "fleets": [], "installations": [] } }

// Servidor → cliente: cambios incrementales
{ "t": "delta", "topic": "sector:3:-1:7", "seq": 1043, "ops": [{ "path": "fleets.f-12.pos", "v": [3.1, -1, 7] }] }

// Servidor → cliente: evento discreto
{ "t": "evt", "kind": "siege.progress", "data": { "installationId": "i-7", "progress": 0.42 } }
```

- `seq` permite detectar huecos; ante uno, el cliente pide una nueva `snap`.

### Implementado (Fase 4)

- Conexión: `POST /api/ws/ticket` (con la cookie de sesión) devuelve un ticket de un solo uso válido 30 s; el cliente abre `/ws?v=<versión>&ticket=...`. El servidor rechaza antes de aceptar la conexión si el origen no es `PUBLIC_URL`, la versión del protocolo no coincide, el ticket no vale o hay demasiadas conexiones.
- Al conectar, el servidor envía `hello` (id del Emperador propio y hora del servidor, para corregir el reloj local). El cliente pide `{"t":"sub","topic":"emperors"}` y recibe la `snap` con todos los Emperadores; después, `delta` con cada cambio (viajes, altas, conexiones y desconexiones).
- Única orden por ahora: `emperor.move` (`args.systemId`). El viaje se guarda como destino y horas de salida y llegada; la posición se calcula al vuelo con `@imperium/sim` en el servidor y en el cliente, sin enviar posiciones.
- Tipos en `packages/shared/src/protocol.ts`; esquema Zod de los mensajes del cliente en `schemas.ts`. Mensaje mal formado → cierre 4400; exceso de mensajes → 4429.

### Implementado (paso 5b): niebla de guerra

- Las posiciones y clases de estrella (`generateSector`) son públicas. El detalle (`generateSystemDetail`) recibe además una semilla secreta **por sistema**: `HMAC-SHA256(DETAIL_SEED, systemId)` recortado a 32 bits (`apps/server/src/discovery/service.ts`). Averiguar la semilla de un sistema por fuerza bruta no revela las de los demás.
- Tabla `discoveries (emperor_id, system_id, discovered_at)`. Se descubre el sistema y todo lo que esté dentro del alcance del escáner (recorriendo los sectores que corta la esfera): al crear el Emperador, al procesar `fleet.arrive` (mejor escáner de la flota) y al procesar `emperor.arrive` (nave del Emperador), evento que se programa al ordenar el salto.
- Puesta al día: al arrancar, el servidor da su entorno a los Emperadores sin ningún descubrimiento (los creados antes del paso 5b); es idempotente.
- `GET /api/systems/:systemId` (cookie de sesión, 120 por minuto y cuenta): `{ detail }` si se ha descubierto; si no, 403 `not_discovered`.
- Tema `me`: la instantánea lleva `discovered` (ids) y cada descubrimiento llega como `{ path: "discovered.<id>", v: true }`. `PROTOCOL_VERSION` = 3.

### Implementado (Fase 7): humanos, colonias y economía

- **Datos** en `packages/content/src/economy.ts` (`HUMANS`, `SHIP_HUMAN_CAPACITY`, `POPULATION`, `INSTALLATIONS`, `ECONOMY`); **reglas puras** en `packages/sim/src/economy.ts` (generación de humanos, colonos mínimos, crecimiento logístico, energía, mano de obra, extracción, refinería, `advanceStock` lineal a trozos, `resolveColony` a pasos de una hora de juego). Las tasas son por hora de juego: horas = Δms × `TIME_SCALE` / 3,6e6; las construcciones duran `horas / TIME_SCALE`.
- **Modelo de datos** (migración `0006`):
  - `emperors.humans` + `humans_at`: humanos de la nave del Emperador resueltos a esa hora (crecen solos hasta 500).
  - `ships.humans`: colonos a bordo.
  - `colonies (id, emperor_id, system_id, planet_index, name, population, metal, volatiles, crystal, alloys, resolved_at, founded_at)`, único por `(system_id, planet_index)`. `emperor_id` es el dueño y puede cambiar (conquista, Fase 9). Población y existencias son las de `resolved_at`: toda escritura resuelve antes a la hora actual.
  - `installations (id, colony_id, kind, built_at)`: una fila por instalación.
  - `colony_builds (id, seq, colony_id, kind, item_id, started_at, finish_at)`: cola; solo la primera está en marcha y tiene un evento `colony.build` programado. Se paga al encargar; al terminar, la siguiente empieza a la hora de fin de la anterior.
  - `resource_ledger (id, emperor_id, colony_id, reason, ref, metal, volatiles, crystal, alloys, humans, created_at)`: solo inserción (un disparador impide `UPDATE` y `DELETE`); sin claves ajenas para sobrevivir a lo que describe. Motivos: `foundation`, `build`, `colonizer_boarding`. La producción continua no se asienta (es la resolución perezosa).
- **Órdenes** (WebSocket, `cmd`): `colony.claim { systemId, planetIndex, humans?, fleetId? }` (sistema descubierto, planeta libre; sin `fleetId` desembarcan `humans` de la nave del Emperador, que debe estar allí y parada; con `fleetId`, los colonos del colonizador de esa flota, que se consume y, si la flota se queda vacía, desaparece), `colony.rename { colonyId, name }` (solo el dueño; mismas reglas que el nombre de Emperador, 2–32 caracteres) y `colony.build { colonyId, kind: "installation" | "ship", itemId }` (naves solo con astillero). Errores nuevos en `CommandError`.
- **Quién ve qué**: el tema privado `me` lleva `colonies` (población, existencias, tasas por hora real, energía, instalaciones y cola) y `humans`; cambios `colonies.<id>` (null si se pierde) y `humans.<emperorId>`. Dueño y nombre de los planetas (territorio) se piden a `GET /api/systems/:id/claims`, solo para sistemas descubiertos. `PROTOCOL_VERSION` = 4.
- **Evento** `colony.build { buildId }`: resuelve la colonia hasta la hora de fin con lo que tenía, añade la instalación o crea una flota nueva con la nave (el colonizador embarca colonos de la colonia, dejando 50) y pone en marcha la siguiente.

## 9. Autenticación por enlace mágico

- El usuario introduce su correo; se genera un **token aleatorio de 32 bytes**.
- En la base de datos **solo se guarda su hash SHA-256**.
- Validez de **15 minutos**, **uso único**.
- Al canjearlo se crea una sesión en **cookie `HttpOnly`, `Secure`, `SameSite=Lax`**.
- Para el WebSocket, el cliente pide por HTTP un **ticket corto** de un solo uso que presenta al conectar.
- `MAIL_TRANSPORT=console` imprime el enlace en el registro: **solo en desarrollo**; el servidor se niega a arrancar con ese valor en producción.
- `MAIL_TRANSPORT=smtp` envía el correo (texto + HTML, en el idioma del jugador) por el SMTP de un proveedor transaccional con nodemailer (`SmtpMailer` en `apps/server/src/mail.ts`): TLS obligatorio, tiempos de espera acotados y comprobación de la conexión al arrancar. Si el envío falla se registra (correo enmascarado) y la respuesta es la misma de siempre. `MAIL_LOG_LINKS=true` escribe además el enlace en el registro (solo fuera de producción). Ver «Correo real» en `docs/despliegue.md`.

## 10. Modelo de datos (tablas previstas)

- `accounts`, `sessions`, `magic_link_tokens`, `ws_tickets`
- `organizations`, `organization_members`
- `emperors`, `heirs`, `lineage_cradles`
- `sectors_touched` (solo sectores con cambios), `sector_leases`
- `colonies`, `installations`, `colony_builds` (hechas en la Fase 7; las existencias van en la propia colonia)
- `fleets`, `ships`
- `resource_ledger`
- `scheduled_events`
- `processed_commands`
- `sieges`, `battles`, `battle_rounds`
- `discoveries`, `discovery_shares`
- `ai_actors` (gobernadores, facciones, Emperadores IA)
- `translations`, `translation_votes`

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Carga del servidor con cientos de jugadores | Resolución perezosa, N3 sin coste, un escritor por sector. |
| Inconsistencias por concurrencia | `SKIP LOCKED`, arrendamientos, transacciones cortas, idempotencia. |
| Abuso de tráfico saliente | Estáticos en Cloudflare R2, límites de tasa, vigilante de tráfico (ver despliegue). |
| Trampas desde el cliente | Servidor autoritativo; el cliente solo envía órdenes. |
| Crecimiento de la base de datos | Solo se guarda lo que cambia; compactación del libro a largo plazo. |
| IA demasiado costosa | Procesos separados (`apps/ai`), decisiones espaciadas en el tiempo. |
| Correo marcado como spam | SPF, DKIM y dominio propio. |
