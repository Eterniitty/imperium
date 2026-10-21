# Pilotar la nave

Tu Emperador viaja siempre en su nave, y la pilotas tú en tiempo real, sin pantallas intermedias entre el espacio y los sistemas. Al pulsar **Despertar** empiezas a los mandos dentro del sistema donde está tu nave.

## Controles

Todas las teclas se pueden cambiar en **Ajustes → Controles** (hasta dos por acción). Estas son las de por defecto:

### Pilotar la nave

{{tabla:teclas-vuelo}}

**La cámara y la nave van por separado.** Arrastrar con el ratón **mueve la cámara alrededor de la nave** (arriba, abajo, a los lados, por delante) sin girarla; la rueda acerca o aleja la cámara y [[B]] la devuelve detrás de la nave. La nave solo cambia de orientación con los mandos de vuelo: flechas (cabeceo y guiñada) y [[Q]]/[[E]] (alabeo). Si lo prefieres, el **pilotaje con ratón** ([[G]] o en Ajustes) hace que arrastrar con el botón izquierdo gire la nave como una palanca (cuanto más lejos del punto pulsado, más rápido); con el botón derecho sigues moviendo la cámara. En cabina, el ratón mira alrededor.

### Inercia y asistencia de vuelo

La nave se mueve con propulsores: el principal empuja hacia delante, otros más débiles frenan y la mueven a los lados y arriba o abajo, y los de maniobra la hacen girar (los giros aceleran y frenan con suavidad, nunca de golpe).

- Con la **asistencia de vuelo** encendida (por defecto; [[Z]] la cambia), los propulsores llevan la nave a la velocidad que pides y, sin teclas, la frenan hasta pararla.
- Apagada, la nave **conserva su velocidad** (inercia pura): para frenar hay que empujar al revés.
- En **Ajustes → Controles** puedes cambiar la aceleración, la inercia y la velocidad máxima de maniobra, e invertir el eje vertical de la cámara.

{{tabla:modelo-vuelo}}

### Mapa galáctico

{{tabla:teclas-mapa}}

### En cualquier momento

{{tabla:teclas-general}}

## Velocidades

{{tabla:vuelo}}

- **Velocidad normal**: para maniobrar y combatir.
- **Impulso** ([[Mayús]], mantener): multiplica la velocidad normal.
- El servidor comprueba cada posición que envías: nadie puede ir más rápido de lo que permite su nave.

## Motor de pulso

El motor de pulso ([[P]], encender y apagar) es un **supercrucero** para cruzar el sistema de un planeta a otro (uno o dos minutos).

- Empuja **solo hacia delante**; mientras está encendido **no puedes disparar**.
- Se puede encender **siempre**, también junto a un planeta. Su velocidad máxima depende de la distancia al **cuerpo más cercano**: de frente hacia un planeta va despacio (cientos de m/s) y frena solo al acercarse; al **alejarte**, el límite es varias veces mayor; en el espacio abierto llega a la velocidad máxima de la tabla.
- Acelera y frena **de forma suave**. El panel de abajo muestra el límite actual y el **tiempo estimado** hasta el planeta seleccionado, la nave fijada o el cuerpo que tienes de frente.
- Gasta **combustible** y algo de **energía**: sin combustible no funciona.

## Gravedad

Los planetas, las lunas y la estrella **atraen la nave**, pero solo dentro de su **esfera de influencia** (unas ocho veces su radio, más si tiene lunas): en el espacio entre planetas no hay gravedad y no caes hacia nada. El HUD muestra la región en la que estás:

- **Espacio profundo**: fuera de toda esfera, sin gravedad.
- **Aproximación orbital**: dentro de la esfera de un cuerpo; la atracción crece al acercarte (como 1/r²).
- **Proximidad a la superficie**: muy cerca del suelo o dentro de la atmósfera.

