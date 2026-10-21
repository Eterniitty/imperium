import { useEffect, useState, type FormEvent } from "react";
import { COMPANION_REQUEST_TTL_HOURS, EMPEROR_NAME_MAX, EMPEROR_NAME_MIN, isDeepId, MAGIC_LINK_TTL_MINUTES } from "@imperium/shared";
import { music } from "../audio/music";
import { ACCOUNT_DELETED_FLAG, authStore, useAuth } from "../state/auth";
import { settingsStore } from "../state/settings";
import { findSystemSummary, gameStore, useGame, useT } from "../state/store";
import { LanguageToggle } from "./LanguageToggle";
import { AcceptTerms, LegalLinks } from "./Legal";
import { CookieNotice } from "./CookieNotice";
import { PhotosensitivityNotice } from "./PhotosensitivityNotice";

/** Formulario de acceso o botón de entrada, según el estado de la sesión. */
function AuthPanel() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const { status, account, emperor, sentTo, pending, busy, error, companion } = useAuth((s) => s);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [companionName, setCompanionName] = useState("");
  // Alta con compañero ya aceptada (el nombre estaba cogido): solo falta elegir otro nombre.
  const accepted = companion?.status === "accepted" ? companion : null;
  const [termsAccepted, setTermsAccepted] = useState(false);

  const enter = (
    <button
      className="btn btn-primary start-button"
      onClick={() => {
        // El clic es el gesto que el navegador exige para poder sonar.
        music.setVolume(settingsStore.getState().prefs.musicVolume);
        music.setSfxVolume(settingsStore.getState().prefs.sfxVolume);
        music.start();
        gameStore.getState().start(emperor?.location);
      }}
      autoFocus
    >
      {t("start.enter")}
    </button>
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void authStore.getState().requestLink(email, locale);
  };

  const crown = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const wanted = companionName.trim();
    if (wanted && !accepted) void authStore.getState().requestCompanion(name, wanted);
    else void authStore.getState().createEmperor(name);
  };

  const signedIn = (
    <p className="start-hint">
      {t("auth.signedInAs", { email: account?.email ?? "" })} ·{" "}
      <button className="link-btn" onClick={() => void authStore.getState().logout()} disabled={busy}>
        {t("auth.logout")}
      </button>
    </p>
  );

  switch (status) {
    case "loading":
    case "verifying":
      return <p className="start-hint">{t(status === "loading" ? "auth.loading" : "auth.verifying")}</p>;

    case "confirm":
      return (
        <div className="auth-box" role="dialog" aria-labelledby="auth-confirm-title">
          <h2 className="auth-title" id="auth-confirm-title">
            {t("auth.confirmTitle", { email: pending?.email ?? "" })}
          </h2>
          {account && <p className="auth-warning">{t("auth.confirmSwitch", { email: account.email })}</p>}
          <p className="muted small">{t("auth.confirmHint")}</p>
          {error && (
            <p className="auth-error" role="alert">
              {t(error)}
            </p>
          )}
          <button className="btn btn-primary" onClick={() => void authStore.getState().confirmLogin()} autoFocus>
            {t("auth.confirm")}
          </button>
          <button className="link-btn" onClick={() => authStore.getState().cancelLogin()}>
            {t("auth.cancel")}
          </button>
        </div>
      );

    case "offline":
      return (
        <>
          {enter}
          <p className="start-hint">{t("auth.offline")}</p>
        </>
      );

    case "naming":
      return (
        <>
          <form className="auth-box" onSubmit={crown}>
            <h2 className="auth-title">{t("emperor.title")}</h2>
            <label className="auth-label" htmlFor="emperor-name">
              {t("emperor.nameLabel")}
            </label>
            <input
              id="emperor-name"
              className="auth-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              required
              minLength={EMPEROR_NAME_MIN}
              maxLength={EMPEROR_NAME_MAX}
              placeholder={t("emperor.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <p className="muted small">{t("emperor.nameRules", { min: EMPEROR_NAME_MIN, max: EMPEROR_NAME_MAX })}</p>
            {accepted ? (
              <p className="muted small">{t("companion.acceptedRename", { companion: accepted.companion })}</p>
            ) : (
              <>
                <label className="auth-label" htmlFor="companion-name">
                  {t("companion.label")}
                </label>
                <input
                  id="companion-name"
                  className="auth-input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  placeholder={t("companion.placeholder")}
                  value={companionName}
                  onChange={(e) => setCompanionName(e.target.value)}
                />
                <p className="muted small">{t("companion.hint")}</p>
              </>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {t(error)}
              </p>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {t(busy ? "emperor.creating" : companionName.trim() && !accepted ? "companion.send" : "emperor.create")}
            </button>
            <p className="start-hint">{t("emperor.hint")}</p>
          </form>
          {signedIn}
        </>
      );

    case "waiting":
      return (
        <>
          <CompanionWaiting />
          {signedIn}
        </>
      );

    case "authenticated":
      return (
        <>
          {emperor && <p className="start-emperor">{t("emperor.at", { name: emperor.name, system: emperor.location.systemName || t("deep.name") })}</p>}
          {emperor && !isDeepId(emperor.location.systemId) && !findSystemSummary(emperor.location.systemId) && <p className="auth-warning">{t("emperor.mismatch")}</p>}
          {enter}
          {error && (
            <p className="auth-error" role="alert">
              {t(error)}
            </p>
          )}
          {signedIn}
        </>
      );

    case "sent":
      return (
        <div className="auth-box" role="status">
          <p>{t("auth.sent", { email: sentTo ?? "", minutes: MAGIC_LINK_TTL_MINUTES })}</p>
          <button className="link-btn" onClick={() => authStore.getState().reset()}>
            {t("auth.useOther")}
          </button>
        </div>
      );

    case "anonymous":
      return (
        <form className="auth-box" onSubmit={submit}>
          <h2 className="auth-title">{t("auth.title")}</h2>
          <label className="auth-label" htmlFor="auth-email">
            {t("auth.emailLabel")}
          </label>
          <input
            id="auth-email"
            className="auth-input"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder={t("auth.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <AcceptTerms checked={termsAccepted} onChange={setTermsAccepted} />
          {error && (
            <p className="auth-error" role="alert">
              {t(error)}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy || !termsAccepted} title={termsAccepted ? undefined : t("legal.mustAccept")}>
            {t(busy ? "auth.sending" : "auth.send")}
          </button>
          <p className="start-hint">{t("auth.noPassword")}</p>
        </form>
      );
  }
}

/** Cada cuánto se pregunta si el compañero ya respondió. */
const COMPANION_POLL_MS = 5000;

/**
 * Alta con compañero: esperando a que el compañero acepte (se puede retirar la
 * solicitud o empezar en solitario). Si la acepta, el Emperador se crea solo
 * cerca de él; si la rechaza o no responde a tiempo, se avisa.
 */
function CompanionWaiting() {
  const t = useT();
  const { companion, busy, error } = useAuth((s) => s);
  const status = companion?.status;

  useEffect(() => {
    if (status !== "pending" && status !== "accepted") return;
    void authStore.getState().refreshCompanion();
    const timer = window.setInterval(() => void authStore.getState().refreshCompanion(), COMPANION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [status]);

  if (!companion) return null;
  const params = { companion: companion.companion, name: companion.name };
  const text =
    companion.status === "pending"
      ? t("companion.waiting", params)
      : companion.status === "accepted"
        ? t("companion.accepted", params)
        : companion.status === "rejected"
          ? t("companion.rejected", params)
          : t("companion.expired", params);
  return (
    <div className="auth-box" role="status">
      <h2 className="auth-title">{t("companion.title")}</h2>
      <p>{text}</p>
      {companion.status === "pending" && <p className="muted small">{t("companion.waitingHint", { hours: COMPANION_REQUEST_TTL_HOURS })}</p>}
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
      {companion.status !== "accepted" && (
        <>
          <button className="btn btn-primary" onClick={() => void authStore.getState().cancelCompanion(true)} disabled={busy}>
            {t("companion.alone", params)}
          </button>
          <button className="link-btn" onClick={() => void authStore.getState().cancelCompanion(false)} disabled={busy}>
            {t(companion.status === "pending" ? "companion.cancel" : "companion.other")}
          </button>
        </>
      )}
    </div>
  );
}

export function StartScreen() {
  const t = useT();
  // Aviso tras borrar la cuenta (la página se recarga al borrarla).
  const [deleted] = useState(() => {
    const flag = sessionStorage.getItem(ACCOUNT_DELETED_FLAG) !== null;
    sessionStorage.removeItem(ACCOUNT_DELETED_FLAG);
    return flag;
  });

  useEffect(() => {
    void authStore.getState().init();
  }, []);

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
        {deleted && (
          <p className="start-hint" role="status">
            {t("account.deleted")}
          </p>
        )}
        <AuthPanel />
      </div>
      <CookieNotice />
      <PhotosensitivityNotice />
      <div className="start-footer">
        <span>{t("app.prototype")}</span>
        <LegalLinks />
        <LanguageToggle />
      </div>
    </div>
  );
}
