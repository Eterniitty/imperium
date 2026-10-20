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

## 9. Autenticación por enlace mágico

- El usuario introduce su correo; se genera un **token aleatorio de 32 bytes**.
- En la base de datos **solo se guarda su hash SHA-256**.
- Validez de **15 minutos**, **uso único**.
- Al canjearlo se crea una sesión en **cookie `HttpOnly`, `Secure`, `SameSite=Lax`**.
- Para el WebSocket, el cliente pide por HTTP un **ticket corto** de un solo uso que presenta al conectar.
- `MAIL_TRANSPORT=console` imprime el enlace en el registro: **solo en desarrollo**; el servidor se niega a arrancar con ese valor en producción.

## 10. Modelo de datos (tablas previstas)

- `accounts`, `sessions`, `magic_link_tokens`, `ws_tickets`
- `organizations`, `organization_members`
- `emperors`, `heirs`, `lineage_cradles`
- `sectors_touched` (solo sectores con cambios), `sector_leases`
- `colonies`, `installations`, `inventories`
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
