# Aeonarch, Era II — Mecánicas de juego

Diseño de cómo se juega en la Era II: un solo sistema de siete mundos, en Unreal (ver [roadmap-unreal.md](roadmap-unreal.md)). El mundo y sus secretos están en [lore-era2.md](lore-era2.md); este documento solo usa el **lore público** (lo que saben los jugadores).

> **Estado: diseño, nada construido.** Las cifras son propuestas para ajustar jugando; acabarán como datos en `packages/content` (regla 4). Cada sección termina con las preguntas que quedan abiertas para el dueño.

## 0. Decisiones del dueño que marcan este diseño (23-10-2026)

| Decisión | Consecuencia |
|---|---|
| **Sesiones largas** | Actividades de una a varias horas: expediciones, ruinas, campañas, asedios, cacerías. El imperio sigue funcionando sin el jugador (principio de `docs/diseno.md`), pero lo mejor pasa jugando. |
| **PvP mixto** | Zonas seguras, zonas disputadas (solo con guerra declarada entre casas) y zonas sin ley (todo vale). |
| **Muerte suave** | Al morir solo se pierden **tiempo y posición**: la carga, los humanos, las reliquias y la nave se conservan (la nave se reconstruye con el Emperador). Lo que sí se puede perder para siempre (Ley III) son las colonias y la tierra, por conquista. |
| **Reliquias moderadas y coleccionables** | Ventajas pequeñas y apilables; lo importante es reunirlas, completar colecciones y su lore. |
| Lore (resumen público) | Aeon es la tumba de seis dioses; cada planeta es el cuerpo de uno; los Emperadores son conquistadores que quieren la tumba como todos; hay reliquias, tierra sagrada y recuerdos que ganar. |

---

## 1. El bucle de juego

### 1.1 Una sesión larga típica (2–3 horas)

1. **Despertar o volver**: el Emperador aparece donde lo dejó (o renace en una Cuna). Un resumen le cuenta qué pasó mientras no estaba: producción, ataques, rutas, mensajes de los pueblos.
2. **Gestionar (10–15 min)**: colas de construcción, rutas, mercado, encargos de los personajes.
3. **Salir a la aventura (1–2 h)**, una o varias de:
   - una **expedición** a una ruina de los Precursores (§7; llega en la etapa B, con el Emperador a pie);
   - una **cacería** de Carroñeros en el anillo de Céfiro o el Cinturón;
   - una **misión** de un personaje de un pueblo (§9);
   - un **asedio** o la defensa de una parcela (§11);
   - **cartografiar** una región nueva de un planeta (§6);
   - un **suceso del sistema** en curso (oleada de la Grieta, tormenta de Céfiro…) (§13).
4. **Volver con el botín**: reliquias, recuerdos, recursos, reputación, entradas del códice.
5. **Invertir**: reclamar tierra, construir, equipar la nave, encargar naves en el Astillero.

### 1.1.1 La etapa A: un poco de todo (decisión del 23-10-2026)

Hasta que llegue el Emperador a pie (etapa B), las sesiones largas se reparten **a partes iguales** entre cacerías y combate, conquista y asedios, exploración y cartografía volando bajo, misiones de los pueblos y sucesos del sistema. Ninguna es «la principal»: el jugador elige cada día.

### 1.2 Lo que avanza sin el jugador

Igual que ahora, con resolución perezosa en el servidor: producción y población de las colonias, construcción, rutas de logística, viajes de flotas, investigación, gestación del Emperador muerto, gobierno de los Herederos y la IA de los pueblos. El jugador **no** pierde progreso por no conectarse, pero sí puede perder tierra si no la defiende (con avisos y tiempos de asedio largos, §11).

### 1.3 Las tres escalas del juego

| Escala | Qué hace el jugador | Ejemplo |
|---|---|---|
| **El Emperador** | Pilotar, pelear, explorar, hablar con personajes | Volar a Elyss y entrar en una ciudad enterrada. |
| **La casa** | Colonias, flotas, rutas, Herederos, diplomacia | Fundar una colonia en una luna de Vesperia con permiso de los Vesperi. |
| **El sistema** | Sucesos, guerras entre casas, la carrera por la tumba | Defender Origen de una oleada de la Grieta con otros jugadores. |

---

## 2. El Emperador

### 2.1 Qué tiene

- **Hangar de naves** (decisión del 23-10-2026): el Emperador puede tener **las naves que quiera** (sin límite; solo limita el coste) y elegir con cuál sale; la que pilota es su **nave insignia** de ese momento (bodega, armas, escudo, motores, combustible y 3 huecos de reliquia). Las demás esperan en el hangar de una colonia propia o en Origen. Se sigue pudiendo pilotar a distancia las naves de flota, como hoy.
- **Traje** (etapa B, a pie): escáner, linterna, *jetpack*, herramienta de minería, protección contra el clima.
- **Recuerdos** (§5) y **reliquias equipadas** (§4).
- **Rango** (el actual: experiencia por contratos, combate, exploración).
- **Casa** (§3).

### 2.2 Muerte y renacer (muerte suave)

