/**
 * Cadenas base de contenido en español e inglés. Especies y facciones siguen
 * docs/lore.md; los nombres de facción son provisionales.
 */
export type ContentDictionary = Readonly<Record<string, string>>;

export const contentEs: ContentDictionary = {
  // Especies y facciones (docs/lore.md)
  "species.eradicators.name": "Los Erradicadores",
  "species.eradicators.motto": "Purificación · Exterminio",
  "species.eradicators.description": "Consideran que la humanidad es un error que amenaza la estabilidad de la existencia. No buscan conquistar territorios humanos, sino impedir que los Emperadores vuelvan a levantarse: destruyen instalaciones de reconstrucción, atacan núcleos de población y persiguen toda evidencia de actividad humana.",
  "species.greys.name": "Los Grises",
  "species.greys.motto": "Orden · Control",
  "species.greys.description": "Inteligencias antiguas que pretenden someter el universo a un orden calculable. No odian a los humanos: los consideran una variable imposible de controlar. Ofrecen pactos, tecnología y protección a cambio de que los Emperadores acepten límites a su expansión.",
  "species.void_nomads.name": "Los Nómadas del Vacío",
  "species.void_nomads.motto": "Supervivencia · Libertad",
  "species.void_nomads.description": "Pueblos que viven a bordo de flotas y hábitats móviles. Desconfían de los imperios territoriales y comercian con cualquiera que respete sus rutas: socios indispensables o adversarios formidables si alguien intenta encadenarlos.",
  "species.precursors.name": "Los Precursores",
  "species.precursors.motto": "Misterio · Legado",
  "species.precursors.description": "Civilizaciones desaparecidas que dejaron estructuras imposibles, mundos artificiales y archivos incompletos. Nadie sabe si fueron una especie, muchas o algo que ya no cabe en categorías biológicas. Sus ruinas podrían guardar pistas sobre el origen de los Emperadores.",
  "species.elydri.name": "ELYDRI",
  "species.elydri.motto": "Los Testigos de la Eternidad · Nada debe olvidarse",
  "species.elydri.description": "Seres cristalinos que conservan recuerdos durante eras; sus ciudades son archivos vivientes. Para ellos, destruir el conocimiento es peor que la muerte. Desean estudiar los recuerdos de los Emperadores entre vidas. Combaten con escudos energéticos y tecnología antigua.",
  "species.tharaxi.name": "THARAXI",
  "species.tharaxi.motto": "La Marea Viviente · El individuo es prescindible",
  "species.tharaxi.description": "Una civilización colectiva unida por señales químicas y redes biológicas: unas castas piensan, otras construyen y millones combaten. La reproducción humana autónoma los fascina y quieren incorporarla a su biología. Atacan en enjambres que crecen y se adaptan.",
  "species.aurelians.name": "AURELIANOS",
  "species.aurelians.motto": "La Corona de las Mil Estrellas · El poder debe demostrarse",
  "species.aurelians.description": "Una civilización aristocrática de casas interestelares, legitimada por siglos de victorias y pactos hereditarios. Quien puede gobernar y proteger un territorio tiene derecho a reclamarlo. Ven en los Emperadores a sus rivales naturales.",
  "species.nihil.name": "NIHIL",
  "species.nihil.motto": "Los Hijos del Silencio · Toda existencia es una deuda",
  "species.nihil.description": "Organismos oscuros envueltos en campos que distorsionan la luz, en regiones de espacio extremo. Creen que reducir la existencia es misericordia y que la persistencia de los Emperadores perpetúa una deuda cósmica. Se ocultan, ciegan sensores y atacan infraestructuras.",
  "species.vesperi.name": "VESPERI",
  "species.vesperi.motto": "Los Guardianes del Hogar · La vida local es sagrada",
  "species.vesperi.description": "Civilizaciones pequeñas y diversas con defensas extraordinarias. No quieren conquistar la galaxia, sino preservar sus sistemas de origen: para ellos, las fronteras son una responsabilidad, no una propiedad.",
  "species.scavengers.name": "Carroñeros",
  "species.scavengers.motto": "Botín · Supervivencia",
  "species.scavengers.description": "Piratas de especies mezcladas que asaltan a quien se aventura fuera del Núcleo Humano. No tienen doctrina: solo hambre y oportunidad.",
  "faction.eradicators_pale_verdict.name": "El Veredicto Pálido",
  "faction.eradicators_pale_verdict.description": "Persiguen las Cunas y los núcleos de población: donde un Emperador podría renacer, ellos llegan primero.",
  "faction.greys_calculus.name": "El Cálculo",
  "faction.greys_calculus.description": "Ofrecen pactos exactos: tecnología y protección a cambio de límites medibles a tu expansión.",
  "faction.void_nomads_free_wake.name": "La Estela Libre",
  "faction.void_nomads_free_wake.description": "Caravanas que comercian con quien respete sus rutas y se vuelven implacables con quien las corte.",
  "faction.elydri_living_archive.name": "El Archivo Viviente",
  "faction.elydri_living_archive.description": "Buscan los recuerdos de los Emperadores: los consideran los archivos más valiosos del universo.",
  "faction.tharaxi_tide.name": "La Marea",
  "faction.tharaxi_tide.description": "La mente colectiva: quiere arrancarle a la humanidad el secreto de su reproducción.",
  "faction.tharaxi_severed_caste.name": "La Casta Cercenada",
  "faction.tharaxi_severed_caste.description": "Tharaxi que rompieron con la mente colectiva. Podrían aliarse con los Emperadores.",
  "faction.aurelians_house_solenne.name": "Casa Solenne",
  "faction.aurelians_house_solenne.description": "Quiere convertir a los Emperadores en vasallos de la Corona.",
  "faction.aurelians_house_varek.name": "Casa Varek",
  "faction.aurelians_house_varek.description": "Sueña con demostrar que un imperio mortal puede superar a uno inmortal, en buena lid.",
  "faction.nihil_quiet_end.name": "El Fin Callado",
  "faction.nihil_quiet_end.description": "Quieren saldar la deuda cósmica acabando con la humanidad.",
  "faction.nihil_unbinding.name": "Los Desatadores",
  "faction.nihil_unbinding.description": "Buscan una forma de liberar a los Emperadores de su condición.",
  "faction.vesperi_wardens.name": "Los Custodios",
  "faction.vesperi_wardens.description": "Protegen a las colonias humanas cercanas como si fueran propias.",
  "faction.vesperi_last_border.name": "La Última Frontera",
  "faction.vesperi_last_border.description": "Resisten hasta el final a cualquier imperio que intente absorber sus mundos.",
  "faction.scavengers_rust_tide.name": "Marea de Óxido",
  "faction.scavengers_rust_tide.description": "Bandas que acechan las rutas fuera del Núcleo Humano.",


  // Naves
  "ship.explorer.name": "Explorador",
  "ship.explorer.description":
    "Nave ligera y rápida con escáneres de largo alcance. Abre el camino hacia lo desconocido.",
  "ship.freighter.name": "Carguero",
  "ship.freighter.description":
    "Bodegas enormes y casco frágil. Sin cargueros no hay imperio; sin escolta no hay cargueros.",
  "ship.colonizer.name": "Colonizador",
  "ship.colonizer.description":
    "Una semilla de civilización en viaje lento. Se desmantela al llegar para fundar la nueva colonia.",
  "ship.frigate.name": "Fragata",
  "ship.frigate.description":
    "La espina dorsal de la flota imperial. La única nave del arsenal inicial diseñada para combatir.",
};

