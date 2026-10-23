import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { I18nKey } from "@imperium/shared";
import { spaceStore } from "../net/space";
import { usePhotoNoticeOpen } from "../state/photoNotice";
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
  const raised = useStore(spaceStore, (s) => s.event !== null);
  // Con una ventana modal abierta (Ajustes, Humanidad…), plegado: así no tapa sus botones.
  const [modal, setModal] = useState(false);
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

  // Cada poco: dónde está lo que se resalta y si el paso ya está hecho.
  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    let finished = false;
    const tick = () => {
      // Lo que se resalta: el primero visible con ese `data-tutorial`.
      const el = step.target ? [...document.querySelectorAll<HTMLElement>(`[data-tutorial="${step.target}"]`)].find((e) => e.offsetParent !== null) : null;
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (r && prev && r.x === prev.x && r.y === prev.y && r.width === prev.width && r.height === prev.height ? prev : r));
      setModal(document.querySelector(".modal-backdrop") !== null);
      if (!finished && step.done && start.current && step.done({ start: start.current, now: snapshot() })) {
        finished = true;
        setDone(true);
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [step]);

  // Hecho: una pausa con la marca y al siguiente paso (sin depender del efecto de arriba, que se repite).
  useEffect(() => {
    if (!done || !stepKey) return;
    const id = window.setTimeout(() => tutorialStore.getState().next(), DONE_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [done, stepKey]);

  if (!active || !chapter || !step) return null;
  const store = tutorialStore.getState();
  const total = chapter.steps.length;
  const title = t(`tut.${chapter.id}.title` as I18nKey);

  if (mini || modal) {
    return (
      <button type="button" className={raised ? "tutorial-pill panel raised" : "tutorial-pill panel"} onClick={() => store.setMini(false)} title={t("tut.expand")}>
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
      <section className={raised ? "tutorial-panel panel raised" : "tutorial-panel panel"} role="region" aria-label={t("tut.title")}>
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

const OFFER_KEY = "aeon.tutorialOffered";

/**
 * Ofrecimiento del tutorial, una sola vez en este navegador: al entrar con un
 * Emperador, si no se ha empezado ni hecho ningún capítulo. «Ahora no» no
 * vuelve a preguntar (sigue en Ajustes → Tutorial).
 */
export function TutorialOffer() {
  const t = useT();
  const active = useStore(tutorialStore, (s) => s.active);
  const done = useStore(tutorialStore, (s) => s.done);
  const [offered, setOffered] = useState(() => {
    try {
      return localStorage.getItem(OFFER_KEY) === "1";
    } catch {
      return true;
    }
  });
  // Primero el aviso de fotosensibilidad (si está abierto): luego, esto.
  const photo = usePhotoNoticeOpen();
  if (offered || active || photo || Object.keys(done).length > 0) return null;
  const answer = (start: boolean) => {
    try {
      localStorage.setItem(OFFER_KEY, "1");
    } catch {
      // Sin almacenamiento: no se vuelve a preguntar en esta sesión.
    }
    setOffered(true);
    if (start) tutorialStore.getState().start("basics");
  };
  return (
    <section className="tutorial-panel panel" role="region" aria-label={t("tut.title")}>
      <span className="contract-kind">{t("tut.title")}</span>
      <p className="tutorial-text">{t("tut.offer")}</p>
      <footer className="tutorial-foot">
        <button type="button" className="btn btn-small" onClick={() => answer(false)}>
          {t("tut.offerLater")}
        </button>
        <button type="button" className="btn btn-small btn-primary" onClick={() => answer(true)}>
          {t("tut.start")}
        </button>
      </footer>
    </section>
  );
}
