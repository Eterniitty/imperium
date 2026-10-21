import { LEGAL_PAGES } from "@imperium/shared";
import { closePhotoNotice, usePhotoNoticeOpen } from "../state/photoNotice";
import { settingsStore } from "../state/settings";
import { useGame, useT } from "../state/store";

/**
 * Aviso de fotosensibilidad (epilepsia): sale una vez al terminar el alta (al
 * crear el Emperador, antes de entrar a jugar) y desde Ajustes. El juego tiene
 * destellos (salto cuántico, explosiones). Permite activar «Reducir efectos
 * visuales» (se guarda en los ajustes del navegador) o continuar.
 */
export function PhotosensitivityNotice() {
  const t = useT();
  const open = usePhotoNoticeOpen();
  const pages = LEGAL_PAGES[useGame((s) => s.locale)];
  if (!open) return null;
  const choose = (reduce: boolean) => {
    if (reduce) settingsStore.getState().setPrefs({ reduceEffects: true });
    closePhotoNotice();
  };
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
