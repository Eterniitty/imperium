# Muerte y linaje

Tu Emperador **puede morir**. No es el final (Ley I, [Persistencia](/wiki/leyes#i-persistencia)): su cuerpo nuevo se **gesta** y vuelve. Pero la muerte tiene **consecuencias** (Ley III): tiempo, posición y lo que llevaba la nave. Todo lo de esta página se abre con el botón **Linaje** de la barra superior. Las cifras se leen del código del juego.

## Cuándo cae el Emperador

El Emperador va **en su nave**. Cae cuando el casco de la nave llega a 0:

- en el **combate pilotado** (tiempo real), contra piratas u otros Emperadores (ver [Combate](/wiki/combate));
- en una **batalla de flotas por rondas** (ver más abajo).

Al caer aparece la pantalla **«Tu Emperador ha caído»**, con quién te derribó, dónde renacerás y el **tiempo que falta**. Mientras se gesta, tu Emperador **no tiene nave**: no puede pilotar, saltar, colonizar ni desembarcar. Tus colonias, flotas, rutas, asedios y créditos **siguen funcionando** con normalidad.

## Qué se pierde y qué se conserva

| Se pierde (Ley III) | Se conserva |
|---|---|
| Los **humanos de a bordo** (mueren con la nave) | Tus **colonias**, sus existencias e instalaciones |
| El **combustible** y la **munición** que llevaba | Tus **flotas** (con su carga) y sus rutas |
| La **posición**: renaces lejos de donde caíste | Tus **créditos**, descubrimientos y compañeros |
| **Tiempo**: la gestación | Tus **Cunas** y tus **Herederos** |

La nave nueva despierta con el **casco y el escudo enteros**, la **reserva de emergencia** de combustible, la **munición que se fabrica a bordo** y unos pocos humanos: el cuerpo nuevo vuelve a generarlos solo (Ley II, [Continuidad](/wiki/leyes#ii-continuidad)). Para llenar el depósito y las armas, acércate a una colonia propia.

{{tabla:linaje}}

## La gestación

Cada muerte **seguida** alarga la gestación; el contador se **relaja con el tiempo sin morir**. Sin ninguna Cuna, la humanidad te reconstruye en el **Núcleo Humano**, más despacio y lejos de todo.

{{tabla:linaje-gestacion}}

En el panel **Linaje** ves tu **racha**, tu **generación** (sube con cada cuerpo nuevo) y cuánto duraría la gestación si cayeras ahora.

## Cunas de linaje

La **Cuna de linaje** es una instalación de colonia (se construye en el panel del planeta, como las demás): es **donde renaces** y donde se gestan tus **Herederos**. Al caer, renaces en tu **Cuna preferida** (la eliges en el panel Linaje) o, si no has elegido, en la **más cercana** a donde caíste. La nave nueva aparece **junto al planeta de la Cuna**.

Las Cunas son **objetivos militares**: si pierdes la colonia (o la Cuna cae en la captura), dejas de poder renacer allí. Los **Erradicadores** las persiguen: en su territorio, asedian primero las colonias con Cuna (ver [IA y territorios](/wiki/ia-territorios)). Si eso pasa durante la gestación, renaces en otra Cuna tuya o, sin ninguna, en el Núcleo Humano.

{{tabla:instalaciones}}

## Herederos

Los **Herederos** son cuerpos de tu linaje. Se **gestan en una Cuna** (con recursos y algunos habitantes de esa colonia) y, al nacer, **gobiernan la colonia** donde están con la **doctrina** que elijas:

- su doctrina mejora la **extracción** o la **defensa contra asedios** de esa colonia;
- si lo permites, el gobernador **encarga instalaciones** según su doctrina cuando la cola de construcción está **vacía** (nunca se mete en tus encargos y no gasta por debajo de una reserva).

Hay **un Heredero por colonia**. Para gestar otro en la misma Cuna, envía el que ya nació a **gobernar otra colonia** tuya.

{{tabla:herederos}}

{{tabla:doctrinas}}

Si la colonia de un Heredero **cambia de manos** (conquista u ocupación), el Heredero **muere** con ella.

## Encarnarse

Puedes **encarnarte** en un Heredero nacido: tu Emperador despierta en él, **en su colonia**, con su nave junto al planeta. El Heredero **se consume** y la colonia se queda sin gobernador.

- **Muerto**: en vez de esperar la gestación, despiertas ya en el Heredero (con la nave nueva, como al renacer).
- **Vivo**: tu nave y lo que lleva (humanos, combustible, munición) pasan a la colonia del Heredero. No puedes hacerlo **viajando**, en una **batalla** ni en **pleno combate** (si te han dado hace poco).

Como mucho una vez cada cierto tiempo (ver la tabla de arriba).

## La nave del Emperador en las batallas

En las [batallas de flotas por rondas](/wiki/guerra), tu nave **combate junto a tus flotas** si están en la batalla y está en el sistema (no de viaje). **Fuera del Núcleo Humano** también combate **sola**: si una flota hostil que puede atacar llega a donde está tu nave (aunque esté aparcada), la batalla empieza. Las naves de los Emperadores **no empiezan batallas** por sí solas. Su ataque, escudo y casco están en la tabla de arriba; **el casco es el mismo** que en el combate pilotado. Para escapar, salta a otro sistema.

## El casco

El casco de tu nave **se guarda**: no se cura saliendo del sistema ni con el tiempo sin más. La tripulación lo **repara a bordo** poco a poco (cuando no recibe daño) y, **junto a una colonia propia**, se repara deprisa pagando **aleaciones** de sus existencias, a la vez que se reponen combustible y munición.

## Los Emperadores de la IA

Los [Emperadores de la IA](/wiki/ia-territorios) siguen **las mismas reglas**: pueden caer, construyen una **Cuna** en su capital, gestan Herederos, los envían a gobernar sus colonias y, si caen con una gestación larga, **se encarnan** en uno.
