import { useEffect, useState, type FormEvent } from "react";
import { VISIBILITIES, type AllyEntry, type I18nKey, type SocialResponse, type Visibility } from "@imperium/shared";
import { api } from "../state/auth";
import { useT } from "../state/store";

/** Pestaña Compañeros: quién te ve y con quién os veis. */
export function SocialTab() {
  const t = useT();
  const [social, setSocial] = useState<SocialResponse | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<I18nKey | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<SocialResponse>("GET", "/api/social").then((r) => (r.ok ? setSocial(r.data) : setError(r.error)));
  }, []);

  const call = async (url: string, body: unknown, onOk?: (s: SocialResponse) => void) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const r = await api<SocialResponse>("POST", url, body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSocial(r.data);
    onOk?.(r.data);
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const wanted = name.trim();
    if (!wanted || busy) return;
    void call("/api/social/allies", { name: wanted }, (s) => {
      setName("");
      const isAlly = s.allies.some((a) => a.name.toLowerCase() === wanted.toLowerCase());
      if (!isAlly) setInfo(t("social.added", { name: wanted }));
    });
  };

  if (!social) return <p className="muted small">{error ? t(error) : "…"}</p>;

  const list = (entries: AllyEntry[], action: { label: I18nKey; run: (a: AllyEntry) => void }, extra?: { label: I18nKey; run: (a: AllyEntry) => void }) => (
    <ul className="emperor-list social-list">
      {entries.map((a) => (
        <li key={a.id}>
          <strong>{a.name}</strong>
          <span className="social-actions">
            {extra && (
              <button className="link-btn" onClick={() => extra.run(a)} disabled={busy}>
                {t(extra.label)}
              </button>
            )}
            <button className="link-btn" onClick={() => action.run(a)} disabled={busy}>
              {t(action.label)}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
  const remove = { label: "social.remove" as const, run: (a: AllyEntry) => void call("/api/social/allies/remove", { emperorId: a.id }) };

  return (
    <>
      <h3>{t("social.visibility")}</h3>
      <div className="tabs" role="radiogroup" aria-label={t("social.visibility")}>
        {VISIBILITIES.map((v: Visibility) => (
          <button
            key={v}
            role="radio"
            aria-checked={social.visibility === v}
            className={social.visibility === v ? "lang-btn active" : "lang-btn"}
            onClick={() => void call("/api/social/visibility", { visibility: v })}
            disabled={busy}
          >
            {t(`social.visibility.${v}`)}
          </button>
        ))}
      </div>
      <p className="muted small">{t("social.visibilityHint")}</p>

      <h3>{t("social.allies")}</h3>
      <p className="muted small">{t("social.alliesHint")}</p>
      {social.allies.length ? list(social.allies, remove) : <p className="muted small">{t("social.none")}</p>}

      {social.requests.length > 0 && (
        <>
          <h4>{t("social.requests")}</h4>
          {list(
            social.requests,
            { label: "social.reject", run: (a) => void call("/api/social/allies/remove", { emperorId: a.id }) },
            { label: "social.accept", run: (a) => void call("/api/social/allies", { name: a.name }) },
          )}
        </>
      )}
      {social.pending.length > 0 && (
        <>
          <h4>{t("social.pending")}</h4>
          {list(social.pending, remove)}
        </>
      )}

      <form className="social-add" onSubmit={add}>
        <label className="auth-label" htmlFor="ally-name">
          {t("social.addLabel")}
        </label>
        <div className="social-add-row">
          <input id="ally-name" className="auth-input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <button className="btn" type="submit" disabled={busy || !name.trim()}>
            {t("social.add")}
          </button>
        </div>
      </form>
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
      {info && <p className="muted small">{info}</p>}
    </>
  );
}
