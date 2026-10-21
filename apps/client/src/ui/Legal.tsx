import { LEGAL_PAGES } from "@imperium/shared";
import { useGame, useT } from "../state/store";

/** Enlaces a la Wiki y a las páginas legales (se abren en otra pestaña para no perder la partida). */
export function LegalLinks() {
  const t = useT();
  const pages = LEGAL_PAGES[useGame((s) => s.locale)];
  return (
    <nav className="legal-links">
      <a href="/wiki/" target="_blank" rel="noopener" title={t("wiki.openTitle")}>
        {t("wiki.title")}
      </a>
      <a href={pages.terms} target="_blank" rel="noopener">
        {t("legal.terms")}
      </a>
      <a href={pages.privacy} target="_blank" rel="noopener">
        {t("legal.privacy")}
      </a>
      <a href={pages.imprint} target="_blank" rel="noopener">
        {t("legal.imprint")}
      </a>
    </nav>
  );
}

/** Casilla obligatoria para pedir el enlace de acceso: edad mínima, términos y privacidad. */
export function AcceptTerms({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
  const t = useT();
  const pages = LEGAL_PAGES[useGame((s) => s.locale)];
  // La frase lleva dos enlaces dentro: se parte por sus marcadores.
  const parts = t("legal.accept", { terms: "\u0001", privacy: "\u0002" }).split(/([\u0001\u0002])/);
  return (
    <label className="accept-terms">
      <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {parts.map((part, i) =>
          part === "\u0001" ? (
            <a key={i} href={pages.terms} target="_blank" rel="noopener">
              {t("legal.acceptTerms")}
            </a>
          ) : part === "\u0002" ? (
            <a key={i} href={pages.privacy} target="_blank" rel="noopener">
              {t("legal.acceptPrivacy")}
            </a>
          ) : (
            part
          ),
        )}
      </span>
    </label>
  );
}
