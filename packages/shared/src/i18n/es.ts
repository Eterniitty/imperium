/**
 * Textos base en español. Es el idioma de referencia: cualquier clave nueva
 * se añade aquí primero. Las traducciones comunitarias (Fase 4+) sobrescriben
 * estas claves por prioridad: personal > organización > pública > base.
 */
export const es = {
  "app.title": "AEONARCH",
  "app.subtitle": "La guerra no termina. La humanidad tampoco.",
  "app.prototype": "Prototipo · Fase 3",

  "start.enter": "Despertar",
  "start.hint": "Generación local del universo · sin servidor todavía",

  "hud.sector": "Sector",
  "hud.position": "Posición",
  "hud.systems": "Sistemas cargados",
  "hud.fps": "FPS",
  "hud.goto": "Ir",
  "hud.gotoTitle": "Viajar a un sector",
  "hud.language": "Idioma",
  "hud.modeFlight": "Vuelo",
  "hud.modeOrbit": "Órbita",
  "hud.modeTitle": "Cambiar entre vista de órbita y vuelo de nave (V)",
  "flight.speed": "Velocidad",
  "flight.hint": "Arrastra para orientar la nave · W acelerar · Mayús impulso",

  "server.label": "Servidor",
  "server.online": "En línea",
  "server.offline": "Sin conexión",
  "server.title": "Estado de la conexión con el servidor",

  "view.galaxy": "Mapa estelar",
  "view.system": "Sistema",
  "view.back": "Volver al mapa",

  "system.unexplored": "Sin explorar",
  "system.class": "Clase estelar",
  "system.distance": "Distancia",
  "system.coords": "Coordenadas",
  "system.energy": "Energía estelar",
  "system.planets": "Planetas",
  "system.belts": "Cinturones de asteroides",
  "system.anomaly": "Anomalía",
  "system.none": "Ninguno",
  "system.focus": "Centrar",
  "system.enter": "Entrar en el sistema",
  "system.close": "Cerrar",
  "system.moons": "lunas",
  "system.moonCount": "Lunas",
  "system.habitability": "Habitabilidad",
  "system.orbit": "Órbita",
  "system.radius": "Radio",
  "system.selectHint": "Selecciona un sistema para inspeccionarlo.",
  "system.planetHint": "Haz clic en un planeta para ver sus recursos.",

  "unit.ly": "a.l.",
  "unit.au": "UA",
  "unit.earth": "R⊕",

  "star.O": "Gigante azul (O)",
  "star.B": "Estrella azul (B)",
  "star.A": "Estrella blanca (A)",
  "star.F": "Estrella blanco-amarilla (F)",
  "star.G": "Enana amarilla (G)",
  "star.K": "Enana naranja (K)",
  "star.M": "Enana roja (M)",
  "star.RG": "Gigante roja",
  "star.WD": "Enana blanca",
  "star.NS": "Estrella de neutrones",
  "star.BH": "Agujero negro",

  "planet.lava": "Mundo de lava",
  "planet.barren": "Roca estéril",
  "planet.rocky": "Mundo rocoso",
  "planet.desert": "Mundo desértico",
  "planet.ocean": "Mundo oceánico",
  "planet.toxic": "Mundo tóxico",
  "planet.ice": "Mundo helado",
  "planet.gas_giant": "Gigante gaseoso",
  "planet.ice_giant": "Gigante helado",

  "resource.metal": "Metal",
  "resource.volatiles": "Volátiles",
  "resource.crystal": "Cristal raro",
  "resource.energy": "Energía",

  "anomaly.ruins": "Ruinas de origen desconocido",
  "anomaly.derelict": "Pecio a la deriva",
  "anomaly.rift": "Grieta espacial",
  "anomaly.nebula": "Bolsa nebular",

  "help.title": "Controles",
  "help.rotate": "Arrastrar con botón derecho o izquierdo: girar",
  "help.pan": "Arrastrar con botón central / Mayús+arrastrar: desplazar",
  "help.zoom": "Rueda: acercar / alejar",
  "help.move": "W A S D: avanzar por el espacio · Q / E: bajar / subir",
  "help.boost": "Mayús: viaje rápido",
  "help.select": "Clic: seleccionar · Doble clic o Intro: entrar",
  "help.focus": "F: centrar selección · Esc: volver / deseleccionar",
  "help.flightToggle": "V: alternar modo vuelo (nave) / órbita",
  "help.flightLook": "Vuelo: arrastrar para orientar · flechas: girar · Q / E: alabeo",
  "help.flightMove": "Vuelo: W / S avanzar / frenar · A / D lateral · Espacio / C subir / bajar",

  "legend.title": "Clases estelares",
} as const;

export type I18nKey = keyof typeof es;
