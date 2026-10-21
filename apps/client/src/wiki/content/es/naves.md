# Naves humanas

Doce clases de nave, todas **construidas en tus colonias** (ver [Economía](/wiki/economia#cola-de-construccion)). Cada una aparece como una **flota nueva** en el sistema de la colonia que la construyó; su mantenimiento lo paga tu [capital](/wiki/colonias#la-capital). Además está tu propia nave, la del Emperador ([Pilotar](/wiki/pilotar)), que no se construye.

## Catálogo

{{tabla:naves}}

\* El Colonizador se consume al fundar una colonia. En la columna *Humanos*: colonos (Colonizador) o plazas de pasajeros (Carguero, Carguero pesado, Transporte de tropas).

| Papel | Naves | Para qué |
|---|---|---|
| **Exploración** | Explorador | El más rápido y con el mayor escáner: abre camino y [descubre](/wiki/niebla) sistemas. |
| **Cazas** | Caza ligero, Interceptor | Baratos y rápidos. El interceptor es la nave de combate más veloz: alcanza convoyes en ruta y huye de lo que no puede vencer. |
| **Escolta** | Corbeta | Cañones antiaéreos de tiro rápido: muchos disparos pequeños contra cazas y enjambres. |
| **Línea** | Fragata, Destructor | La fragata vale para todo; el destructor lleva torretas pesadas y torpedos. |
| **Capitales** | Crucero, Portanaves | Las más caras: piden **dique orbital**. El portanaves lleva alas de cazas embarcadas. |
| **Logística** | Carguero, Carguero pesado | Bodega para los recursos y plazas para pasajeros; lentos y frágiles, necesitan escolta. |
| **Transporte** | Transporte de tropas | Casco blindado y 600 plazas: traslada población y lleva las tropas para el [desembarco](/wiki/conquista). |
| **Colonización** | Colonizador | Lleva colonos para fundar una colonia y se desmantela al hacerlo. |

## Qué hace falta para construirlas

- Toda nave necesita un **astillero** en la colonia.
- Las pesadas (destructor, carguero pesado, transporte de tropas) piden también una **refinería** y gastan **aleaciones**.
- Las capitales (crucero, portanaves) piden además un **dique orbital**, una instalación nueva que solo se puede construir donde ya hay astillero.

Si falta algo, el botón de la nave sale apagado con lo que necesita («Necesita: …»).

## En batalla

{{tabla:naves-combate}}

En el [combate de flotas por rondas](/wiki/guerra) cuentan el ataque, los disparos por ronda, el escudo de batalla, el tamaño como blanco y el casco:

- **Disparos por ronda**: el ataque se reparte entre ellos y cada disparo elige su blanco. Muchos disparos pequeños no se desperdician en naves casi destruidas (bueno contra enjambres de cazas), pero cada escudo absorbe su parte: contra naves con escudo rinden poco.
- **Tamaño de blanco**: la probabilidad de que un disparo enemigo elija una nave es proporcional a su tamaño. Las grandes atraen el fuego y protegen a las pequeñas.

### Equilibrio

Con el mismo presupuesto (comprobado en pruebas automáticas):

- las **corbetas** barren a los **cazas**, pero pierden contra **fragatas** y **destructores**;
- los **cazas** en enjambre desbordan el escudo de una nave sola (sobre todo de un portanaves sin escolta);
- el **interceptor** paga su velocidad: pierde contra la fragata;
- ninguna clase gana o pierde casi siempre contra todas: conviene **mezclar**.

## Modelos

Cada nave tiene su propio modelo 3D, generado por código a partir de sus datos (eslora, familia de diseño, forma del casco, motores, torretas, contenedores, hangar). Son naves espaciales de ingeniería industrial y militar, no aviones: casco por módulos, toberas grandes que brillan según el empuje, propulsores de maniobra que se encienden al girar o desplazarse, radiadores para disipar el calor, antenas, sensores y luces de navegación (roja a babor, verde a estribor, destellos blancos). Cada familia —exploradores, cazas, fragatas, naves capitales, transportes y, en el futuro, mineros— monta las mismas piezas con otra disposición; las de los Carroñeros son chatarra recompuesta y asimétrica. Los cañones y lanzadores están en sus **bocas de fuego**, las mismas desde las que dispara el servidor. Tus flotas paradas se ven en formación en la vista del sistema, junto a tu colonia.

{{tabla:naves-modelos}}

*Armas*: bocas de cañón + lanzadores de misiles.
