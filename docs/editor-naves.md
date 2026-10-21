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

1. **E1** Datos de piezas y reglas puras con pruebas; las clases actuales como diseños de serie.
2. **E2** Servidor: diseños, validación, compra y construcción.
3. **E3** Editor (catálogo, anclajes, estadísticas, problemas).
4. **E4** Las estadísticas mandan en el vuelo, el salto y el combate.
5. **E5** Modelos 3D generados de las piezas.