Sin asistencia de vuelo, caes hacia el cuerpo; con ella, los propulsores compensan la atracción, aunque no del todo (la nave cede despacio, más junto a los gigantes). Con la velocidad adecuada se puede orbitar. El motor de pulso ignora la gravedad. La gravedad de cada tipo de cuerpo está en [Universo](/wiki/universo#dentro-de-un-sistema).

> [!dev] La asistencia gravitatoria (efecto honda) no existe aún, y la gravedad de las estrellas está recortada para que siempre se pueda escapar con los propulsores.

## Instrumentos y recursos de la nave

En la cabina ves el **horizonte artificial** (respecto al plano de las órbitas) y, siempre, el **rumbo** (0° = hacia la estrella), la **velocidad** y la **altitud** (distancia a la superficie del cuerpo más cercano). Abajo, a la izquierda, **escudo**, **casco**, **energía** y **combustible**; a la derecha, los **proyectiles** del cañón, los **misiles** y el objetivo con su distancia.

- **Energía**: la recarga sola el reactor; la gastan el cañón (cada disparo), la recarga del escudo y el pulso. Con fuego continuo se agota y el cañón se calla.
- **Combustible**: lo gastan el pulso y el salto cuántico. Por debajo de la reserva de emergencia se regenera **muy despacio** a bordo, para que nadie se quede atrapado.
- **Proyectiles y misiles**: contados. A bordo solo se fabrica una pequeña reserva.
- **Reponer**: a menos de 150 km de un planeta con **colonia propia**, la nave se repone sola con las existencias de la colonia (volátiles para el combustible, metal para los proyectiles, aleaciones para los misiles).

## Nave aparcada

Al dejar los mandos, tu nave se queda donde estaba y **orbita la estrella** como los planetas. Los demás la ven y pueden atacarla; los piratas solo persiguen naves pilotadas. Al volver, sales desde donde está.

## Cámaras

[[T]] alterna entre la cámara **exterior** (tercera persona, por defecto) y la de **cabina** (primera persona). En las dos, el ratón mueve la cámara, no la nave; [[B]] vuelve a la vista de seguimiento (o a mirar al frente).

## Salir del sistema

Vuela hasta el **borde del sistema** (unos miles de kilómetros más allá del último planeta) para salir al **espacio interestelar**: pasas al mapa galáctico con la estrella a tu espalda.

## Viaje cuántico a otra estrella

1. A los mandos, pulsa [[J]]: verás los sistemas **al alcance de tu combustible**, con la distancia, la duración y el combustible del salto. También puedes **seleccionar una estrella en el mapa** y pulsar [[J]] o **Saltar aquí**.
2. La nave se **alinea** sola con el destino y **carga el motor cuántico** (unos segundos). [[J]] o Esc cancelan. Mientras carga, el espacio empieza a fallar delante de la nave (se curva, se agrieta con luz y la imagen se corta) y, al saltar, se rompe como un cristal; al llegar, la grieta se abre en el destino y se cierra tras la nave. Si te molestan los destellos o las sacudidas, activa **Reducir efectos visuales** en Ajustes.
3. Durante el viaje ves el **túnel cuántico** con el tiempo restante; [[M]] alterna entre el túnel y el mapa. Al llegar apareces **en el borde del sistema de destino**, a los mandos.

- La velocidad de salto está en la tabla de arriba: unos minutos a las estrellas cercanas y hasta unos **40 minutos** el salto más largo. El **alcance** lo marca el combustible: para ir más lejos, salta por etapas y reposta en tus colonias.
- Al llegar, tu escáner [descubre](/wiki/niebla) el sistema y los que tenga al alcance.
- Se puede saltar a cualquier estrella al alcance, descubierta o no.

### Salir del túnel a mitad de viaje

En el túnel, [[K]] (o el botón **Salir del túnel aquí**) detiene el viaje: quedas en el **espacio profundo**, entre las dos estrellas, y solo gastas el combustible del tramo recorrido. Allí puede haber asteroides que minar con [[L]]. Ver [Espacio profundo y minería](/wiki/espacio-profundo).

## Vuelo compartido

Dentro de un sistema ves moverse a los demás Emperadores que vuelan allí, y ellos a ti. Fuera del Núcleo Humano te puedes encontrar con piratas. Ver [Combate](/wiki/combate).
