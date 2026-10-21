# Aterrizaje (preparado, sin implementar)

Objetivo futuro (estilo No Man's Sky): acercarse a un planeta, entrar en la atmósfera, descender, explorar la superficie, extraer minerales y construir una base. **Hoy no existe nada de eso**; este documento recoge qué hay ya y cómo se añadiría.

## Lo que ya existe (22-10-2026)

### Escalas separadas

| Escala | Dónde | Qué |
|---|---|---|
| Lógica (astronómica) | `packages/procgen` | Lo generado: tipo, radio en radios terrestres, UA, clase de estrella. **No cambió** (`GENERATOR_VERSION` igual). |
| Física (simulación) | `packages/content` bodies.ts (`WORLD_SCALE`, `STAR_BODIES`, `PLANET_BODIES`) y `packages/sim` bodies.ts / systemLayout.ts | Metros de la simulación, iguales en cliente y servidor: radios, órbitas, μ, esferas de influencia, colisiones. |
| Visual (render) | `apps/client` SystemView | Cada cuerpo se dibuja con su radio físico; no hay radio «visual» aparte. De lejos ayudan los rótulos y las líneas de órbita. |
| Interacción | `CelestialBody.approachAltitude`, `surfaceAltitude`; `flight.ts` (pulso) | Distancias de aproximación, proximidad a la superficie, límite del pulso. |

Cifras actuales: nave ~45 m; Tierra 62 km de radio (radios ^0,7: rocosos 20–95 km, gigantes 220–350 km); lunas 4–35 km; Sol 2500 km (raíz del radio solar); órbitas = esfera de la estrella + 18 000 km·√UA, sin solapar esferas de influencia; pulso hasta 2000 km/s.

### Cada cuerpo (`CelestialBody`, `packages/sim/src/bodies.ts`)

`kind` (star/planet/moon/asteroid), `parent`, `radius`, `mu`, `surfaceGravityG` (lógica) y `surfaceGravity` (simulada, recortada a 30 m/s²), `massEarth`, `influenceRadius`, `approachAltitude`, `surfaceAltitude`, `atmosphere` (altura y densidad), `surface` (roca, polvo, hielo, lava, océano, arena, tóxica, gas, plasma), `entry` (vacío, suave, turbulenta, caliente, aplastante), `landable` y `resources`. Todo se deriva de forma determinista del tipo y del radio generados (`PLANET_BODIES`); las lunas, de un resumen del id del sistema, el planeta y la luna.

### Gravedad (`packages/sim/src/gravity.ts`)

Atracción por esferas de influencia con suavizado, regiones (espacio profundo, aproximación orbital, proximidad a la superficie), integración semi-implícita en subpasos en el cliente y cota de velocidad por caída en el servidor. Limitaciones: sin asistencia gravitatoria (honda); gravedad de estrellas recortada; órbitas de planetas y lunas analíticas (sobre raíles) y muy lentas; la nave pilotada no hereda la velocidad del planeta (no hay marco de referencia local: no hace falta mientras las órbitas vayan a decenas de m/s).

## Cómo se añadiría

1. **Aproximación y entrada.** Al bajar de `approachAltitude` con el pulso apagado, el cliente pasaría a un **marco local del cuerpo** (origen en su centro, girando con él: `planetSpinAngle`), lo que da precisión y deja la superficie quieta bajo la nave. Por debajo de `atmosphere.height`, arrastre según `atmosphere.density` y efectos según `entry` (calor, turbulencia; los gigantes, `crushing`, no se pueden atravesar). El servidor validaría con la misma región.
2. **Transición.** Reutilizar el patrón de `SectorManager`/`onLeave` (paso sin pantallas entre espacio y sistema): una vista nueva `SurfaceView` (como `SystemView`/`TunnelView`, interfaz `View`) que el motor activa al cruzar `surfaceAltitude` y desactiva al subir. El servidor añadiría una «sala» por cuerpo dentro de `SpaceService` (hoy una por sistema).
3. **Terreno procedural.** Alturas deterministas por cuerpo con `packages/procgen` (solo enteros y `+ - * / sqrt`, semilla derivada de `DETAIL_SEED` y del id del cuerpo, nueva capa sin tocar `GENERATOR_VERSION`), en un quadtree de parches sobre la esfera (cube-sphere) con LOD; el sombreado actual de `bodyMaterials.ts` serviría de lejos. Las colisiones pasarían de la esfera a la altura del terreno.
4. **Gravedad superficial.** Ya está: `surfaceGravity` (m/s²). En tierra, el jugador a pie la usaría tal cual.
5. **Minería.** Los depósitos del planeta (`Planet.deposits`, `Moon.deposits`) y `CelestialBody.resources` decidirían qué vetas aparecen; la extracción sería una orden validada por el servidor con su asiento en `resource_ledger` (como las colonias).
6. **Bases.** Una base sería una colonia con posición en la superficie (tabla nueva, migración nueva), reutilizando la cola de construcción y las instalaciones de `packages/content` economy.ts.

Ninguno de estos pasos exige cambiar la escala ni los datos generados.
