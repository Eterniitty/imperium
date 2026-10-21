# Aeonarch — Documento de diseño

Resumen de las decisiones de diseño acordadas. Este documento describe *qué* es el juego; la implementación técnica está en [arquitectura.md](arquitectura.md).

## 1. Concepto

IMPERIUM es un MMO espacial 3D para navegador. Cada jugador es un **Emperador inmortal** al frente de un fragmento de la humanidad, en una **guerra infinita** contra otros Emperadores y contra especies alienígenas en un universo procedural sin límites prácticos.

- La muerte no termina la partida: el Emperador renace. Lo que se pierde es tiempo, posición y recursos.
- La guerra no tiene final: no hay "ganador" del servidor, solo imperios que crecen, caen y se reconstruyen.

## 2. Bucle de juego

1. **Explorar**: enviar exploradores, levantar la niebla de guerra, descubrir sistemas, recursos y anomalías.
2. **Expandir**: fundar colonias con colonizadores en mundos aptos.
3. **Producir y transportar**: extraer recursos, moverlos físicamente con cargueros, construir naves e instalaciones.
4. **Defender y conquistar**: proteger rutas de suministro, asediar y capturar instalaciones enemigas.
5. **Sobrevivir a la muerte**: cuando el Emperador cae, renace y vuelve a empezar desde lo que conserve su linaje.

El ritmo es **en horas** para construir, producir y asediar. **Viajar entre estrellas cercanas lleva minutos** (decidido el 20-10-2026): un salto de 10–20 años luz dura unos minutos y cruzar un sector, entre media hora y una hora. Dentro de un sistema se vuela en tiempo real, pilotando la nave, al estilo de No Man's Sky. **El juego corre en tiempo real** (`TIME_SCALE=1` también en el servidor de pruebas): un minuto de juego es un minuto real. Viajar entre estrellas es posible gracias al **salto hiperespacial**, mucho más rápido que la luz (unos 200 a.l. por hora para la nave del Emperador); dentro de los sistemas las distancias están comprimidas para recorrerlos volando en minutos. Se juega en sesiones cortas y frecuentes; el imperio sigue funcionando mientras el jugador no está.

## 3. El Emperador inmortal

### Cunas de linaje
- Instalaciones donde se **regenera el Emperador** tras morir.
- La **gestación** tarda un tiempo que **crece con las muertes seguidas**: morir repetidamente en poco tiempo penaliza cada vez más. El contador se relaja con el tiempo sin morir.
- Las Cunas son objetivos militares de primer orden: destruirlas o capturarlas deja al rival sin punto de regeneración.

### Núcleo Humano
- Si el Emperador muere **sin ninguna Cuna** disponible, reaparece en el **Núcleo Humano**, una zona central de la humanidad.
- Es la red de seguridad: nadie queda fuera del juego, pero reaparecer allí implica estar lejos de lo que uno tenía.

### Herederos
- Se gestan en las Cunas con un **coste en tiempo y recursos**.
- Actúan como **gobernadores IA** de colonias, aplicando la doctrina elegida por el jugador.
- El jugador puede **encarnarse** en un Heredero para tomar el control directo en otra parte del imperio.

### Decisiones de la Fase 10 (21-10-2026)
- **Cuándo se muere**: cuando la nave del Emperador llega a casco 0, en el combate pilotado o en una batalla de flotas por rondas. En las rondas, la nave pelea junto a sus flotas y, fuera del Núcleo Humano, también sola si llega una flota hostil a donde está (aunque esté aparcada); las naves de los Emperadores no empiezan batallas por sí solas. El casco se guarda (no se cura saliendo del sistema): se repara despacio a bordo y deprisa junto a una colonia propia, con aleaciones.
- **Qué se pierde** (Ley III): los humanos de a bordo, el combustible, la munición, la posición y el tiempo de gestación. **Qué se conserva**: colonias, flotas (con su carga y rutas), créditos, descubrimientos, compañeros, Cunas y Herederos. El cuerpo nuevo despierta con unos pocos humanos (Ley II), la reserva de emergencia de combustible y la munición que se fabrica a bordo. La nave del Emperador no lleva bodega: la carga va en las flotas.
- **Gestación**: unos minutos la primera vez, el doble con cada muerte seguida hasta unas horas; se olvida una muerte de la racha cada pocas horas sin morir. Sin Cunas, en el Núcleo Humano y un 50 % más larga. Mientras, el Emperador no tiene nave (no pilota, no salta, no coloniza), pero su imperio sigue funcionando.
- **Cunas**: instalación de colonia (una por colonia). Se renace en la preferida (si sigue siendo propia) o en la más cercana a donde se cayó; la nave aparece junto a su planeta. Se pierden con la colonia (captura) y en las pérdidas de la captura.
- **Herederos**: uno por colonia y tres por Emperador; doctrinas Prosperidad (extracción), Bastión (defensa contra asedios) y Equilibrio. El gobernador solo construye con la cola vacía y dejando una reserva, y se puede desactivar. Mueren si su colonia cambia de manos.
- **Encarnarse**: consume al Heredero; el Emperador despierta en su colonia con su nave. Vivo conserva lo que lleva (no viajando, ni en batalla, ni con daño reciente); muerto, sustituye a la gestación. Como mucho una vez cada 12 h de juego.
- Los **Emperadores de la IA** usan lo mismo: Cuna en su capital, Herederos que gobiernan sus colonias y encarnación si caen con una gestación larga.

