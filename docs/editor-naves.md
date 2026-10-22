# Editor de naves (plan, 21-10-2026)

Petición del usuario: construir tus propias naves comprando piezas y
acoplándolas **como un Lego**; la nave responde a cada pieza (sin tal pieza no
funciona); motores de propulsión distintos, velocidades distintas en la
grieta cuántica y de crucero, escudos y armas distintos.

## Idea

Una nave es un **casco** (armazón) con **anclajes** donde se encajan
**piezas**. Las estadísticas de la nave no se escriben a mano: salen de sus
piezas (reglas puras en `packages/sim`, datos en `packages/content`).

## Piezas (datos en `packages/content`, `ship-parts.ts`)

| Tipo | Qué aporta | Sin ella |
|---|---|---|
| **Casco** (S, M, L, XL) | anclajes, masa base, casco (vida), bodega | — |
| **Puente** | mando; tripulación mínima | no se puede pilotar |
| **Reactor** | energía por segundo | nada funciona |
| **Motor de propulsión** (iónico, químico, de fusión…) | empuje → aceleración y velocidad de crucero; consumo | no se mueve |
| **Motor cuántico** (clases A–D) | velocidad en la grieta, alcance por combustible, tiempo de carga | no salta |
| **Depósito** | combustible | sin alcance |
| **Generador de escudo** (ligero, de flota, de asedio) | escudo, recarga, retardo | sin escudo |
| **Armas** (cañón, láser, misiles, torreta, lanza de minería) | daño, cadencia, alcance; energía | desarmada |
| **Soporte vital** | plazas de humanos | sin tripulación ni pasajeros |
| **Módulos** (bodega, hangar, sensores, blindaje, refinería) | lo suyo | — |

Cada pieza tiene **masa**, **consumo de energía**, **coste** (recursos y
créditos), **tamaño de anclaje** (S/M/L) y **requisitos** (p. ej. la lanza de
asedio exige reactor L; el motor cuántico D, casco L o XL).

## Reglas (puras, en `packages/sim/src/shipDesign.ts`)

- **Validez**: puente + reactor + motor obligatorios; la energía consumida no
  puede superar la del reactor; cada pieza en un anclaje de su tamaño; los
  requisitos se cumplen. Lista de problemas legible («Falta un motor cuántico:
  la nave no podrá saltar»).
- **Estadísticas**: masa total; aceleración = empuje / masa; velocidad de
  crucero y de pulso según motor y masa; giro según masa y propulsores; salto:
  velocidad en la grieta y alcance según motor cuántico, masa y depósito;
  escudo y armas de sus piezas; firma y blanco en las batallas por rondas.
- Las naves actuales (`SHIP_CLASSES`) pasan a ser **diseños de serie** hechos
  con piezas, para que todo use las mismas reglas.

## Servidor

- Tabla `ship_designs` (dueño, nombre, casco, piezas en sus anclajes, versión
  de las reglas). Validación en el servidor (nunca se confía en el cliente).
- **Compra de piezas** con créditos y recursos; construcción en el astillero o
  dique seco según el casco (cola de construcción de la colonia).
- Las naves guardan su diseño: el combate pilotado, las batallas por rondas,
  el vuelo y el salto usan sus estadísticas.

## Editor (cliente)

- Vista 3D del casco con los **anclajes resaltados**; se arrastra una pieza del
  catálogo y **encaja** en un anclaje compatible (como un Lego); se puede
  girar la vista y quitar piezas.
- Panel de **estadísticas en vivo** (masa, energía, velocidad, salto, escudo,
  daño) y **lista de problemas**; coste total.
- Guardar diseño, duplicar y encargar su construcción.
- El modelo 3D de la nave se genera de sus piezas (`shipFactory`).

## Fases

1. ✔ **E1** Datos de piezas y reglas puras con pruebas. (Las clases de serie siguen siendo clases: las naves del Astillero usan la clase base de su casco, `HullDef.baseClass`.)
2. ✔ **E2** Servidor: diseños (`/api/designs`, tabla `ship_designs`), validación, construcción en la cola de la colonia (encargo `design` con la foto del diseño; recursos, créditos y componentes de la Fábrica; dique orbital para L y XL) y tecnología necesaria (`PartDef.tech`).
3. ✔ **E3** Editor «Astillero» (casco, una pieza por anclaje, estadísticas, problemas, coste, componentes, candados de tecnología, vista de la nave, construir).
4. ✔ **E4** Las estadísticas mandan: combate por rondas (`designBattleStats`), combate en tiempo real de escoltas y naves pilotadas (`designCombat`), viajes (`fleetTravelSpeed`), combustible (`shipFuelMax`), escáner (`shipsScannerRangeLy`) y aceleración y giro al pilotarla.
5. ✔ (parcial) **E5** Modelo 3D según las piezas sobre la forma de la clase base (`designLook`: motores, torretas, contenedores, hangar, hábitat, plato); falta un dibujo propio de cada pieza.

Además: casco de nave nodriza (`hull_mothership`) para diseñarla con sus módulos.

---

# Editor 3D de construcción (plan, 22-10-2026, noche)

Petición del usuario: que el Astillero pase a ser un **editor 3D de construcción por piezas**: montar, encajar, simetría, árbol de piezas y estadísticas en vivo, validado en el servidor. (La referencia interna es un juego conocido de construir cohetes; **en la interfaz y en la Wiki no se nombra ningún otro juego**.) Interfaz compacta: ventanas con pestañas, sin emojis y con la barra de acciones a la izquierda intacta.

## Qué hay y qué se reaprovecha

