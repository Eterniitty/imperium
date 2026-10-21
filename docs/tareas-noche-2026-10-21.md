# Tareas de la noche (21-10-2026, ~05:15 → ~12:15)

Petición del usuario: como máximo dos agentes a la vez, trabajar ~7 horas sin él. Sudo permitido
si antes se hace copia de seguridad (una por cambio grande, no por cada cambio). Copias en
`~/backups/aeonarch/` (base de datos) y `~/backups/aeonarch/proyecto/` (código, sin node_modules).

Copia inicial: `proyecto/imperium-20261021-051653-antes-noche.tar.gz` + `imperium-20261021-051654-antes-noche.dump`.

## Agente 1 (árbol principal)
1. [x] Cerrar Fase 9a (combate de flotas por rondas e intercepción) y commit (`c4640f7`).
2. [x] Colonias independientes al borrar una cuenta y commit (`8be8a4f`).
3. [x] Tipos de nave nuevos y mejorados para humanos y Carroñeros (datos en `packages/content`,
       modelos procedurales en el cliente, uso por la IA de Carroñeros y en construcción de colonias).
       Empieza después de fusionar el pilotaje (comparte `shipModel.ts`).

## Agente 2 (rama `worktree-agent-a3b0fc1f726a359e1`)
1. [x] Pulso estilo supercrucero (activable junto a planetas, velocidad según distancia, sin brusquedad).
2. [x] Nave detallada; disparos desde cañones y lanzadores; misiles y explosiones mejores.
3. [x] Flotar en reposo y orbitar la estrella cuando está aparcada (determinista, servidor lo conoce).
4. [x] Cabina tipo Battlefield: munición, misiles, energía, combustible, escudos, casco (recursos del servidor).
5. [x] Viaje cuántico entre sistemas (minutos a ~40 min), unificado con `emperor.move`.
6. [x] Volumen de efectos aparte de la música y sonidos del combate; `pnpm e2e` completo pasado (se arregló el
       desbordamiento de la barra superior con la escala de la interfaz). Fusionado en `main` con avance rápido:
       migraciones 0013 (aparcamiento) y 0014 (recursos de la nave), `PROTOCOL_VERSION` 8, guía en
       `docs/ayuda-pilotaje.md` y artículo «Pilotar» de la Wiki al día.

## Después (orquestador)
- [x] Fusionar rama de pilotaje en `main`, typecheck y `pnpm test` (lo hizo el agente 2; la copia de seguridad, pendiente del orquestador).
- [x] Ventana de ayuda detallada (sustituida por la Wiki, ver abajo) (economía con números reales, controles, combate, logística, lore,
      pilotaje nuevo). Se paró para respetar el límite de dos agentes; se relanza al quedar un hueco.
- [x] Tipos de nave (ver Agente 1, punto 3). Hecho: 12 clases humanas (dique orbital nuevo), 6 de Carroñeros con
      peligro por anillo, generador 3D paramétrico con LOD para humanos, Carroñeros y alienígenas, bocas de fuego como
      datos, batallas por rondas en 3D, miniaturas, Wiki («Naves humanas», «Carroñeros», «Naves alienígenas»).
- [ ] `pnpm build`, `pnpm e2e` completo (cierre de fase y cambios en motor 3D), revisar capturas.
- [ ] Copia de seguridad de la base de producción → desplegar servidor y cliente.
- [ ] Actualizar CLAUDE.md y este archivo con el resultado.

## Ampliación del usuario (05:25): seguir mejorando el juego sin esperar órdenes
En orden, siempre de dos en dos agentes, con copia antes de cada cambio grande:
- [x] **Wiki** (se llama «Wiki», no «Ayuda»): página propia y separada del juego (ruta `/wiki`,
      también enlazada desde la barra superior), con todo detallado: controles, pilotaje, combate,
      economía, logística, guerra, especies, IA, lore. Se actualiza con cada sistema nuevo.
      Hecha: `/wiki` y `/wiki/<tema>/` (16 artículos es/en, tablas generadas desde `packages/content`,
      buscador, móvil); regla añadida en CLAUDE.md. El artículo «Pilotar» se ampliará al fusionar el pilotaje nuevo.
- [x] **Economía de la humanidad y global**: además de la de cada colonia, una economía de toda la
      humanidad (agregados, impuestos/aportes al Núcleo Humano, proyectos comunes) y un mercado
      global entre jugadores e IA (precios por oferta y demanda, comercio entre sistemas).
      Hecha: créditos por población, tesoro del Núcleo (10 %), 4 proyectos comunes, mercado con libro
      de órdenes y envíos según la distancia, paneles «Humanidad»/«Mercado», Wiki (`humanidad`, `mercado`),
      migración 0011. La IA en el mercado queda para la Fase 11.
- [x] **Otras especies** del lore (`docs/lore.md` §V) como datos en `packages/content`, con naves,
      territorios y comportamiento propios. Hecho: territorio, flotas, IA, filosofía y actitud por especie,
      19 naves alienígenas (`aliens.ts`, con datos para el modelo 3D), capa de territorio determinista y
      secreta en procgen (sin subir `GENERATOR_VERSION`), halos en el mapa respetando la niebla, presencia
      alienígena en sistemas, flotas y «Batallas», Wiki («Especies» e «IA y territorios»). Migración 0012.
- [x] **Otras IA**: facciones alienígenas y Emperadores humanos de la IA (Fase 11; `docs/ia-naves.md` §6b).
      Hecho: `AlienService` (regiones que despiertan, guarnición, patrullas, expansión, respuesta a intrusos,
      rencor y tributos, Nómadas en el mercado) y `AiEmperorService` (colonizan, construyen, exploran,
      comercian). Pendiente: IA de pilotaje 3D (9d), modelos 3D alienígenas (tras fusionar el pilotaje),
      guerra de los Emperadores IA, ataques a colonias (9b).
- [ ] Fases siguientes de la hoja de ruta: 9b (conquista), 9c, 10 (muerte y linaje).