## 4. Universo

- **Sectores cúbicos de 100 años luz** de lado.
- **Generación determinista por semilla**: el mismo sector produce siempre las mismas estrellas, planetas y anomalías.
- **Solo se guarda lo que cambia**: colonias, instalaciones, recursos extraídos, naves. Lo no tocado se regenera a partir de la semilla.
- **Niebla de guerra**: cada jugador solo conoce lo que ha explorado o le han compartido.
- **Descubrimientos compartidos** con la propia organización de forma automática, con opción de **publicarlos** para todo el mundo.

## 5. Economía

| Recurso | Características |
|---|---|
| **Metal** | Base de casi toda construcción. Abundante. |
| **Volátiles** | Combustible y mantenimiento de naves. |
| **Energía** | Se produce y consume localmente; **no es transportable**. |
| **Cristal** | **Raro**; necesario para tecnología avanzada. |
| **Aleaciones** | Producto elaborado a partir de los anteriores. |

- **Inventarios locales**: cada colonia, instalación y nave tiene su propio inventario. No hay almacén global.
- **Transporte físico**: los recursos viajan en cargueros por rutas reales que pueden ser interceptadas.
- **Mantenimiento**: las naves e instalaciones consumen recursos de forma continua; un imperio sobredimensionado se desangra.
- **Economía de la humanidad** (21-10-2026): por encima de las colonias, la de toda la humanidad. La moneda es el **crédito**, que generan las colonias según su población; una parte fija va al **tesoro común del Núcleo Humano**, que nadie gobierna (coherente con el lore: no hay imperio humano único) y que paga **proyectos comunes** con efectos para todos. Los Emperadores aportan los recursos de esos proyectos.
- **Mercado global**: los Emperadores (y más adelante la IA, p. ej. los Nómadas del Vacío) compran y venden recursos con créditos en un libro de órdenes; los precios salen de la oferta y la demanda. Lo comprado **viaja** de la colonia del vendedor a la del comprador (la logística cuenta).

## 6. Naves del MVP

| Clase | Rol | Notas |
|---|---|---|
| **Explorador** | Exploración | Rápido, escáner de largo alcance, casi sin armas. |
| **Carguero** | Logística | Gran bodega, lento y frágil; necesita escolta. |
| **Colonizador** | Colonización | Caro y lento; **se consume** al fundar la colonia. |
| **Fragata** | Combate | La única con ataque relevante. |

Los valores concretos están como datos en `packages/content/src/ships.ts`.

## 7. Combate por escala

- **Tiempo real**: el jugador pilota la nave del Emperador con una **escolta de hasta ~5 naves por bando**. Combate directo, de acción.
- **Combate de flotas por rondas**: cuando un encuentro supera ese tamaño, pasa a **combate por rondas resuelto en el servidor** y se **muestra en 3D** a los participantes.
- El servidor es siempre la autoridad; el cliente solo visualiza y envía órdenes.

## 8. Conquista

- **Control por instalación**: no se conquista un planeta de golpe, sino cada instalación (minas, astilleros, Cunas, defensas).
- **Red de suministro**: las instalaciones aisladas de su red de suministro se debilitan.
- **Asedios con progreso**: capturar lleva tiempo y presencia sostenida; el defensor puede reaccionar.
- **Captura en vez de destrucción**: lo conquistado cambia de manos y conserva su valor.

## 9. Especies y facciones como datos

Las especies alienígenas no son jugables. Se definen como **datos** (`packages/content`): naturaleza, doctrina, expansión, postura hacia la humanidad, disposición a pactar, preferencias, rasgos y lenguaje visual. Su historia y sus motivos están en [lore.md](lore.md) (la **Gran Hostilidad**: no todas son enemigas).

