# Guerra entre flotas

Cuando se encuentran flotas de Emperadores enemigos, combaten **por rondas**, resueltas en el servidor. No hace falta que estés conectado: la batalla sigue sola.

## Cuándo empieza una batalla

Al **llegar una flota** a un sistema, si allí hay **flotas paradas de dos Emperadores que no son compañeros** y al menos uno de los bandos **puede hacer daño** (alguna nave con ataque), empieza una batalla con **todas sus flotas** de ese sistema.

- Como mucho hay **una batalla por sistema**. Las flotas de uno de los bandos que llegan después **se unen** a su bando; las de terceros **esperan** a que termine.
- Al terminar, se mira si quedan otros enemigos en el sistema (y puede empezar otra).
- **La nave del Emperador también combate** (ver [Muerte y linaje](/wiki/linaje#la-nave-del-emperador-en-las-batallas)): junto a sus flotas si están en la batalla y, fuera del Núcleo Humano, aunque esté sola, cuando llega una flota hostil a donde está. Las naves de los Emperadores no empiezan batallas por sí solas. Si cae, el Emperador muere.

## Cómo se resuelve una ronda

- **Todas las naves disparan a la vez** (también las que caen en esa ronda).
- Cada nave con ataque reparte su ataque entre sus **disparos** (casi todas, uno; corbetas, cruceros y portanaves, varios). Cada disparo elige **al azar** una nave enemiga que siga en pie —las más **grandes** tienen más probabilidad de ser elegidas— y le hace su parte del ataque **± una variación**.
- El **escudo de batalla** del objetivo absorbe daño hasta agotarse en esa ronda; el resto va al **casco**. El escudo se renueva en cada ronda; el casco no.
- Con el casco a 0, la nave queda **destruida**.
- El resultado es determinista: con los mismos bandos y la misma semilla, siempre sale lo mismo.

{{tabla:batallas}}

## Tácticas

Cada flota tiene una **táctica** que cambia cómo combate en las rondas. Se elige en el panel **Batallas** (para cada flota propia en una batalla en curso) o en la ficha del sistema donde está la flota, y **vale a distancia**: no hace falta estar allí, y en plena batalla se aplica desde la ronda siguiente. La nave del Emperador combate siempre con la táctica equilibrada.

{{tabla:tacticas}}

Con **fuego concentrado**, cada disparo va a la nave enemiga con menos casco en vez de elegirla al azar: rematas antes las naves dañadas, pero no repartes el daño.

## Las naves en batalla

Las cifras de cada nave (ataque, disparos, escudo de batalla, tamaño como blanco y casco) y el equilibrio entre clases están en [Naves humanas](/wiki/naves#en-batalla); las alienígenas, en [Naves alienígenas](/wiki/naves-alienigenas). Solo esas cifras cuentan en las rondas; las armas y escudos «en tiempo real» son los del [combate pilotado](/wiki/combate).

## Cómo termina

| Resultado | Cuándo |
|---|---|
| **Victoria / Derrota** | Un bando se queda sin naves. |
| **Retirada** | Un bando huye. |
| **Tablas** | Tras el máximo de rondas, o si ningún bando puede hacer daño. |

## Pérdidas

- Las naves destruidas **desaparecen**. Si con ellas la flota pierde bodega o plazas, **la carga que ya no cabe y los pasajeros sin plaza se pierden**, y queda apuntado en el [libro de recursos](/wiki/economia#libro-de-recursos).
- Una flota sin naves desaparece.
- Al perder naves, tu capital paga menos mantenimiento desde ese momento.

## Huir

Cualquier **orden de viaje** saca a la flota de la batalla: es una **retirada**. Mientras combate, una flota **no puede cargar, descargar ni colonizar**; los convoyes en [ruta automática](/wiki/flotas#rutas-automaticas) esperan y siguen su ruta si sobreviven.

## Contactos e interceptación

En el panel **Batallas**, la sección **Contactos** lista las **flotas enemigas en tránsito** que salen de o van a un sistema al alcance de tus sensores:

- cada flota tuya **parada** (el escáner de su mejor nave),
- tu **nave** (si no está saltando),
- cada una de tus **colonias**.

Elige una flota tuya y pulsa **Interceptar**: viaja al **destino** del contacto y, si coinciden allí, combaten. Si el contacto ya no está al alcance de tus sensores, la orden falla.

## Verla en 3D

Las batallas en curso se ven en la **vista del sistema**: los dos bandos frente a frente, con los modelos de sus naves, disparos que salen de sus bocas de fuego y explosiones cuando una ronda derriba naves. En el panel **Batallas**, **Ver la batalla en 3D** abre el sistema y lleva la cámara hasta allí (si no estás pilotando). Es una puesta en escena de lo que resuelve el servidor en cada ronda; con muchas naves se dibuja una parte proporcional.

## El panel Batallas

Muestra tus batallas en curso y las acabadas en la última hora: el enemigo, el sistema, las naves de cada lado, la ronda, el daño hecho y recibido en la última ronda y el resultado.

## Contra alienígenas

Las flotas de las facciones alienígenas combaten **igual que las de un Emperador**, por rondas. Una batalla con ellas empieza cuando coincidís en un sistema **de su territorio** y la facción **te es hostil** (por naturaleza o por [rencor](/wiki/ia-territorios#rencor-y-tributos)); nunca en el Núcleo Humano. En el panel salen con el nombre de su facción. Ver [IA y territorios](/wiki/ia-territorios).

## Colonias independientes

Los planetas de los jugadores que borran su cuenta quedan como **colonias independientes**, congeladas y sin dueño. Ver [Colonias](/wiki/colonias#colonias-independientes).

Para tomar planetas ajenos (asedio, defensas y desembarco de tropas), ver [Conquista](/wiki/conquista).

> [!dev] Pendiente: ver las batallas en **3D**, el **combate a gran escala** (fase 9c) y la **IA de naves** (pilotaje, tácticas de grupo, emboscadas; fase 9d).
