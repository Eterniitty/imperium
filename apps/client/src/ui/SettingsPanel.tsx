import { useEffect, useState, type ReactNode } from "react";
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
import { openPhotoNotice } from "../state/photoNotice";

const QUALITIES: Quality[] = ["auto", "high", "medium", "low"];

type Section = "graphics" | "audio" | "interface" | "flight" | "controls" | "social" | "account";

/** Iconos de las secciones (SVG en línea: la CSP no deja cargar nada de fuera). */
const ICONS: Record<Section, ReactNode> = {
  graphics: <path d="M3 5h18v12H3zM8 21h8M12 17v4" />,
  audio: <path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />,
  interface: <path d="M4 4h16v16H4zM4 9h16M9 9v11" />,
  flight: <path d="M12 2l3 7 7 2-7 2-3 9-3-9-7-2 7-2z" />,
  controls: <path d="M3 7h18v10H3zM7 11h1M11 11h1M15 11h1M8 14h8" />,
  social: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M21 19a4.5 4.5 0 0 0-4-4.5" />,
  account: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />,
};

/** Última sección abierta (comodidad de cada jugador; si el navegador no deja guardarla, se empieza en Gráficos). */
const SECTION_KEY = "imperium.settings.section";
function loadSection(): Section {
  try {
    const s = localStorage.getItem(SECTION_KEY);
    return s && s in ICONS ? (s as Section) : "graphics";
  } catch {
    return "graphics";
  }
}

/** Una fila de ajuste: nombre y explicación a la izquierda, el control a la derecha. */
function Row({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

/** Interruptor (casilla con aspecto de interruptor; sigue siendo una casilla para el teclado y los lectores). */
function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="toggle">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </span>
  );
}

/** Deslizador con su valor a la derecha. */
function Slider({ id, value, min, max, step, onChange, format }: { id: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <span className="slider">
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ["--fill" as string]: `${pct}%` }} />
      <span className="slider-value mono">{format(value)}</span>
    </span>
  );
}

