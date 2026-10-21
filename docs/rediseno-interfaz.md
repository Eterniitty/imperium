# Rediseño de la interfaz (plan, 21-10-2026)

Petición del usuario: interfaz más profesional y pulida, con animaciones; un
menú principal serio; y **no asignar teclas al azar**: no todo tiene que tener
tecla.

## 1. Política de teclas

Solo llevan tecla por defecto las acciones que se usan **constantemente con
las manos en los mandos**. Todo lo demás es un **botón visible** en el sitio
donde tiene sentido (y se puede asignar tecla en Ajustes → Controles, sin
tecla por defecto).

| Grupo | Con tecla por defecto |
|---|---|
| Vuelo | W/S empuje, A/D lateral, Espacio/C subir/bajar, Q/E alabeo, flechas (giro con teclado), Mayús (impulso) |
| Combate | clic izquierdo (disparar), 1/2/3 (arma), R (misil), X (fijar blanco), Tab (siguiente blanco) |
| Nave | I (motores), P (pulso), J (salto), T (cámara cabina/exterior) |
| Interfaz | M (mapa), Esc (menú / cerrar), Intro (confirmar) |

Pasan a **botón** (sin tecla por defecto): asistencia de vuelo, modo del ratón,
recentrar cámara, fuego automático, blanco anterior y más cercano, minería,
crucero, seguir, acoplar, salir del túnel. Cada uno en su panel: barra de
acciones del vuelo, panel de combate, panel de minería, panel de crucero,
panel del túnel.

## 2. Sistema de diseño

- **Fichas de diseño** (variables CSS): colores (fondo, panel, línea, texto,
  apagado, dorado de acento, cian de información, rojo de peligro), espaciado
  (4/8/12/16/24), radios, sombras y tipografía (display y texto).
- **Componentes**: panel con cabecera (título, acciones, cerrar), botón
  principal / secundario / fantasma / peligro, interruptor, pestañas,
  deslizador, insignia de tecla (`<kbd>`), barra de progreso, aviso.
- **Iconos** propios en SVG en línea (sin dependencias externas: la CSP es estricta).

## 3. Menú (Esc)

Ventana a pantalla completa con fondo desenfocado: **Continuar · Ajustes ·
Controles · Cuenta · Wiki · Créditos y legal · Salir al mapa**. Ajustes por
pestañas (Gráficos, Sonido, Vuelo, Controles, Accesibilidad, Cuenta), con
vista previa de cada cambio y «restablecer».

## 4. HUD

Zonas fijas: barra superior (imperio), columna izquierda (estado de la nave),
columna derecha (blanco y armas), abajo en el centro (velocidad e
instrumentos) y **barra de acciones contextual** (motores, pulso, asistencia,
crucero, acoplar, minar… solo las que tienen sentido en ese momento, con su
tecla si la tienen).

## 5. Animaciones

Transiciones de 150–250 ms (aparecer/desaparecer paneles, pestañas, avisos),
sin destellos; respetan `prefers-reduced-motion` y «Reducir efectos».

## Fases

1. **U1** Política de teclas y barra de acciones del vuelo.
2. **U2** Fichas de diseño y componentes; pasar los paneles existentes.
3. **U3** Menú con Esc y Ajustes por pestañas.
4. **U4** HUD por zonas y animaciones.
5. **U5** Mapa galáctico y paneles del imperio con el nuevo estilo.
