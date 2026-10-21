import { useState } from "react";
import type { I18nKey } from "@imperium/shared";
import { authStore, useAuth } from "../state/auth";
import { useT } from "../state/store";
import { LegalLinks } from "./Legal";

/**
 * Pestaña Cuenta: derechos del jugador sobre sus datos (RGPD). Descargar todo lo
 * que guarda el servidor y borrar la cuenta, con confirmación escrita.
 */
export function AccountTab() {
  const t = useT();
  const email = useAuth((s) => s.account?.email ?? "");
  const busy = useAuth((s) => s.busy);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<I18nKey | null>(null);
  const word = t("account.deleteWord");

  const remove = async () => {
    setError(null);
    const err = await authStore.getState().deleteAccount();
    if (err) setError(err === "error.network" ? err : "account.deleteFailed");
  };

  return (
    <div className="account">
      <dl className="prefs">
        <dt>{t("account.email")}</dt>
        <dd className="mono">{email}</dd>
        <dt>{t("account.export")}</dt>
        <dd>
          {/* GET con la cookie de sesión: el servidor responde con el archivo para descargar. */}
          <a className="btn" href="/api/account/export" download="aeonarch-datos.json">
            {t("account.export")}
          </a>
          <div className="muted small">{t("account.exportHint")}</div>
        </dd>
        <dt>{t("account.legal")}</dt>
        <dd>
          <LegalLinks />
        </dd>
      </dl>
      <section className="account-danger">
        <h3>{t("account.delete")}</h3>
        <p className="muted small">{t("account.deleteHint")}</p>
        {!confirming ? (
          <button className="btn btn-danger" onClick={() => setConfirming(true)}>
            {t("account.delete")}
          </button>
        ) : (
          <div className="social-add-row">
            <input
              className="auth-input"
              aria-label={t("account.deleteConfirm")}
              placeholder={word}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
            />
            <button className="btn btn-danger" disabled={busy || typed.trim().toUpperCase() !== word} onClick={() => void remove()}>
              {t("account.deleteNow")}
            </button>
            <button
              className="btn"
              onClick={() => {
                setConfirming(false);
                setTyped("");
              }}
            >
              {t("account.deleteCancel")}
            </button>
          </div>
        )}
        {confirming && <p className="muted small">{t("account.deleteConfirm")}</p>}
        {error && (
          <p className="auth-error" role="alert">
            {t(error)}
          </p>
        )}
      </section>
    </div>
  );
}