/** Opciones excluyentes en botones contiguos. */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ id: T; text: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} className={o.id === value ? "seg on" : "seg"} onClick={() => onChange(o.id)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

const pct = (v: number) => `${Math.round(v)} %`;

function GraphicsSection() {
  const t = useT();
  const prefs = useSettings((s) => s.prefs);
  const set = settingsStore.getState().setPrefs;
  return (
    <>
      <Row label={t("settings.quality")} hint={t("settings.qualityHint", { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })}>
        <Segmented
          label={t("settings.quality")}
          value={prefs.quality}
          onChange={(quality) => set({ quality })}
          options={QUALITIES.map((q) => ({ id: q, text: t(`settings.qualityShort.${q}`) }))}
        />
      </Row>
      <Row label={t("settings.reduceEffects")} htmlFor="pref-reduce-fx" hint={
        <>
          {t("settings.reduceEffectsHint")}{" "}
          <button className="link-btn" type="button" onClick={openPhotoNotice}>
            {t("photo.show")}
          </button>
        </>
      }>
        <Toggle id="pref-reduce-fx" checked={prefs.reduceEffects} onChange={(reduceEffects) => set({ reduceEffects })} />
      </Row>
    </>
  );
}

function AudioSection() {
  const t = useT();
  const prefs = useSettings((s) => s.prefs);
  const set = settingsStore.getState().setPrefs;
  const vol = (v: number) => (v > 0 ? pct(v) : t("settings.off"));
  return (
    <>
      <Row label={t("settings.music")} htmlFor="pref-music" hint={t("settings.musicHint")}>
        <Slider id="pref-music" value={Math.round(prefs.musicVolume * 100)} min={0} max={100} step={1} onChange={(v) => set({ musicVolume: v / 100 })} format={vol} />
      </Row>
      <Row label={t("settings.sfx")} htmlFor="pref-sfx" hint={t("settings.sfxHint")}>
        <Slider id="pref-sfx" value={Math.round(prefs.sfxVolume * 100)} min={0} max={100} step={1} onChange={(v) => set({ sfxVolume: v / 100 })} format={vol} />
      </Row>
    </>
  );
}

function InterfaceSection() {
  const t = useT();
  const prefs = useSettings((s) => s.prefs);
  const set = settingsStore.getState().setPrefs;
  return (
    <>
      <Row label={t("hud.language")}>
        <LanguageToggle />
      </Row>
      <Row label={t("settings.uiScale")} htmlFor="pref-ui" hint={t("settings.uiScaleHint")}>
        <select
          id="pref-ui"
          className="auth-input set-select"
          value={String(prefs.uiScale)}
          onChange={(e) => set({ uiScale: (e.target.value === "auto" ? "auto" : Number(e.target.value)) as UiScale })}
        >
          {UI_SCALES.map((s) => (
            <option key={s} value={String(s)}>
              {s === "auto" ? t("settings.uiScale.auto", { percent: Math.round(uiScaleFor("auto", window.innerWidth, window.innerHeight) * 100) }) : `${Math.round(s * 100)} %`}
            </option>
          ))}
        </select>
      </Row>
    </>
  );
}

/** Pilotaje: asistencia, ratón, cámara, combate con ratón, aceleración, inercia y velocidad. */
function FlightSection() {
  const t = useT();
  const flight = useSettings((s) => s.prefs.flight);
  const set = (changes: Partial<typeof flight>) => settingsStore.getState().setPrefs({ flight: { ...flight, ...changes } });
  const check = (key: "assist" | "mouseFlight" | "invertCameraY" | "mouseInvertY" | "mouseFire" | "autoFire", label: I18nKey) => (
    <Row label={t(label)} htmlFor={`pref-${key}`}>
      <Toggle id={`pref-${key}`} checked={flight[key]} onChange={(v) => set({ [key]: v })} />
    </Row>
  );
  const range = (key: "accel" | "inertia" | "maxSpeed" | "mouseSensitivity" | "mouseDeadzone", label: I18nKey, min: number, max: number) => (
    <Row label={t(label)} htmlFor={`pref-${key}`}>
      <Slider id={`pref-${key}`} value={Math.round(flight[key] * 100)} min={min * 100} max={max * 100} step={5} onChange={(v) => set({ [key]: v / 100 })} format={pct} />
    </Row>
  );
  return (
    <>
      <h3 className="set-group">{t("settings.group.assist")}</h3>
      {check("assist", "settings.flight.assist")}
      {range("accel", "settings.flight.accel", 0.5, 1.5)}
      {range("inertia", "settings.flight.inertia", 0.5, 2)}
      {range("maxSpeed", "settings.flight.maxSpeed", 0.25, 1)}
      <h3 className="set-group">{t("settings.group.mouse")}</h3>
      {check("mouseFlight", "settings.flight.mouseFlight")}
      {range("mouseSensitivity", "settings.flight.mouseSensitivity", 0.3, 3)}
      {range("mouseDeadzone", "settings.flight.mouseDeadzone", 0, 0.3)}
      {check("mouseInvertY", "settings.flight.mouseInvertY")}
      {check("invertCameraY", "settings.flight.invertY")}
      <h3 className="set-group">{t("settings.group.combat")}</h3>
      {check("mouseFire", "settings.flight.mouseFire")}
      {check("autoFire", "settings.flight.autoFire")}
    </>
  );
}

/** Controles: cómo se juega (plegable), buscador y las teclas de cada acción (dos por acción). */
function ControlsSection({ capturing, setCapturing }: { capturing: { action: Action; slot: number } | null; setCapturing: (c: { action: Action; slot: number } | null) => void }) {
  const t = useT();
  const keys = useKeyLabels();
  const locale = useGame((s) => s.locale);
  const bindings = useSettings((s) => s.bindings);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  return (
    <>
      <details className="set-howto">
        <summary>{t("settings.howToPlay")}</summary>
        <ul className="howto">
          <li>{t("help.pilotMouse", keys)}</li>
          <li>{t("help.keysPilot", keys)}</li>
          <li>{t("help.combat", keys)}</li>
          <li>{t("help.rotate")} · {t("help.pan")} · {t("help.zoom")}</li>
          <li>{t("help.select")}</li>
          <li>{t("help.keysMap", keys)}</li>
        </ul>
      </details>
      <div className="set-keys-head">
        <input className="auth-input set-search" type="search" placeholder={t("settings.searchKeys")} aria-label={t("settings.searchKeys")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn" type="button" onClick={() => settingsStore.getState().resetBindings()}>
          {t("settings.reset")}
        </button>
      </div>
      <p className="set-hint">{t("settings.keysHint")}</p>
      {(Object.keys(ACTIONS) as ActionContext[]).map((ctx) => {
        const actions = ACTIONS[ctx].filter((a) => !q || t(`action.${a}`).toLowerCase().includes(q));
        if (actions.length === 0) return null;
        return (
          <section key={ctx}>
            <h3 className="set-group">{t(`settings.ctx.${ctx}`)}</h3>
            <table className="keys-table">
              <tbody>
                {actions.map((action) => {
                  const codes = bindings[action];
                  const conflicts = [...new Set(codes.flatMap((c) => conflictsOf(action, c)))];
                  return (
                    <tr key={action}>
                      <th scope="row">
                        {t(`action.${action}`)}
                        {conflicts.length > 0 && <div className="key-conflict">{t("settings.conflict", { actions: conflicts.map((a) => t(`action.${a}`)).join(", ") })}</div>}
                      </th>
                      {[0, 1].map((slot) => {
                        const active = capturing?.action === action && capturing.slot === slot;
                        const code = codes[slot];
                        return (
                          <td key={slot}>
                            <button
                              className={active ? "key-btn capturing" : conflicts.length && code ? "key-btn conflict" : code ? "key-btn" : "key-btn empty"}
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
        );
      })}
    </>
  );
}

/**
 * Menú de ajustes (`docs/rediseno-interfaz.md` §3): ventana grande con fondo
 * desenfocado, secciones en una barra lateral y filas de ajuste con su
 * explicación. Esc lo cierra (salvo mientras se elige una tecla).
 */
export function SettingsPanel() {
  const t = useT();
  const open = useGame((s) => s.settingsOpen);
  const [section, setSectionState] = useState<Section>(loadSection);
  const hasEmperor = useAuth((s) => s.emperor !== null);
  const hasAccount = useAuth((s) => s.account !== null);
  const [capturing, setCapturing] = useState<{ action: Action; slot: number } | null>(null);
  const setSection = (s: Section) => {
    setSectionState(s);
    try {
      localStorage.setItem(SECTION_KEY, s);
    } catch {
      // Sin almacenamiento: no pasa nada, se abrirá en Gráficos.
    }
  };

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

  // Esc cierra el menú (si no se está eligiendo tecla).
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
  const sections: Section[] = ["graphics", "audio", "interface", "flight", "controls", ...(hasEmperor ? (["social"] as const) : []), ...(hasAccount ? (["account"] as const) : [])];
  const current = sections.includes(section) ? section : "graphics";
  const close = () => gameStore.getState().setSettingsOpen(false);

  return (
    <div className="modal-backdrop settings-backdrop" onClick={close}>
      <div className="settings settings-menu panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()} {...(capturing ? { "data-capturing-key": "" } : {})}>
        <aside className="settings-nav">
          <h2 id="settings-title">{t("settings.title")}</h2>
          <div role="tablist" aria-orientation="vertical" aria-labelledby="settings-title">
            {sections.map((id) => (
              <button key={id} role="tab" id={`set-tab-${id}`} aria-controls="set-content" aria-selected={current === id} className={current === id ? "settings-tab on" : "settings-tab"} onClick={() => setSection(id)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {ICONS[id]}
                </svg>
                <span>{t(`settings.tab.${id}`)}</span>
              </button>
            ))}
          </div>
        </aside>
        <div className="settings-main">
          <header className="settings-head">
            <h3>{t(`settings.tab.${current}`)}</h3>
            <button className="icon-btn" aria-label={t("settings.close")} onClick={close}>
              ×
            </button>
          </header>
          <div className="settings-content" id="set-content" role="tabpanel" aria-labelledby={`set-tab-${current}`} key={current}>
            {current === "graphics" && <GraphicsSection />}
            {current === "audio" && <AudioSection />}
            {current === "interface" && <InterfaceSection />}
            {current === "flight" && <FlightSection />}
            {current === "controls" && <ControlsSection capturing={capturing} setCapturing={setCapturing} />}
            {current === "social" && <SocialTab />}
            {current === "account" && <AccountTab />}
          </div>
          <footer className="settings-foot">
            <span className="muted small">{t("settings.saved")}</span>
            <button className="btn btn-primary" onClick={close}>
              {t("settings.close")}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