| Especie | Lema | Postura | Facciones |
|---|---|---|---|
| **Erradicadores** | Purificación · Exterminio | Exterminio; nunca pactan. Atacan Cunas y población. | El Veredicto Pálido |
| **Grises** | Orden · Control | Control: pactos con límites a la expansión. | El Cálculo |
| **Nómadas del Vacío** | Supervivencia · Libertad | Comercio; hostiles si se cortan sus rutas. | La Estela Libre |
| **Precursores** | Misterio · Legado | Desaparecidos: solo ruinas y archivos. | — |
| **ELYDRI** | Nada debe olvidarse | Estudian a los Emperadores. | El Archivo Viviente |
| **THARAXI** | El individuo es prescindible | Asimilar la reproducción humana. | La Marea / La Casta Cercenada (posible aliada) |
| **AURELIANOS** | El poder debe demostrarse | Rivales naturales. | Casa Solenne (vasallaje) / Casa Varek (superarlos) |
| **NIHIL** | Toda existencia es una deuda | Divididos. | El Fin Callado / Los Desatadores (posible aliada) |
| **VESPERI** | La vida local es sagrada | Protectores o resistentes. | Los Custodios (posible aliada) / La Última Frontera |
| **Carroñeros** | Botín · Supervivencia | Saqueo. **Activos** como piratas de la IA. | Marea de Óxido |

Los nombres de facción y los rasgos numéricos son provisionales. Desde el 21-10-2026 **todas las especies salvo los Precursores están en el juego** (Fase 11): cada una tiene **territorio** (más lejos del Núcleo Humano cuanto más peligrosa; el Núcleo es seguro), **naves propias** y una **IA** que patrulla, se expande despacio, ataca a los intrusos según su agresividad o comercia (Nómadas del Vacío). Las neutrales solo atacan por **rencor** (interceptar sus flotas, colonizar su territorio), que se puede pagar con **tributos**. Los Precursores dejan ruinas. Ver `docs/arquitectura.md` («Implementado (Fase 11)») y la Wiki («IA y territorios»).

## 10. Tres capas de IA

1. **Gobernadores** de jugadores ausentes: gestionan colonias según la **doctrina elegida** por el jugador (Herederos).
2. **Facciones alienígenas**: actúan según la ficha de su especie y facción.
3. **Emperadores IA humanos**: llenan el universo para que se sienta vivo con pocos jugadores (hechos en su versión básica: colonizan, construyen, exploran y comercian; aún no guerrean).

Las tres capas usan **la misma tubería de órdenes validada** que los jugadores humanos: no hacen trampas ni tienen atajos.

## 11. Decisiones cerradas

- **Escala dentro de los sistemas** (estilo No Man's Sky, en metros): la nave del Emperador mide ~45 m; un planeta rocoso, 2–9 km de radio; un gigante gaseoso, hasta ~35 km; una estrella, 100–250 km. Las órbitas están a cientos o miles de km. Velocidad normal ~250 m/s (combate), impulso ×4 y **motor de pulso** tipo supercrucero (21-10-2026): se enciende siempre; su velocidad máxima depende de la distancia al cuerpo más cercano (cientos de m/s junto a un planeta, hasta 150 km/s en el espacio abierto; más deprisa al alejarse que al ir de frente) y cruzar el sistema lleva 1–2 minutos. Armas en metros: cañón ~2 km, misil ~5 km.
- **Nave del Emperador** (21-10-2026): sin piloto, queda aparcada y orbita la estrella como los planetas (todos la ven igual; se le puede atacar). Recursos reales del servidor: **energía** (escudos, cañón y pulso; se recarga sola), **combustible** (pulso y salto cuántico; reserva de emergencia que se regenera muy despacio) y **munición** limitada (cañón y misiles). Se reponen junto a una colonia propia con sus volátiles, metal y aleaciones.
- **Viaje cuántico** (21-10-2026): desde los mandos se elige destino, la nave se alinea, carga el motor y salta (túnel con tiempo restante). Unos 200 a.l. por hora: minutos a los vecinos y hasta ~40 min el salto más largo; el alcance lo marca el combustible (unos 133 a.l. con el depósito lleno), así que los viajes largos se hacen por etapas repostando en colonias.
- **Privacidad de la posición**: cada jugador elige quién ve dónde está su Emperador (todos, solo compañeros o nadie; por defecto, compañeros). Las flotas solo las ve su dueño. Un futuro escáner podrá detectar a quien esté cerca.
- **PvP libre en todo el universo**, **sin protección especial para desconectados**. La defensa del ausente es su gobernador IA y su preparación.
- **Ritmo en horas** para construir y asediar; **viajes entre estrellas en minutos**; vuelo en tiempo real dentro de los sistemas.
- **Juego gratuito y sin monetizar**.
- **Estilo visual estilizado épico** (no fotorrealista).
- **Idiomas**: español e inglés como base, con **traducción comunitaria**. Prioridad de resolución: personal > organización > pública (aprobada por votación y moderación) > base.
- **Escala objetivo**: cientos de jugadores simultáneos.