| Se pierde | Se conserva |
|---|---|
| El **tiempo** de gestación. | La nave (se reconstruye), su carga, sus humanos, su combustible y munición. |
| La **posición**: se renace en una Cuna (o en Origen). | Las reliquias equipadas y guardadas. La nave que pilotaba vuelve a su hangar. |
| | Colonias, flotas, créditos, reputación, recuerdos, códice. |

- **Gestación**: unos minutos la primera vez, más con muertes seguidas (la racha de la Fase 10 sigue: unos minutos la primera vez y se dobla con cada muerte seguida hasta **1 hora o más** de techo, decisión del 23-10-2026; propuesta: 2 h), y se olvida con el tiempo.
- **Renacer**: en una **Cuna** propia (cápsula en el agua, en cualquier planeta con colonia propia) o, si no hay, en **Origen**, en la cápsula del fondo del mar (la escena del primer despertar).
- **Sueños** (lore): mientras gesta, la pantalla de muerte muestra una visión breve; algunas dejan una pista en el códice.
- **Quién te mató** queda registrado para la casa (para guerras y venganzas, §11.4).
- **Lo que hace dura la muerte** no es perder cosas, sino **dejar desprotegido lo que defendías**: un asedio que no sostienes, una ruta sin escolta, una expedición a medias (la ruina se «cierra» si te vas, §7.4).

### 2.3 Emperador o Emperatriz

Se elige al crear el personaje (y se puede cambiar en Ajustes); todos los textos concuerdan. El traje y la nave cambian de detalles, no de poder.

- **La nave desaparece** donde cayó (decisión del 23-10-2026): no deja pecio; se reconstruye entera con el Emperador.


---

## 3. Las casas

- Cada Emperador **es** una casa: nombre del linaje (= nombre del Emperador), **emblema** (generado a partir del nombre y retocable con piezas: forma del escudo, símbolo, colores; sin dibujo libre ni texto) y **colores** que pintan sus naves, edificios y uniformes.
- **Herederos** (Fase 10): miembros de la casa que gobiernan colonias o mandan flotas, con su doctrina.
- **Prestigio de la casa**: suma de tierra, reliquias, colecciones completadas, victorias y obras. Es la base del ranking y del lore (leyendas de la era).
- **Alianzas entre casas** (más adelante, Fase 12 de la hoja de ruta actual): pactos de no agresión y defensa mutua; por ahora, **compañeros** como hoy.

**Una casa por jugador** (decisión del 23-10-2026); las alianzas y casas de varios jugadores llegan más adelante.

---

## 4. Reliquias divinas

Objetos de los dioses muertos. **Poder moderado, coleccionables**: lo bonito es reunirlas.

### 4.1 Cómo son

- **Seis familias**, una por dios conocido: reliquias de **Kaurath** (fuego, poder), **Ilwen** (memoria, tiempo), **Umara** (vida, crecimiento), **Vael** (protección, hogar), **Zefaro** (viento, viaje), **Ossal** (silencio, muerte).
- Cada reliquia tiene **nombre, texto de lore**, una **ventaja pequeña** y una **colección** a la que pertenece.
- **Rareza** por cantidad en el servidor: **comunes** (muchas), **raras** (pocas) y **únicas** (una sola en todo el servidor; quien la tiene sale en la Wiki del juego).

### 4.2 Qué dan (moderado)

| Familia | Ejemplos de ventaja (+2 % a +8 %) |
|---|---|
| Kaurath | Daño de los cañones, velocidad de la forja (aleaciones). |
| Ilwen | Experiencia de recuerdos, alcance del escáner, velocidad de investigación. |
| Umara | Crecimiento de la población, producción de biomasa. |
| Vael | Escudo de la nave, defensa de las colonias. |
| Zefaro | Velocidad de crucero, consumo de combustible, rapidez de las rutas. |
| Ossal | Sigilo (menos alcance de detección enemiga), resistencia en la muerte (gestación más corta). |

- **Huecos**: la nave tiene 3 huecos de reliquia, cada colonia 2 y el Emperador (traje) 2. Las demás se guardan en el **relicario** de la casa (un edificio en una colonia, visible).
- **Sin acumulación sin fin**: dos reliquias iguales no suman; el tope por tipo de ventaja evita que alguien sea invencible.

### 4.3 Colecciones

- Cada dios tiene **colecciones** de 4–8 reliquias («Las Lágrimas de Ilwen», «Las Plumas de Zefaro»…).
- Completar una colección da una **recompensa que se ve** (un adorno para la nave, un color nuevo de casa, un monumento en tu colonia), un **recuerdo** (§5) y una entrada del códice, más **prestigio**.
- Una **galería** de la casa muestra lo reunido (y lo que falta, como siluetas).

### 4.4 Cómo se consiguen

| Vía | Notas |
|---|---|
| **Ruinas de los Precursores** (§7) | La fuente principal: expediciones largas. |
| **Tierra sagrada** (§6.3) | Algunas parcelas generan reliquias comunes muy despacio. |
| **Personajes de los pueblos** (§9) | Recompensa de misiones y de reputación alta. |
| **Sucesos** (§13) | Oleadas de la Grieta, tormentas, despertares. |
| **Comercio** | Mercado del anillo (comunes y raras) y Nómadas (con su comisión). Las únicas no se venden. |
| **Conquista** | Al conquistar una colonia, su relicario puede perder parte de lo guardado (§11.3). |

