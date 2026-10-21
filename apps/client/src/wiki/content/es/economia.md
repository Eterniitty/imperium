# Economía en detalle

Cada colonia tiene su **propio inventario**: no hay un almacén global. Lo que produce una colonia se queda en ella hasta que una flota lo [transporta](/wiki/flotas). Todas las cifras de esta página se leen del código del juego.

## Recursos

| Recurso | Para qué sirve |
|---|---|
| **Metal** | Base de casi toda construcción. Abundante. |
| **Volátiles** | Combustible y mantenimiento de naves e instalaciones. |
| **Cristal raro** | Escaso; lo piden el astillero y casi todas las naves. |
| **Aleaciones** | Producto elaborado en la refinería a partir de metal y volátiles. |
| **Metales raros** | No los produce ninguna colonia: se minan en el [espacio profundo](/wiki/espacio-profundo) o se compran en el mercado. Los piden las naves capitales. |
| **Materia exótica** | Muy escasa; solo en algunos asteroides del espacio profundo (o en el mercado). |
| **Energía** | Se produce y se gasta en la propia colonia; **no se almacena ni se transporta**. |

Cada recurso almacenable tiene un **tope de almacén** por colonia. **Lo que no cabe se pierde**, así que conviene gastarlo o sacarlo en cargueros.

{{tabla:recursos}}

## Cómo se calcula la producción

La economía se resuelve **de forma perezosa**: el servidor guarda las existencias y la población de cada colonia en un instante y, cuando hace falta (al mirarla, construir, cargar…), calcula el estado actual a partir del tiempo transcurrido, por tramos de una hora como mucho. Por eso tu colonia sigue produciendo aunque no estés conectado, y las cifras del panel avanzan solas.

### Riqueza

Cada planeta tiene una **riqueza** de 0 a 3 en metal, volátiles y cristal (ver [Universo](/wiki/universo#planetas-lunas-y-cinturones)). A la del planeta se suma **la mitad de la de sus lunas**.

### Extracción

Por cada punto de riqueza, una colonia extrae cada hora:

`(extracción base + extracción por mina × minas × eficiencia energética) × mano de obra`

El **cristal** se extrae a una cuarta parte de ese ritmo. Las minas mejoran a la vez metal, volátiles y cristal.

{{tabla:produccion}}

Extracción por punto de riqueza según el número de minas (con energía suficiente y población de 500 o más):

{{tabla:minas}}

### Energía

- Una colonia capta energía de su estrella: `energía estelar × (2 + 4 × centrales)`. La energía estelar de cada sistema (0–5) aparece en el panel del sistema.
- Las instalaciones **gastan** energía (ver la tabla de instalaciones). Si gastan más de la que hay, **todas van más despacio en la misma proporción** (eficiencia = producida / gastada). La extracción base, la que no depende de las minas, no necesita energía.
- Con energía estelar 0 (algunos agujeros negros) no se capta nada y, sin energía, las minas no aportan y la refinería no funciona.

### Mano de obra

El rendimiento crece con la población hasta 1 con **500 habitantes**: `población / 500`, con un mínimo del 25 % (automatización). Afecta a la extracción y a la refinería.

### Refinería

Cada refinería transforma por hora metal y volátiles en aleaciones (a pleno rendimiento; se multiplica por la eficiencia energética y la mano de obra). Si se queda sin metal o sin volátiles en el almacén, trabaja al ritmo al que llegan; con el almacén de aleaciones lleno, se para.

## Instalaciones

Se construyen en la colonia (sección *Construir instalación*). Cada una tiene un máximo por colonia.

{{tabla:instalaciones}}

## Mantenimiento

- Cada instalación consume **volátiles por hora** de su colonia mientras exista.
- Tu **capital** (la colonia más antigua) paga además el **mantenimiento de todas tus naves** (ver la tabla de naves en [Flotas](/wiki/flotas#naves)).
- El mantenimiento se paga **antes** que la refinería. Si el almacén de volátiles está vacío y la colonia extrae menos de lo que debe, aparece como **«Desabastecida»**: paga lo que puede, la refinería se para y los volátiles no suben. Un imperio sobredimensionado se desangra.

## Ejemplo

Una colonia en un planeta con riqueza 2 de metal, 1 de volátiles y 1 de cristal, con una luna de riqueza 1 de metal y 2 de volátiles, en una estrella de energía 3, con 500 habitantes, **2 minas, 1 refinería y 1 central** (y los almacenes a medias):

{{tabla:ejemplo}}

## Cola de construcción

- Instalaciones y naves se **encargan** en la colonia y van a una **cola** (como mucho 5 encargos, incluido el que está en marcha).
- **Se paga al encargar**, con las existencias de ese momento. Sin recursos suficientes, no se puede encargar.
- Solo se construye **uno a la vez**, el primero de la cola; al terminar, empieza el siguiente.
- Las **naves** necesitan un **astillero** en la colonia. Cada nave terminada aparece como una **flota nueva** en el sistema de la colonia. Al terminar un colonizador, embarcan colonos de la colonia (ver [Humanos](/wiki/humanos#mover-humanos)).
- **Cancelar** un encargo: si no había empezado, se devuelve **todo**; si ya estaba en construcción, **la mitad**, y empieza el siguiente.

Los costes y tiempos de las naves están en [Flotas](/wiki/flotas#naves).

## Gestionar colonias desde cualquier sitio

En el panel **Colonias**, **Gestionar colonias** abre una ventana con todas tus colonias: población, existencias y producción, instalaciones y cola de obras de cada una. Desde ahí puedes encargar y cancelar obras **sin estar en el sistema**, también durante un viaje cuántico (en el puente de mando, pulsar una colonia la abre aquí). Lo que pide estar presente, como desembarcar humanos o descargar la bodega, sigue en la ficha del planeta.

**Derribar** una instalación (dos clics, para no hacerlo sin querer) quita la más reciente de ese tipo y devuelve la mitad de su coste a las existencias de la colonia, sin pasar del almacén. Sirve para quitarte mantenimiento o hacer sitio a otra; queda apuntado en el libro de recursos.

## Libro de recursos

Cada movimiento discreto de recursos o humanos queda apuntado en un **libro solo de inserción**, que nadie puede modificar ni borrar: fundaciones, encargos, cancelaciones, colonos que embarcan o desembarcan, cargas y descargas de flotas, pérdidas en batalla, independencia de colonias y, desde la [economía de la humanidad](/wiki/humanidad), créditos, aportes y operaciones del [mercado](/wiki/mercado). La producción continua no se apunta (es el cálculo perezoso). Sirve para auditar y reconstruir los saldos, y aparece en la [descarga de tus datos](/wiki/cuenta).

Por encima de las colonias está la [economía de toda la humanidad](/wiki/humanidad): las colonias generan **créditos** según su población, una parte va al tesoro del Núcleo Humano y paga proyectos comunes. Con los créditos se compran y venden recursos en el [mercado global](/wiki/mercado).

> [!dev] La **red de suministro** (instalaciones aisladas que se debilitan) está prevista para más adelante.
