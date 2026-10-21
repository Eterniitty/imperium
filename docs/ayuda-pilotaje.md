# Ayuda: pilotar la nave del Emperador

Texto para jugadores (lo usará la ventana de ayuda del juego). Las teclas son las de fábrica; todas se pueden cambiar en **Ajustes → Controles**.

## Mandos

| Tecla | Qué hace |
|---|---|
| Arrastrar con el ratón | Mover la cámara alrededor de la nave (no la gira); rueda: distancia |
| B | Cámara: volver detrás de la nave (o mirar al frente en cabina) |
| Z | Asistencia de vuelo (frenado y estabilización) |
| G | Pilotaje con ratón: arrastrar con el botón izquierdo gira la nave; el derecho mueve la cámara |
| W / S | Acelerar / frenar y retroceder |
| A / D | Desplazarse a izquierda / derecha |
| Espacio / C | Subir / bajar |
| Q / E | Alabear (girar sobre el eje del morro) |
| Flechas | Guiñada y cabeceo (con aceleración angular, sin giros bruscos) |
| Mayús | Impulso (×4 la velocidad de maniobra) |
| **P** | **Motor de pulso** (encender / apagar) |
| F (mantener) | Cañón |
| X | Fijar el siguiente enemigo (del más cercano al más lejano) |
| R | Lanzar un misil al objetivo fijado |
| T | Cámara: cabina (primera persona) o exterior (tercera) |
| **J** | **Salto cuántico**: elegir destino (otra vez J o Esc cancela la carga) |
| M | Mapa galáctico / volver a los mandos (durante un viaje: mapa / túnel) |
| K | Durante un viaje: **salir del túnel** y quedarse en el espacio profundo |
| L (mantener) | Láser de minería (espacio profundo, apuntando a un asteroide) |

## Velocidades

- **Maniobra**: unos 250 m/s; con **impulso** (Mayús), unos 1000 m/s. Es la velocidad para combatir y acercarse a los planetas.
- **Motor de pulso (P)**, al estilo del supercrucero: solo hacia delante y sin disparar. Se puede encender **siempre**, también junto a un planeta. Su velocidad máxima depende de lo cerca que estés del cuerpo más próximo (estrella o planeta):
  - pegado a un planeta y **de frente** hacia él, va despacio (unos cientos de m/s) y frena solo al acercarse;
  - si **te alejas** del planeta, el límite es varias veces mayor y la nave acelera de forma progresiva;
  - en el espacio abierto llega hasta unos **2000 km/s**.
  
  Acelera y frena suavemente, sin saltos: cruzar el sistema de un planeta a otro lleva **uno o dos minutos**. El HUD muestra la velocidad, el límite actual del pulso y el **tiempo estimado** hasta el planeta seleccionado, la nave fijada o el cuerpo que tengas de frente. Al apagar el pulso, la nave frena en un par de segundos.
- El pulso gasta **combustible** y algo de **energía**. Sin combustible no funciona.

*Nota de diseño (petición del usuario, 21-10-2026): el pulso anterior iba a 30 km/s fijos, se notaba como un teletransporte y no se podía encender junto a un planeta. Ahora el límite es la distancia a la superficie del cuerpo más cercano dividida entre 3 s, multiplicada hasta por 7 si te alejas de él, entre 300 m/s y 2000 km/s (`packages/sim/src/flight.ts`; 22-10-2026, con la escala nueva: planetas de 20–350 km de radio). El servidor valida cada posición con el límite más permisivo en ese punto.*

## Inercia, asistencia y gravedad

- La nave tiene **inercia**: propulsores principal, de frenado y laterales/verticales con su aceleración (`FLIGHT_MODEL`). Con la **asistencia** (Z) frena sola; sin ella conserva la velocidad.
- **Gravedad**: planetas, lunas y estrella atraen solo dentro de su esfera de influencia; el HUD muestra la región (espacio profundo, aproximación orbital, proximidad a la superficie) y la aceleración. El pulso la ignora.
- En **Ajustes → Controles**: aceleración, inercia, velocidad máxima, pilotaje con ratón e invertir la cámara.

## Instrumentos (HUD)