Decisiones del 23-10-2026: **huecos 3 + 2 + 2** aprobados; las **reliquias únicas pasan al conquistador** si se conquista la colonia donde están guardadas (son objetivo de guerra; las que lleva la nave o el Emperador no se pierden, por la muerte suave).

---

## 5. Recuerdos

Los Emperadores tienen **recuerdos rotos**. Recuperarlos es la progresión personal del Emperador.

- **Fragmentos de recuerdo** se consiguen con reliquias nuevas, colecciones completas, ruinas, sueños, cumplir hitos (primera vez en cada planeta, primera colonia…) y con los **Elydri** (que intercambian conocimiento por recuerdos).
- Los fragmentos llenan **recuerdos** completos, cada uno con:
  - una **escena breve** (texto e imagen) de una vida pasada que «no encaja»;
  - un **rasgo** pequeño y permanente del Emperador (p. ej. «Recuerdas el mar»: +5 % de velocidad bajo el agua; «Recuerdas una guerra»: +3 % de daño contra Erradicadores).
- **Árbol de recuerdos**: 6 ramas (una por dios conocido) más una rama **sin nombre** que se llena muy despacio y nunca explica de dónde viene (lore secreto, sin decirlo).
- Morir **no** borra recuerdos (muerte suave), aunque un sueño puede «cambiar» el texto de uno.

- **Ceder recuerdos a los Elydri** (decisión del 23-10-2026): el Emperador puede entregar un recuerdo completo a cambio de algo valioso (avanzar de golpe una investigación humana, una reliquia, reputación alta). **Lo pierde**: desaparece su rasgo y su escena queda en el códice como «Entregado a los Elydri». Es una decisión dura y a propósito; los fragmentos de ese recuerdo pueden volver a encontrarse, muy despacio.

---

## 5b. Colonias (decisiones del 23-10-2026)

- **Construcción libre**: el jugador coloca cada edificio **donde quiera dentro de sus parcelas** (con rejilla y giro), como en un juego de construcción. El servidor valida la posición (dentro de una parcela propia, sin solaparse, en terreno válido) y guarda la intención; el edificio se construye solo con la cola de siempre, aunque el jugador se desconecte.
- **Edificios fijos**: cada instalación (mina, refinería, central, astillero, dique seco, plataforma defensiva, Cuna, fábrica, relicario, granja…) es **un edificio completo** con su aspecto por casa y nivel; no se montan por piezas.
- **Comida**: la población consume **biomasa**; si falta, deja de crecer (no muere). Se produce en granjas (biomas fértiles: Origen, Vesperia, Tharax) o se compra.
- **Herederos visibles**: tienen nombre, aspecto (el traje de la casa con los colores de su doctrina) y se les ve en la colonia que gobiernan o en el puente de la flota que mandan; se les puede visitar.

## 6. La tierra: parcelas

### 6.1 La malla

- Cada planeta y luna sólido se divide en **parcelas** de una malla geodésica (hexágonos y 12 pentágonos). Propuesta: **Origen 642**, planetas medianos **362**, lunas **162**; Céfiro sin parcelas (solo sus lunas y las ciudades nómadas, que no se reclaman).
- Cada parcela tiene **bioma**, **recursos**, **dueño** y, a veces, **algo especial** (ruina, tierra sagrada, nido, guardianes).

### 6.2 Reclamar y perder

| Acción | Cómo |
|---|---|
| **Reclamar** | Aterrizar (o enviar una flota) en una parcela libre y plantar el estandarte de la casa: coste en créditos según el planeta (caro en Origen, barato y peligroso lejos). |
| **Límite** | Número máximo de parcelas según el rango y las colonias (para que nadie se quede con un planeta entero al principio). |
| **Conectar** | Las parcelas contiguas forman una colonia; las sueltas son **puestos** (minería, vigilancia). |
| **Perder** | Por conquista (§11) o abandono: una parcela sin colonia ni puesto vuelve a estar libre a los 14 días sin visitarla. |

### 6.3 Tierra sagrada

- Parcelas sobre **restos divinos** (un hueso de Vael que florece, una vena de Kaurath, un cristal-pensamiento de Ilwen). Pocas por planeta, marcadas en el mapa una vez descubiertas.
- Producen el recurso **esencia** (nuevo, de la familia de su dios) y, muy despacio, reliquias comunes.
- Son el **centro de las guerras**: todas las casas y el pueblo del planeta las quieren. Controlar tierra sagrada de un dios cambia la reputación con su pueblo (sube o baja según su doctrina, §9).

### 6.4 Biomas y recursos

