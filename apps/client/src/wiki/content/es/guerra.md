# Guerra entre flotas

Cuando se encuentran flotas de Emperadores enemigos, combaten **por rondas**, resueltas en el servidor. No hace falta que estés conectado: la batalla sigue sola.

## Cuándo empieza una batalla

Al **llegar una flota** a un sistema, si allí hay **flotas paradas de dos Emperadores que no son compañeros** y al menos uno de los bandos **puede hacer daño** (alguna nave con ataque), empieza una batalla con **todas sus flotas** de ese sistema.

- Como mucho hay **una batalla por sistema**. Las flotas de uno de los bandos que llegan después **se unen** a su bando; las de terceros **esperan** a que termine.
- Al terminar, se mira si quedan otros enemigos en el sistema (y puede empezar otra).
- La nave del Emperador no participa en estas batallas: su combate es [en tiempo real](/wiki/combate).

## Cómo se resuelve una ronda

- **Todas las naves disparan a la vez** (también las que caen en esa ronda).
- Cada nave con ataque elige **al azar** una nave enemiga que siga en pie y le hace su **ataque ± una variación**.
- El **escudo de batalla** del objetivo absorbe daño hasta agotarse en esa ronda; el resto va al **casco**. El escudo se renueva en cada ronda; el casco no.
- Con el casco a 0, la nave queda **destruida**.
- El resultado es determinista: con los mismos bandos y la misma semilla, siempre sale lo mismo.

{{tabla:batallas}}

## Las naves en batalla

{{tabla:naves-combate}}

Solo el ataque, el escudo de batalla y el casco cuentan en las rondas; las armas y escudos «en tiempo real» son los del [combate pilotado](/wiki/combate).

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

## El panel Batallas

Muestra tus batallas en curso y las acabadas en la última hora: el enemigo, el sistema, las naves de cada lado, la ronda, el daño hecho y recibido en la última ronda y el resultado.

## Colonias independientes

Los planetas de los jugadores que borran su cuenta quedan como **colonias independientes**, congeladas y sin dueño. Ver [Colonias](/wiki/colonias#colonias-independientes).

> [!dev] Pendiente: ver las batallas en **3D**, la **conquista** de planetas (asedios, tropas, captura de instalaciones; fase 9b), el **combate a gran escala** (fase 9c) y la **IA de naves** (pilotaje, tácticas de grupo, emboscadas; fase 9d).
