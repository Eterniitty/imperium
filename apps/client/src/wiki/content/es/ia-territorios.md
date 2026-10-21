# IA y territorios

Las facciones alienígenas ocupan **territorios** y los defienden con **flotas** que mueve una **inteligencia artificial** en el servidor. La IA no hace trampas: usa las **mismas flotas, órdenes de viaje, combate por rondas y mercado** que los jugadores, y no ve lo que oculta la niebla de guerra.

## Territorios

- La galaxia se divide en **regiones** cúbicas. Cada región es de **una especie o de nadie**, elegida entre las que pueden vivir a esa distancia del Núcleo y según la densidad de estrellas que prefieren.
- Dentro de su región, una especie ocupa **una parte de los sistemas**, sobre todo los de sus **estrellas preferidas** (ver cada ficha en [Especies](/wiki/especies#fichas)).
- **El Núcleo Humano es seguro**: ninguna especie vive en él ni entra en él. Las más peligrosas viven **más lejos**.
- El reparto es **determinista** (siempre el mismo) pero **secreto**: lo calcula el servidor con una semilla que no tiene el cliente.
- Además, los territorios **crecen despacio**: cada especie suma de vez en cuando un sistema libre cercano de su región (nunca donde hay colonias).

{{tabla:anillos}}

### En el mapa

El territorio se ve como un **halo suave del color de la especie** alrededor de los sistemas que **has descubierto**. Lo que no has explorado sigue oculto: la frontera que conoces es la que has visto. Las **ruinas precursoras** se marcan con un punto dorado. Al elegir un sistema, el panel muestra su **presencia alienígena**: de quién es, si hay ruinas y qué flotas hay (si tus sensores lo cubren ahora).

## Cómo despierta la IA

La IA no recorre el universo entero: **solo despierta donde hay humanos**.

1. Cuando una flota tuya o tu nave llega a un sistema de su territorio, **la región despierta** y aparece su **guarnición** (más flotas y más grandes cuanto más lejos del Núcleo).
2. Mientras está despierta, la IA **decide cada cierto tiempo**: llegan **refuerzos** si ha perdido flotas, sus flotas **patrullan** el territorio y, a veces, **se expande**.
3. Si una facción te es **hostil** y su respuesta es **atacar**, envía flotas contra tu flota intrusa según su **agresividad**. Al llegar, combatís [por rondas](/wiki/guerra).
4. Sin humanos cerca durante un tiempo, la región **se duerme** (sus flotas se quedan donde están).

{{tabla:ia-alienigena}}

> [!nota] **Gracia para los nuevos**: durante sus primeras horas, nadie envía flotas contra un Emperador recién llegado (aunque sí combaten las guarniciones del sistema al que entre). Y en el Núcleo Humano nunca hay combates con alienígenas.

## Rencor y tributos

Cada facción guarda **rencor** a cada Emperador. Las facciones **hostiles** por naturaleza (el Veredicto Pálido, la Marea, Casa Solenne, el Fin Callado, la Marea de Óxido) atacan siempre; las **neutrales** y las **posibles aliadas**, solo si el rencor llega al umbral.

- **Interceptar** una de sus flotas suma mucho rencor (te vuelve hostil al instante).
- **Fundar una colonia** en su territorio suma el rencor que indica su ficha (los Nómadas no toleran que les cortes las rutas; los Grises, que te expandas en su espacio).
- El rencor **se olvida** poco a poco.
- **Tributo** (diplomacia básica): en el panel **Batallas → Facciones conocidas** puedes pagar créditos para borrar el rencor. Las que **nunca pactan** (Erradicadores, Tharaxi) no lo aceptan. Si la facción comercia, los créditos van a su cartera.

## Comercio de los Nómadas del Vacío

Los **Nómadas del Vacío** tienen un **hábitat** en su territorio y una cartera de créditos. Cuando su región está despierta, **venden volátiles y metal** y **compran cristal** en el [mercado global](/wiki/mercado), cerca del último precio, con las mismas órdenes que cualquier Emperador. Lo que les compras **viaja** desde su hábitat, lejos del Núcleo: tarda más.

## Contactos alienígenas

En el panel **Batallas**:

- **Contactos**: las flotas alienígenas **en tránsito** que detectan tus sensores salen con el nombre de su facción. Puedes interceptarlas (y te guardarán rencor).
- **Avistamientos alienígenas**: sus flotas **paradas** al alcance de tus sensores.
- **Facciones conocidas**: las que has encontrado, si te son hostiles y su rencor, con el botón de tributo.

## Emperadores humanos de la IA

> [!dev] Los Emperadores humanos controlados por la IA (que colonizan, comercian y guerrean como un jugador) y la IA de pilotaje de las naves en 3D están diseñados (fases 9d y 11) pero aún no están en el juego.
