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

El ritmo es **en horas** para construir, producir y asediar. **Viajar entre estrellas cercanas lleva minutos** (decidido el 20-10-2026): un salto de 10–20 años luz dura unos minutos y cruzar un sector, entre media hora y una hora. Dentro de un sistema se vuela en tiempo real, pilotando la nave, al estilo de No Man's Sky. Se juega en sesiones cortas y frecuentes; el imperio sigue funcionando mientras el jugador no está.

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

Las especies alienígenas no son jugables. Se definen como **datos** (`packages/content`): naturaleza, doctrina, expansión, postura hacia la humanidad, preferencias, rasgos y lenguaje visual. Nombres provisionales hasta que llegue el lore:

| Arquetipo | Esencia | MVP |
|---|---|---|
| **Hordas** | Biológicas, brutales, muy prolíficas; enjambres baratos, abordajes, saqueo. | Sí |
| **Antiguos** | Longevos, escasos, tecnología muy superior; defienden sus mundos. | No |
| **Máquinas** | Sintéticas autorreplicantes, sin moral ni retirada; consumen metal. | Sí |
| **Enjambre** | Biología colectiva que asimila mundos. | No |
| **Etéreos** | Seres de energía/psíquicos cerca de anomalías; sabotaje. | No |
| **Carroñeros** | Mezcla de especies; piratas que atacan rutas de suministro. | No |

Cada especie tiene una o más **facciones**, que pueden estar enfrentadas entre sí (p. ej. dos clanes de Hordas).

## 10. Tres capas de IA

1. **Gobernadores** de jugadores ausentes: gestionan colonias según la **doctrina elegida** por el jugador (Herederos).
2. **Facciones alienígenas**: actúan según la ficha de su especie y facción.
3. **Emperadores IA humanos**: llenan el universo para que se sienta vivo con pocos jugadores.

Las tres capas usan **la misma tubería de órdenes validada** que los jugadores humanos: no hacen trampas ni tienen atajos.

## 11. Decisiones cerradas

- **PvP libre en todo el universo**, **sin protección especial para desconectados**. La defensa del ausente es su gobernador IA y su preparación.
- **Ritmo en horas** para construir y asediar; **viajes entre estrellas en minutos**; vuelo en tiempo real dentro de los sistemas.
- **Juego gratuito y sin monetizar**.
- **Estilo visual estilizado épico** (no fotorrealista).
- **Idiomas**: español e inglés como base, con **traducción comunitaria**. Prioridad de resolución: personal > organización > pública (aprobada por votación y moderación) > base.
- **Escala objetivo**: cientos de jugadores simultáneos.
