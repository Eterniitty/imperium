import type { FactionDefinition, SpeciesTraits } from "./types";
import { getSpecies } from "./species";

/**
 * Facciones: grupos concretos de cada especie. Hordas y Máquinas tienen dos
 * facciones cada una, enfrentadas entre sí.
 */
export const FACTIONS: readonly FactionDefinition[] = [
  {
    id: "horde_red_maw",
    speciesId: "horde",
    nameKey: "faction.horde_red_maw.name",
    descriptionKey: "faction.horde_red_maw.description",
    goal: "conquer_human_worlds",
    traitModifiers: { aggression: 0.05, numbers: 0.05, resilience: -0.1 },
    hostileTo: ["horde_iron_tusk"],
  },
  {
    id: "horde_iron_tusk",
    speciesId: "horde",
    nameKey: "faction.horde_iron_tusk.name",
    descriptionKey: "faction.horde_iron_tusk.description",
    goal: "raid_supply_lines",
    traitModifiers: { techLevel: 0.1, resilience: 0.1, numbers: -0.15 },
    hostileTo: ["horde_red_maw"],
  },
  {
    id: "machines_prime_lattice",
    speciesId: "machines",
    nameKey: "faction.machines_prime_lattice.name",
    descriptionKey: "faction.machines_prime_lattice.description",
    goal: "consume_resources",
    traitModifiers: { expansionRate: 0.2, aggression: -0.1 },
    hostileTo: ["machines_null_choir"],
  },
  {
    id: "machines_null_choir",
    speciesId: "machines",
    nameKey: "faction.machines_null_choir.name",
    descriptionKey: "faction.machines_null_choir.description",
    goal: "conquer_human_worlds",
    traitModifiers: { aggression: 0.15, techLevel: 0.1, expansionRate: -0.2 },
    hostileTo: ["machines_prime_lattice"],
  },
  {
    id: "ancients_last_vigil",
    speciesId: "ancients",
    nameKey: "faction.ancients_last_vigil.name",
    descriptionKey: "faction.ancients_last_vigil.description",
    goal: "defend_homeworlds",
    traitModifiers: { resilience: 0.05 },
    hostileTo: [],
  },
  {
    id: "swarm_brood_mother",
    speciesId: "swarm",
    nameKey: "faction.swarm_brood_mother.name",
    descriptionKey: "faction.swarm_brood_mother.description",
    goal: "assimilate_worlds",
    traitModifiers: { expansionRate: 0.05 },
    hostileTo: [],
  },
  {
    id: "ethereals_veiled_host",
    speciesId: "ethereals",
    nameKey: "faction.ethereals_veiled_host.name",
    descriptionKey: "faction.ethereals_veiled_host.description",
    goal: "guard_anomalies",
    traitModifiers: { aggression: 0.1 },
    hostileTo: [],
  },
  {
    id: "scavengers_rust_tide",
    speciesId: "scavengers",
    nameKey: "faction.scavengers_rust_tide.name",
    descriptionKey: "faction.scavengers_rust_tide.description",
    goal: "raid_supply_lines",
    traitModifiers: { numbers: 0.1, aggression: 0.05 },
    hostileTo: [],
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
