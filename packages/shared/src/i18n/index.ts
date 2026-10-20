import { en } from "./en";
import { es, type I18nKey } from "./es";

export type { I18nKey };
export type Locale = "es" | "en";

export const BASE_LOCALES: Locale[] = ["es", "en"];

export const BASE_DICTIONARIES: Record<Locale, Record<I18nKey, string>> = { es, en };

/**
 * Capa de traducción. `overrides` se ordena de mayor a menor prioridad
 * (personal, organización, pública). Si una clave no existe en ninguna capa,
 * se usa el idioma base y, en último caso, el español.
 */
export function translate(
  locale: Locale,
  key: I18nKey,
  params?: Record<string, string | number>,
  overrides: Array<Partial<Record<I18nKey, string>>> = [],
): string {
  let text: string | undefined;
  for (const layer of overrides) {
    text = layer[key];
    if (text !== undefined) break;
  }
  text ??= BASE_DICTIONARIES[locale][key] ?? es[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
