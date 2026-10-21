import { getFaction, getSpecies } from "@imperium/content";
import type { Locale } from "@imperium/shared";
import { contentText } from "./fleets";

/** Nombre traducido de una facción alienígena. */
export function factionName(locale: Locale, factionId: string): string {
  const f = getFaction(factionId);
  return f ? contentText(locale, f.nameKey) : factionId;
}

/** Nombre traducido de una especie. */
export function speciesName(locale: Locale, speciesId: string): string {
  const s = getSpecies(speciesId);
  return s ? contentText(locale, s.nameKey) : speciesId;
}

/** Color con el que se pinta una especie en la interfaz y en el mapa (su color emisivo). */
export function speciesColor(speciesId: string): string {
  return getSpecies(speciesId)?.visual.emissiveColor ?? "#ff8a5c";
}
