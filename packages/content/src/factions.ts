import type { FactionDefinition, SpeciesTraits } from "./types";
import { getSpecies } from "./species";

/**
 * Facciones: grupos concretos de cada especie (docs/lore.md). Una misma
 * especie puede estar dividida: los Tharaxi tienen una casta disidente que
 * podría aliarse con los jugadores; los NIHIL, unos que quieren acabar con la
 * humanidad y otros que buscan liberar a los Emperadores; los Aurelianos, casas
 * que quieren vasallos y casas que buscan superarlos; los VESPERI, protectores
 * de colonias humanas y resistentes ante quien quiera absorberlos. Los nombres
 * de las facciones son provisionales. Los Precursores, desaparecidos, no tienen.
 */
export const FACTIONS: readonly FactionDefinition[] = [
  {
    id: "eradicators_pale_verdict",
    speciesId: "eradicators",
    nameKey: "faction.eradicators_pale_verdict.name",
    descriptionKey: "faction.eradicators_pale_verdict.description",
    goal: "prevent_human_rebirth",
    relation: "hostile",
    traitModifiers: { aggression: 0.05 },
    hostileTo: [],
    regionShare: 1,
  },
  {
    id: "greys_calculus",
    speciesId: "greys",
    nameKey: "faction.greys_calculus.name",
    descriptionKey: "faction.greys_calculus.description",
    goal: "impose_order",
    relation: "neutral",
    traitModifiers: {  },
    hostileTo: ["void_nomads_free_wake"],
    regionShare: 1,
  },
  {
    id: "void_nomads_free_wake",
    speciesId: "void_nomads",
    nameKey: "faction.void_nomads_free_wake.name",
    descriptionKey: "faction.void_nomads_free_wake.description",
    goal: "protect_trade_routes",
    relation: "neutral",
    traitModifiers: {  },
    hostileTo: ["greys_calculus", "aurelians_house_solenne"],
    regionShare: 1,
  },
  {
    id: "elydri_living_archive",
    speciesId: "elydri",
    nameKey: "faction.elydri_living_archive.name",
    descriptionKey: "faction.elydri_living_archive.description",
    goal: "study_emperors",
    relation: "neutral",
    traitModifiers: {  },
    hostileTo: ["eradicators_pale_verdict", "nihil_quiet_end"],
    regionShare: 1,
  },
  {
    id: "tharaxi_tide",
    speciesId: "tharaxi",
    nameKey: "faction.tharaxi_tide.name",
    descriptionKey: "faction.tharaxi_tide.description",
    goal: "absorb_human_reproduction",
    relation: "hostile",
    traitModifiers: { aggression: 0.05 },
    hostileTo: ["tharaxi_severed_caste"],
    regionShare: 0.85,
  },
  {
    id: "tharaxi_severed_caste",
    speciesId: "tharaxi",
    nameKey: "faction.tharaxi_severed_caste.name",
    descriptionKey: "faction.tharaxi_severed_caste.description",
    goal: "break_hive_mind",
    relation: "potential_ally",
    traitModifiers: { aggression: -0.45, numbers: -0.6, techLevel: 0.15 },
    hostileTo: ["tharaxi_tide"],
    regionShare: 0.15,
  },
  {
    id: "aurelians_house_solenne",
    speciesId: "aurelians",
    nameKey: "faction.aurelians_house_solenne.name",
    descriptionKey: "faction.aurelians_house_solenne.description",
    goal: "vassalize_emperors",
    relation: "hostile",
    traitModifiers: { aggression: 0.1 },
    hostileTo: ["aurelians_house_varek"],
    regionShare: 0.6,
  },
  {
    id: "aurelians_house_varek",
    speciesId: "aurelians",
    nameKey: "faction.aurelians_house_varek.name",
    descriptionKey: "faction.aurelians_house_varek.description",
    goal: "surpass_emperors",
    relation: "neutral",
    traitModifiers: { aggression: -0.15, techLevel: 0.05 },
    hostileTo: ["aurelians_house_solenne"],
    regionShare: 0.4,
  },
  {
    id: "nihil_quiet_end",
    speciesId: "nihil",
    nameKey: "faction.nihil_quiet_end.name",
    descriptionKey: "faction.nihil_quiet_end.description",
    goal: "end_humanity",
    relation: "hostile",
    traitModifiers: { aggression: 0.2 },
    hostileTo: ["nihil_unbinding"],
    regionShare: 0.6,
  },
  {
    id: "nihil_unbinding",
    speciesId: "nihil",
    nameKey: "faction.nihil_unbinding.name",
    descriptionKey: "faction.nihil_unbinding.description",
    goal: "liberate_emperors",
    relation: "potential_ally",
    traitModifiers: { aggression: -0.4 },
    hostileTo: ["nihil_quiet_end"],
    regionShare: 0.4,
  },
  {
    id: "vesperi_wardens",
    speciesId: "vesperi",
    nameKey: "faction.vesperi_wardens.name",
    descriptionKey: "faction.vesperi_wardens.description",
    goal: "protect_human_colonies",
    relation: "potential_ally",
    traitModifiers: {  },
    hostileTo: ["vesperi_last_border"],
    regionShare: 0.5,
  },
  {
    id: "vesperi_last_border",
    speciesId: "vesperi",
    nameKey: "faction.vesperi_last_border.name",
    descriptionKey: "faction.vesperi_last_border.description",
    goal: "resist_annexation",
    relation: "neutral",
    traitModifiers: { aggression: 0.3 },
    hostileTo: ["vesperi_wardens"],
    regionShare: 0.5,
  },
  {
    id: "scavengers_rust_tide",
    speciesId: "scavengers",
    nameKey: "faction.scavengers_rust_tide.name",
    descriptionKey: "faction.scavengers_rust_tide.description",
    goal: "raid_supply_lines",
    relation: "hostile",
    traitModifiers: {  },
    hostileTo: [],
    regionShare: 1,
  },
];

/** Busca una facción por id. */
export function getFaction(id: string): FactionDefinition | undefined {
  return FACTIONS.find((f) => f.id === id);
}

/** Facciones de una especie. */
export function factionsOfSpecies(speciesId: string): FactionDefinition[] {
  return FACTIONS.filter((f) => f.speciesId === speciesId);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Rasgos efectivos de una facción: los de su especie más sus modificadores, recortados a [0, 1]. */
export function effectiveTraits(faction: FactionDefinition): SpeciesTraits {
  const species = getSpecies(faction.speciesId);
  if (!species) throw new Error(`Especie desconocida: ${faction.speciesId}`);
  const base = species.traits;
  const m = faction.traitModifiers;
  return {
    aggression: clamp01(base.aggression + (m.aggression ?? 0)),
    expansionRate: clamp01(base.expansionRate + (m.expansionRate ?? 0)),
    techLevel: clamp01(base.techLevel + (m.techLevel ?? 0)),
    numbers: clamp01(base.numbers + (m.numbers ?? 0)),
    resilience: clamp01(base.resilience + (m.resilience ?? 0)),
  };
}