| Planeta | Biomas principales | Recursos destacados |
|---|---|---|
| Brasa | Lava, obsidiana, crepúsculo | `metal`, `alloys`, esencia de Kaurath |
| Elyss | Cristal, aurora, llanuras cantoras | `crystal`, `rare_metals`, esencia de Ilwen |
| Origen | Océano, islas, arrecifes | Equilibrado; población alta |
| Tharax | Selva de hongos, esporas, colmena | **biomasa** (nuevo), `volatiles`, esencia de Umara |
| Vesperia | Pradera dorada, bosque torre | Comida/biomasa, `crystal`, esencia de Vael |
| Céfiro (lunas) | Hielo, roca | `volatiles` (combustible), esencia de Zefaro (en las nubes) |
| Umbra | Hielo azul, géiseres | `exotic`, `rare_metals`, esencia de Ossal |
| Cinturón y anillo | Asteroides | `metal`, `rare_metals`, `exotic` |

Recursos actuales que se mantienen: `metal`, `volatiles`, `crystal`, `alloys`, `rare_metals`, `exotic`. Nuevos: **biomasa** (población y organismos) y **esencia** (seis tipos, uno por dios; para reliquias, mejoras y monumentos).

### 6.5 Cartografía

- Las regiones de un planeta empiezan **borrosas** en el mapa. Se cartografían de dos formas (decisión del 23-10-2026): **volando bajo con el escáner** (revela al pasar) y con **sondas y torres de escucha** que revelan alrededor y mantienen la región **vigilada** (avisan de quién entra). A pie, en la etapa B.
- Descubrir da experiencia (oficio de Explorador), entradas del códice y, a veces, ruinas o tierra sagrada.
- **Cada casa tiene su mapa**: lo que cartografías solo lo ves tú… salvo que **vendas el mapa** en el mercado (decisión del 23-10-2026). Un mapa vendido es una copia de una región tal como estaba ese día.

Decisión del 23-10-2026: una parcela sin colonia ni puesto queda libre a los **14 días** sin visitarla (se avisa antes). Los números de parcelas (642 / 362 / 162, unas 3600 en total) quedan aprobados.

---

## 7. Ruinas de los Precursores (expediciones)

La actividad larga principal. Mezcla de **templos colosales** visibles y **ciudades enterradas**.

### 7.1 Tipos

| Tipo | Dónde | Duración | Para cuántos |
|---|---|---|---|
| **Santuario** | Pequeñas ruinas en la superficie | 15–30 min | 1 |
| **Ciudad enterrada** | Bajo el polvo y el hielo, se descubren cartografiando | 1–2 h | 1–4 |
| **Gran templo** | Uno por dios, tallado en su cuerpo (escaleras que no acaban) | 2–4 h, por fases | 2–8 |

### 7.2 Qué se hace dentro (en la nave al principio; a pie en la etapa B)

- **Recorrer** salas y galerías generadas por gramáticas (cada ruina distinta, pero con el estilo de su dios).
- **Puzles** sencillos de los Precursores: alinear luces, abrir puertas con la reliquia correcta, seguir un canto.
- **Guardianes** antiguos (máquinas de los Grises o criaturas del dios) que defienden las salas.
- **Inscripciones** para el códice (siempre nombran seis dioses).
- **Botín**: reliquias, fragmentos de recuerdo, esencia.

### 7.3 A pie, en la etapa B (decisión del 23-10-2026)

Las expediciones **llegan con el Emperador a pie** (etapa B de la hoja de ruta), no antes. Hasta entonces, las sesiones largas de la etapa A se llenan con cacerías, misiones de los pueblos, asedios, cartografía y sucesos del sistema; los templos colosales se ven y se sobrevuelan desde fuera, cerrados, como promesa.

Dentro de las ruinas hay **puzles, combate y jefes** (un gran guardián al final de cada gran templo); recorrerlas es el camino, no el objetivo.

### 7.4 Reglas

- Una ruina tiene **progreso compartido** dentro de un grupo; si todos se van o mueren, se «cierra» y hay que volver a empezar (la muerte suave duele aquí).
- Cada ruina se **reinicia** con otra distribución cada cierto tiempo (días), para volver a jugarla.
- Los grandes templos están en **zonas disputadas o sin ley**: entrar es arriesgarse a encontrarse con otra casa.


---

## 8. El espacio y el combate

### 8.1 Vuelo

Se mantiene todo lo que ya existe (inercia y asistencia, pulso de crucero, cámaras, autopiloto, arranque de motores, combustible, energía, munición, calor de la estrella) con la **escala nueva** (§2.4 de la hoja de ruta: cruzar el sistema en unos 2 min). Novedad: **volar dentro de las atmósferas** (arrastre, entrada, tormentas) y **aterrizar**.

### 8.2 Combate en tiempo real

Se mantiene (cañones, misiles, escudos, asistencia de puntería, fuego automático, choques, fuego amigo), con **zonas** (§11.1) y con **reliquias** que cambian un poco las armas. Las naves de los pueblos pelean según su identidad militar del lore: Elydri con escudos y análisis, Tharaxi en enjambre que se adapta, Aurelianos con comandantes de élite, Nihil con ocultación e interferencia, Vesperi con defensas extraordinarias.

### 8.2.1 Estilo del combate (decisiones del 23-10-2026)

