import { contentDictionaries, type ContentLocale } from "@imperium/content";
import type { Fleet, Locale } from "@imperium/shared";

/** Texto de contenido (nombres de naves, especies…) en el idioma actual. */
export function contentText(locale: Locale, key: string): string {
  return contentDictionaries[locale as ContentLocale]?.[key] ?? contentDictionaries.es[key] ?? key;
}

/** Naves de una flota agrupadas por clase: [["explorer", 2], ["frigate", 1]]. */
export function shipCounts(fleet: Fleet): Array<{ key: string; classId: string; design?: string; n: number }> {
  // Las naves del Astillero se cuentan por diseño (con su nombre), las de serie por clase.
  const counts = new Map<string, { key: string; classId: string; design?: string; n: number }>();
  for (const s of fleet.ships) {
    const key = s.design ? `design:${s.design.name}` : s.classId;
    const c = counts.get(key) ?? { key, classId: s.classId, ...(s.design ? { design: s.design.name } : {}), n: 0 };
    c.n++;
    counts.set(key, c);
  }
  return [...counts.values()];
}
