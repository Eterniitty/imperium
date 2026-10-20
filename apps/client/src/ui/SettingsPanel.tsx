import { useEffect, useState } from "react";
import { ACTIONS, conflictsOf, keyLabel, settingsStore, useSettings, type Action, type ActionContext } from "../state/settings";
import { gameStore, useGame, useT } from "../state/store";

/** Ajustes: de momento, las teclas. Cada acción admite dos teclas. */
export function SettingsPanel() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const open = useGame((s) => s.settingsOpen);
  const bindings = useSettings((s) => s.bindings);
  const [capturing, setCapturing] = useState<{ action: Action; slot: number } | null>(null);

  // Captura la siguiente tecla pulsada para la acción elegida.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return setCapturing(null);
      if (e.code === "Delete" || e.code === "Backspace") settingsStore.getState().unbind(capturing.action, capturing.slot);
      else settingsStore.getState().bind(capturing.action, capturing.slot, e.code);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturing]);

  // Esc cierra el panel (si no se está eligiendo tecla).
  useEffect(() => {
    if (!open || capturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") gameStore.getState().setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, capturing]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => gameStore.getState().setSettingsOpen(false)}>
      <div
        className="settings panel"
        role="dialog"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        {...(capturing ? { "data-capturing-key": "" } : {})}
      >
        <div className="settings-head">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <button className="icon-btn" aria-label={t("settings.close")} onClick={() => gameStore.getState().setSettingsOpen(false)}>
            ×
          </button>
        </div>
        <h3>{t("settings.keys")}</h3>
        <p className="muted small">{t("settings.keysHint")}</p>
        {(Object.keys(ACTIONS) as ActionContext[]).map((ctx) => (
          <section key={ctx}>
            <h4>{t(`settings.ctx.${ctx}`)}</h4>
            <table className="keys-table">
              <tbody>
                {ACTIONS[ctx].map((action) => {
                  const codes = bindings[action];
                  const conflicts = [...new Set(codes.flatMap((c) => conflictsOf(action, c)))];
                  return (
                    <tr key={action}>
                      <th scope="row">
                        {t(`action.${action}`)}
                        {conflicts.length > 0 && (
                          <div className="key-conflict">{t("settings.conflict", { actions: conflicts.map((a) => t(`action.${a}`)).join(", ") })}</div>
                        )}
                      </th>
                      {[0, 1].map((slot) => {
                        const active = capturing?.action === action && capturing.slot === slot;
                        const code = codes[slot];
                        return (
                          <td key={slot}>
                            <button
                              className={active ? "key-btn capturing" : conflicts.length && code ? "key-btn conflict" : "key-btn"}
                              onClick={() => setCapturing({ action, slot })}
                              aria-label={`${t(`action.${action}`)} ${slot + 1}`}
                            >
                              {active ? t("settings.press") : code ? keyLabel(code, locale) : t("settings.none")}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
        <div className="actions">
          <button className="btn" onClick={() => settingsStore.getState().resetBindings()}>
            {t("settings.reset")}
          </button>
          <button className="btn btn-primary" onClick={() => gameStore.getState().setSettingsOpen(false)}>
            {t("settings.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
