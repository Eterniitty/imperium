import { BASE_LOCALES } from "@imperium/shared";
import { gameStore, useGame, useT } from "../state/store";

export function LanguageToggle() {
  const locale = useGame((s) => s.locale);
  const t = useT();
  return (
    <div className="lang" role="group" aria-label={t("hud.language")}>
      {BASE_LOCALES.map((l) => (
        <button
          key={l}
          className={l === locale ? "lang-btn active" : "lang-btn"}
          onClick={() => gameStore.getState().setLocale(l)}
          aria-pressed={l === locale}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