- **Pesado y táctico**: naves con masa e inercia que giran despacio; lo que cuenta es la posición, el reparto de **energía** entre armas, escudo y motores (la energía ya existe en el juego) y elegir el momento. Las naves pequeñas son algo más ágiles, pero nadie esquiva balas como en un juego de cazas.
- **Escudo de burbuja única**, como ahora: un valor que baja y se recarga.
- **Daño por partes**: además del casco, se pueden romper **motores** (la nave queda lenta), **armas** (dejan de disparar), **generador de escudo** (no se recarga) y **sensores** (se pierde el radar). Se reparan despacio a bordo y deprisa en una colonia propia o un hangar.
- **Tripulación de varios jugadores**: las naves grandes tienen **puestos de artillero** (y, más adelante, de ingeniero) que pueden ocupar compañeros; el piloto vuela y ellos manejan torretas. En la etapa A se entra al puesto desde el menú; con los interiores (etapa B), andando hasta él.

### 8.3 Criaturas del espacio (decisión del 23-10-2026)

**Sí hay criaturas espaciales**, sobre todo cerca de los cuerpos de los dioses (lista aprobada el 23-10-2026):

| Criatura | Dónde | Comportamiento |
|---|---|---|
| **Bancos de luz** | Cerca de Aeon y de Elyss | Enjambres de destellos que siguen a las naves; inofensivos; su paso deja esencia de Ilwen. |
| **Leviatanes del aliento** | Entre las nubes de Céfiro | Gigantes lentos que nadan en el viento de Zefaro; los Nómadas los respetan; cazarlos enfada a los Nómadas. |
| **Brasas errantes** | Órbita de Brasa | Fragmentos vivos del fuego de Kaurath; atacan a quien se acerca demasiado al corazón. |
| **Esporas del vacío** | Alrededor de Tharax | Nubes vivas que se pegan a los cascos y los corroen; la colmena las usa como arma. |
| **Siervos menores** | Junto a las lunas | Restos animados de los siervos de los dioses (las lunas); son los **jefes del sistema** de los sucesos «Despertar de un guardián». |
| **Ecos de Ossal** | En la oscuridad de Umbra | Siluetas que solo se ven por el rabillo del ojo; desactivan sensores. |

**Domesticar** (decisión del 23-10-2026): algunas criaturas (no los jefes) se pueden **atraer y domesticar**; acompañan a la nave o viven en una colonia, con un pequeño efecto (un banco de luz que ilumina y revela lo oculto, una brasa que calienta en Umbra…). Cazarlas no es el objetivo del juego. Cómo se atraen (alimento, esencia, paciencia) queda por diseñar.

### 8.4 Flotas

Decisiones del 23-10-2026:
- **Todo en tiempo real**: desaparece el combate por rondas. Toda batalla (con o sin jugadores mirando) la simula el servidor en vivo, en el lugar real del sistema, con la IA de naves de la Fase 9d.
- **Mando mixto**: cada flota lucha sola con la táctica elegida (como hoy) y, si el Emperador está cerca o a distancia, puede dar **órdenes en tiempo real** (atacar a un blanco, formar, cubrir, retirarse) mientras pilota.
- **Armas**: cañones y misiles (lo que ya hay), **rayos continuos** (queman mientras se mantiene el haz) y **torpedos pesados** (lentos, enormes, interceptables, para naves grandes).
- **Naves capitales** (300–600 m) para jugadores: **más adelante** (etapa B o C); por ahora solo las tienen los pueblos.
- Se mantienen escoltas, nodrizas y comandantes Herederos. Los viajes duran minutos.

Nota técnica: simular en vivo batallas sin nadie mirando cuesta CPU en un servidor pequeño. El servidor las simulará a menos pasos por segundo cuando no haya jugadores cerca (mismo resultado en esencia, menos detalle) y a ritmo completo cuando alguien llegue. Hay que medirlo en la fase S4 (prueba de carga).

---

## 9. Los pueblos

### 9.1 Reputación

Cada pueblo tiene una **reputación** con cada casa (de «enemigo jurado» a «elegido»), que cambia con lo que haces: misiones, comercio, tributos, ataques, tierra sagrada que controlas y cómo la tratas.

### 9.2 Lo que ofrece cada pueblo

**Guardianes** (decisión del 23-10-2026): cada pueblo tiene guardianes (drones o criaturas) en sus tierras sagradas que **atacan siempre** a cualquiera que entre, tenga la reputación que tenga. La reputación abre otras puertas (ciudades, embajadas, mercados, permisos para colonizar zonas no sagradas de su mundo), pero el corazón de cada pueblo es peligroso para todos.

