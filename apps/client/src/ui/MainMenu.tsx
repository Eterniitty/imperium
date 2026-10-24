import { useEffect, useRef, useState, type ReactNode } from "react";
import { isDeepId } from "@imperium/shared";
import { music } from "../audio/music";
import { authStore, useAuth } from "../state/auth";
import { settingsStore, useSettings } from "../state/settings";
import { findSystemSummary, gameStore, useGame, useT } from "../state/store";
import { tutorialStore } from "../tutorial/store";
import type { ShipCustomization } from "@imperium/content";
import { shipStyleStore, useShipStyle } from "../state/shipStyle";
import { MenuScene } from "./MenuScene";
import { ShipCustomizer } from "./ShipCustomizer";

/** Sonidos del menú: un toque al pasar por una opción y otro al elegirla (generativos). */
export function menuSound(kind: "hover" | "select"): void {
  music.effect((ctx, out) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(kind === "hover" ? 1320 : 520, now);
    if (kind === "select") osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(kind === "hover" ? 0.04 : 0.09, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "hover" ? 0.08 : 0.25));
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 0.3);
  });
}

/** Arranca la música (el navegador exige un clic antes de poder sonar). */
export function startMusic(): void {
  music.setVolume(settingsStore.getState().prefs.musicVolume);
  music.setSfxVolume(settingsStore.getState().prefs.sfxVolume);
  music.start();
}

/**
 * El hangar en 3D detrás del menú (quieto con «Reducir efectos»), con la nave
 * del jugador. En el editor, `style` es el borrador y la cámara va con el ratón.
 */
export function MenuBackdrop({ style, mode = "menu", interior = false }: { style?: ShipCustomization; mode?: "menu" | "editor"; interior?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MenuScene | null>(null);
  const still = useSettings((s) => s.prefs.reduceEffects);
  const saved = useShipStyle((s) => s.style);
  const shown = style ?? saved;
  useEffect(() => {
    if (!ref.current) return;
    try {
      sceneRef.current = new MenuScene(ref.current, still, shipStyleStore.getState().style);
    } catch {
      // Sin WebGL: queda el fondo de colores de la portada.
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [still]);
  useEffect(() => {
    sceneRef.current?.setStyle(shown, interior);
  }, [shown, interior]);
  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);
  return <div className={mode === "editor" ? "menu-backdrop editing" : "menu-backdrop"} ref={ref} aria-hidden={mode !== "editor"} />;
}

/** El hangar con el editor de la nave: borrador en vivo, «Guardar» lo confirma. */
export function HangarEditor({ onClose }: { onClose(): void }) {
  const [draft, setDraft] = useState(() => shipStyleStore.getState().style);
  const [interior, setInterior] = useState(false);
  return (
    <>
      <MenuBackdrop style={draft} mode="editor" interior={interior} />
      <ShipCustomizer
        draft={draft}
        interior={interior}
        onChange={setDraft}
        onInterior={setInterior}
        onSave={() => {
          shipStyleStore.getState().set(draft);
          onClose();
        }}
        onCancel={onClose}
      />
    </>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  onSelect(): void;
  href?: string;
}

/** Lista de opciones con flechas arriba y abajo, Intro para elegir y sonido al pasar. */
export function MenuList({ items, label }: { items: MenuItem[]; label: string }) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);
  const move = (from: number, step: number) => {
    const next = (from + step + items.length) % items.length;
    refs.current[next]?.focus();
  };
  return (
    <nav className="menu-list" aria-label={label}>
      {items.map((item, index) => {
        const common = {
          className: "menu-item",
          onMouseEnter: () => menuSound("hover"),
          onFocus: () => menuSound("hover"),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "ArrowDown") (e.preventDefault(), move(index, 1));
            if (e.key === "ArrowUp") (e.preventDefault(), move(index, -1));
          },
        };
        const body: ReactNode = (
          <>
            <span className="menu-item-label">{item.label}</span>
            {item.hint && <span className="menu-item-hint">{item.hint}</span>}
          </>
        );
        return item.href ? (
          <a key={item.id} {...common} ref={(el) => void (refs.current[index] = el)} href={item.href} target="_blank" rel="noopener" onClick={() => menuSound("select")}>
            {body}
          </a>
        ) : (
          <button
            key={item.id}
            {...common}
            ref={(el) => void (refs.current[index] = el)}
            onClick={() => {
              menuSound("select");
              item.onSelect();
            }}
          >
            {body}
          </button>
        );
      })}
    </nav>
  );
}

