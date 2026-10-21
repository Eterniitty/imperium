# Tareas de la noche (21-10-2026, ~05:15 → ~12:15)

Petición del usuario: como máximo dos agentes a la vez, trabajar ~7 horas sin él. Sudo permitido
si antes se hace copia de seguridad (una por cambio grande, no por cada cambio). Copias en
`~/backups/aeonarch/` (base de datos) y `~/backups/aeonarch/proyecto/` (código, sin node_modules).

Copia inicial: `proyecto/imperium-20261021-051653-antes-noche.tar.gz` + `imperium-20261021-051654-antes-noche.dump`.

## Agente 1 (árbol principal)
1. [ ] Cerrar Fase 9a (combate de flotas por rondas e intercepción) y commit.
2. [ ] Colonias independientes al borrar una cuenta y commit.
3. [ ] Tipos de nave nuevos y mejorados para humanos y Carroñeros (datos en `packages/content`,
       modelos procedurales en el cliente, uso por la IA de Carroñeros y en construcción de colonias).
       Empieza después de fusionar el pilotaje (comparte `shipModel.ts`).

## Agente 2 (rama `worktree-agent-a3b0fc1f726a359e1`)
1. [ ] Pulso estilo supercrucero (activable junto a planetas, velocidad según distancia, sin brusquedad).
2. [ ] Nave detallada; disparos desde cañones y lanzadores; misiles y explosiones mejores.
3. [ ] Flotar en reposo y orbitar la estrella cuando está aparcada (determinista, servidor lo conoce).
4. [ ] Cabina tipo Battlefield: munición, misiles, energía, combustible, escudos, casco (recursos del servidor).
5. [ ] Viaje cuántico entre sistemas (minutos a ~40 min), unificado con `emperor.move`.

## Después (orquestador)
- [ ] Copia de seguridad → fusionar rama de pilotaje en `main`, typecheck y `pnpm test`.
- [ ] Ventana de ayuda detallada (economía con números reales, controles, combate, logística, lore,
      pilotaje nuevo). Se paró para respetar el límite de dos agentes; se relanza al quedar un hueco.
- [ ] Tipos de nave (ver Agente 1, punto 3).
- [ ] `pnpm build`, `pnpm e2e` completo (cierre de fase y cambios en motor 3D), revisar capturas.
- [ ] Copia de seguridad de la base de producción → desplegar servidor y cliente.
- [ ] Actualizar CLAUDE.md y este archivo con el resultado.

## Ampliación del usuario (05:25): seguir mejorando el juego sin esperar órdenes
En orden, siempre de dos en dos agentes, con copia antes de cada cambio grande:
- [ ] **Wiki** (se llama «Wiki», no «Ayuda»): página propia y separada del juego (ruta `/wiki`,
      también enlazada desde la barra superior), con todo detallado: controles, pilotaje, combate,
      economía, logística, guerra, especies, IA, lore. Se actualiza con cada sistema nuevo.
- [ ] **Economía de la humanidad y global**: además de la de cada colonia, una economía de toda la
      humanidad (agregados, impuestos/aportes al Núcleo Humano, proyectos comunes) y un mercado
      global entre jugadores e IA (precios por oferta y demanda, comercio entre sistemas).
- [ ] **Otras especies** del lore (`docs/lore.md` §V) como datos en `packages/content`, con naves,
      territorios y comportamiento propios.
- [ ] **Otras IA**: facciones alienígenas y Emperadores humanos de la IA (Fase 11 + 9d, `docs/ia-naves.md`).
- [ ] Fases siguientes de la hoja de ruta: 9b (conquista), 9c, 10 (muerte y linaje).
