# Combate en tiempo real

Dentro de un sistema se combate en tiempo real, pilotando. El **servidor es la autoridad**: comprueba cada disparo (cadencia, munición, alcance) y calcula los impactos; tu navegador solo envía órdenes y dibuja.

## Armas

- **Cañón** ([[F]] o **clic izquierdo**, mantener): ráfagas rápidas, sin límite de munición. Los cañones van en **montajes que giran solos**: con un blanco fijado apuntan al **punto de adelanto** si cabe en su arco alrededor del morro; si no, disparan al frente. Impacta en **la primera nave que el proyectil toca**, sea cual sea (el servidor calcula la trayectoria contra el movimiento de cada nave).
- **Misil** ([[R]], o clic izquierdo con los misiles seleccionados): mucho daño y **sigue a su blanco** dentro del sistema. Necesita un **blanco fijado** que esté **a tiro** y **delante del morro** (a menos de 60°). Si otra nave se cruza en su camino, el impacto es para ella. La munición es limitada y se repone con el tiempo. En tu nave, los cañones van en las barquillas de la proa y los misiles salen de los lanzadores de la proa de los dos módulos de hábitat, a los costados.
- **Láser de minería** ([[L]], o clic izquierdo con el láser seleccionado): solo en el [espacio profundo](/wiki/espacio-profundo), contra asteroides.
- Sin **motores** encendidos ([[I]]) no hay armas, y con el **motor de pulso** encendido no se dispara.

## Asistencia de puntería

Las naves enemigas miden pocos metros y se ven como un punto: la nave te ayuda a apuntar.

- **Marcadores**: cada nave del sistema lleva un marcador aunque no se vea, con su distancia. Forma y color dicen quién es: **rombo rojo** = hostil (piratas), **cuadrado ámbar** = otro Emperador, **círculo cian** = compañero. El **blanco fijado** lleva un recuadro mayor con su nombre, su escudo y su casco; si queda fuera de la pantalla, una **flecha** en el borde señala hacia él.
- **Fijar blanco**: [[X]] fija la nave más cercana a la retícula (al cursor en vuelo con ratón; si no, a la línea del morro). [[N]] y [[H]]: siguiente y anterior (primero los hostiles, del más cercano al más lejano; luego los demás Emperadores). [[U]]: el más cercano. **Clic central** sobre un marcador: fija esa nave. Al ciclar **nunca se fijan compañeros**; con el clic central sí (te avisa: hay fuego amigo).
- **Punto de adelanto**: un círculo donde hay que disparar según la velocidad del blanco, la tuya y la del proyectil. Se pone **verde** cuando el blanco está a tiro y dentro del arco de los montajes.
- **Puntería automática**: con un blanco fijado, los cañones apuntan solos a ese punto; tú decides cuándo disparar. Los misiles ya persiguen al blanco solos.
- **Fuego automático** ([[O]], también en Ajustes → Controles): el cañón dispara solo mientras el blanco fijado esté a tiro y en arco. Nunca dispara solo a un compañero.
- **Ratón**: con los motores encendidos, el **clic izquierdo** dispara el arma seleccionada y la **rueda** cambia de arma ([[1]] cañón, [[2]] misiles, [[3]] láser). La distancia de la cámara pasa a **Mayús + rueda**, mover la cámara al **botón derecho** (o Alt + arrastrar) y seleccionar un planeta a **Alt + clic**. Se puede desactivar en Ajustes → Controles («Ratón para combatir»). Todas las teclas se pueden cambiar.

{{tabla:punteria}}

{{tabla:armas}}

## Escudos y casco

El daño va primero al **escudo** y, cuando se agota, al **casco**. El escudo se **recarga solo** tras unos segundos sin recibir impactos; el casco no. Si el casco llega a 0, la nave queda destruida.

El estado de combate de tu nave dura aunque salgas del sistema: no se cura saliendo y entrando.

## La nave del Emperador

{{tabla:nave-emperador}}

## Si te derriban

Tu nave explota, sale del sistema y **tu Emperador cae**. Su cuerpo nuevo se **gesta** en una [Cuna de linaje](/wiki/linaje) (o, si no tienes ninguna, en el Núcleo Humano) durante un tiempo que crece con cada muerte seguida. Se pierden los humanos de a bordo, el combustible y la munición; no pierdes colonias, flotas ni descubrimientos (ver [Ley I](/wiki/leyes#i-persistencia)). Todo lo que pasa al morir está en [Muerte y linaje](/wiki/linaje).

El casco **no se cura solo al salir del sistema**: la tripulación lo repara poco a poco y, junto a una colonia propia, se repara deprisa con sus aleaciones (ver [Muerte y linaje](/wiki/linaje#el-casco)).

## Contra otros Emperadores y fuego amigo

El **PvP es libre** en todo el universo, sin protección para los desconectados: puedes atacar a cualquier Emperador que vuele en tu mismo sistema. Hay **fuego amigo**: tus disparos dañan a cualquier nave que toquen, también a tus **compañeros** (ver [Compañeros](/wiki/companeros)), que salen marcados como «compañero» con un círculo cian. Ojo al disparar con un compañero delante.

## Choques

Las naves **chocan** entre sí: dos naves que se tocan acercándose reciben daño según la velocidad del choque y rebotan. Contra planetas, lunas y asteroides la nave se para en la superficie (sin daño).

## Carroñeros

Los **Carroñeros** son piratas de la IA (todo sobre ellos en [Carroñeros](/wiki/carroneros)). **No hay ninguno en el Núcleo Humano**; fuera de él, en parte de los sistemas, rondando alguno de sus planetas: **más y más pesados cuanto más lejos** (esquifes y asaltantes cerca del Núcleo; arponeros, bombarderos, desguazadores y naves nodriza en las zonas profundas).

- Te detectan y te persiguen cuando te acercas; cada clase se queda a su distancia (los arponeros se pegan, los bombarderos disparan misiles desde lejos) y dispara desde sus bocas de fuego, con puntería imperfecta (de lejos fallan más).
- Las naves grandes son más fáciles de acertar.
- Un Carroñero derribado reaparece al cabo de un rato. Sin jugadores en el sistema, los piratas no se mueven.

> [!dev] Las **escoltas** (hasta unas 5 naves por bando que combaten junto a tu nave en tiempo real) y el paso a combate por rondas en los encuentros grandes (fase 9c) están por llegar. Hoy las batallas entre flotas se resuelven aparte, por rondas: ver [Guerra](/wiki/guerra).
