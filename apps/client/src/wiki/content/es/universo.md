# Universo, mapa galáctico y sistemas

## Sectores y estrellas

El universo se genera por procedimientos a partir de una semilla: el mismo sector produce siempre las mismas estrellas. Está dividido en **sectores cúbicos de 100 años luz** de lado, con entre 4 y 56 sistemas cada uno, y no tiene límites prácticos. Solo se guarda lo que cambia (colonias, flotas, descubrimientos); lo demás se regenera.

El **Núcleo Humano** son los 27 sectores alrededor del origen (de −1 a 1 en cada eje). Allí aparecen los Emperadores nuevos y renacen los caídos, y allí no hay piratas.

### Clases de estrella

La clase de una estrella decide cuántos planetas suele tener, cuánta **energía estelar** (de 0 a 5) captan sus colonias y la probabilidad de encontrar **cristal** en sus cuerpos. La energía exacta de cada sistema varía medio punto arriba o abajo de la de su clase.

{{tabla:estrellas}}

Las estrellas exóticas (enanas blancas, estrellas de neutrones y agujeros negros) tienen pocos mundos habitables, pero más cristal y más anomalías.

## Planetas, lunas y cinturones

Cada planeta tiene un **tipo**, una **habitabilidad** (de 0 a 100 %) y unos **depósitos** de metal, volátiles y cristal con una **riqueza** de 0 a 3. Los planetas pueden tener lunas (los gigantes gaseosos, varias) con sus propios depósitos.

- La habitabilidad depende del tipo y de la distancia a la zona habitable de la estrella: los **mundos oceánicos** en la zona habitable son los mejores (60–100 %), los **rocosos** en la zona, 30–70 %; los **desérticos**, 15–45 %; el resto apenas llega al 8 %. Alrededor de estrellas exóticas, la habitabilidad se divide por cinco.
- El **cristal** aparece en cualquier cuerpo con la probabilidad de la tabla de estrellas, normalmente con riqueza 1.

{{tabla:depositos}}

Los **cinturones de asteroides** (hasta dos por sistema) son ricos en metal, pero hoy no se explotan.

> [!dev] Las **anomalías** (ruinas de origen desconocido, pecios a la deriva, grietas espaciales y bolsas nebulares) ya aparecen en los sistemas, pero aún no se pueden explorar.

## El mapa galáctico

Pulsa [[M]] (o el botón **Mapa**) para pasar del pilotaje al mapa. Allí ves las estrellas cercanas como puntos de colores según su clase (la leyenda está en pantalla).

- **Clic** en una estrella: la seleccionas y el panel lateral muestra su clase, distancia, coordenadas y, si la has descubierto, su energía, planetas, cinturones y anomalía. Haz clic en un planeta para ver sus recursos.
- **Doble clic** o [[Intro]]: entras en la vista del sistema. [[F]] centra la cámara en la selección y [[Esc]] la quita.
- **Órbita** (por defecto): arrastra para girar, rueda para acercar, botón central o [[Mayús]] + arrastrar para desplazar.
- **Vuelo libre de cámara** ([[V]]): mueve la cámara como una nave con [[W]] [[A]] [[S]] [[D]], [[Q]]/[[E]] para bajar y subir y [[Mayús]] para ir más rápido.
- El campo **Ir** de la barra superior lleva la cámara al sector con esas coordenadas.

Desde el panel del sistema puedes **trasladar a tu Emperador** allí (o pulsar [[J]]) y **enviar tus flotas**. Ver [Pilotar](/wiki/pilotar#viaje-cuantico-a-otra-estrella) y [Flotas](/wiki/flotas).

## Dentro de un sistema

Los sistemas tienen una **escala propia del juego**: proporciones astronómicas plausibles, pero comprimidas para poder jugar. Tu nave mide **320 m** (lleva hasta 500 personas); un planeta rocoso, de **20 a 95 km** de radio (cientos o miles de veces la nave); un gigante gaseoso, de **220 a 350 km**; las lunas, de **4 a 35 km** (menores que su planeta, como la Luna y la Tierra), y una estrella como el Sol, **2500 km**. Las órbitas están a **cientos de miles de kilómetros** (crecen con la raíz de la distancia real), así que desde un planeta como la Tierra el Sol se ve como un disco de **un grado**, casi como el real, y los demás planetas como puntos; nunca se solapan las esferas de influencia de dos cuerpos. Con el motor de pulso se va de un planeta al vecino en menos de un minuto.

Cada cuerpo tiene **un solo radio**: el que se dibuja es el mismo de las colisiones y de la gravedad. Los planetas y las lunas **giran según la hora del servidor**, así que todos los jugadores los ven en el mismo sitio; las órbitas son muy lentas (decenas de m/s), así que una nave siempre alcanza a un planeta. Los planetas reclamados llevan un rótulo con su nombre (dorado si son tuyos).

### Estrellas

{{tabla:escala-estrellas}}

La gravedad simulada de las estrellas está recortada (ver [Pilotar](/wiki/pilotar#gravedad)).

Las estrellas **giran** (más deprisa en el ecuador que en los polos, como el Sol) y **arden**: su superficie es una masa de fuego en movimiento, con **llamas en 3D** que salen de ella y asoman por el borde. Al acercarte, su **resplandor** crece hasta llenar la vista (la mitad con «reducir efectos»).

### Calor de las estrellas

Cerca de una estrella hace **calor**: dentro de su zona, la nave recibe daño cada segundo, poco en el borde y **cada vez más deprisa** al acercarse (crece con el cuadrado de lo que te has metido). Primero se gastan los **escudos**, que no se recargan mientras te estés quemando, y después el **casco**. El HUD lo avisa con el daño por segundo; a partir del daño por segundo de la última fila de la tabla, la zona es **mortal**: el aviso parpadea y el **pulso se corta** mientras vayas hacia la estrella (alejándote sí funciona). Las zonas quedan siempre por dentro de la órbita de los planetas y de donde se aparcan las naves. Si mueres así, la causa es «calor estelar».

En un **agujero negro** no hay superficie contra la que chocar: el radio de la tabla es el **horizonte de sucesos**, y cruzarlo destruye la nave sin remedio. Su disco también quema.

{{tabla:calor}}

### Planetas y lunas

{{tabla:cuerpos}}

Las lunas usan la tabla de su tipo con su propio radio.

> [!dev] **Aterrizar** aún no es posible. Cada cuerpo ya tiene definidos su atmósfera, su superficie, las condiciones de entrada y si se podrá aterrizar en él; los gigantes gaseosos no tienen superficie.

## Tiempo

El juego corre **en tiempo real**: una hora de juego es una hora real. Construir lleva horas; saltar entre estrellas cercanas, minutos; y dentro de un sistema se vuela en tiempo real.
