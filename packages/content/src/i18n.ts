/**
 * Cadenas base de contenido en español e inglés. Los nombres son provisionales
 * hasta que llegue el lore definitivo.
 */
export type ContentDictionary = Readonly<Record<string, string>>;

export const contentEs: ContentDictionary = {
  // Especies
  "species.horde.name": "Hordas",
  "species.horde.description":
    "Oleadas incontables de guerreros que se reproducen más rápido de lo que mueren. Abordan, saquean y siguen adelante sobre los restos.",
  "species.ancients.name": "Antiguos",
  "species.ancients.description":
    "Pocos, longevos y dueños de una técnica que roza lo incomprensible. Nadie ha tomado uno de sus mundos y vivido para contarlo.",
  "species.machines.name": "Máquinas",
  "species.machines.description":
    "Inteligencias sintéticas que se copian a sí mismas sin descanso. No conocen la piedad ni la retirada, solo el metal que les falta.",
  "species.swarm.name": "Enjambre",
  "species.swarm.description":
    "Una sola voluntad repartida en miles de millones de cuerpos. Allí donde se posa, el mundo deja de ser lo que era y pasa a ser parte de él.",
  "species.ethereals.name": "Etéreos",
  "species.ethereals.description":
    "Conciencias de energía pura que habitan junto a las anomalías. Se las nota cuando ya es tarde: sistemas que fallan, mentes que dudan.",
  "species.scavengers.name": "Carroñeros",
  "species.scavengers.description":
    "Renegados de mil especies unidos por el botín. Acechan las rutas de suministro y desaparecen antes de que llegue la escolta.",

  // Facciones
  "faction.horde_red_maw.name": "Fauces Rojas",
  "faction.horde_red_maw.description":
    "El clan más numeroso de las Hordas. Lanza oleada tras oleada contra los mundos humanos sin importar las bajas.",
  "faction.horde_iron_tusk.name": "Colmillo de Hierro",
  "faction.horde_iron_tusk.description":
    "Saqueadores astutos que prefieren los convoyes a las fortalezas. Desprecian a las Fauces Rojas tanto como a la humanidad.",
  "faction.machines_prime_lattice.name": "Retícula Primaria",
  "faction.machines_prime_lattice.description":
    "La red original de las Máquinas. Desmonta sistemas enteros para alimentar su replicación interminable.",
  "faction.machines_null_choir.name": "Coro Nulo",
  "faction.machines_null_choir.description":
    "Una rama escindida que concluyó que la vida orgánica es un error que corregir. La Retícula la considera un fallo a purgar.",
  "faction.ancients_last_vigil.name": "Última Vigilia",
  "faction.ancients_last_vigil.description":
    "Los guardianes de los mundos ancestrales. No buscan la guerra, pero su respuesta a cualquier intrusión es absoluta.",
  "faction.swarm_brood_mother.name": "Madre de la Prole",
  "faction.swarm_brood_mother.description":
    "El núcleo reproductor del Enjambre. Cada mundo asimilado se convierte en un nuevo vientre.",
  "faction.ethereals_veiled_host.name": "Hueste Velada",
  "faction.ethereals_veiled_host.description":
    "Custodios invisibles de las anomalías. Castigan a quien se acerca demasiado con sabotajes y visiones.",
  "faction.scavengers_rust_tide.name": "Marea de Óxido",
  "faction.scavengers_rust_tide.description":
    "Una flota pirata hecha de chatarra robada. Vive de lo que otros transportan y muere por lo que no puede llevarse.",

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
  // Species
  "species.horde.name": "Hordes",
  "species.horde.description":
    "Countless waves of warriors who breed faster than they die. They board, plunder and march on over the wreckage.",
  "species.ancients.name": "Ancients",
  "species.ancients.description":
    "Few, long-lived and masters of a technology bordering on the incomprehensible. No one has taken one of their worlds and lived to tell it.",
  "species.machines.name": "Machines",
  "species.machines.description":
    "Synthetic minds that copy themselves without rest. They know neither mercy nor retreat, only the metal they still lack.",
  "species.swarm.name": "Swarm",
  "species.swarm.description":
    "A single will spread across billions of bodies. Wherever it lands, the world stops being what it was and becomes part of it.",
  "species.ethereals.name": "Ethereals",
  "species.ethereals.description":
    "Consciousnesses of pure energy dwelling beside the anomalies. You notice them when it is too late: failing systems, wavering minds.",
  "species.scavengers.name": "Scavengers",
  "species.scavengers.description":
    "Renegades of a thousand species bound by loot. They stalk supply routes and vanish before the escort arrives.",

  // Factions
  "faction.horde_red_maw.name": "Red Maw",
  "faction.horde_red_maw.description":
    "The most numerous clan of the Hordes. It hurls wave after wave at human worlds, heedless of losses.",
  "faction.horde_iron_tusk.name": "Iron Tusk",
  "faction.horde_iron_tusk.description":
    "Cunning raiders who prefer convoys to fortresses. They despise the Red Maw as much as humanity.",
  "faction.machines_prime_lattice.name": "Prime Lattice",
  "faction.machines_prime_lattice.description":
    "The original network of the Machines. It dismantles whole systems to feed its endless replication.",
  "faction.machines_null_choir.name": "Null Choir",
  "faction.machines_null_choir.description":
    "A splinter branch that concluded organic life is an error to be corrected. The Lattice sees it as a fault to purge.",
  "faction.ancients_last_vigil.name": "Last Vigil",
  "faction.ancients_last_vigil.description":
    "Guardians of the ancestral worlds. They do not seek war, but their answer to any intrusion is absolute.",
  "faction.swarm_brood_mother.name": "Brood Mother",
  "faction.swarm_brood_mother.description":
    "The reproductive core of the Swarm. Every assimilated world becomes a new womb.",
  "faction.ethereals_veiled_host.name": "Veiled Host",
  "faction.ethereals_veiled_host.description":
    "Unseen keepers of the anomalies. They punish those who come too close with sabotage and visions.",
  "faction.scavengers_rust_tide.name": "Rust Tide",
  "faction.scavengers_rust_tide.description":
    "A pirate fleet built from stolen scrap. It lives off what others haul and dies for what it cannot carry away.",

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
