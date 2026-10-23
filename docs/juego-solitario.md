# Mecánicas para jugar (también en solitario)

Petición del usuario (22-10-2026): «aún no se siente como un juego». Hace falta un **bucle de juego claro** que funcione sin otros jugadores: algo que hacer, por qué hacerlo y una recompensa que se note. Reglas que se mantienen: servidor autoritativo (el juego sigue sin el jugador), sin chat ni texto libre público, contenido como datos en `packages/content`, textos en es/en y cada sistema documentado en la Wiki.

## Bucle

1. **Contratos** que te dicen qué hacer ahora (cazar, explorar, repartir, rescatar), con recompensa.
2. **Eventos** que salen al paso mientras vuelas (señales de socorro, restos, emboscadas) con decisiones.
3. **Progresión**: rango del Emperador con títulos y mejoras desbloqueables; cada contrato y evento suma.
4. **Objetivos del día y de la semana**, que renuevan los motivos para volver.

## Prioridades (más sensación de juego con menos trabajo)

| # | Mecánica | Por qué primero | Se apoya en |
|---|---|---|---|
| 1 | **Contratos** (tablero con 3–5 ofertas por jugador, renovadas cada día de juego): caza de Carroñeros, exploración (descubrir un sistema o escanear una anomalía), reparto (llevar recursos de una colonia a un sistema) y rescate (llegar a unos restos y quedarse junto a ellos) | Da qué hacer desde el primer minuto y usa sistemas que ya existen | piratas, descubrimientos, logística, crucero |
| 2 | **Rango del Emperador** (experiencia por contratos, eventos, derribos y descubrimientos; títulos y pequeñas mejoras: más bodega, más combustible, misiles extra…) | Progresión visible con poco código | contratos |
| 3 | **Eventos en el espacio** al llegar a un sistema o en crucero: señal de socorro (rescate o trampa), restos con carga, emboscada, anomalía con 2–3 decisiones fijas | Sorpresa y decisiones; no exige otros jugadores | Carroñeros, bodega, combate |
| 4 | **Objetivos diarios y semanales** (3 al día, 1 a la semana), con racha | Motivo para volver cada día | contratos y rango |
| 5 | **Retos de combate** contra la IA con dificultad creciente (oleadas en un sistema seguro, marcador personal) | Combate con propósito | IA pirata |
| 6 | **Colonias que piden cosas** (crisis locales: escasez, plaga, revuelta) con plazo y consecuencia | Da vida al imperio | economía |
| 7 | **Lore como recompensa**: descubrimientos que desbloquean libros de la Wiki | Exploración con sentido | Wiki (libros) |

## Diseño de los contratos (fase 1)

- **Datos** (`packages/content` contracts.ts): tipos, plantillas, recompensas por nivel de peligro (anillo) y rango.
- **Servidor** (`ContractService`): genera las ofertas de forma determinista por jugador y día de juego, guarda los aceptados (tabla `contracts`), sigue el progreso con los sucesos que ya existen (derribo de un pirata, descubrimiento, descarga en una colonia, presencia junto a un punto) y paga al completar. Caducan si no se cumplen a tiempo.
- **Cliente**: ventana «Contratos» con pestañas (Ofertas, En curso, Completados), objetivo marcado en el mapa y en el espacio (destino del crucero), aviso al completar y recompensa.
- Sin texto libre: todo son plantillas con nombres de sistemas y recursos.
- Wiki: artículo «Contratos».

## Estado (22-10-2026, noche)

| # | Mecánica | Estado |
|---|---|---|
| 1 | Contratos | ✓ Hecho: caza, exploración, minería, rescate (restos en un sistema conocido, señal y destino del crucero) y reparto (descarga en otro sistema que el de carga); tablero diario sin repetidos, plazos, pago. |
| 2 | Rango del Emperador | ✓ Hecho: diez rangos, experiencia de casi todo lo que se hace; mejoras de contratos (huecos, ofertas, recompensa), de la bodega, del depósito de combustible y de los misiles. |
| 3 | Sucesos en el espacio | ✓ Hecho: restos a la deriva, anomalías que se escanean (las dos, también en el espacio profundo) y señales de socorro con decisión y trampa. |
| 4 | Objetivos del día y de la semana | ✓ Hecho, con racha. |
| 5 | Retos de combate | ✓ Hecho: reto de caza por oleadas con récord personal. |
| 6 | Colonias que piden cosas | ✓ Hecho: escasez y malestar con plazo, premio y castigo. |
| 7 | Lore como recompensa | Sin empezar. |

Todo vive en la ventana de contratos (pestañas Objetivos, Ofertas, En curso, Historial y Rango) y lo explica el tutorial (capítulo 12) y la Wiki (Contratos, Rango, Sucesos en el espacio, Carroñeros y Colonias).
