# IA de pilotaje de naves (Fase 9d)

Diseño de la IA que pilota las naves dentro de un sistema estelar: las de las
flotas de los jugadores (con órdenes) y las de los Carroñeros (por su cuenta).
Petición del usuario (21-10-2026): «una buena IA, bien implementada y bastante
completa, también para los Carroñeros».

Sustituye a la IA actual de los piratas (`apps/server/src/space/pirates.ts`):
se acercan, dan vueltas y disparan; no apuntan con adelanto, no esquivan, no
huyen ni se coordinan.

## 1. Principios

- **Justa**: la IA vuela con las mismas reglas físicas que un jugador
  (aceleración, giro y velocidad máximos de su clase de nave) y solo sabe lo
  que sus sensores ven. Nada de puntería perfecta ni de conocer el mapa entero.
- **Autoritativa y en el servidor**: corre dentro de `SpaceService`, en el
  mismo bucle que el combate en tiempo real. El cliente solo dibuja.
- **Reglas puras y deterministas**: toda la lógica vive en `packages/sim/src/ai/`
  como funciones puras (estado + percepción + semilla → decisión). Así se puede
  probar sin red ni base de datos y repetir una batalla exacta en un test.
- **Datos, no lógica**: los parámetros de cada clase de nave y de cada
  personalidad (agresividad, umbral de huida, puntería…) son datos en
  `packages/content` (regla 4 de CLAUDE.md).
- **Barata**: presupuesto fijo por sistema (ver §8).

## 2. Arquitectura por capas

Cada nave controlada por la IA tiene un **piloto** con cuatro capas, de lenta a rápida:

| Capa | Frecuencia | Qué hace |
|---|---|---|
| **Percepción** | 5 Hz | Contactos al alcance del sensor, amenaza de cada uno, memoria de la última posición vista (se pierde el rastro a los ~10 s sin verlo). |
| **Táctica** (IA de utilidad) | 2–5 Hz, escalonada | Puntúa las conductas posibles y elige una: atacar, flanquear, perseguir, huir, reagruparse, escoltar, defender, patrullar, volver a casa. Histéresis para no cambiar de idea cada ronda. |
| **Pilotaje** (comportamientos de dirección) | cada tick (20 Hz) | Convierte la conducta en un vector deseado combinando: buscar, llegar, **perseguir con adelanto**, evadir, orbitar a la distancia preferida, separación de los aliados, **esquivar planetas, lunas y la estrella**, mantener el hueco en la formación. Limitado por aceleración y giro. |
| **Armas** | cada tick | **Apunta con adelanto** (solución de intercepción con la velocidad del proyectil), dispara solo si el error de puntería entra en la tolerancia, el blanco está al alcance y **no hay un aliado en la línea de fuego**. Misiles cuando hay fijación y el escudo del blanco ha caído o el blanco huye; administra la munición. |

Las capas lentas se reparten entre ticks (cada piloto decide en un tick distinto)
para que el coste por tick sea uniforme.

## 3. Percepción y amenaza

- Alcance de sensor por clase de nave; las naves ocultas o muy lejanas no se ven.
- **Amenaza** de un contacto = daño por segundo que puede hacer × (casco + escudo
  restantes) / distancia, ajustada por si me apunta (ángulo de su morro hacia mí).
- **Valor como presa** (Carroñeros): carga que lleva, lo débil que está, si va solo.
- **Fuerza de bando**: suma de amenazas de aliados y enemigos visibles; decide si
  conviene pelear, esperar refuerzos o huir.

## 4. Conductas (táctica)

Cada conducta tiene una puntuación de utilidad (0–1) calculada con curvas sobre
la percepción y la personalidad; gana la mayor, con un bono para la actual.

- **Atacar**: elige blanco por amenaza, valor y cercanía; **fuego concentrado**
  (el grupo comparte blanco) salvo que la personalidad diga otra cosa.
- **Flanquear**: los miembros de un grupo se reparten ángulos alrededor del
  blanco para no estorbarse y no quedar en línea.
- **Perseguir**: con adelanto; abandona si el blanco es más rápido y se aleja más
  de N km o si entra en una zona que no debe (el Núcleo Humano para los piratas).
- **Evadir**: bajo fuego, maniobras laterales y cambios de velocidad
  impredecibles (semilla) para romper la puntería del atacante.
- **Huir**: con el casco bajo el umbral de su personalidad o en clara
  desventaja de fuerzas; se aleja rompiendo la línea de visión (detrás de un
  planeta si puede) y salta fuera del sistema si llega al borde.
- **Reagruparse**: con escudos bajos y sin peligro inmediato, se retira con el
  grupo hasta que se recargan.
- **Escoltar / Defender / Patrullar / Volver a casa**: ver §5 y §6.

## 4b. Tácticas de grupo y ataques sorpresa

Petición del usuario: flanqueos, ataques en grupo y ataques sorpresa «según el
talento y otras circunstancias». Un **líder de grupo** (el piloto con más
talento o el que recibe la orden) elige un **plan táctico** y reparte papeles;
cada piloto lo ejecuta con su propio talento. Si el líder cae, otro toma el mando.

