# Pilotar la nave

Tu Emperador viaja siempre en su nave, y la pilotas tú en tiempo real, sin pantallas intermedias entre el espacio y los sistemas. Al pulsar **Despertar** empiezas a los mandos dentro del sistema donde está tu nave.

## Controles

Todas las teclas se pueden cambiar en **Ajustes → Controles** (hasta dos por acción). Estas son las de por defecto:

### Pilotar la nave

{{tabla:teclas-vuelo}}

**Arrancar los motores.** Al tomar los mandos, la nave está con los motores apagados: el HUD se ve tenue y en el centro te recuerda la tecla. Pulsa [[I]] y empieza el arranque (unos segundos): se encienden el reactor, las bombas y las luces de estado, suena la turbina, las toberas se encienden y el HUD se activa. Sin motores no hay empuje, giros, motor de pulso, armas ni láser de minería (la nave solo sigue con su inercia y la gravedad). La misma tecla los apaga. Si das la orden de salto cuántico con los motores apagados, arrancan solos antes de alinear la nave; al llegar de un salto ya están en marcha.

**La cámara y la nave van por separado.** El ratón tiene dos modos, que se cambian con [[G]] (el HUD dice en cuál estás):

- **Cámara libre** (por defecto): arrastrar con el ratón **mueve la cámara alrededor de la nave** (arriba, abajo, a los lados, por delante) sin girarla; la rueda acerca o aleja la cámara y [[B]] la devuelve detrás de la nave. Pilotas con el teclado: flechas (cabeceo y guiñada) y [[Q]]/[[E]] (alabeo).
- **Vuelo con ratón**: una **retícula virtual** en el centro de la pantalla. La nave gira hacia donde apunta el cursor respecto al centro, sin arrastrar: cuanto más lejos del centro, más rápido (hasta el círculo exterior); dentro del círculo pequeño (zona muerta) no gira. La cámara va detrás de la nave; con el botón derecho puedes mirar alrededor un momento. Las flechas y [[Q]]/[[E]] siguen funcionando.

En **Ajustes → Controles** puedes cambiar la sensibilidad y la zona muerta del vuelo con ratón e invertir su eje vertical. En cabina, en el modo de cámara libre, el ratón mira alrededor.

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
2. La nave se **alinea** sola con el destino y **carga el motor cuántico** (unos segundos). [[J]] o Esc cancelan. Mientras carga, se abre una **grieta en el espacio** delante del morro: una costura de luz que se alarga, se agrieta y curva el fondo a su alrededor. Al saltar se abre del todo y la nave, acelerando casi a la velocidad de la luz, **se estira hacia ella** hasta ser un hilo de luz y desaparece dentro en medio segundo; al llegar, se abre otra en el destino, **un rayo de luz sale disparado de ella** y se contrae en tu nave con un destello. La cámara acompaña: se abre un poco y tiembla levemente. La grieta está en el espacio, no en tu pantalla: **los demás pilotos del sistema la ven** (cargar, entrar y salir). Si te molestan los destellos, activa **Reducir efectos visuales** en Ajustes: los destellos y el rayo serán más tenues y la cámara no temblará.
3. Durante el viaje ves el **túnel cuántico** con el tiempo restante; [[M]] alterna entre el túnel y el mapa. Al llegar apareces a los mandos **donde estuviste la última vez en ese sistema**; si es la primera vez, **en su borde**, del lado por el que llegas.

- La velocidad de salto está en la tabla de arriba: unos minutos a las estrellas cercanas y hasta unos **40 minutos** el salto más largo. El **alcance** lo marca el combustible: para ir más lejos, salta por etapas y reposta en tus colonias.
- Al llegar, tu escáner [descubre](/wiki/niebla) el sistema y los que tenga al alcance.
- Se puede saltar a cualquier estrella al alcance, descubierta o no.
- **El salto no necesita que mires la pantalla.** Puedes elegir el destino y cambiar de pestaña o de ventana: el salto se da igual (sin la animación) y el viaje y la llegada los lleva el servidor. Al volver, ves el túnel si aún viajas o tu nave ya en el destino.
- **Memoria de posición:** el juego recuerda dónde estaba tu nave en cada sistema (al saltar fuera, al aparcarla y cada minuto mientras vuelas). Al volver a un sistema, llegas ahí y allí se abre la grieta.
- **Junto a un compañero:** si un [compañero](/wiki/companeros) está o estuvo en un sistema, en el selector de salto ([[J]]) y en el panel del sistema en el mapa aparece **«Junto a …»**: llegas a su lado, donde está ahora o donde estuvo la última vez.

### Salir del túnel a mitad de viaje

En el túnel, [[K]] (o el botón **Salir del túnel aquí**) detiene el viaje: quedas en el **espacio profundo**, entre las dos estrellas, y solo gastas el combustible del tramo recorrido. Allí puede haber asteroides que minar con [[L]]. Ver [Espacio profundo y minería](/wiki/espacio-profundo).

## Vuelo compartido

Dentro de un sistema ves moverse a los demás Emperadores que vuelan allí, y ellos a ti. Fuera del Núcleo Humano te puedes encontrar con piratas. Ver [Combate](/wiki/combate).