| Pueblo | Qué ofrece a buena reputación | Qué le enfada |
|---|---|---|
| **Aurelianos** (Brasa) | Duelos y torneos con premios, adornos y emblemas forjados con el fuego de Kaurath, vasallaje temporal a cambio de protección. | Rechazar un duelo, tomar tierra de Kaurath sin vencerles antes. |
| **Elydri** (Elyss) | Conocimiento (investigación más rápida) a cambio de **recuerdos**; restauran reliquias dañadas. | Destruir ruinas o archivos; quemar tierra sagrada. |
| **Tharaxi** (Tharax) | La colmena: nada (es hostil). Los **disidentes**: biomasa, criaturas aliadas, rutas secretas por la selva. | Cualquier ataque a la colmena despierta su **adaptación** (resisten más tu tipo de arma). |
| **Vesperi** (Vesperia) | **Protección** de tus colonias cercanas (sus escudos), permiso para aterrizar y colonizar en sus tierras. | Abusar de la fuerza, atacar a débiles, colonizar sin permiso. |
| **Nómadas** (Céfiro) | Mercado propio, escoltas, rutas rápidas, contrabando de reliquias. | Bloquear sus rutas, atacar sus ciudades. |
| **Grises** (Ábaco) | **Tratados**: investigación más rápida o protección a cambio de no pasar de cierto número de parcelas. Romper el tratado tiene castigo. | Crecer más allá de lo pactado. |
| **Nihil** (Umbra) | Muy poco: paso seguro por Umbra, alguna reliquia de Ossal a quien respeta el silencio. | Hacer ruido en Umbra: combates, minería, motores a tope cerca de sus velatorios. |
| **Carroñeros** | Nada oficial; contratos sucios, mercado negro. | Siempre hostiles salvo pacto puntual. |
| **Erradicadores** | Nada. | Existir. |

### 9.3 Personajes con diálogo

- Cada pueblo tiene **3–5 personajes** con nombre, retrato y diálogo escrito (sin voces): un **embajador**, un **sacerdote o guardián**, un **mercader** y alguno especial (el líder de los disidentes tharaxi, una archivista elydri, un duelista aureliano…).
- Dan **misiones** (cadenas cortas que cuentan una historia), comercian y reaccionan a tu reputación.
- Los diálogos tienen **opciones** que cambian la reputación y, a veces, el desenlace.
- Todo el texto lo escribimos nosotros (es/en); no hay texto libre de jugadores.

Decisión del 23-10-2026: **solo texto**, sin voces.

- **Muchas misiones pequeñas** (decisión del 23-10-2026): cada personaje tiene encargos cortos y repetibles (llevar algo, cazar, escoltar, cartografiar, recuperar) que cambian con la reputación, más alguna cadena corta que cuenta su historia.

---

## 10. Naves y Astillero

- Se mantienen las clases actuales (12 humanas, Carroñeros, alienígenas, nodriza) y el **Astillero por piezas**.
- **Solo tecnología humana** (decisión del 23-10-2026): no hay piezas alienígenas que funcionen distinto. Con reputación, los pueblos dan **adornos** de su estilo (pintura, emblemas, luces) que no cambian el poder.
- **Reliquias** en los huecos de la nave (§4.2).
- **Personalización**: colores y emblema de la casa, adornos de colecciones completadas.
- La nave insignia se **reconstruye** al morir sin perder nada (muerte suave).

---

## 11. Guerra y PvP (modelo mixto)

### 11.1 Zonas

| Zona | Dónde (propuesta) | Reglas |
|---|---|---|
| **Segura** | Origen y su órbita, el anillo humano, la estación Ábaco (los Grises no toleran combates), las ciudades nómadas | Sin PvP. Los pueblos y la milicia del Núcleo protegen. |
| **Disputada** | Brasa, Elyss, Vesperia, las lunas de Céfiro, los puntos de Lagrange | PvP **solo entre casas en guerra declarada** (§11.4). Pueblos y piratas atacan igual. |
| **Sin ley** | Tharax, Umbra, el Cinturón, el anillo de Céfiro, alrededores de la Grieta | Todo vale. Allí están las mejores ruinas, la tierra sagrada más rica y lo más raro. |

El reparto queda aprobado por ahora (23-10-2026) y podrá cambiar. La zona se ve siempre en el HUD y en el mapa. Las zonas pueden cambiar con sucesos (una oleada de la Grieta convierte una zona en sin ley mientras dura).

### 11.2 Gracia

Los Emperadores nuevos tienen **gracia** (como hoy, 24 h ampliables a unos días) en la que no pueden ser atacados por jugadores ni atacar.

### 11.3 Asedio y conquista de parcelas

Lo de la Fase 9b sobre parcelas (decisión del 23-10-2026: **solo asedio general**, no se destruyen edificios concretos uno a uno): presencia sostenida en órbita y en tierra, plataformas defensivas, desembarco de tropas, captura con pérdidas. Las **tropas son visibles** (decisión del 23-10-2026): los mortales de la casa bajan en lanzaderas y se les ve luchar en el suelo (etapa B, con el personaje a pie; antes, solo las lanzaderas y los combates de fondo). Para no perder tierra mientras duermes:
- **Aviso** inmediato a la casa (en el juego y, si se activa, notificación).
- **Tiempos largos**: un asedio necesita **horas de presencia** y se puede **defender** al volver.
- **Ventanas de vulnerabilidad** (aprobadas el 23-10-2026): cada casa elige unas horas del día en que sus colonias pueden ser asediadas en zonas disputadas. En zonas sin ley no hay ventana: se puede asediar a cualquier hora (con asedios largos y aviso).
- Al capturar una colonia: la tierra cambia de dueño, el relicario puede perder parte de lo guardado, los edificios quedan dañados. Las reliquias únicas guardadas allí pasan al conquistador.