**Planes de ataque en grupo** (cada uno con condiciones y papeles):

| Plan | Cuándo | Papeles |
|---|---|---|
| **Tenaza** | Superioridad numérica, blanco aislado | Dos alas entran por lados opuestos a la vez; el blanco no puede encarar a ambas. |
| **Yunque y martillo** | Un ala aguanta bien el daño | El yunque atrae y fija al enemigo de frente; el martillo rodea y golpea por detrás. |
| **Cebo** | El enemigo es agresivo y persigue | Una nave rápida provoca y huye hacia donde espera el resto emboscado. |
| **Oleadas** | Escudos enemigos fuertes | Pasadas sucesivas para no dejarle recargar escudos; quien pasa se retira a recargar. |
| **Fuego concentrado** | Blanco peligroso o casi destruido | Todos al mismo blanco, priorizando al que más daño hace o al que está a punto de caer. |
| **Dispersión y reagrupe** | Llegan misiles o fuego pesado | Se separan en direcciones distintas y se vuelven a juntar más adelante. |
| **Cobertura** | Un aliado dañado | Uno o dos se interponen y atraen el fuego mientras el dañado se retira. |

**Ataques sorpresa** (aprovechar el entorno y el momento):

- **Desde la sombra de un planeta o una luna**: esperar detrás, fuera de la
  línea de visión del sensor del blanco, y salir cuando pasa cerca.
- **Desde el resplandor de la estrella**: acercarse con la estrella a la
  espalda, donde los sensores del blanco ven peor (penalización de detección).
- **Motores al mínimo**: en emboscada, la firma de la nave baja y se la detecta
  más tarde; al atacar, la firma sube.
- **Golpe de oportunidad**: atacar cuando el blanco ya está peleando con otro,
  acaba de llegar de un salto, tiene los escudos caídos o va cargado y lento.
- **Por detrás y por arriba**: elegir el ángulo de entrada fuera del cono de
  visión del morro del blanco.

**Talento y circunstancias.** Cada piloto tiene rasgos (datos en
`packages/content`), que deciden qué planes conoce y lo bien que los ejecuta:

- **Talento** (novato, veterano, as): puntería, reacción, lo bien que mantiene
  su papel y cuántos planes conoce (un novato solo carga de frente o huye; un as
  hace cebos y ataques desde la sombra).
- **Audacia**: cuánto riesgo acepta (cebo, perseguir más lejos, huir más tarde).
- **Disciplina**: si mantiene la formación y el plan o se lanza a por la presa.
- **Moral** (grupo): sube al derribar enemigos y baja con las pérdidas y la
  muerte del líder; con la moral baja el grupo se rompe y huye.

Las **circunstancias** que pesan en la elección del plan: número y fuerza de
cada bando, talento del líder, terreno cercano (planetas, lunas, estrella),
estado del blanco (escudos, casco, carga, si está peleando), munición propia y
distancia a casa o a la salida del sistema. La elección lleva algo de azar
(con semilla) entre los planes válidos para que no sean previsibles.

**Pruebas** (añadir al §9): la tenaza y el yunque y martillo deben ganar más
que la carga directa con las mismas naves; una emboscada desde la sombra debe
dar el primer disparo antes de ser detectada en la mayoría de los casos; un
grupo con un as de líder debe ganar más que uno de novatos igualado en naves.

## 5. Naves de las flotas del jugador

Cuando el Emperador está en un sistema donde tiene flotas, sus naves aparecen en
3D a su alrededor (hasta el tope del §8) y obedecen órdenes:

| Orden | Comportamiento |
|---|---|
| **Escoltarme** (por defecto) | Formación alrededor del Emperador (cuña, esfera o línea según el número); atacan a lo que le amenace. |
| **Atacar objetivo** | El blanco fijado por el jugador (tecla de fijar). Van a por él con la táctica completa; al destruirlo vuelven a escoltar. |
| **Defender** posición o planeta | Patrullan alrededor y atacan a lo que entre en el radio. |
| **Mantener posición** | No se mueven; disparan a lo que esté al alcance. |
| **Retirarse** | Vuelven junto al Emperador evitando el combate. |

- **Reglas de enfrentamiento** por flota: agresivas (atacan a cualquier hostil
  visible), defensivas (solo si atacan al grupo; por defecto) o pasivas (nunca disparan primero).
- Las órdenes se dan desde la interfaz y con teclas configurables (Ajustes →
  Controles), y van por la tubería normal de órdenes (`cmd`, idempotentes).
- El HUD muestra el estado de los compañeros de ala (casco, escudo, orden actual).
- Las naves destruidas en 3D se pierden también en la flota (misma regla que el
  combate por rondas de la Fase 9a).

## 6. Carroñeros: personalidad

Piratas oportunistas de especies mezcladas (`docs/lore.md`). No pelean por
honor: buscan botín con el menor riesgo.

- **Cazan en manada** (2–4): esperan a estar juntos antes de atacar; si uno ve
  una presa, avisa a los cercanos del sistema.
