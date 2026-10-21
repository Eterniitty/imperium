import { useEffect, useState } from "react";
import type { I18nKey } from "@imperium/shared";
import {
  ACTIONS,
  conflictsOf,
  keyLabel,
  settingsStore,
  UI_SCALES,
  uiScaleFor,
  useSettings,
  type Action,
  type ActionContext,
  type Quality,
  type UiScale,
} from "../state/settings";
import { useAuth } from "../state/auth";
import { useKeyLabels } from "./keys";
import { SocialTab } from "./SocialTab";
import { AccountTab } from "./AccountTab";
import { LanguageToggle } from "./LanguageToggle";
import { gameStore, useGame, useT } from "../state/store";

const QUALITIES: Quality[] = ["auto", "high", "medium", "low"];

/** Pestaña General: idioma, calidad de imagen y música. */
function GeneralTab() {
  const t = useT();
  const prefs = useSettings((s) => s.prefs);
  const set = settingsStore.getState().setPrefs;
  return (
    <dl className="prefs">
      <dt>{t("hud.language")}</dt>
      <dd>
        <LanguageToggle />
      </dd>
      <dt>
        <label htmlFor="pref-quality">{t("settings.quality")}</label>
      </dt>
      <dd>
        <select id="pref-quality" className="auth-input" value={prefs.quality} onChange={(e) => set({ quality: e.target.value as Quality })}>
          {QUALITIES.map((q) => (
            <option key={q} value={q}>
              {t(`settings.quality.${q}`)}
            </option>
          ))}
        </select>
        <div className="muted small">{t("settings.qualityHint", { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })}</div>
      </dd>
      <dt>
        <label htmlFor="pref-ui">{t("settings.uiScale")}</label>
      </dt>
      <dd>
        <select
          id="pref-ui"
          className="auth-input"
          value={String(prefs.uiScale)}
          onChange={(e) => set({ uiScale: (e.target.value === "auto" ? "auto" : Number(e.target.value)) as UiScale })}
        >
          {UI_SCALES.map((s) => (
            <option key={s} value={String(s)}>
              {s === "auto"
                ? t("settings.uiScale.auto", { percent: Math.round(uiScaleFor("auto", window.innerWidth, window.innerHeight) * 100) })
                : `${Math.round(s * 100)} %`}
            </option>
          ))}
        </select>
      </dd>
      <dt>
        <label htmlFor="pref-music">{t("settings.music")}</label>
      </dt>
      <dd>
        <input
          id="pref-music"
          type="range"
          min={0}
          max={100}
          value={Math.round(prefs.musicVolume * 100)}
          onChange={(e) => set({ musicVolume: Number(e.target.value) / 100 })}
        />{" "}
        <span className="mono small">{prefs.musicVolume > 0 ? `${Math.round(prefs.musicVolume * 100)} %` : t("settings.off")}</span>
      </dd>
      <dt>
        <label htmlFor="pref-sfx">{t("settings.sfx")}</label>
      </dt>
      <dd>
        <input
          id="pref-sfx"
          type="range"
          min={0}
          max={100}
          value={Math.round(prefs.sfxVolume * 100)}
          onChange={(e) => set({ sfxVolume: Number(e.target.value) / 100 })}
        />{" "}
        <span className="mono small">{prefs.sfxVolume > 0 ? `${Math.round(prefs.sfxVolume * 100)} %` : t("settings.off")}</span>
        <div className="muted small">{t("settings.sfxHint")}</div>
      </dd>
    </dl>
  );
}

/** Ajustes de pilotaje: asistencia, pilotaje con ratón, cámara, aceleración, inercia y velocidad máxima. */
function FlightPrefsSection() {
  const t = useT();
  const flight = useSettings((s) => s.prefs.flight);
  const set = (changes: Partial<typeof flight>) => settingsStore.getState().setPrefs({ flight: { ...flight, ...changes } });
  const check = (key: "assist" | "mouseFlight" | "invertCameraY", label: I18nKey) => (
    <label className="flight-pref">
      <input type="checkbox" checked={flight[key]} onChange={(e) => set({ [key]: e.target.checked })} /> {t(label)}
    </label>
  );
  const range = (key: "accel" | "inertia" | "maxSpeed", label: I18nKey, min: number, max: number) => (
    <label className="flight-pref">
      {t(label)}{" "}
      <input type="range" min={min * 100} max={max * 100} step={5} value={Math.round(flight[key] * 100)} onChange={(e) => set({ [key]: Number(e.target.value) / 100 })} />{" "}
      <span className="mono small">{Math.round(flight[key] * 100)} %</span>
    </label>
  );
  return (
    <section className="flight-prefs">
      <h3>{t("settings.flight")}</h3>
      {check("assist", "settings.flight.assist")}
      {check("mouseFlight", "settings.flight.mouseFlight")}
      {check("invertCameraY", "settings.flight.invertY")}
      {range("accel", "settings.flight.accel", 0.5, 1.5)}
      {range("inertia", "settings.flight.inertia", 0.5, 2)}
      {range("maxSpeed", "settings.flight.maxSpeed", 0.25, 1)}
    </section>
  );
}

/** Pestaña Controles: cómo se juega y las teclas (dos por acción). */
export function SettingsPanel() {
  const t = useT();
  const keys = useKeyLabels();
  const locale = useGame((s) => s.locale);
  const open = useGame((s) => s.settingsOpen);
  const bindings = useSettings((s) => s.bindings);
  const [tab, setTab] = useState<"general" | "controls" | "social" | "account">("general");
  const hasEmperor = useAuth((s) => s.emperor !== null);
  const hasAccount = useAuth((s) => s.account !== null);
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
    // En fase de captura y sin propagar: el Esc que cierra el menú no llega al juego.
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.stopPropagation();
      gameStore.getState().setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
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
        <div className="tabs" role="tablist">
          {(["general", "controls", ...(hasEmperor ? (["social"] as const) : []), ...(hasAccount ? (["account"] as const) : [])] as const).map((id) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "lang-btn active" : "lang-btn"} onClick={() => setTab(id)}>
              {t(`settings.tab.${id}`)}
            </button>
          ))}
        </div>
        {tab === "general" && <GeneralTab />}
        {tab === "social" && <SocialTab />}
        {tab === "account" && <AccountTab />}
        {tab === "controls" && (
          <>
        <h3>{t("settings.howToPlay")}</h3>
        <ul className="howto">
          <li>{t("help.pilotMouse", keys)}</li>
          <li>{t("help.keysPilot", keys)}</li>
          <li>{t("help.rotate")} · {t("help.pan")} · {t("help.zoom")}</li>
          <li>{t("help.select")}</li>
          <li>{t("help.keysMap", keys)}</li>
        </ul>
        <FlightPrefsSection />
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
          </>
        )}
        <div className="actions">
          {tab === "controls" && (
            <button className="btn" onClick={() => settingsStore.getState().resetBindings()}>
              {t("settings.reset")}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => gameStore.getState().setSettingsOpen(false)}>
            {t("settings.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