### 11.4 Guerra declarada entre casas

- Una casa **declara la guerra** a otra; empieza tras un **aviso de 12 h** (decisión del 23-10-2026) para que la otra se prepare.
- Durante la guerra, PvP libre entre ellas en las zonas disputadas; puntuación de guerra (naves destruidas, parcelas tomadas, reliquias capturadas).
- La guerra termina por **rendición**, **tregua** acordada o **tiempo** (máximo de días).
- Las alianzas entre casas (más adelante) arrastran a los aliados.



---

## 12. Economía (decisiones del 23-10-2026)

- **Créditos por varias vías equilibradas**: renta de la población de las colonias (como hoy), comercio entre mercados, pagos de misiones y cacerías, botín.
- **Sin mantenimiento**: tener colonias y naves no cuesta nada por estar; el límite al crecimiento lo ponen las parcelas, el rango y la guerra.
- **Sin tesoro de la humanidad ni proyectos comunes**: se quitan en la Era II.
- **Mercado del anillo** (Origen): libro de órdenes, comisión y envíos según la distancia real. **Solo mercado**: no hay intercambio directo entre jugadores; todo pasa por los libros de órdenes, para evitar abusos.
- **Mercado nómada** (Céfiro): más caro, pero compra y vende lo que el del anillo no (reliquias comunes y raras, esencias, contrabando), sin preguntar.
- **Fabricación** y **tecnología** como hoy (Fábrica, recetas, **un solo árbol de investigación humano**), con recetas nuevas que usan **esencia** y **biomasa**.
- **Logística visible**: cargueros entre parcelas, lunas y mercados. **Los jugadores pueden asaltarlos en zonas sin ley** (piratería de jugadores), además de los Carroñeros; en zonas disputadas, solo entre casas en guerra.

## 13. El sistema vivo: sucesos

Sucesos del servidor (decisión del 23-10-2026: **llegan por sorpresa con unas horas de señales** —temblores en la Grieta, cambios en las nubes de Céfiro, cantos de los cristales—, no con calendario) que hacen que el sistema cambie y que el dueño puede usar para contar el lore poco a poco (MMO):

| Suceso | Qué pasa | Frecuencia aproximada (propuesta) |
|---|---|---|
| **Oleada de la Grieta** | Los Erradicadores entran por la Grieta y van a por Cunas y colonias pobladas; recompensas para quien defiende. | Semanal |
| **Tormenta de Zefaro** | Una gran tormenta de Céfiro cambia las rutas y deja esencia en las nubes. | Cada pocos días |
| **Lluvia del Cinturón** | Meteoros sobre un planeta: daños y minerales raros en el suelo. | Cada pocos días |
| **Eclipse** | Cuando Céfiro tapa el sol de una luna o una alineación rara: se abren santuarios que solo existen en la sombra. | Según las órbitas |
| **Canto de Elyss** | Los cristales cantan un recuerdo para todo el sistema: una entrada de códice común y una ruina que despierta. | Rara |
| **Silencio de Umbra** | Los Nihil apagan los sensores de una región durante horas. | Rara |
| **Despertar de un guardián** | Un siervo muerto (una luna) se agita: jefe del sistema para muchas casas a la vez. | Mensual |
| **Sucesos del dueño** | Eventos escritos a mano que cuentan el lore (nuevos textos, lugares, personajes). | Cuando el dueño quiera |

Ninguno revela el secreto (lore-era2.md §9 y §13); como mucho, siembran preguntas.

### 13.1 Las oleadas de la Grieta (decisiones del 23-10-2026)

- **Destruyen de verdad**: si nadie las para, los Erradicadores arrasan las Cunas y las colonias pobladas que encuentran en su camino (edificios destruidos, población perdida). Es la amenaza real del sistema (Ley III).
- **Tregua automática**: mientras dura una oleada, el PvP se desactiva en las zonas afectadas; las casas en guerra pelean del mismo lado.
- **Los pueblos también luchan, cada uno a su manera**: los Vesperi defienden a quien esté cerca, los Aurelianos lo ven como un duelo glorioso, los Grises calculan y protegen solo Ábaco, los Nómadas huyen con sus ciudades, los Tharaxi se lanzan en enjambre, los Elydri salvan archivos y los Nihil se esconden en el silencio.

### 13.2 Historia principal por era

Cada era (3 meses) cuenta un **capítulo** de la historia para todo el servidor: una campaña de sucesos, misiones y lugares nuevos que avanza según lo que hacen los jugadores, y que termina con el gran suceso del fin de era (§18). Es la vía principal para que el dueño cuente el lore poco a poco, sin revelar nunca el secreto.

---

## 14. El códice