- **Eligen presas débiles**: naves solas, dañadas o cargueros con carga. Evitan
  a grupos más fuertes (solo observan desde lejos y siguen a distancia).
- **Emboscadas**: esperan cerca de planetas, lunas y de la zona de llegada de
  los saltos, con los motores al mínimo.
- **Acosan, no se suicidan**: atacan, se retiran a recargar escudos y vuelven.
  **Huyen** con el casco bajo (~35 %) o si el bando contrario gana claramente,
  y pueden volver más tarde con refuerzos.
- **Prefieren inutilizar a destruir** a los cargueros (cuando haya botín y
  abordaje, Fase 9b/logística: robar carga en vez de reventar la nave).
- **Peligrosidad por zona**: más lejos del Núcleo Humano, Carroñeros más
  numerosos, mejor armados y con mejor puntería (niveles de habilidad como datos).
- Nunca entran en el Núcleo Humano y abandonan la persecución en su borde.

## 6b. Humanos controlados por la IA

Petición del usuario: «para la humana también tiene que haber inteligencia».
Los humanos de la IA usan el mismo piloto (§2–§4b), con sus propias personalidades:

**Naves humanas en los sistemas** (pilotaje, Fase 9d):

- **Milicia del Núcleo Humano**: patrulla los sistemas del Núcleo, defiende a
  los jugadores de los Carroñeros que se acerquen al borde y persigue a quien
  ataque a otro humano dentro del Núcleo. Disciplinada: formación, cobertura y
  fuego concentrado; no persigue fuera del Núcleo.
- **Mercantes y convoyes**: viajan entre colonias; huyen y piden ayuda (avisan a
  la milicia y a los Emperadores cercanos) si los atacan.
- **Escoltas de convoy**: protegen a los mercantes con el plan de cobertura.

**Emperadores humanos de la IA** (estrategia, Fase 11): no solo pilotan; gobiernan.

- **Economía**: eligen planetas que reclamar (habitabilidad, riqueza, energía,
  distancia), construyen instalaciones en buen orden (minas → centrales →
  refinería → astillero), mantienen el abastecimiento de volátiles y montan
  rutas de transporte entre sus colonias.
- **Expansión y exploración**: envían flotas a explorar, colonizan siguiendo un
  plan y no se estiran más de lo que pueden defender.
- **Guerra**: evalúan la fuerza propia y la ajena antes de atacar, defienden sus
  colonias, interceptan convoyes enemigos y se retiran de las batallas perdidas.
- **Diplomacia**: aceptan o rechazan compañeros según su personalidad e
  historial (quién les atacó, quién les ayudó); cooperan contra los Carroñeros y,
  más adelante, contra las facciones alienígenas.
- **Personalidad** (datos): expansionista, mercader, militarista, defensivo…
  más su talento, como los pilotos.
- **Juego limpio**: usan la misma tubería de órdenes que los jugadores (proceso
  `apps/ai`, Fase 11), con los mismos límites y sin ver lo que la niebla de
  guerra les oculta.
- **Gobernadores**: la misma IA puede gestionar las colonias de un jugador
  ausente si él lo activa (con límites que él elige).

## 7. Niveles de habilidad (datos)

Cada piloto tiene un perfil en `packages/content`: error de puntería, tiempo de
reacción, agresividad, umbral de huida, disciplina de formación y uso de misiles.
Los Carroñeros usan perfiles según la zona; las naves de las flotas, según su
tripulación (más adelante, con experiencia).

## 8. Rendimiento

- Tope de naves simuladas en 3D por sistema (orientativo: 30 entre todos los
  bandos). Por encima, la batalla se resuelve por rondas (Fase 9c) y en 3D solo
  se muestran las más cercanas a cada jugador.
- Percepción con rejilla espacial o búsqueda directa (n ≤ 30: n² basta).
- Táctica escalonada entre ticks; sistemas sin jugadores «dormidos» (como ahora).
- Medir el coste por tick en los tests de rendimiento y fijar un máximo.

## 9. Pruebas y calidad (cómo sabemos que la IA es buena)

Un **banco de pruebas sin red** en `packages/sim` que enfrenta pilotos en
escenarios deterministas (misma semilla, mismo resultado) y mide:

- Puntería: % de impactos contra un blanco que maniobra, por nivel de habilidad.
- Persecución: tiempo hasta alcanzar el alcance de tiro; abandono correcto.
- Huida: que se dispare con el umbral y que la nave sobreviva más a menudo.
- Navegación: **cero colisiones** con planetas, lunas y estrella en N batallas.
- Formación: error medio de posición en escolta durante un viaje con giros.
- Fuego amigo: ningún disparo con un aliado en la línea de fuego.
- Coordinación: 3 Carroñeros contra 1 caza ganan más que 3 que atacan por separado.
- Equilibrio: tasas de victoria en escenarios tipo (1 contra 1 igualado ≈ 50 %;
  manada contra carguero solo; escolta de 4 contra manada de 3…).

Los umbrales quedan como pruebas de regresión: si un cambio empeora la IA, falla un test.
