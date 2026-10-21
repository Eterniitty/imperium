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

## Ataques a colonias

Las facciones que no ignoran a los intrusos **asedian las colonias humanas de su territorio** cuando te son hostiles (por naturaleza o por rencor): en cada decisión de su región, con una probabilidad según su **agresividad**, empiezan un asedio si tienen una flota allí o envían flotas. No desembarcan humanos: al completar el asedio, **ocupan** la colonia (muere parte de la población). Puedes recuperarla asediándola tú (eso les suma rencor). Nunca en el Núcleo Humano ni contra Emperadores en su gracia. Ver [Conquista](/wiki/conquista#alienigenas).

## Flotas de castigo

Si una facción te guarda **mucho rencor** (ver la tabla de arriba), ya no se queda en su territorio: envía **flotas de castigo** a tu colonia más cercana a su alcance, aunque esté lejos de sus sistemas. Al llegar la **asedian** (si no hay flotas tuyas defendiéndola) y, cuando no les queda nada que hacer, vuelven a casa. Nunca atacan en el Núcleo Humano ni durante la gracia de los Emperadores nuevos. En **Batallas → Facciones conocidas** la verás como «Te persigue». Un tributo o el paso del tiempo la calman.

## Comercio de los Nómadas del Vacío

Los **Nómadas del Vacío** tienen un **hábitat** en su territorio y una cartera de créditos. Cuando su región está despierta, **venden volátiles y metal** y **compran cristal** en el [mercado global](/wiki/mercado), cerca del último precio, con las mismas órdenes que cualquier Emperador. Lo que les compras **viaja** desde su hábitat, lejos del Núcleo: tarda más.

## Contactos alienígenas

En el panel **Batallas**:

- **Contactos**: las flotas alienígenas **en tránsito** que detectan tus sensores salen con el nombre de su facción. Puedes interceptarlas (y te guardarán rencor).
- **Avistamientos alienígenas**: sus flotas **paradas** al alcance de tus sensores.
- **Facciones conocidas**: las que has encontrado, si te son hostiles y su rencor, con el botón de tributo.

## Emperadores humanos de la IA

Para que el universo no esté vacío con pocos jugadores, hay unos pocos **Emperadores humanos de la IA**. Se ven en el mapa como cualquier Emperador, con la marca **IA**, y juegan con **las mismas órdenes y reglas** que tú: reclaman planetas con los humanos de su nave, construyen instalaciones en orden, fabrican colonizadores para fundar más colonias, mandan su explorador a descubrir sistemas cercanos y, los mercaderes, venden sus excedentes en el [mercado](/wiki/mercado). Solo saben lo que han descubierto y evitan colonizar territorio alienígena conocido. **En el Núcleo Humano no empiezan peleas.**

{{tabla:ia-emperadores}}

Desde la fase 9b, **todos defienden** sus colonias asediadas (envían sus naves armadas) y los **militaristas conquistan**: con suficientes naves armadas, asedian la colonia ajena más débil a su alcance **fuera del Núcleo** (independientes o de Emperadores que no son compañeros ni están en su gracia; nunca de facciones alienígenas) y desembarcan los colonos de un colonizador. Ver [Conquista](/wiki/conquista).

> [!dev] Aún no aceptan compañeros, y la IA de pilotaje de las naves en 3D (fase 9d) está diseñada pero no hecha.
