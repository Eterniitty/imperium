import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { I18nKey } from "@imperium/shared";
import { useT } from "../state/store";
import { KeyHint } from "../ui/common";
import { CHAPTERS, chapterById, snapshot, type Snapshot } from "./chapters";
import { tutorialStore } from "./store";

/** Cada cuánto se mira si el paso está hecho y dónde está lo que se resalta (ms). */
const POLL_MS = 250;
/** Pausa con la marca de hecho antes de pasar al siguiente paso (ms). */
const DONE_PAUSE_MS = 900;

/**
 * Panel del tutorial (`docs/tutorial.md`): el paso en curso con su texto,
 * sus teclas y un anillo sobre lo que hay que tocar. Comprueba solo, sobre la
 * partida real, cuándo se ha hecho; se puede pasar, saltar, plegar o salir.
 */
export function TutorialPanel() {
  const t = useT();
  const active = useStore(tutorialStore, (s) => s.active);
  const mini = useStore(tutorialStore, (s) => s.mini);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [done, setDone] = useState(false);
  const start = useRef<Snapshot | null>(null);

  const chapter = active ? chapterById(active.chapter) : null;
  const step = chapter && active ? (chapter.steps[active.step] ?? null) : null;
  const stepKey = active ? `${active.chapter}:${active.step}` : null;

  // Al empezar un paso: foto del estado (para comprobar cambios desde aquí).
  useEffect(() => {
    start.current = stepKey ? snapshot() : null;
    setDone(false);
  }, [stepKey]);

  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    let timer: number | null = null;
    const tick = () => {
      // Lo que se resalta: el primero visible con ese `data-tutorial`.
      const el = step.target ? [...document.querySelectorAll<HTMLElement>(`[data-tutorial="${step.target}"]`)].find((e) => e.offsetParent !== null) : null;
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (r && prev && r.x === prev.x && r.y === prev.y && r.width === prev.width && r.height === prev.height ? prev : r));
      if (step.done && start.current && !done && step.done({ start: start.current, now: snapshot() })) {
        setDone(true);
        timer = window.setTimeout(() => tutorialStore.getState().next(), DONE_PAUSE_MS);
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      window.clearInterval(id);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [step, done]);

  if (!active || !chapter || !step) return null;
  const store = tutorialStore.getState();
  const total = chapter.steps.length;
  const title = t(`tut.${chapter.id}.title` as I18nKey);

  if (mini) {
    return (
      <button type="button" className="tutorial-pill panel" onClick={() => store.setMini(false)} title={t("tut.expand")}>
        <span className="contract-kind">{t("tut.title")}</span> {title} · <span className="mono">{active.step + 1}/{total}</span>
      </button>
    );
  }

  return (
    <>
      {rect && (
        <div
          className="tutorial-ring"
          aria-hidden
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <section className="tutorial-panel panel" role="dialog" aria-label={t("tut.title")}>
        <header className="tutorial-head">
          <span className="contract-kind">
            {t("tut.title")} · {t("tut.chapterN", { n: CHAPTERS.indexOf(chapter) + 1 })}
          </span>
          <span className="mono small muted">
            {active.step + 1}/{total}
          </span>
          <button type="button" className="icon-btn" onClick={() => store.setMini(true)} aria-label={t("tut.collapse")} title={t("tut.collapse")}>
            –
          </button>
        </header>
        <strong className="tutorial-chapter">{title}</strong>
        <div className="tutorial-progress" aria-hidden>
          <span style={{ width: `${((active.step + (done ? 1 : 0)) / total) * 100}%` }} />
        </div>
        <p className={done ? "tutorial-text done" : "tutorial-text"}>
          {done && <span className="tutorial-check">✓ </span>}
          {t(`tut.${chapter.id}.${step.id}` as I18nKey)}
        </p>
        {step.keys && step.keys.length > 0 && (
          <p className="tutorial-keys">
            {step.keys.map((k) => (
              <KeyHint key={k} action={k} />
            ))}
          </p>
        )}
        {chapter.needsFlight && active.step === 0 && <p className="muted small">{t("tut.needsFlight")}</p>}
        {step.optional && <p className="muted small">{t("tut.optional")}</p>}
        <footer className="tutorial-foot">
          <button type="button" className="btn btn-small" onClick={() => store.exit()}>
            {t("tut.exit")}
          </button>
          {step.done ? (
            <button type="button" className="btn btn-small" onClick={() => store.next()} title={t("tut.skipTitle")}>
              {t("tut.skip")}
            </button>
          ) : (
            <button type="button" className="btn btn-small btn-primary" onClick={() => store.next()}>
              {active.step + 1 >= total ? t("tut.finish") : t("tut.next")}
            </button>
          )}
        </footer>
      </section>
    </>
  );
}

/** Lista de capítulos (Ajustes → Tutorial): estado, empezar o repetir, y reiniciar todo. */
export function TutorialMenu() {
  const t = useT();
  const done = useStore(tutorialStore, (s) => s.done);
  const active = useStore(tutorialStore, (s) => s.active);
  const store = tutorialStore.getState();
  return (
    <div className="tutorial-menu">
      <p className="muted small">{t("tut.menuHint")}</p>
      <ol className="contract-list">
        {CHAPTERS.map((c, i) => {
          const state = active?.chapter === c.id ? "current" : done[c.id] ? "done" : "new";
          return (
            <li key={c.id} className="contract-row">
              <div className="contract-main">
                <span className="contract-kind">
                  {t("tut.chapterN", { n: i + 1 })} · {t(`tut.state.${state}` as I18nKey)}
                </span>
                <strong>{t(`tut.${c.id}.title` as I18nKey)}</strong>
                <span className="muted small">{t(`tut.${c.id}.summary` as I18nKey)}</span>
              </div>
              <button type="button" className="btn btn-small" onClick={() => store.start(c.id)}>
                {done[c.id] ? t("tut.repeat") : t("tut.start")}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="muted small">{t("tut.more")}</p>
      <button type="button" className="btn btn-small" onClick={() => store.reset()}>
        {t("tut.reset")}
      </button>
    </div>
  );
}