/** Ventana de créditos. */
export function Credits({ onClose }: { onClose(): void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") (e.stopPropagation(), onClose());
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);
  return (
    <div className="menu-overlay" role="dialog" aria-labelledby="credits-title">
      <div className="menu-card panel">
        <h2 id="credits-title">{t("menu.creditsTitle")}</h2>
        <p>{t("menu.creditsBody")}</p>
        <p className="muted small">{t("menu.creditsTech")}</p>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          {t("menu.back")}
        </button>
      </div>
    </div>
  );
}

/**
 * Menú principal (con sesión o sin servidor): la nave del Emperador en su hangar
 * y las opciones a la izquierda. «Continuar» entra en el juego donde estaba.
 */
export function MainMenu({ onHangar }: { onHangar(): void }) {
  const t = useT();
  const { account, emperor, busy } = useAuth((s) => s);
  const [credits, setCredits] = useState(false);

  const enter = (tutorial = false) => {
    startMusic();
    gameStore.getState().start(emperor?.location);
    if (tutorial) tutorialStore.getState().start("basics");
  };

  const where = emperor ? emperor.location.systemName || t("deep.name") : null;
  const items: MenuItem[] = [
    { id: "continue", label: t(emperor ? "menu.continue" : "menu.explore"), hint: emperor ? t("menu.continueHint", { name: emperor.name, system: where ?? "" }) : t("auth.offline"), onSelect: () => enter() },
    { id: "hangar", label: t("menu.hangar"), hint: t("menu.hangarHint"), onSelect: onHangar },
    ...(emperor ? [{ id: "tutorial", label: t("menu.tutorial"), hint: t("menu.tutorialHint"), onSelect: () => enter(true) }] : []),
    { id: "settings", label: t("menu.settings"), onSelect: () => gameStore.getState().setSettingsOpen(true) },
    { id: "wiki", label: t("menu.wiki"), href: "/wiki/", onSelect: () => undefined },
    { id: "credits", label: t("menu.credits"), onSelect: () => setCredits(true) },
    ...(account ? [{ id: "logout", label: t("menu.logout"), hint: account.email, onSelect: () => !busy && void authStore.getState().logout() }] : []),
  ];

  return (
    <div className="main-menu">
      <header className="main-menu-head">
        <h1 className="main-menu-title">{t("app.title")}</h1>
        <p className="main-menu-subtitle">{t("app.subtitle")}</p>
      </header>
      {emperor && !isDeepId(emperor.location.systemId) && !findSystemSummary(emperor.location.systemId) && <p className="auth-warning">{t("emperor.mismatch")}</p>}
      <MenuList items={items} label={t("menu.title")} />
      <p className="menu-keys muted small">{t("menu.keys")}</p>
      {credits && <Credits onClose={() => setCredits(false)} />}
    </div>
  );
}

/**
 * Menú de pausa en la partida (botón de la barra superior o F10; Esc lo cierra):
 * seguir, ajustes, tutorial, Wiki, volver al menú principal o cerrar sesión.
 */
export function PauseMenu() {
  const t = useT();
  const open = useGame((s) => s.pauseOpen);
  const { account, emperor } = useAuth((s) => s);
  const [credits, setCredits] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "F10") {
        e.preventDefault();
        gameStore.getState().setPauseOpen(!gameStore.getState().pauseOpen);
      } else if (e.code === "Escape" && gameStore.getState().pauseOpen && !credits && !gameStore.getState().settingsOpen) {
        e.stopPropagation();
        gameStore.getState().setPauseOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [credits]);

  if (!open) return null;
  const close = () => gameStore.getState().setPauseOpen(false);
  const items: MenuItem[] = [
    { id: "resume", label: t("menu.resume"), onSelect: close },
    { id: "settings", label: t("menu.settings"), onSelect: () => (close(), gameStore.getState().setSettingsOpen(true)) },
    ...(emperor ? [{ id: "tutorial", label: t("menu.tutorial"), onSelect: () => (close(), tutorialStore.getState().start("basics")) }] : []),
    { id: "wiki", label: t("menu.wiki"), href: "/wiki/", onSelect: () => undefined },
    { id: "credits", label: t("menu.credits"), onSelect: () => setCredits(true) },
    { id: "main", label: t("menu.toMainMenu"), onSelect: () => gameStore.getState().toMenu() },
    ...(account ? [{ id: "logout", label: t("menu.logout"), onSelect: () => (gameStore.getState().toMenu(), void authStore.getState().logout()) }] : []),
  ];
  return (
    <div className="menu-overlay pause-menu" role="dialog" aria-labelledby="pause-title">
      <div className="pause-card">
        <h2 id="pause-title" className="pause-title">
          {t("menu.pause")}
        </h2>
        <MenuList items={items} label={t("menu.pause")} />
      </div>
      {credits && <Credits onClose={() => setCredits(false)} />}
    </div>
  );
}

