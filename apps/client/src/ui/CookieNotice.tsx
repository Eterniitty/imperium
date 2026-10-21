import { useState } from "react";
import { LEGAL_PAGES } from "@imperium/shared";
import { useGame, useT } from "../state/store";

const SEEN_KEY = "imperium.cookieNotice";

/**
 * Aviso de cookies. Solo hay cookies técnicas imprescindibles (sesión y
 * protección de Cloudflare), que no necesitan consentimiento (§ 25.2 TDDDG):
 * por eso es un aviso informativo, no un banner de aceptar o rechazar.
 */
export function CookieNotice() {
  const t = useT();
  const pages = LEGAL_PAGES[useGame((s) => s.locale)];
  const [seen, setSeen] = useState(() => localStorage.getItem(SEEN_KEY) !== null);
  if (seen) return null;
  return (
    <div className="cookie-notice panel" role="region" aria-label={t("cookies.title")}>
      <p>
        {t("cookies.text")}{" "}
        <a href={pages.privacy} target="_blank" rel="noopener">
          {t("cookies.more")}
        </a>
      </p>
      <button
        className="btn"
        onClick={() => {
          localStorage.setItem(SEEN_KEY, "1");
          setSeen(true);
        }}
      >
        {t("cookies.ok")}
      </button>
    </div>
  );
}
