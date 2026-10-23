# Aeonarch — Plan de migración a Unreal Engine 5.8.4

Plan escrito el 23-10-2026 a petición del dueño. **No es una migración hecha**: explica qué supone pasar el cliente a Unreal, qué se conserva, qué hay que reescribir, en qué orden y con qué riesgos. No se ha cambiado código del juego.

> Claude no puede instalar, compilar ni ejecutar Unreal en su contenedor ni en el servidor de Hetzner (sin GPU, sin Windows, sin el editor). Todo lo de Unreal lo compila y prueba el dueño en su ordenador; Claude escribe código C++, revisa, adapta el servidor y prepara pruebas que se puedan ejecutar fuera del motor.

## 0. Lo comprobado en la web (23-10-2026)

| Hecho | Estado | Fuente |
|---|---|---|
| Existe Unreal Engine **5.8.4** | **Confirmado** por resultados de búsqueda: anuncio «5.8.4 Hotfix Released» en los foros de Epic de hace unos días (arreglos del editor con Visual Studio 2026 y `.slnx`, cierres inesperados de Sequencer, Live Link en Mac/Linux, USD…). No pude abrir el anuncio (la red del contenedor no resuelve los dominios de Epic), así que no he leído la lista completa. | [Foro de Epic, 5.8.4](https://forums.unrealengine.com/t/5-8-4-hotfix-released/2842775) |
| Qué trae la 5.8 | Salió en junio de 2026: Lumen más ligero, MegaLights ampliado, PCG que sigue siendo procedural al editar, terreno de malla experimental, física de Control Rig y un plugin MCP experimental. Para Aeonarch lo importante es Lumen/MegaLights (cabina y naves) y PCG (no nos sirve para el universo, ver §3.4). Los hotfix 5.8.x no cambian funciones. | [Notas de la 5.8](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes), [anuncio](https://www.unrealengine.com/news/unreal-engine-5-8-is-now-available) |
| Exportar a navegador | **No hay exportación oficial**. La exportación HTML5/WebGL experimental de UE4 se abandonó; existen intentos de terceros (Wonder Interactive con WebGL/WebGPU, demos en foros) sin soporte de Epic ni garantía para la 5.8. | [The New Stack](https://thenewstack.io/a-new-tool-for-unreal-engine-developers-to-export-to-the-web/), [PCGH](https://www.pcgameshardware.de/Unreal-Engine-Software-239301/News/5-Entwickler-zeigt-Spiel-im-Browser-dank-WebGPU-1440861/) |
| Licencia y regalías | Gratis para desarrollar; **5 % de los ingresos brutos de por vida por encima de 1 millón de USD** (el primer millón está exento), por juego publicado. Rebaja al 3,5 % si sale en la Epic Games Store a la vez o antes que en otras tiendas (dato de una FAQ de Epic/Twinmotion; compruébalo en la EULA vigente). Informes trimestrales solo si se deben regalías. Un juego gratuito sin ingresos no paga nada. **Ojo**: no he podido leer la EULA directamente; si un día hay suscripción o compras dentro del juego, léela entera antes. | [Epic, informes de regalías](https://www.unrealengine.com/news/unreal-engines-improved-royalty-reporting-system), [FAQ](https://www.unrealengine.com/en-US/faq) |
| Pixel Streaming | Funciona (el juego corre en una GPU del servidor y se envía como vídeo por WebRTC), pero cada jugador conectado ocupa una parte de una GPU: en la práctica **1–4 jugadores por GPU barata**. Precios vistos (de proveedores, no verificados): AWS g4dn.xlarge ≈ 0,53 USD/h, g5.xlarge ≈ 1 USD/h; CoreWeave desde 0,24 USD/h; Streampixel 99 €/mes. | [abratabia](https://abratabia.com/unreal-engine/pixel-streaming-hosting.php), [AWS re:Post](https://repost.aws/questions/QUw_34NW4hQk2m7eNoyMhypA/how-to-have-concurrent-users-on-a-single-ec2-instance-of-unreal-engine-projects-of-pixel-streaming), [CoreWeave](https://coreweave.com/solutions/pixel-streaming) |
| WebSocket y JSON en UE | **Sí**: módulo `WebSockets` (`FWebSocketsModule::Get().CreateWebSocket(url, protocol, headers)`, `IWebSocket` con `OnConnected/OnMessage/OnClosed`), más `HTTP`, `Json` y `JsonUtilities` (`FJsonObjectConverter` para `USTRUCT`). Error frecuente: el módulo se llama `WebSockets`, en plural. | [API FWebSocketsModule](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/WebSockets/FWebSocketsModule), [foro](https://forums.unrealengine.com/t/websocket-module-not-found/2256600) |
| Servidor dedicado de UE | Exige **compilar el motor desde el código fuente** (GitHub de Epic, cuenta enlazada) y la cadena de compilación cruzada para Linux; la versión del Launcher no empaqueta servidores. | [Docs 4.27](https://docs.unrealengine.com/4.27/InteractiveExperiences/Networking/HowTo/DedicatedServers), [Redpoint](https://docs.redpoint.games/docs/dedis/preparing_your_game_server) |

## 1. Qué implica

### 1.1 Deja de ser un juego de navegador

Con Unreal, Aeonarch pasa a ser un **programa de escritorio** (Windows primero; Linux y macOS después si se quiere). Hay dos maneras de llevarlo al jugador:

1. **Descarga** (recomendada). El jugador instala un cliente de 2–10 GB. El servidor de Hetzner no cambia de tamaño: sigue moviendo JSON pequeño por WebSocket. Lo único peligroso es **dónde se aloja la descarga**:
   - **Nunca desde Hetzner**: un instalador de varios GB descargado en bucle se come los 20 TB del mes en horas (es justo el ataque que preocupa en `CLAUDE.md`). El vigilante `aeonarch-egress` cortaría Caddy, pero el juego quedaría caído.
   - Opciones: **Cloudflare R2** (sin coste de tráfico saliente; se paga el almacenamiento, céntimos al mes por unos GB, y las operaciones; compruébalo en su página de precios antes de decidir), **itch.io** (gratis, con su propio lanzador), **Steam** (100 USD por juego; aporta actualizaciones y anticheat básico, pero añade un tercero en la política de privacidad) o **Epic Games Store** (rebaja de regalías).
   - Actualizaciones: cada versión del cliente es una descarga nueva (o un parche). Hay que añadir comprobación de versión al arrancar (ver §2.5).
2. **Pixel Streaming**. Se sigue jugando en el navegador, pero el render ocurre en GPUs del servidor. Con los precios de arriba, 20 jugadores a la vez durante 4 h al día son unas 5–10 GPUs × 120 h/mes ≈ **300–1200 €/mes**, frente a los 23 € del CPX22. Además: latencia añadida al pilotaje en tiempo real, mucho tráfico saliente (vídeo, 5–20 Mbit/s por jugador) y un ataque trivial (abrir sesiones) que cuesta dinero de verdad. **No es compatible con la prioridad de costes del dueño**; solo tendría sentido para una demo de pocos minutos con cola y límite estricto.

> Hoy el juego es Three.js y funciona en cualquier ordenador con navegador; con Unreal los requisitos suben (GPU con DirectX 12 / Vulkan y SM6 para Nanite/Lumen). Con Lumen apagado y materiales sencillos se puede apuntar a GPUs modestas, pero hay que decidirlo al principio.

### 1.2 Acceso, puerta y versión del cliente

Hoy el acceso depende del navegador (cookies, enlace por correo que se abre en él, puerta de Caddy con cookie). En un cliente de escritorio eso cambia; los detalles están en §2.3 (acceso y puerta), §2.4 (mapa estelar) y §2.5 (versión mínima del cliente).

### 1.3 La Wiki y las páginas legales

- **La Wiki sigue siendo web, servida por el mismo servidor de Hetzner** (Caddy, desde los archivos compilados, con su panel de edición en `apps/server/src/wiki`). No se mete en Unreal: el cliente abre el navegador del sistema con `FPlatformProcess::LaunchURL`. Las tablas que se generan desde `packages/content` (`apps/client/src/wiki/tables.ts`) siguen igual, así que **hay que conservar la parte web** aunque el juego deje de usar el cliente React. Recomendado: mover la Wiki a `apps/wiki` en la fase M0, para poder retirar algún día el cliente web sin tocarla.
- Detrás de la puerta: la Wiki necesita la cookie del navegador. Un jugador que solo tenga el cliente entra una vez en el navegador por `/puerta/?next=/wiki/` (el cliente le abre esa dirección).
- **Páginas legales**: siguen en la parte web (hoy `apps/client/public/legal/`), servidas sin puerta y rellenadas con `scripts/fill-legal.sh`. Cambios necesarios (subir `LEGAL_VERSION`):
  - La política de privacidad debe describir el cliente: qué guarda en el disco (sesión, ajustes, caché del mapa), y si se usa Steam/itch.io/Epic, que son terceros con su propia política.
  - **El informador de fallos de Unreal (`CrashReportClient`) envía datos a Epic por defecto**. Hay que desactivarlo en el empaquetado o, si se usa, mencionarlo en la privacidad (implica un encargado más fuera de la UE). Recomendado: desactivarlo y, si hace falta, enviar informes propios al servidor sin datos personales.
  - Los términos deben incluir la licencia del cliente y los avisos de terceros que exige la EULA de Epic.
  - El cliente muestra los enlaces a Impressum y privacidad en la pantalla de inicio (hoy los muestra la puerta) y acepta `LEGAL_VERSION` igual que la web.
  - El aviso de fotosensibilidad pasa a la primera ejecución del cliente.

## 2. El servidor: se queda el actual

**Decisión del dueño (23-10-2026): el servidor de Hetzner se queda**, para el multijugador y para la Wiki. La base es el servidor autoritativo Node actual (Fastify + ws + PostgreSQL, `apps/server`, migraciones 0001–0053), y el cliente de Unreal se conecta a él con **el mismo protocolo** que el cliente web. Ambos clientes pueden convivir durante toda la migración.

### 2.1 Por qué no un servidor dedicado de Unreal (nota breve)

- Habría que reescribir en C++ las ~17 500 líneas de `apps/server` y `packages/sim` (combate, IA de naves, asedios, economía, mercado, linaje, contratos…) antes de tener nada jugable.
- La replicación de Unreal está pensada para partidas con decenas de jugadores por proceso, no para un mundo persistente con cola de eventos, resolución perezosa y «el juego sigue sin el jugador».
- Unreal no trae acceso a PostgreSQL, exige compilar el motor desde el código fuente para empaquetar servidores Linux y cada proceso pide más CPU y RAM que el CPX22.

Unreal se usa como **motor de render, sonido e interfaz**, sin su replicación (sin `NetDriver` ni actores replicados): para Unreal es un juego «de un jugador» que habla con nuestro servidor por WebSocket.

### 2.2 El protocolo como contrato

- El protocolo está en `packages/shared/src/protocol.ts` (mensajes `cmd/ack/sub/snap/delta/pose/fire/mine/rift/space/poses/shot/…`, `PROTOCOL_VERSION` = 15) y los esquemas de lo que manda el cliente, en Zod (`schemas.ts`). Los tipos de la API HTTP, en `api.ts`.
- Escribir a mano 100+ estructuras en C++ y mantenerlas a mano es la mayor fuente de errores. Propuesta: un **generador** (`scripts/gen-unreal-protocol.ts`, Node, lo puede escribir y probar Claude) que lea los tipos con la API del compilador de TypeScript o, más sencillo, los esquemas Zod convertidos a JSON Schema (`zod-to-json-schema`), y genere:
  - `USTRUCT`s con `UPROPERTY` (para `FJsonObjectConverter` y Blueprints),
  - enumeraciones (`CommandError`, `WeaponKind`, `RiftPhase`…),
  - la constante `PROTOCOL_VERSION` y las claves de los mensajes.
  Los archivos generados se suben con el cliente; una comprobación en `scripts/verify.sh` falla si el protocolo cambió y no se regeneraron.
- Uniones con campo `t`: se decodifican leyendo `t` primero y luego el `USTRUCT` correspondiente. Los `delta` (`ops` con rutas) se aplican sobre un modelo de datos en C++ (`UAeonWorldState`) equivalente al almacén del cliente (`apps/client/src/state`).
- Rendimiento: `poses` llega a 10–20 Hz con muchas naves; con JSON y `FJsonSerializer` va bien para decenas de naves. Si un día no basta, se puede añadir un formato binario **solo** para `poses`/`pose` (sube `PROTOCOL_VERSION`), sin tocar el resto.

### 2.3 Qué cambia en el acceso

Hoy, en el navegador:

1. Caddy protege todo (también `/api/*` y `/ws`) con `forward_auth` a `/puerta/check`, que exige la cookie firmada `aeon_gate` y **rechaza agentes de usuario que no sean de ordenador** (`isDesktop` en `apps/server/src/gate/routes.ts`).
2. El jugador pide un **enlace de un solo uso** por correo; al abrirlo en el navegador, el servidor deja una cookie de sesión (`httpOnly`, `SameSite=Lax`).
3. Con esa cookie, `POST /api/ws/ticket` da un **ticket de un solo uso** y el WebSocket comprueba además `Origin == PUBLIC_URL` (`apps/server/src/realtime/routes.ts`, línea ~132).

En el cliente de escritorio:

- **Puerta (mientras el juego siga cerrado).** El cliente pide usuario y contraseña de la puerta en su pantalla de inicio y los manda a una ruta nueva, `POST /puerta/native` (sin protección de Caddy, como el resto de `/puerta/*`), que devuelve el mismo valor firmado que la cookie `aeon_gate` (7 días). El cliente lo guarda y lo manda como cabecera `Cookie: aeon_gate=…` en **todas** las peticiones HTTP y en la conexión del WebSocket (el módulo `HTTP` de UE deja poner cabeceras y `CreateWebSocket` acepta cabeceras de la conexión). Así **ni Caddy ni el cortafuegos cambian**: `forward_auth` sigue siendo la frontera. `isDesktop` aceptará además el agente de usuario propio del cliente (`Aeonarch/<versión> (Windows; x64)`); no es una frontera de seguridad, pero mantiene la regla «solo ordenadores». Mismos límites por IP que la página de la puerta y el mismo registro de intentos.
- **Enlace por correo → código de dispositivo.** El cliente no puede recibir la cookie del navegador, así que:
  1. El cliente llama a `POST /api/auth/device` → recibe un `deviceCode` (secreto largo, solo para él, caduca en 10 min) y un `userCode` corto (p. ej. `KQ7-4MX`).
  2. El jugador escribe su correo en el cliente y se le manda el enlace de siempre (`POST /api/auth/request`, con el `userCode` asociado). Al abrirlo en el navegador, la página muestra «¿Autorizar el cliente de escritorio con el código KQ7-4MX?» y un botón; el navegador también queda con sesión (útil para la Wiki).
  3. El cliente consulta `POST /api/auth/device/poll` cada pocos segundos hasta recibir un **token de sesión de cliente**, que es una fila normal de `sessions` marcada como `kind = 'native'` (para poder verla y cerrarla en Ajustes → Cuenta).
  4. El cliente guarda el token cifrado (DPAPI en Windows) y lo manda como cookie de sesión, igual que el navegador. Nada más del servidor cambia: `accountFromRequest` sigue leyendo la cookie.
  - Tabla nueva `device_codes` (código, cuenta, caducidad), borrada en cascada al borrar la cuenta y fuera de la exportación (es efímera). Límites por IP para `device` y `poll`. Se descarta un esquema `aeonarch://` registrado en Windows (más frágil y el token viajaría por la línea de órdenes).
- **WebSocket.** Igual que ahora: ticket con la cookie de sesión. El cliente manda `Origin: https://aeonarch.de`; la comprobación de `Origin` protege contra webs ajenas en navegadores, no contra programas, así que se mantiene y se documenta que el cliente nativo la envía.
- **Cuando el juego se abra al público** y se quite la puerta, el cliente simplemente deja de pedirla (`GET /api/client-version` dirá si hace falta, ver §2.5).

### 2.4 Qué cambia con el mapa estelar

Hoy **el cliente genera el mapa** (posiciones y clases de estrella) con `packages/procgen` (`generateSector`, `galaxyDensityAt`, `universeSeedFromString`, en `SectorManager.ts`, `QuantumPanel.tsx` y `state/store.ts`) usando `VITE_UNIVERSE_SEED`, y el servidor hace lo mismo con `UNIVERSE_SEED`; el **detalle** de cada sistema ya lo da solo el servidor (`GET /api/systems/:id`, con la semilla secreta `DETAIL_SEED` y la niebla de guerra). Con un cliente en C++ hay dos caminos:

- **A. El servidor manda el mapa (recomendado).** Ruta nueva `GET /api/galaxy/sectors?…` (o un archivo por `GENERATOR_VERSION`) con las estrellas públicas por sector: id, posición, clase y nombre, lo mismo que hoy genera el cliente, nada del detalle secreto. Son ~30 000 estrellas: en binario o JSON comprimido, del orden de 1–2 MB **una vez**; el cliente lo guarda en disco junto a la versión y solo lo vuelve a pedir si cambia `GENERATOR_VERSION`. Para no gastar tráfico de Hetzner (y que nadie pueda descargarlo en bucle), se sirve como archivo estático con huella (`/assets/galaxy-v3-<hash>.bin`, caché larga de Cloudflare, como el resto de `/assets/`) o se incluye en el propio instalador. Ventajas: el cliente no necesita portar `procgen` con igualdad al bit, el servidor sigue siendo la única fuente de verdad (regla 2) y un cambio del generador no obliga a publicar un cliente nuevo.
- **B. El cliente lo sigue generando** con un port exacto de `procgen` a C++ y vectores de prueba (ver §3.4). Más trabajo y más riesgo; solo compensa si un día el mapa crece tanto que no cabe enviarlo.

Recomendación: **A** desde M1; el port de `procgen` (§3.4) se deja como plan B y para lo que el cliente quiera calcular sin preguntar (p. ej. nombres o cielos de fondo, que no afectan al juego).

### 2.5 Versión mínima del cliente frente a `PROTOCOL_VERSION`

Hoy el cliente web siempre está al día (se descarga en cada visita) y el servidor rechaza en `hello` cualquier `PROTOCOL_VERSION` distinta. Un cliente de escritorio instalado se queda viejo, así que:

- **`PROTOCOL_VERSION` sigue siendo la regla dura** del WebSocket: si no coincide, no hay conexión. Sigue subiendo solo con cambios incompatibles del protocolo.
- Se añade **`GET /api/client-version`** (público, pequeño, sin datos personales), que el cliente consulta antes de iniciar sesión:
  ```jsonc
  { "protocol": 15, "minNative": "0.4.0", "latestNative": "0.5.2", "download": "https://…", "gate": true }
  ```
  - Si `protocol` no es la del cliente o su versión es menor que `minNative`: pantalla «Hay que actualizar» con el enlace, en vez de un error de conexión.
  - Si es menor que `latestNative`: aviso suave.
  - `gate`: si hay que pedir la puerta.
- La versión del cliente (`Aeonarch/<versión>` en el agente de usuario y en `hello`) se guarda en la configuración del servidor (`NATIVE_MIN_VERSION`, `NATIVE_LATEST_VERSION`, `NATIVE_DOWNLOAD_URL` en `.env.example`), así un despliegue del servidor puede exigir un cliente nuevo.
- Para no obligar a actualizar por cada cambio: preferir **cambios compatibles** (campos nuevos opcionales, mensajes nuevos que el cliente viejo ignora) y subir `PROTOCOL_VERSION` solo cuando se rompa algo. El decodificador del cliente debe **ignorar mensajes y campos desconocidos** en vez de fallar.
- Orden de un despliegue con protocolo nuevo: publicar el cliente nuevo → desplegar el servidor (con `minNative` nuevo) → los clientes viejos ven «Hay que actualizar». El cliente web se despliega a la vez, como ahora.

### 2.6 Resumen de cambios en el servidor (los hace Claude)

1. Puerta para cliente nativo (`POST /puerta/native`, agente de usuario en `isDesktop`).
2. Código de dispositivo (`/api/auth/device`, `/poll`, tabla `device_codes`, `sessions.kind`, sesiones nativas visibles en Ajustes → Cuenta), con límites, cascada al borrar la cuenta y artículo de la Wiki.
3. Mapa estelar servido por el servidor (§2.4), como archivo estático con huella.
4. `GET /api/client-version` y variables `NATIVE_*`.
5. Generador del protocolo en C++ (§2.2) y exportación de `content` e i18n.

Todo se puede probar sin Unreal con un script Node que haga de cliente nativo (`scripts/native-client-smoke.ts`) contra el servidor de desarrollo, con cuentas de `aeonarch-sesion-prueba` (regla 11).

## 3. Qué hay que reescribir en el cliente

Tamaño de referencia: `apps/client/src` tiene unas 28 000 líneas (motor 3D, interfaz React, audio, tutorial, red). Lo que importa del cliente de `packages/*`: `procgen` (~800 líneas), parte de `sim` (~2 600 en total), los datos de `content` (~4 900) y las ~2 100 claves i18n por idioma.

### 3.1 Render y escena (`apps/client/src/engine`)

| Hoy (Three.js) | En Unreal |
|---|---|
| `GalaxyView`, `GalaxyCloud`, `SectorManager` (mapa de ~30 000 estrellas) | Niagara o `UInstancedStaticMeshComponent` para las estrellas; el mapa como un «nivel» aparte. |
| `SystemView` (2 400 líneas: estrella, planetas, lunas, cinturones, órbitas) | Actores por cuerpo; materiales procedurales para planetas (`planetLook.ts` → material con parámetros). |
| Escala astronómica (Sol de 2500 km, órbitas a 270 000 km·√UA, búfer de profundidad logarítmico) | Unreal usa coordenadas `double` (LWC) desde la 5.0, así que las distancias caben, pero la precisión de render sigue necesitando **origen flotante** (re-centrar el mundo en la nave) y escalar visualmente lo lejano. Hay que decidirlo en M1; es el punto técnico más delicado del render. |
| `shipFactory.ts` (naves procedurales paramétricas, LOD) | `UProceduralMeshComponent` o **Geometry Script** (en tiempo de ejecución) con los mismos parámetros de `packages/content` shipModels.ts; o generar mallas una vez en el editor y guardarlas. Las bocas de fuego (`shipHardpoints`) deben salir del mismo cálculo. |
| `TunnelView`, `Backdrop`, `Effects`, `fx/` (túnel cuántico, cielo por sistema, destellos con `flashLimiter`) | Niagara y materiales de postproceso. **Mantener el limitador global de destellos** (fotosensibilidad). |
| `DeepField` (asteroides) | Instancias; la capa de asteroides es secreta y la manda el servidor (`field`). |
| `FleetScene` (batallas por rondas en 3D) | Nivel o subescena propia. |

### 3.2 Pilotaje y cámara

- `ShipController`, `FlightController`, `Autopilot`, `ChaseCamera`, `TargetAssist`, `input.ts`, `pointerLock.ts`, `cockpit.ts`: se reescriben como `APawn` + componentes en C++, con **Enhanced Input** para las teclas configurables (las asignaciones actuales —J, K, L, I, G, B, Z, N, H, X, Y/U, V, O, rueda, Ctrl + rueda— pasan a un `UInputMappingContext` editable desde Ajustes).
- La física de vuelo la decide el servidor y lo tolera (`packages/sim` flight.ts, gravity.ts, aim.ts, park.ts). El cliente predice con la misma fórmula: **se porta a C++** la parte que el cliente usa (inercia, pulso `stepPulseSpeed`, gravedad por esferas de influencia, punto de adelanto `leadPoint`, `positionAt`, `quantumFuelCost`, `quantumRangeLy`, `travelDurationMs`, `regenFuel`, `fleetRallyPoint`, `fleetSlotPosition`). Aquí **no** hace falta igualdad al bit: el servidor corrige con `poseRejected`; basta con que la diferencia sea pequeña (pruebas con tolerancia, ver §3.4).
- **No usar** `UCharacterMovementComponent` ni la física Chaos para la nave: la autoridad es nuestra.

### 3.3 Interfaz, i18n y audio

- **Interfaz**: ~60 componentes React (`apps/client/src/ui`: barra superior, barra de acciones vertical, ventanas con pestañas minimizables, colonias, mercado, flotas, batallas, linaje, contratos, Astillero, tutorial…). En Unreal: **UMG + CommonUI** (pestañas, foco, mando), con widgets en C++ (`UUserWidget` con `BindWidget`) y el aspecto en el editor. Es la parte **más grande** del trabajo. Mantener las preferencias de `docs/diseno.md`: sin emojis, iconos de línea propios (exportar los SVG de `hudIcons.tsx` a texturas o a `Slate` vectorial), barra superior en una línea.
  - Alternativa a valorar en M0: **interfaz web dentro del juego** (navegador embebido, `WebBrowserWidget`/CEF, o un middleware HTML/CSS para juegos) reutilizando los componentes React. Ahorraría meses, pero CEF pesa, rinde peor en superposiciones y complica la depuración. Recomendado: UMG para el HUD de vuelo y combate; decidir en M3 si las ventanas de gestión (mercado, colonias, Astillero) se rehacen en UMG o se muestran con el navegador embebido.
- **i18n**: hoy son claves en `packages/shared/src/i18n/es.ts` y `en.ts` (regla 5). Propuesta: un script que exporte esas claves a **tablas de cadenas** de Unreal (CSV → `UStringTable`, ID `Aeonarch`, clave igual que en TypeScript) y usar `FText` con `LOCTABLE("Aeonarch", "clave")`. Las cadenas con parámetros pasan de `{name}` a `{name}` de `FText::Format` (compatible si se usan nombres). Una sola fuente de verdad: los `.ts`; la Wiki y el cliente web siguen leyéndolos.
- **Datos** (`packages/content`): se exportan a JSON en el empaquetado (`scripts/export-content.ts`) y el cliente los carga como `UDataTable`/`UDataAsset`. Así siguen siendo datos (regla 4), sin copiar a mano.
- **Audio generativo** (`apps/client/src/audio`: música y efectos con Web Audio, sin archivos): en Unreal, **MetaSounds** (síntesis procedural nativa, con parámetros desde C++). La música generativa de `music.ts` se reescribe como grafo de MetaSound + lógica de composición en C++. Se puede mantener la regla «sin archivos de audio».

### 3.4 Generación procedural idéntica (regla 3) — plan B

Con el mapa servido por el servidor (§2.4) esto deja de ser imprescindible; queda como plan B y para lo que el cliente calcule por su cuenta. Si se porta:

El cliente genera hoy en local el mapa estelar (`generateSector`, `STAR_CLASSES`, `galaxyDensityAt`, `universeSeedFromString`) y el servidor, el detalle secreto. Si el cliente de Unreal calcula una estrella distinta en un solo sector, el jugador ve un mapa que no coincide con el del servidor. Hay que **portar `packages/procgen` a C++ (`AeonProcgen`, módulo sin dependencias de UE)** con igualdad exacta, así:

1. **Reglas de traducción** (las mismas que impone la regla 3):
   - Enteros de 32 bits: `Math.imul(a, b)` → `(uint32)((uint64)a * b)`, `>>> 0` → `uint32`, `| 0` → `int32` con la conversión **ToInt32** de JavaScript (módulo 2³², no un `static_cast` de un `double` grande, que es comportamiento indefinido en C++), `>>>` → desplazamiento sobre `uint32`, `>>` → sobre `int32`.
   - Coma flotante: solo `double`, `+ - * /` y `sqrt` (IEEE 754 los redondea igual en todas partes). Compilar ese módulo **sin contracción FMA** (`/fp:precise` en MSVC, `-ffp-contract=off` en Clang) y sin `-ffast-math`; nada de `float`. `Math.floor` → `std::floor`.
   - `hashString` usa `charCodeAt` (UTF-16): en C++ convertir a UTF-16 explícitamente (`StringCast<UTF16CHAR>`); no depender del tamaño de `TCHAR`.
   - Orden: `Array.prototype.sort` es estable → `std::stable_sort` con el mismo comparador; iteración de objetos y `Map` en orden de inserción → `TArray` o contenedores ordenados, nunca `TMap` para decidir orden.
   - Formateo de nombres (`names.ts`) y cualquier conversión número→texto: reproducir exactamente (`Number.prototype.toString` no es `printf`).
   - `galaxy.ts` usa aproximaciones propias (`approxCos`, con reducción del ángulo por `Math.floor` y polinomio de Taylor, y un logaritmo por serie) en vez de `Math.cos`/`Math.log`: portar la misma fórmula **en el mismo orden de operaciones** (sin reagrupar términos ni dejar que el compilador use FMA), nunca `FMath::Cos`/`FMath::Loge`.
2. **Vectores de prueba compartidos**: un script Node (`scripts/procgen-vectors.ts`, lo escribe Claude) genera `packages/procgen/test/vectors/*.json` con entradas y salidas de `mix32`, `hashString`, `hashInts`, `Rng` (primeros 1000 valores de varias semillas), ruido, densidad de la galaxia y **sectores completos** de una muestra de coordenadas (incluidos el Núcleo, el Ónfalo y bordes de la galaxia), con `GENERATOR_VERSION` en el nombre. Los `double` se guardan como **bits en hexadecimal** (no como texto decimal), para comparar al bit.
3. **Prueba en C++ fuera de Unreal**: el módulo `AeonProcgen` es C++ puro, así que se compila también con CMake y una prueba que lee los vectores. **Claude puede compilarla y ejecutarla en Linux** (g++/clang en el contenedor) aunque no tenga Unreal; el dueño ejecuta la misma prueba en Windows (MSVC) y dentro del motor (Automation Tests de UE). Si MSVC y Clang dan lo mismo que Node, el riesgo queda cubierto.
4. Cada cambio de `packages/procgen` (y cada subida de `GENERATOR_VERSION`) regenera los vectores; `scripts/verify.sh` falla si los vectores no coinciden con el TypeScript.
5. Alternativa más sencilla a medio plazo: que **el servidor mande el mapa** (como ya hace con el detalle de los sistemas) y el cliente deje de generarlo. Quita el riesgo, pero añade tráfico (30 000 estrellas ≈ 1–2 MB comprimido, mejor por sectores y en caché en el disco del cliente). Recomendado: portar procgen con vectores (es pequeño, ~800 líneas) y dejar esta opción como plan B.

Para `packages/sim` en el cliente se aplica la misma técnica de vectores, pero **con tolerancia** (el servidor manda).

## 4. Fases de la migración

Cada fase termina con algo que el dueño puede abrir y jugar. Las estimaciones son de **semanas de trabajo del dueño a ratos** con ayuda de Claude, muy aproximadas; dependen sobre todo de cuánto se cuide el aspecto. Mientras tanto **el cliente web sigue siendo el juego** (se despliega como hasta ahora).

| Fase | Contenido | Jugable al acabar | Tamaño | Lo que hace Claude | Lo que hace el dueño |
|---|---|---|---|---|---|
| **M0. Preparación** | Repositorio `aeonarch-unreal` (o carpeta `apps/unreal`, con Git LFS para `.uasset`; los binarios de Unreal no deben inflar el repositorio actual). Wiki a `apps/wiki`. Generador del protocolo, exportación de `content` e i18n a JSON/CSV. Servidor: puerta para cliente nativo, código de dispositivo, mapa estelar servido por el servidor, `/api/client-version` (§2.6). | Nada nuevo en Unreal; el servidor ya admite el cliente nativo (se prueba con un script Node que simule ser el cliente). | 1–2 semanas | Casi todo: scripts, servidor, pruebas Node. | Instalar UE 5.8.4 y Visual Studio 2026; crear el proyecto C++ vacío. |
| **M1. Prototipo conectado** | Cliente Unreal que inicia sesión, pide ticket, abre el WebSocket, recibe `hello` y `snap`, dibuja el sistema actual (estrella, planetas desde `GET /api/systems/:id`) y las naves de `space`/`poses`. Vuela con controles básicos y manda `pose`. Origen flotante y escala. | **Sí**: se vuela en el mismo sistema que alguien del cliente web y ambos se ven. | 3–5 semanas | C++ de red, JSON, modelo de estado, controlador de vuelo (sin compilar: el dueño compila y pega los errores). | Compilar, probar, crear materiales y escena; decidir el estilo visual. |
| **— Decisión —** | Con M1 en la mano: ¿rinde, se ve mejor, compensa el esfuerzo? (ver §5) | | | Informe de lo que falta. | Decide seguir o volver. |
| **M2. Mapa y salto** | Mapa galáctico con las estrellas que manda el servidor (§2.4; port de `procgen` solo si se elige el plan B), salto cuántico (J), túnel y grieta (`rift`), salida a espacio profundo (K). | Sí: viajar por la galaxia. | 3–4 semanas | Lógica de salto y del mapa (y el port de procgen con su prueba en Linux, si hace falta). | Efectos (Niagara), pruebas en Windows. |
| **M3. Combate y pilotaje completo** | Armas, misiles, escudos, asistencia de puntería, fuego automático, choques, calor, minería (L), arranque de motores (I), autopiloto de crucero, cabina, instrumentos, `shipFactory` en Unreal, audio de vuelo y combate (MetaSounds). | Sí: el bucle de vuelo y combate completo. | 6–10 semanas | Port de `aim.ts`, `flight.ts`, `gravity.ts`, autopiloto, generador de naves. | Arte, sonido, ajuste de sensaciones. |
| **M4. Interfaz de gestión** | Barra superior y de acciones, colonias, flotas, logística, mercado, humanidad, batallas por rondas (`FleetScene`), asedios, linaje y `DeathScreen`, contratos, rango, objetivos, Astillero, investigación, ajustes y teclas, i18n es/en completo. | Sí: todo el juego salvo el tutorial. | 8–14 semanas (la mayor) | Widgets en C++, enlaces con el estado, tablas de cadenas. | Diseño de los widgets en el editor. |
| **M5. Pulido y distribución** | Tutorial (12 capítulos), aviso de fotosensibilidad, música generativa, opciones gráficas, instalador, alojamiento de la descarga (R2/itch.io/Steam), comprobación de versión, informes de fallo sin Epic, textos legales y `LEGAL_VERSION`, Wiki (artículo «Cliente de escritorio»). | Versión alfa descargable. | 3–5 semanas | Textos legales (sin datos personales: marcadores `{{LEGAL_*}}`), Wiki, servidor. | Empaquetar, firmar el ejecutable (si se quiere evitar el aviso de Windows SmartScreen, hace falta un certificado de firma de código, de pago), publicar. |
| **M6. Retirar el cliente web** (opcional) | Solo cuando el cliente Unreal lo haga todo. Se borra el motor Three.js y la interfaz React; se quedan la Wiki, las páginas legales y una portada con el enlace de descarga. | — | 1 semana | Limpieza. | Decidir la fecha. |

Total orientativo: **6–10 meses** a ratos hasta igualar el cliente actual. Durante ese tiempo cada función nueva del juego habría que hacerla dos veces (web y Unreal), así que conviene **congelar funciones nuevas grandes** a partir de M3 o asumir el doble trabajo.

### Cómo trabajar con Claude en esto

- Claude no ve el editor ni puede compilar: el bucle es «Claude escribe C++ → el dueño compila → pega el error o una captura → Claude corrige». Funciona bien para C++ y lógica; mal para materiales, Niagara, Blueprints y diseño de widgets (son archivos binarios `.uasset`). Por eso: **lógica en C++, aspecto en el editor**, y Blueprints solo como capa fina.
- Todo lo que se pueda probar fuera del motor (procgen, protocolo, decodificación JSON, fórmulas de `sim`) va en módulos C++ sin dependencias de UE, con pruebas CMake que Claude sí puede compilar y ejecutar en Linux.
- El servidor sigue siendo terreno de Claude como hasta ahora (typecheck, build, despliegue con `aeonarch-desplegar`).
- Para probar con sesión siguen valiendo solo las cuentas de `aeonarch-sesion-prueba` (regla 11); el cliente Unreal no debe guardar registros con correos ni IPs.

## 5. Riesgos y alternativas

### Riesgos

1. **Tamaño**: el cliente actual son ~28 000 líneas más paquetes compartidos y una interfaz muy densa. Rehacerlo es varias veces el trabajo de una fase normal del proyecto.
2. **Doble mantenimiento** mientras convivan los dos clientes, con `PROTOCOL_VERSION` compartida.
3. **Se pierde el «abre el enlace y juega»**: descarga de GB, instalador, aviso de SmartScreen sin firma, requisitos de GPU. Para un alfa cerrado con amigos es aceptable; para atraer jugadores nuevos es un freno.
4. **Escala astronómica** y precisión (origen flotante, distancias de cientos de miles de km): resuelto en Three.js con profundidad logarítmica; en Unreal hay que rehacerlo.
5. **Determinismo de procgen** entre TypeScript, MSVC y Clang: se evita sirviendo el mapa desde el servidor (§2.4); si se porta, vectores al bit, porque un descuido (FMA, `float`, `TMap`) rompe el mapa en silencio.
6. **Costes**: con descarga, los costes del servidor no cambian; con Pixel Streaming se multiplican por 10–50 y abren un vector de ataque que cuesta dinero. No usar Pixel Streaming salvo para una demo muy limitada.
7. **Privacidad y legal**: el informador de fallos de Epic, las tiendas y los SDK de terceros son encargados nuevos; hay que revisarlos antes de publicar.
8. **Licencia**: sin coste mientras el juego no ingrese más de 1 millón de USD; si se monetiza, 5 % por encima. Confirmar en la EULA vigente (no la he podido leer directamente).
9. **Dependencia del ordenador del dueño**: solo él compila; Claude trabaja «a ciegas» en la parte visual.
10. **Clientes viejos**: un cambio de protocolo deja fuera a quien no actualice; se mitiga con `GET /api/client-version` y cambios compatibles (§2.5).

### Alternativas

- **Quedarse en la web y mejorar el render**: Three.js con **WebGPU** (`WebGPURenderer`, ya estable en Three.js) o Babylon.js da sombras, posprocesado y mucha más potencia sin perder el navegador, la puerta, la Wiki integrada ni el despliegue actual. Es la opción más barata si lo que se busca es que «se vea mejor».
- **Godot 4**: exporta a web (con limitaciones) y a escritorio, licencia MIT sin regalías, C# o GDScript; menos potencia gráfica que Unreal pero más cerca del modelo actual.
- **Unreal solo como cliente de escritorio opcional** (además del web): lo que propone este plan hasta M5, sin llegar a M6.
- **Pixel Streaming**: descartado por coste, salvo demo.

### Recomendación

1. **No decidir la migración completa todavía.** Hacer **M0 y M1** (unas 4–7 semanas): un prototipo de cliente Unreal conectado al **servidor Node actual**, volando en el mismo sistema que el cliente web. Cuesta poco al servidor (los cambios son pequeños y útiles igualmente) y responde a lo importante: si Unreal se ve y se siente tanto mejor como para justificar meses de trabajo, y si el bucle «Claude escribe, el dueño compila» es llevadero.
2. Mantener el **servidor Node + PostgreSQL de Hetzner** como fuente de verdad, para el multijugador y la Wiki (decisión del dueño). El cliente se conecta con el mismo protocolo; el servidor manda el mapa estelar y la versión mínima del cliente.
3. Distribuir como **descarga de escritorio desde Cloudflare R2 o itch.io**, nunca desde Hetzner; descartar Pixel Streaming.
4. Wiki y páginas legales, **siempre web**.
5. Si tras M1 no compensa, la alternativa es **Three.js con WebGPU** en el cliente actual.

### Fuentes

- [Unreal Engine 5.8 Release Notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes)
- [Unreal Engine 5.8 is now available](https://www.unrealengine.com/news/unreal-engine-5-8-is-now-available)
- [5.8.4 Hotfix Released (foro de Epic)](https://forums.unrealengine.com/t/5-8-4-hotfix-released/2842775)
- [Epic: sistema de informes de regalías](https://www.unrealengine.com/news/unreal-engines-improved-royalty-reporting-system)
- [Epic: FAQ de Unreal Engine](https://www.unrealengine.com/en-US/faq)
- [The New Stack: exportar Unreal a la web (terceros)](https://thenewstack.io/a-new-tool-for-unreal-engine-developers-to-export-to-the-web/)
- [PCGH: UE5 en el navegador con WebGPU (terceros)](https://www.pcgameshardware.de/Unreal-Engine-Software-239301/News/5-Entwickler-zeigt-Spiel-im-Browser-dank-WebGPU-1440861/)
- [Pixel Streaming hosting (precios orientativos)](https://abratabia.com/unreal-engine/pixel-streaming-hosting.php)
- [AWS re:Post: usuarios por instancia de Pixel Streaming](https://repost.aws/questions/QUw_34NW4hQk2m7eNoyMhypA/how-to-have-concurrent-users-on-a-single-ec2-instance-of-unreal-engine-projects-of-pixel-streaming)
- [CoreWeave Pixel Streaming](https://coreweave.com/solutions/pixel-streaming)
- [API FWebSocketsModule](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/WebSockets/FWebSocketsModule)
- [Foro: módulo WebSockets no encontrado](https://forums.unrealengine.com/t/websocket-module-not-found/2256600)
- [Servidores dedicados (docs 4.27)](https://docs.unrealengine.com/4.27/InteractiveExperiences/Networking/HowTo/DedicatedServers)
- [Redpoint: preparar el servidor dedicado](https://docs.redpoint.games/docs/dedis/preparing_your_game_server)
