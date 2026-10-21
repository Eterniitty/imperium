import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { HELP_CALL } from "@imperium/content";
import type { I18nKey } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { spaceStore } from "../net/space";
import { connection } from "../net/world";
import { dismissHelpCall, HELP_CALL_SHOW_MS, helpStore, useHelpCalls } from "../state/help";
import { findSystemSummary, useT } from "../state/store";

/**
 * Pedir ayuda (`HELP_CALL`) mientras se pilota la nave del Emperador: avisa a
 * los compañeros conectados y, cerca del Núcleo, acude la milicia.
 */
export function HelpButton() {
  const t = useT();
  const remote = useStore(spaceStore, (s) => s.remote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!sentAt) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [sentAt]);
  if (remote) return null;
  const wait = Math.max(0, Math.ceil((sentAt + HELP_CALL.cooldownSec * 1000 - Date.now()) / 1000));
  const call = async () => {
    setBusy(true);
    const err = await connection.command("help.call", {});
    setError(err);
    if (!err) setSentAt(Date.now());
    setBusy(false);
  };
  return (
    <div className="help-hud panel">
      <button className="lang-btn" disabled={busy || wait > 0} title={t("help.hint")} onClick={() => void call()}>
        {wait > 0 ? t("help.wait", { s: wait }) : t("help.call")}
      </button>
      {sentAt > 0 && wait > 0 && <span className="muted small">{t("help.sent")}</span>}
      {error && <span className="auth-error small">{t(error)}</span>}
    </div>
  );
}

/** Peticiones de ayuda de los compañeros: dónde están y un botón para saltar a su lado. */
export function HelpCalls() {
  const t = useT();
  const calls = useHelpCalls();
  useEffect(() => {
    if (calls.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      helpStore.setState((s) => ({ calls: s.calls.filter((c) => now - c.at < HELP_CALL_SHOW_MS) }));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [calls.length]);
  if (calls.length === 0) return null;
  return (
    <div className="help-calls" role="status">
      {calls.map((c) => {
        const system = findSystemSummary(c.systemId);
        return (
          <div key={c.from} className="panel help-call">
            <strong>{t("help.incoming", { name: c.name, system: system?.name ?? c.systemId })}</strong>
            <div className="escort-orders">
              {system && (
                <button
                  className="lang-btn active"
                  onClick={() => {
                    engineRef.current?.startQuantum(system, c.from);
                    dismissHelpCall(c.from);
                  }}
                >
                  {t("help.go")}
                </button>
              )}
              <button className="lang-btn" onClick={() => dismissHelpCall(c.from)}>
                {t("help.dismiss")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
