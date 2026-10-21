# Combate en tiempo real

Dentro de un sistema se combate en tiempo real, pilotando. El **servidor es la autoridad**: comprueba cada disparo (cadencia, munición, alcance) y calcula los impactos; tu navegador solo envía órdenes y dibuja.

## Armas

- **Cañón** ([[F]], mantener): ráfagas rápidas hacia donde apunta el morro, sin límite de munición. Impacta en el primer enemigo que el proyectil roza (a unos 30 m de su centro).
- **Misil** ([[R]]): mucho daño y **sigue a su objetivo** dentro del sistema. Necesita un **objetivo fijado** ([[X]] fija al enemigo más cercano y, al repetir, el siguiente), que esté **a tiro** y **delante del morro** (a menos de 60°). La munición es limitada y se repone con el tiempo.
- Con el **motor de pulso** encendido no se dispara.

{{tabla:armas}}

## Escudos y casco

El daño va primero al **escudo** y, cuando se agota, al **casco**. El escudo se **recarga solo** tras unos segundos sin recibir impactos; el casco no. Si el casco llega a 0, la nave queda destruida.

El estado de combate de tu nave dura aunque salgas del sistema: no se cura saliendo y entrando.

## La nave del Emperador

{{tabla:nave-emperador}}

## Si te derriban

Tu nave explota, sale del sistema y **renaces en un sistema al azar del Núcleo Humano** con la nave reparada: casco, escudo y munición al máximo. No pierdes colonias, flotas ni descubrimientos (ver [Ley I](/wiki/leyes#i-persistencia)).

> [!dev] La muerte con consecuencias (Cunas de linaje, gestación y Herederos) llegará con la fase «Muerte y linaje».

## Contra otros Emperadores

El **PvP es libre** en todo el universo, sin protección para los desconectados. Puedes dañar a cualquier Emperador que vuele en tu mismo sistema **salvo a tus compañeros** (los que se han añadido mutuamente; ver [Compañeros](/wiki/companeros)), que salen marcados como «compañero».

## Carroñeros

Los **Carroñeros** son piratas de la IA (ver [Especies](/wiki/especies)). **No hay ninguno en el Núcleo Humano**; fuera de él, **cuatro de cada diez sistemas** tienen entre uno y tres, rondando alguno de sus planetas.

- Te detectan y te persiguen cuando te acercas; luego intentan rodearte a corta distancia mientras disparan su cañón (con puntería imperfecta: de lejos fallan más).
- Un Carroñero derribado reaparece al cabo de un rato.
- Sin jugadores en el sistema, los piratas no se mueven.

{{tabla:carroneros}}

> [!dev] Las **escoltas** (hasta unas 5 naves por bando que combaten junto a tu nave en tiempo real) y el paso a combate por rondas en los encuentros grandes (fase 9c) están por llegar. Hoy las batallas entre flotas se resuelven aparte, por rondas: ver [Guerra](/wiki/guerra).
