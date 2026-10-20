import type { SpeciesDefinition } from "./types";

/**
 * Los seis arquetipos alienígenas. Los nombres son provisionales: el lore
 * definitivo llegará después y solo cambiará las cadenas i18n.
 */
export const SPECIES: readonly SpeciesDefinition[] = [
  {
    // Hordas: biológicas, brutales, muy prolíficas; enjambres baratos, abordajes y saqueo.
    id: "horde",
    nameKey: "species.horde.name",
    descriptionKey: "species.horde.description",
    nature: "biological",
    doctrine: "swarm_assault",
    expansion: "fast_fragile",
    stance: "plunder",
    economy: { preferredResources: ["metal", "volatiles"] },
    geography: {
      preferredStarClasses: ["K", "M", "G"],
      preferredPlanetTypes: ["desert", "rocky", "toxic"],
      anomalyAffinity: 0.1,
    },
    traits: { aggression: 0.95, expansionRate: 0.85, techLevel: 0.25, numbers: 0.95, resilience: 0.4 },
    rivals: ["ancients", "machines"],
    visual: {
      silhouette: "brutalist_scrap",
      primaryColor: "#5a6b2e",
      secondaryColor: "#8a3b1f",
      emissiveColor: "#ff6a1a",
    },
    playable: false,
    enabledInMvp: true,
  },
  {
    // Antiguos: longevos, escasos, tecnología muy superior; defienden sus mundos.
    id: "ancients",
    nameKey: "species.ancients.name",
    descriptionKey: "species.ancients.description",
    nature: "biological",
    doctrine: "fortified_defense",
    expansion: "static",
    stance: "territorial",
    economy: { preferredResources: ["crystal", "energy"] },
    geography: {
      preferredStarClasses: ["A", "F", "G"],
      preferredPlanetTypes: ["ocean", "rocky"],
      anomalyAffinity: 0.5,
    },
    traits: { aggression: 0.3, expansionRate: 0.1, techLevel: 0.95, numbers: 0.1, resilience: 0.9 },
    rivals: ["horde", "machines"],
    visual: {
      silhouette: "crystalline",
      primaryColor: "#e8eef5",
      secondaryColor: "#c9a94a",
      emissiveColor: "#7fe0ff",
    },
    playable: false,
    enabledInMvp: false,
  },
  {
    // Máquinas: sintéticas autorreplicantes, sin moral ni retirada; consumen metal.
    id: "machines",
    nameKey: "species.machines.name",
    descriptionKey: "species.machines.description",
    nature: "mechanical",
    doctrine: "precision_strike",
    expansion: "slow_solid",
    stance: "exterminate",
    economy: { preferredResources: ["metal", "energy"] },
    geography: {
      preferredStarClasses: ["M", "WD", "NS"],
      preferredPlanetTypes: ["barren", "lava", "ice"],
      anomalyAffinity: 0.2,
    },
    traits: { aggression: 0.8, expansionRate: 0.55, techLevel: 0.75, numbers: 0.65, resilience: 0.85 },
    rivals: ["horde", "ancients", "ethereals"],
    visual: {
      silhouette: "geometric",
      primaryColor: "#2b2f36",
      secondaryColor: "#8c939c",
      emissiveColor: "#ff2b2b",
    },
    playable: false,
    enabledInMvp: true,
  },
  {
    // Enjambre: biología colectiva que asimila mundos enteros.
    id: "swarm",
    nameKey: "species.swarm.name",
    descriptionKey: "species.swarm.description",
    nature: "biological",
    doctrine: "assimilation",
    expansion: "fast_fragile",
    stance: "assimilate",
    economy: { preferredResources: ["volatiles", "metal"] },
    geography: {
      preferredStarClasses: ["G", "K", "F"],
      preferredPlanetTypes: ["ocean", "toxic", "rocky"],
      anomalyAffinity: 0.15,
    },
    traits: { aggression: 0.7, expansionRate: 0.9, techLevel: 0.4, numbers: 0.9, resilience: 0.5 },
    rivals: ["ethereals", "ancients"],
    visual: {
      silhouette: "organic",
      primaryColor: "#4a1f3d",
      secondaryColor: "#b5a36a",
      emissiveColor: "#b8ff3a",
    },
    playable: false,
    enabledInMvp: false,
  },
  {
    // Etéreos: seres de energía y mente que habitan cerca de anomalías; sabotaje.
    id: "ethereals",
    nameKey: "species.ethereals.name",
    descriptionKey: "species.ethereals.description",
    nature: "energy",
    doctrine: "guerrilla",
    expansion: "nomadic",
    stance: "dominate",
    economy: { preferredResources: ["energy", "crystal"] },
    geography: {
      preferredStarClasses: ["O", "B", "NS", "BH"],
      preferredPlanetTypes: ["gas_giant", "ice_giant"],
      anomalyAffinity: 0.95,
    },
    traits: { aggression: 0.45, expansionRate: 0.3, techLevel: 0.85, numbers: 0.2, resilience: 0.6 },
    rivals: ["machines", "swarm"],
    visual: {
      silhouette: "ethereal",
      primaryColor: "#2a1a5e",
      secondaryColor: "#6fd3ff",
      emissiveColor: "#d58cff",
    },
    playable: false,
    enabledInMvp: false,
  },
  {
    // Carroñeros: mezcla de especies, piratas que atacan rutas de suministro.
    id: "scavengers",
    nameKey: "species.scavengers.name",
    descriptionKey: "species.scavengers.description",
    nature: "hybrid",
    doctrine: "raiding",
    expansion: "nomadic",
    stance: "plunder",
    economy: { preferredResources: ["volatiles", "metal", "crystal"] },
    geography: {
      preferredStarClasses: ["M", "K", "RG"],
      preferredPlanetTypes: ["barren", "ice", "desert"],
      anomalyAffinity: 0.35,
    },
    traits: { aggression: 0.6, expansionRate: 0.4, techLevel: 0.5, numbers: 0.5, resilience: 0.35 },
    rivals: ["horde"],
    visual: {
      silhouette: "angular",
      primaryColor: "#6b5a44",
      secondaryColor: "#2e4a52",
      emissiveColor: "#ffd23a",
    },
    playable: false,
    enabledInMvp: false,
  },
];

/** Busca una especie por id. */
export function getSpecies(id: string): SpeciesDefinition | undefined {
  return SPECIES.find((s) => s.id === id);
}

/** Especies activas en el MVP. */
export function mvpSpecies(): SpeciesDefinition[] {
  return SPECIES.filter((s) => s.enabledInMvp);
}