- **Datos** (`packages/content` `shipParts.ts`): cascos (`HullDef`, con anclajes fijos `slots`) y piezas (`PartDef`: tipo, tamaño S/M/L, masa, energía, estadísticas, coste, componentes, tecnología, casco mínimo). **Se reaprovechan** las piezas y sus números; los anclajes fijos pasan a ser **nodos de unión** de cada pieza.
- **Reglas** (`packages/sim` `shipDesign.ts`: `validateDesign`, `designStats`, `designBattleStats`, `designTech`…). **Se reaprovechan** las cuentas (masa, energía, empuje, escudo, armas, salto); cambia la entrada: un **árbol de piezas colocadas** en lugar de `slotId → partId`.
- **Servidor** (`apps/server/src/design/`, tabla `ship_designs`, encargo `design` en la cola de la colonia, `ships.design`). **Se reaprovecha** todo el ciclo de guardar, validar y construir; la foto del diseño (`ShipDesignSnapshot`) gana el árbol.
- **Uso en el juego** (E4): combate por rondas y en tiempo real, viajes, combustible, escáner y pilotaje ya salen del diseño; **no cambia** mientras las estadísticas se sigan calculando con las mismas funciones.
- **Modelo 3D** (`shipFactory.ts` `designLook`): hoy decora la forma de la clase base. Pasa a **montar la nave con la geometría de cada pieza** (cada `PartDef` con su modelo procedural y sus nodos).
- **Cliente** (`ShipEditor.tsx`, 336 líneas): lista de anclajes con un selector por anclaje. **Se sustituye** por el editor 3D; se conservan los paneles de estadísticas, problemas, coste y tecnología.

## Modelo de datos nuevo

- **Pieza colocada**: `{ id, partId, parent: id | null, node: string | "surface", pos: [x,y,z], rot: [x,y,z,w], symmetry?: { group, mode: "radial" | "mirror", count } }`. La primera es la **raíz** (un casco o un puente).
- **Nodos de unión** de cada pieza en los datos (`PartDef.nodes`: posición, dirección y tamaño S/M/L) y si admite **montaje en superficie** (`surface: true`).
- **Diseño**: `{ name, root, parts: PlacedPart[], version: 2 }`. Las fotos de las naves ya construidas (versión 1, por anclajes) se siguen leyendo: se convierten al cargar.
- **Categorías** del catálogo: casco y estructura, motores, depósitos, armas, escudos, módulos (bodega, hangar, minería, sensores) y decoración (sin efecto en las estadísticas).

## Fases

1. **E6 · Datos y reglas del árbol** (`packages/content`, `packages/sim`, con pruebas):
   - nodos y modelo de cada pieza;
   - piezas de estructura (vigas, adaptadores S→M→L) y de decoración;
   - reglas de encaje (tamaño del nodo, una pieza por nodo, superficie solo donde se admita, sin solapes groseros);
   - límites por casco o clase (masa máxima, número de piezas, armas por tamaño);
   - estadísticas a partir del árbol: masa, **centro de masas**, empuje y su **eje** (aviso si no pasa cerca del centro de masas), relación empuje/masa, consumo, alcance de salto, casco, escudo, potencia de fuego y coste.
   - Conversión de los diseños de la versión 1.
2. **E7 · Servidor autoritativo**:
   - `/api/designs` con la versión 2 (valida el árbol entero con las mismas reglas);
   - límites de tamaño de la petición;
   - requisitos de instalación (astillero o dique) y de tecnología;
   - el nombre del diseño es **texto público**: validación y **reportable** con motivos fijos (sin chat ni texto libre en los reportes);
   - las naves construidas guardan la foto v2; combate, viajes y combustible siguen usando `designStats` y compañía.
3. **E8 · Editor 3D, montaje básico** (cliente, ventana a pantalla casi completa con pestañas Catálogo, Estadísticas, Problemas y Diseños):
   - cámara orbital con zoom y vistas rápidas (frente, lado, arriba, 3/4);
   - arrastrar del catálogo y **encajar en nodos** (resaltados los compatibles; imán al acercar);
   - seleccionar, quitar (**quita también lo que cuelga**) y **deshacer y rehacer**.
4. **E9 · Montaje fino**:
   - montaje en superficie;
   - rotación por pasos y libre;
   - desplazamiento fino;
   - **simetría radial (2, 3, 4, 6 y 8) y en espejo**;
   - copiar una rama.
5. **E10 · Estadísticas en vivo**:
   - panel con todas las cifras y su cambio al poner o quitar una pieza;
   - **marcadores 3D** del centro de masas y del empuje, con aviso si no están alineados;
   - coste en recursos, créditos y componentes.
6. **E11 · Diseños**: guardar, cargar, duplicar y renombrar; **plantillas** de serie (las clases actuales rehechas con piezas); construir desde el editor (cola de la colonia).
7. **E12 · Modelo 3D por piezas en el juego**: las naves construidas se dibujan con sus piezas (vuelo, flotas, batallas y miniaturas), con LOD y un tope de piezas por rendimiento.
8. **E13 · Tutorial y Wiki**: capítulo del tutorial «Astillero» y artículo de la Wiki con las tablas generadas de piezas, nodos y límites.

## Riesgos y decisiones abiertas

- **Rendimiento**: muchas piezas por nave y muchas naves en pantalla. Se fusionan las geometrías de cada nave, con LOD y un tope de piezas por casco.
- **Equilibrio**: con libertad de montaje hay que evitar naves imbatibles. Los límites por casco (masa, piezas y armas) y el coste deben sostenerlo; las pruebas de `balance.test.ts` se amplían con diseños extremos.
- **Compatibilidad**: las naves ya construidas (diseños v1) no se rompen; se convierten al cargarlas.
