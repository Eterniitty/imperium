import { useEffect, useState, type FormEvent } from "react";
import { EMPEROR_NAME_MAX, EMPEROR_NAME_MIN, MAGIC_LINK_TTL_MINUTES } from "@imperium/shared";
import { authStore, useAuth } from "../state/auth";
import { findSystemSummary, gameStore, useGame, useT } from "../state/store";
import { LanguageToggle } from "./LanguageToggle";

/** Formulario de acceso o botón de entrada, según el estado de la sesión. */
function AuthPanel() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const { status, account, emperor, sentTo, pending, busy, error } = useAuth((s) => s);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const enter = (
    <button className="btn btn-primary start-button" onClick={() => gameStore.getState().start(emperor?.location)} autoFocus>
      {t("start.enter")}
    </button>
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void authStore.getState().requestLink(email, locale);
  };

  const crown = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void authStore.getState().createEmperor(name);
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
            {error && (
              <p className="auth-error" role="alert">
                {t(error)}
              </p>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {t(busy ? "emperor.creating" : "emperor.create")}
            </button>
            <p className="start-hint">{t("emperor.hint")}</p>
          </form>
          {signedIn}
        </>
      );

    case "authenticated":
      return (
        <>
          {emperor && <p className="start-emperor">{t("emperor.at", { name: emperor.name, system: emperor.location.systemName })}</p>}
          {emperor && !findSystemSummary(emperor.location.systemId) && <p className="auth-warning">{t("emperor.mismatch")}</p>}
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
          {error && (
            <p className="auth-error" role="alert">
              {t(error)}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {t(busy ? "auth.sending" : "auth.send")}
          </button>
          <p className="start-hint">{t("auth.noPassword")}</p>
        </form>
      );
  }
}

export function StartScreen() {
  const t = useT();

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
        <AuthPanel />
      </div>
      <div className="start-footer">
        <span>{t("app.prototype")}</span>
        <LanguageToggle />
      </div>
    </div>
  );
}
