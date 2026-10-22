# Astillero: diseña tus naves

En el **Astillero** (botón de la barra superior) diseñas tus propias naves **pieza a pieza, como un Lego**. Eliges un **casco** y encajas una **pieza** en cada **anclaje**. La nave responde a cada pieza: sin puente nadie la pilota, sin reactor nada funciona, sin motor no se mueve y sin motor cuántico no salta entre estrellas.

## Cómo se diseña

1. Pulsa **Diseño nuevo** y elige el **casco**. Cada casco tiene sus anclajes, su masa, su casco (vida) y su bodega.
2. En cada **anclaje** elige una pieza. Solo salen las que **encajan**: del tipo que admite el anclaje y de su tamaño o menor (una pieza S cabe en un anclaje M, pero no al revés). Algunas piezas exigen un casco grande.
3. A la derecha ves en vivo las **estadísticas** (masa, energía, aceleración, crucero, pulso, giro, salto, casco, escudo, daño, bodega…), los **problemas** y el **coste**.
4. **Guarda el diseño** con un nombre. Puedes **duplicarlo** para probar variantes y **borrarlo**. Puedes guardar hasta 30 diseños, aunque estén a medias.

## Construir un diseño

Guarda el diseño y, abajo, elige la **colonia** y pulsa **Construir aquí**. Hace falta un **astillero** en la colonia; los cascos de crucero y capital, además, un **dique orbital**. Se paga al encargarlo: los **recursos** salen de la colonia y los **créditos** de tu cartera. El encargo va a la **cola** de la colonia con el nombre del diseño y, al terminar, la nave sale como una **flota nueva** en el sistema de la colonia.

- Se construye el diseño **tal como estaba al encargarlo**: si luego lo cambias o lo borras, la nave encargada no cambia.
- Si **cancelas** el encargo, recuperas todo si aún no había empezado y una parte si ya estaba en marcha (recursos y créditos).
- En las **batallas de flotas por rondas** mandan sus piezas: ataque = 0,4 × el daño por segundo de sus armas, escudo por ronda = la mitad de la recarga más el 1 % de la capacidad, un disparo por arma y un tamaño como blanco según el casco. Lleva el **casco** y las **plazas** de sus piezas.
- Entre estrellas viaja a la **velocidad de su motor cuántico** y con el **alcance de sus depósitos** (ver [Flotas](/wiki/flotas#combustible)).
- Su **modelo 3D** sale de sus piezas (motores, torretas, bodegas, hangar…) sobre la forma de la clase de serie más parecida a su casco; por ahora usa el **escáner** de esa clase.

## Las reglas

- **Obligatorio**: puente, reactor y motor de propulsión. Sin ellos la nave **no se puede construir**.
- **Energía**: lo que gastan las piezas no puede pasar de lo que da el reactor.
- **Avisos** (se puede construir, pero cuidado): sin motor cuántico **no salta**; con motor cuántico pero sin depósito, **no tiene combustible**; sin armas, **desarmada**; sin escudo, **sin escudo**.
- **Masa**: cuanto más pesa, menos acelera, más despacio gira y menos llega el salto. La aceleración es empuje / masa.
- **Salto**: el motor cuántico más rápido manda; el alcance sale del combustible de los depósitos y de la masa.

## Cascos

{{tabla:cascos}}

## Piezas

{{tabla:piezas}}

> [!dev]
> **En desarrollo**: que sus estadísticas manden también al pilotarla y en el combate en tiempo real.
