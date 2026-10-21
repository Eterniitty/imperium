import { LEGAL_PAGES } from "@imperium/shared";
import { settingsStore, useSettings } from "../state/settings";
import { useGame, useT } from "../state/store";

/**
 * Aviso de fotosensibilidad (epilepsia) la primera vez que se entra (y desde
 * Ajustes): el juego tiene destellos (salto cuántico, explosiones). Permite
 * activar «Reducir efectos visuales» o continuar; la elección se recuerda
 * en los ajustes del navegador.
 */
export function PhotosensitivityNotice() {
  const t = useT();
  const ack = useSettings((s) => s.prefs.photosensitivityAck);
  const pages = LEGAL_PAGES[useGame((s) => s.locale)];
  if (ack) return null;
  const choose = (reduce: boolean) => settingsStore.getState().setPrefs({ photosensitivityAck: true, ...(reduce ? { reduceEffects: true } : {}) });
  return (
    <div className="photo-notice-backdrop">
      <div className="photo-notice panel" role="alertdialog" aria-modal="true" aria-labelledby="photo-notice-title">
        <h2 id="photo-notice-title">{t("photo.title")}</h2>
        <p>{t("photo.text")}</p>
        <p>{t("photo.advice")}</p>
        <p className="muted small">
          {t("photo.settingsHint")}{" "}
          <a href={pages.terms} target="_blank" rel="noopener">
            {t("photo.terms")}
          </a>
        </p>
        <div className="actions">
          <button className="btn btn-primary" type="button" autoFocus onClick={() => choose(true)}>
            {t("photo.reduce")}
          </button>
          <button className="btn" type="button" onClick={() => choose(false)}>
            {t("photo.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
