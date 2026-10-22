# Tutorial completo y repetible

Petición del usuario (22-10-2026): un tutorial guiado de **todas** las mecánicas que existen, por capítulos, que se pueda **repetir** desde un menú, con progreso guardado pero reiniciable, que **no rompa la partida real**, con indicaciones en pantalla, resaltado de botones y comprobación de cada paso.

## Forma

- **Pasos guiados sobre la partida real**, sin recompensas aprovechables: cada paso explica qué hacer, resalta el botón o la zona (atributo `data-tutorial` en la interfaz) y se da por hecho cuando el juego lo comprueba (telemetría, estado del mundo o una orden aceptada). Nada de lo que se haga en el tutorial paga créditos ni experiencia extra.
- Los pasos que no se pueden hacer en ese momento (p. ej. no hay piratas cerca o no hay nodriza) se explican y se pueden saltar, con un enlace a la Wiki.
- **Menú «Tutorial»** en Ajustes (y enlace desde la Wiki): lista de capítulos con su estado (sin empezar, en curso, hecho), botones Empezar, Repetir y Reiniciar todo.
- **Progreso** guardado en el navegador y en la cuenta (preferencias), reiniciable.
- Ventana pequeña y plegable del paso actual (texto, «Siguiente», «Saltar», «Salir»), sin tapar la barra de acciones.
- Textos en es/en; cada paso con su clave i18n. Datos de los capítulos en `apps/client/src/tutorial/chapters.ts` (pasos, objetivo resaltado, condición de hecho).

## Capítulos

1. **Primeros pasos**: barra superior, Wiki, Ajustes, mapa y vista de sistema.
2. **Pilotar**: arrancar motores (I), acelerar y frenar (W/S), girar (A/D, ratón), ratón atrapado y Esc/Alt, cámara (T), marchas (Z), impulso (Mayús).
3. **Crucero y órbita**: elegir destino, dial de velocidad, minimizar el aviso, orbitar un planeta, cancelar.
4. **Pulso y salto**: pulso (P) y su combustible, salto cuántico (J): alinear, cargar, túnel, salir a mitad (K), llegada.
5. **Combate**: seguro de armas, fijar blanco (X, Tab), cañón y misiles, escudo, avisos de daño, pedir ayuda.
6. **Minería y bodega**: espacio profundo, láser (L), refinería, descargar en una colonia.
7. **Planetas y colonias**: ficha del planeta, reclamar, ventana de la colonia (pestañas), construir, cola, población.
8. **Flotas**: ventana del imperio, enviar una flota, combustible, rutas, renombrar, regalar.
9. **Nodriza**: acoplarse, viaje acoplado, pilotar la nodriza, desacoplarse.
10. **Economía y humanidad**: créditos, mercado, proyectos de la humanidad, reputación.
11. **Linaje y muerte**: Cunas, Herederos, qué pasa al caer.
12. **Contratos** (cuando existan): aceptar, seguir y cobrar.

## Orden de trabajo

1. Motor del tutorial (capítulos como datos, superposición, resaltado y comprobaciones) y el menú.
2. Capítulos 1–4 (lo básico para empezar a jugar).
3. Capítulos 5–11.
4. Capítulo de contratos cuando estos existan.