export const contentEn: ContentDictionary = {
  // Especies y facciones (docs/lore.md)
  "species.eradicators.name": "The Eradicators",
  "species.eradicators.motto": "Purification · Extermination",
  "species.eradicators.description": "They see humanity as an error that threatens the stability of existence. They do not seek to conquer human territory but to stop the Emperors from rising again: they destroy reconstruction facilities, strike population centres and hunt every trace of human activity.",
  "species.greys.name": "The Greys",
  "species.greys.motto": "Order · Control",
  "species.greys.description": "Ancient intelligences that seek to bring the universe under a calculable order. They do not hate humans: they consider them a variable that cannot be controlled. They offer pacts, technology and protection if the Emperors accept limits on their expansion.",
  "species.void_nomads.name": "The Void Nomads",
  "species.void_nomads.motto": "Survival · Freedom",
  "species.void_nomads.description": "Peoples who live aboard fleets and mobile habitats. They distrust territorial empires and trade with anyone who respects their routes: indispensable partners, or formidable foes to anyone who tries to chain them.",
  "species.precursors.name": "The Precursors",
  "species.precursors.motto": "Mystery · Legacy",
  "species.precursors.description": "Vanished civilizations that left impossible structures, artificial worlds and incomplete archives. No one knows whether they were one species, many, or something beyond biology. Their ruins may hold clues to the origin of the Emperors.",
  "species.elydri.name": "ELYDRI",
  "species.elydri.motto": "The Witnesses of Eternity · Nothing must be forgotten",
  "species.elydri.description": "Crystalline beings who preserve memories across ages; their cities are living archives. To them, destroying knowledge is worse than death. They wish to study the Emperors' memories between lives. They fight with energy shields and ancient technology.",
  "species.tharaxi.name": "THARAXI",
  "species.tharaxi.motto": "The Living Tide · The individual is expendable",
  "species.tharaxi.description": "A collective civilization bound by chemical signals and biological networks: some castes think, others build, millions fight. Autonomous human reproduction fascinates them and they want it for their own biology. They attack in swarms that grow and adapt.",
  "species.aurelians.name": "AURELIANS",
  "species.aurelians.motto": "The Crown of a Thousand Stars · Power must be proven",
  "species.aurelians.description": "An aristocratic civilization of interstellar houses, legitimised by centuries of victories and hereditary pacts. Whoever can rule and protect a territory has the right to claim it. They see the Emperors as their natural rivals.",
  "species.nihil.name": "NIHIL",
  "species.nihil.motto": "The Children of Silence · All existence is a debt",
  "species.nihil.description": "Dark organisms wrapped in light-bending fields, dwelling in extreme regions of space. They believe that reducing existence is mercy and that the Emperors' persistence perpetuates a cosmic debt. They hide, blind sensors and strike infrastructure.",
  "species.vesperi.name": "VESPERI",
  "species.vesperi.motto": "The Guardians of Home · Local life is sacred",
  "species.vesperi.description": "Small, diverse civilizations with extraordinary defences. They do not want the galaxy; they want to preserve their home systems. To them, borders are a responsibility, not a property.",
  "species.scavengers.name": "Scavengers",
  "species.scavengers.motto": "Plunder · Survival",
  "species.scavengers.description": "Pirates of mixed species who prey on anyone venturing beyond the Human Core. They have no doctrine: only hunger and opportunity.",
  "faction.eradicators_pale_verdict.name": "The Pale Verdict",
  "faction.eradicators_pale_verdict.description": "They hunt Cradles and population centres: wherever an Emperor could be reborn, they arrive first.",
  "faction.greys_calculus.name": "The Calculus",
  "faction.greys_calculus.description": "They offer exact pacts: technology and protection in exchange for measurable limits on your expansion.",
  "faction.void_nomads_free_wake.name": "The Free Wake",
  "faction.void_nomads_free_wake.description": "Caravans that trade with anyone who respects their routes and turn relentless against those who cut them.",
  "faction.elydri_living_archive.name": "The Living Archive",
  "faction.elydri_living_archive.description": "They seek the Emperors' memories, the most valuable archives in the universe.",
  "faction.tharaxi_tide.name": "The Tide",
  "faction.tharaxi_tide.description": "The hive mind: it wants to tear the secret of reproduction from humanity.",
  "faction.tharaxi_severed_caste.name": "The Severed Caste",
  "faction.tharaxi_severed_caste.description": "Tharaxi who broke away from the hive mind. They could ally with the Emperors.",
  "faction.aurelians_house_solenne.name": "House Solenne",
  "faction.aurelians_house_solenne.description": "It wants to make the Emperors vassals of the Crown.",
  "faction.aurelians_house_varek.name": "House Varek",
  "faction.aurelians_house_varek.description": "It dreams of proving, fairly, that a mortal empire can surpass an immortal one.",
  "faction.nihil_quiet_end.name": "The Quiet End",
  "faction.nihil_quiet_end.description": "They would settle the cosmic debt by ending humanity.",
  "faction.nihil_unbinding.name": "The Unbinding",
  "faction.nihil_unbinding.description": "They seek a way to free the Emperors from their condition.",
  "faction.vesperi_wardens.name": "The Wardens",
  "faction.vesperi_wardens.description": "They protect nearby human colonies as if they were their own.",
  "faction.vesperi_last_border.name": "The Last Border",
  "faction.vesperi_last_border.description": "They resist to the end any empire that tries to absorb their worlds.",
  "faction.scavengers_rust_tide.name": "Rust Tide",
  "faction.scavengers_rust_tide.description": "Bands that stalk the routes beyond the Human Core.",


  // Ships
  "ship.explorer.name": "Explorer",
  "ship.explorer.description":
    "A light, fast ship with long-range scanners. It opens the way into the unknown.",
  "ship.freighter.name": "Freighter",
  "ship.freighter.description":
    "Huge holds and a fragile hull. Without freighters there is no empire; without escorts there are no freighters.",
  "ship.colonizer.name": "Colonizer",
  "ship.colonizer.description":
    "A seed of civilization on a slow voyage. It is dismantled on arrival to found the new colony.",
  "ship.frigate.name": "Frigate",
  "ship.frigate.description":
    "The backbone of the imperial fleet. The only ship in the starting arsenal built to fight.",
};

export type ContentLocale = "es" | "en";

export const contentDictionaries: Readonly<Record<ContentLocale, ContentDictionary>> = {
  es: contentEs,
  en: contentEn,
};
