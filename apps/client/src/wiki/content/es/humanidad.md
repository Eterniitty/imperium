# Humanidad: créditos, tesoro y proyectos

Ningún Emperador gobierna a la humanidad: cada uno sigue su camino (ver [Lore](/wiki/lore)). Pero todos forman parte de ella, y por encima de las colonias de cada uno hay una **economía común**: la de toda la humanidad, con su centro en el **Núcleo Humano**. Se abre con el botón **Humanidad** de la barra superior. Todas las cifras de esta página se leen del código del juego.

## Créditos

Los **créditos** (₢) son la moneda de la humanidad. Nacen del trabajo de la gente: **cada colonia genera créditos según su población**, y los cobra su Emperador. Cada Emperador empieza con un saldo inicial, para poder comprar antes de tener colonias.

Los créditos no son materia: no ocupan bodega ni hay que transportarlos. Tu saldo aparece en la barra superior y crece solo con tu renta. Se usan en el [mercado](/wiki/mercado) y para aportar al tesoro.

{{tabla:humanidad}}

### Cómo se calcula

Como la [producción de las colonias](/wiki/economia#como-se-calcula-la-produccion), la cartera se resuelve **de forma perezosa**: el servidor guarda tu saldo en un instante y tu renta por hora, y el saldo de cualquier momento es `saldo + renta neta × horas`. Cada hora de juego (y cuando compras, vendes o aportas) recalcula tu renta con la población actual de tus colonias. Así nadie recorre todas las colonias del universo cada segundo.

## El tesoro del Núcleo Humano

Una parte fija de los créditos de cada colonia (el **aporte**) va al **tesoro común del Núcleo Humano**. Además, el tesoro recibe la **comisión de cada venta** del mercado y las **donaciones** de créditos de los Emperadores.

El tesoro es de todos y no lo controla nadie: solo sirve para pagar la parte en créditos de los **proyectos comunes**. Su saldo y lo que le entra por hora son públicos.

## Agregados de toda la humanidad

El panel muestra a cualquier jugador las cifras de toda la humanidad: Emperadores con colonias, número de colonias (también las [independientes](/wiki/cuenta)), población, existencias y producción neta de cada recurso, y créditos en circulación. Se actualizan con el recálculo de cada Emperador, así que pueden ir hasta una hora por detrás.

## Proyectos comunes

Los proyectos son obras de toda la humanidad. Cada uno tiene varios **niveles**; cada nivel pide **recursos**, que aportan los Emperadores, y **créditos**, que paga el tesoro. Al completar un nivel, **todos** los Emperadores reciben su efecto, hayan aportado o no.

{{tabla:proyectos}}

### Aportar

1. Abre **Humanidad**, elige un proyecto y despliega **Aportar**.
2. Elige la colonia de la que salen los recursos y cuánto de cada uno. No puedes mandar más de lo que le falta al nivel (contando lo que ya va de camino).
3. Los recursos **salen ya** de la colonia y viajan al Núcleo por su red de transporte; tardan según la distancia (ver la tabla de arriba). Al llegar se suman al proyecto.
4. También puedes donar **créditos**: van al tesoro al momento.

Cuando un nivel tiene todos sus recursos, el tesoro paga sus créditos y el nivel se completa. Si al tesoro aún no le llega, el proyecto queda **esperando créditos** y se completa solo en cuanto los tenga. Lo aportado de más pasa al nivel siguiente.

Cada proyecto muestra a sus **mayores contribuyentes** (recursos y créditos sumados). Si un Emperador borra su cuenta, sus aportes se quedan, anónimos.

### Efectos

- **Defensas del Núcleo**: más escudo para las flotas que combaten en un sistema del Núcleo Humano (ver [Guerra](/wiki/guerra)).
- **Investigación del Núcleo**: todas las colonias extraen más metal, volátiles y cristal. Se aplica desde el último cálculo de cada colonia.
- **Subvenciones a colonias**: las colonias nuevas nacen con más existencias (sin pasar del almacén).
- **Red de transporte**: los envíos del Núcleo (aportes y compras del [mercado](/wiki/mercado)) llegan antes.

## Libro de recursos

Todo movimiento de créditos queda en el mismo **libro solo de inserción** que los recursos ([Economía](/wiki/economia#libro-de-recursos)): saldo inicial, aportes, donaciones, compras, ventas, comisiones y lo que paga el tesoro por cada nivel.

> [!dev] Más adelante, los Emperadores de la IA también aportarán y comerciarán, por la misma vía que los jugadores.
