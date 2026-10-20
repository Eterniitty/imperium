import { gameStore, useT } from "../state/store";
import { LanguageToggle } from "./LanguageToggle";

export function StartScreen() {
  const t = useT();
  return (
    <div className="start">
      <div className="start-bg" />
      <div className="start-content">
        <div className="start-emblem" aria-hidden>
          <svg viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M32 4 L36.5 27.5 L60 32 L36.5 36.5 L32 60 L27.5 36.5 L4 32 L27.5 27.5 Z" fill="currentColor" />
          </svg>
        </div>
        <h1 className="start-title">{t("app.title")}</h1>
        <p className="start-subtitle">{t("app.subtitle")}</p>
        <button className="btn btn-primary start-button" onClick={() => gameStore.getState().start()} autoFocus>
          {t("start.enter")}
        </button>
        <p className="start-hint">{t("start.hint")}</p>
      </div>
      <div className="start-footer">
        <span>{t("app.prototype")}</span>
        <LanguageToggle />
      </div>
    </div>
  );
}