- **Centro**: mira; en cabina, además, el **horizonte artificial** con la escalera de cabeceo (respecto al plano en el que orbitan los planetas) y el indicador de alabeo.
- **Arriba**: **rumbo** (0° = hacia la estrella del sistema).
- **A los lados de la mira**: **velocidad** (izquierda) y **altitud** (derecha: distancia a la superficie del cuerpo más cercano, con su nombre).
- **Abajo a la izquierda**: **escudo**, **casco**, **energía** y **combustible** (la marca blanca es la reserva de emergencia). Avisos de combustible bajo, sin energía o reponiendo.
- **Abajo a la derecha**: **proyectiles** del cañón y **misiles** que quedan, y el **objetivo** fijado con su distancia.
- **Abajo en el centro**: velocidad grande, si el pulso está encendido y el tiempo estimado al objetivo.

## Recursos de la nave

Todos los lleva el servidor: no se pueden falsear.

| Recurso | Para qué | Cómo se recupera |
|---|---|---|
| **Energía** (100) | Escudos (cada punto recargado), cañón (cada disparo) y pulso | El reactor la recarga sola (10 por segundo). Con fuego continuo se agota: entonces el cañón no dispara y el escudo no se recarga. |
| **Combustible** (1000) | Pulso (0,4 por segundo) y salto cuántico (7,5 por año luz) | Junto a una colonia propia. Si baja de 150, a bordo se regenera **muy despacio** una **reserva de emergencia** (unas 30 unidades por hora) para que nadie se quede atrapado. |
| **Proyectiles del cañón** (1500) | Cada disparo gasta uno | Junto a una colonia propia. A bordo se fabrica una reserva de hasta 300 (uno cada 12 s). |
| **Misiles** (6) | Cada lanzamiento gasta uno | Junto a una colonia propia. A bordo se fabrican hasta 2 (uno cada 30 min). |
| **Escudo y casco** | Absorben el daño (primero el escudo) | El escudo se recarga solo tras 4 s sin recibir impactos (gasta energía). |

### Reponer junto a una colonia

Acércate a menos de **150 km** de la superficie de un planeta con **colonia propia** (pilotando o con la nave aparcada allí). La nave se repone sola, poco a poco, con las existencias de la colonia:

- combustible: 0,2 **volátiles** por unidad (llenar el depósito cuesta unos 200);
- proyectiles: 0,04 de **metal** por proyectil;
- misiles: 3 **aleaciones** por misil.

Si la colonia no tiene existencias suficientes, se repone lo que alcance. Todo queda en el libro de recursos de la colonia.

## La nave aparcada

Cuando dejas de pilotar (mapa, cerrar el juego), la nave **se queda donde estaba** y **orbita la estrella** con la misma ley que los planetas (despacio: decenas de m/s). Los demás jugadores del sistema la ven y **pueden atacarla** (no hay protección para desconectados); los piratas solo persiguen naves pilotadas. Al volver a los mandos, sales desde donde está ahora. Quieta, la nave flota con un ligero balanceo.

## Viaje cuántico entre sistemas

1. Pulsa **J** al pilotar: aparece la lista de sistemas **al alcance de tu combustible**, con la distancia, la duración del viaje y el combustible que gasta. También puedes elegir la estrella en el **mapa** (M) y pulsar J o «Saltar aquí».
2. La nave se **alinea** sola con el destino y **carga el motor** cuántico (5 s, con su sonido). J o Esc cancelan.
3. Al saltar, ves el **túnel cuántico** con el destino, el **tiempo restante** y el progreso. Con **M** miras el mapa (la cámara sigue a tu nave) y vuelves al túnel.
4. Con **K** (o el botón del túnel) puedes **salir a mitad de viaje**: quedas en una región de espacio profundo, pagas solo el combustible recorrido y desde allí vuelves a saltar con J. Puede haber asteroides que minar con **L** (bodega, refinería de a bordo y descarga en tus colonias; ver la Wiki «Espacio profundo y minería»).
5. Al llegar apareces en el **borde del sistema de destino**, del lado por el que llegas, a los mandos. El sistema queda descubierto (lo que cubre tu escáner).

Duración: unos **200 años luz por hora** — un vecino a 10 a.l. son 3 minutos; el salto más largo con el depósito lleno (unos **133 a.l.**) dura unos **40 minutos**. El alcance lo marca el combustible: para ir más lejos, salta por etapas y reposta en tus colonias.

## Sonido

Los disparos, impactos, explosiones y el motor cuántico tienen sonido generado por código (sin archivos). Su volumen se ajusta en **Ajustes → Efectos de sonido**, aparte del de la música; los de otras naves suenan más bajo cuanto más lejos están.
