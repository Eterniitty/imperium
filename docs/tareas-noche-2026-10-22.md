# Noche del 22-10-2026 (trabajo autónomo)

Todo desplegado en el servidor. Ninguna de estas cosas se ha probado jugando:
solo comprobación de tipos, capturas con un navegador automático y un repaso de
la consola (sin errores de JavaScript).

## Pendiente de ti

- **Galaxia de ~30 000 estrellas**: está lista, pero reinicia el mundo y el
  revisor del modo automático no me deja vaciar la base. Cuando quieras:
  `! ./scripts/galaxia-30k.sh --si` (hace copias, cambia la galaxia, vacía las
  tablas del juego conservando cuentas y Wiki, y despliega). Con ella el salto
  llega a ~400 a.l. y los viajes van ×3, porque las estrellas quedan a ~135 a.l.

## Hecho esta noche

### Galaxia, cielo y vista
- Galaxia espiral de 30 000 a.l. (4 brazos, bulbo) con **Ónfalo**, agujero
  negro supermasivo en el centro (horizonte como tres soles, zona mortal ×6).
- Mapa galáctico: alejando se ve la galaxia entera, con el rótulo de Ónfalo.
- Cielo propio de cada sistema (nebulosas de colores, Vía Láctea más brillante
  hacia el centro, galaxias lejanas), siempre el mismo al volver.
- Luz de relleno y reflejos suaves en las naves; cámara de persecución más
  baja y cercana; cabina (T) rehecha y transición suave entre cabina y exterior.
- Modelos: insignia con superestructura, faldones, quilla y anillos; nodriza
  con cascos laterales y boca de hangar; naves orgánicas (tharaxi) con espinas,
  venas, mandíbulas y tentáculos; arca nómada con carga; miniaturas más grandes.

### Juego
- **Astillero** (editor de naves): diseñar por piezas, ver estadísticas,
  problemas, coste y la nave; construir en colonias (astillero / dique);
  las piezas mandan en el combate (rondas y tiempo real), viajes, combustible,
  escáner y pilotaje. Casco de **nave nodriza** para diseñarla con sus módulos.
- **Combustible por nave de flota**: alcance por nave, reposta sola en colonias
  propias (volátiles) o con «Repostar».
- **Fabricación**: Fábrica, 6 componentes con recetas y cadenas; las piezas
  avanzadas los piden; se llevan en las bodegas de las flotas.
- **Tecnología**: 5 ramas × 5 niveles (créditos y tiempo); mejora combate,
  viajes y construcción y desbloquea piezas.
- **Comandantes**: los Herederos pueden mandar una flota (bonificación según
  su doctrina).
- **Reputación** ante la humanidad: decide los pactos con la IA y si la milicia
  acude a tu petición de ayuda.
- **Metas**: prestigio, clasificación, objetivos de la era, **crisis
  galácticas** (anunciadas en la barra superior) y **leyendas de la era**.
- **Escolta en crucero** opcional («Pulso: conmigo / esperan»), escolta más
  pegada y sin rótulos; la nodriza sale en la lista del crucero (N).
- El crucero y la órbita siguen con la pestaña oculta.
- Pulso a 5000 km/s; «Servidor: N en línea» junta jugadores e IA.
- El servidor ya no se queda 90 s caído al reiniciarse.

## Lo que queda

- Vender componentes en el mercado.
- Dibujo propio de cada pieza del Astillero (ahora: forma de la clase base con
  los detalles de sus piezas).
- 9c (combate a gran escala), aplazado.
