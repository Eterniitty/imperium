import { contentDictionaries, type ContentLocale } from "@imperium/content";
import type { Fleet, Locale } from "@imperium/shared";

/** Texto de contenido (nombres de naves, especies…) en el idioma actual. */
export function contentText(locale: Locale, key: string): string {
  return contentDictionaries[locale as ContentLocale]?.[key] ?? contentDictionaries.es[key] ?? key;
}

/** Naves de una flota agrupadas por clase: [["explorer", 2], ["frigate", 1]]. */
export function shipCounts(fleet: Fleet): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const s of fleet.ships) counts.set(s.classId, (counts.get(s.classId) ?? 0) + 1);
  return [...counts];
}