- Todo lo que se encuentra se guarda en el **códice** del Emperador: inscripciones, crónicas de los pueblos, cantos elydri, diálogos importantes, sueños, recuerdos, reliquias, criaturas, lugares.
- Ordenado por dios, pueblo y planeta; lo no descubierto aparece como hueco.
- Algunas entradas se **contradicen** entre sí (cada pueblo cuenta la guerra de los dioses a su manera).
- Completar secciones da prestigio y, a veces, un recuerdo.

---

## 15. Progresión (decisiones del 23-10-2026)

### 15.1 Oficios en vez de un rango único

El Emperador sube **por oficios**, cada uno con su experiencia y sus rangos (oficios aprobados el 23-10-2026):

| Oficio | Sube con | Desbloquea (ejemplos) |
|---|---|---|
| **Piloto** | Vuelo, combate de naves, cacerías | Maniobras, mejor reparto de energía, naves más grandes en el hangar. |
| **Señor de la guerra** | Asedios, guerras, mando de flotas | Más flotas, órdenes de flota, tropas mejores. |
| **Explorador** | Cartografía, sondas, criaturas, ruinas | Alcance del escáner, regiones antes que nadie, domesticar criaturas. |
| **Mercader** | Comercio, rutas, misiones de entrega | Comisiones más bajas, más órdenes abiertas, cargueros mayores. |
| **Señor de la tierra** | Colonias, población, construcción | Más parcelas, edificios de nivel alto, granjas mejores. |
| **Erudito** | Códice, recuerdos, reliquias, Elydri | Investigación, colecciones, más huecos de recuerdo. |

Las mejoras de los oficios son **pequeñas y prácticas** (como las del rango actual: bodega, combustible, parcelas…); el poder grande no viene del nivel.

### 15.2 El resto

| Qué | Cómo sube | Para qué |
|---|---|---|
| **Recuerdos** | Fragmentos (§5) | Rasgos permanentes pequeños, lore personal. |
| **Tecnología** | Investigación humana (un solo árbol) | Mejoras de naves, colonias y armas. |
| **Reliquias y colecciones** | Botín (§4) | Ventajas pequeñas y adornos. |
| **Reputación** | Pueblos (§9) | Misiones, permisos, protección, tratados, adornos. |
| **Prestigio de la casa** | Todo lo anterior | **Ranking público por prestigio** (de la era y del legado histórico) y leyendas. |

- **Objetivos: solo semanales**, con racha de semanas; desaparecen los diarios.
- Se mantienen los **contratos**, el **reto de caza** y las **peticiones de colonia**, adaptados al sistema.

## 16. El primer día de un jugador

1. **Despertar** en la cápsula del fondo del mar de Origen; subir nadando o en la cápsula hasta la superficie: el cielo, el anillo, la estrella. (Tutorial, capítulo 1.)
2. Llegar a la ciudad sobre las ruinas; un personaje del **consejo de Emperadores** (solo lore) le da su nave.
3. **Primer vuelo** en la órbita de Origen; la luna-astillero.
4. **Primera parcela** en Origen (pequeña, segura).
5. **Primera misión** de un pueblo (Nómadas, que comercian con todos) y primer viaje fuera de Origen.
6. **Primer santuario** de los Precursores: primera reliquia, primer recuerdo, primera inscripción con «los seis dioses».
7. Primer encuentro con **Carroñeros** (en zona sin ley si se aventura).

---

## 17. Qué cambia en el servidor (resumen)

Lo nuevo frente al servidor actual, para las fases S1–S7 de la hoja de ruta:
- Parcelas, tierra sagrada, cartografía y zonas (S3, S4).
- Reliquias, colecciones, relicario y huecos; recuerdos y su árbol; códice (nuevas tablas, en la exportación de datos y con borrado en cascada).
- Reputación ampliada, personajes, misiones y diálogos (datos en `packages/content`).
- Ruinas (instancias de expedición con progreso compartido y reinicio).
- Guerras declaradas, ventanas de vulnerabilidad.
- Recursos nuevos (`biomass`, `essence_*`).
- Muerte suave: la nave, la carga y los humanos ya no se pierden; techo de gestación.
- Sucesos del sistema (ampliación de `CrisisService` y `SPACE_EVENTS`).

## 18. Eras con reinicio (decisiones del 23-10-2026)

- **Una era dura 3 meses.** Termina con un **gran suceso** del sistema (una oleada final de la Grieta, un despertar), anunciado con semanas de antelación.
- **Se reinicia** todo lo del mundo: parcelas, colonias, flotas, naves del hangar, créditos, reputación, reliquias y adornos.
- **Legado que se conserva**: la cuenta y el Emperador (nombre, casa, emblema), el **códice**, los **recuerdos** (rasgos), el **prestigio** y las **leyendas de la era**.
- **Sin ayudas para los que llegan tarde**: quien empieza a mitad de era empieza como todos (con la gracia de los nuevos y las zonas seguras, como siempre).
- Cada era puede **cambiar algo del sistema** (una luna rota, una zona nueva, un pueblo con otra actitud) y es el gran momento para contar más lore.
- Nota técnica: el cambio de era es una versión del script de reinicio que ya existe (`galaxia-30k.sh` conserva cuentas y Wiki); habrá que ampliarlo para conservar códice, recuerdos y prestigio.
