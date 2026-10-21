import { useEffect, useState } from "react";
import type { CompanionInboxEntry, CompanionInboxResponse, I18nKey } from "@imperium/shared";
import { api, useAuth } from "../state/auth";
import { useT } from "../state/store";

/** Cada cuánto se miran las solicitudes de alta recibidas. */
const POLL_MS = 30_000;

/**
 * Alta con compañero, lado del compañero: alguien que se está dando de alta
 * quiere empezar cerca de tu imperio. Aceptar hace que aparezca en un sistema
 * inicial cercano al tuyo y que seáis compañeros; rechazar se lo avisa.
 */
export function CompanionInbox() {
  const t = useT();
  const hasEmperor = useAuth((s) => s.emperor !== null);
  const [requests, setRequests] = useState<CompanionInboxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);

  useEffect(() => {
    if (!hasEmperor) return;
    const load = () =>
      void api<CompanionInboxResponse>("GET", "/api/companion-requests").then((r) => {
        if (r.ok) setRequests(r.data.requests);
      });
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasEmperor]);

  if (!requests.length) return null;

  const respond = async (id: string, accept: boolean) => {
    setBusy(true);
    setError(null);
    const r = await api<CompanionInboxResponse>("POST", "/api/companion-requests/respond", { id, accept });
    setBusy(false);
    if (r.ok) return setRequests(r.data.requests);
    // Ya no vale (caducó o la retiraron): se quita de la lista.
    setRequests((list) => list.filter((q) => q.id !== id));
    setError(r.error);
  };

  return (
    <div className="companion-inbox panel" role="region" aria-label={t("companion.inboxTitle")}>
      <h3>{t("companion.inboxTitle")}</h3>
      {requests.map((q) => (
        <div key={q.id} className="companion-inbox-item">
          <p>{t("companion.inboxText", { name: q.name })}</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => void respond(q.id, true)} disabled={busy}>
              {t("companion.accept")}
            </button>
            <button className="btn" onClick={() => void respond(q.id, false)} disabled={busy}>
              {t("companion.reject")}
            </button>
          </div>
        </div>
      ))}
      <p className="muted small">{t("companion.inboxHint")}</p>
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
