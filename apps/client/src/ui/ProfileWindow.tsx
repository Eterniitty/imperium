import { useEffect, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { EmperorProfile, I18nKey } from "@imperium/shared";
import { api } from "../state/auth";
import { useT } from "../state/store";
import { fmtInt } from "./colonies";

/** Perfil abierto (id de Emperador) o ninguno. */
export const profileStore = createStore<{ id: string | null; open(id: string): void; close(): void }>((set) => ({
  id: null,
  open: (id) => set({ id }),
  close: () => set({ id: null }),
}));

/**
 * Perfil público de un Emperador: rango, linaje, fecha de alta, puesto y
 * estadísticas públicas. Solo de los que se ven por su nombre (el servidor
 * responde como si no existiera si no). Sin texto libre.
 */
export function ProfileWindow() {
  const t = useT();
  const id = useStore(profileStore, (s) => s.id);
  const [data, setData] = useState<EmperorProfile | null>(null);
  const [error, setError] = useState<I18nKey | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!id) return;
    let alive = true;
    void api<EmperorProfile>("GET", `/api/ranking/profile/${id}`).then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else setError(String(r.error).includes("unknown_emperor") ? "profile.hidden" : (r.error as I18nKey));
    });
    return () => {
      alive = false;
    };
  }, [id]);

  // Esc cierra (sin llegar al juego).
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.stopPropagation();
      profileStore.getState().close();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [id]);

  if (!id) return null;
  const close = () => profileStore.getState().close();
  return (
    <div className="modal-backdrop" onClick={close}>
      <section className="profile-win panel" role="dialog" aria-modal="true" aria-label={t("profile.title")} onClick={(e) => e.stopPropagation()}>
        <header className="profile-head">
          <span className="contract-kind">{t("profile.title")}</span>
          <button type="button" className="icon-btn" aria-label={t("planetWin.close")} onClick={close}>
            ×
          </button>
        </header>
        {error && <p className="muted">{t(error)}</p>}
        {!error && !data && <p className="muted small">{t("ranking.loading")}</p>}
        {data && (
          <>
            <h2 className="profile-name">{data.name}</h2>
            <p className="profile-sub">
              {data.ai ? t("ranking.ai") : t(`rank.title.${data.rankId}` as I18nKey)} · {t("profile.generation", { n: data.generation })}
              {data.core && <> · ◉ {t("ranking.core")}</>}
            </p>
            <dl className="profile-stats">
              <dt>{t("profile.position")}</dt>
              <dd className="mono">
                {data.position} / {data.total}
              </dd>
              <dt>{t("profile.prestige")}</dt>
              <dd className="mono">{fmtInt(data.prestige)}</dd>
              <dt>{t("profile.colonies")}</dt>
              <dd className="mono">{fmtInt(data.stats.colonies)}</dd>
              <dt>{t("profile.population")}</dt>
              <dd className="mono">{fmtInt(data.stats.population)}</dd>
              <dt>{t("profile.discoveries")}</dt>
              <dd className="mono">{fmtInt(data.stats.discoveries)}</dd>
              <dt>{t("profile.ships")}</dt>
              <dd className="mono">{fmtInt(data.stats.ships)}</dd>
              {!data.ai && (
                <>
                  <dt>{t("profile.challenge")}</dt>
                  <dd className="mono">{fmtInt(data.challengeBest)}</dd>
                </>
              )}
              {data.joinedAt !== null && (
                <>
                  <dt>{t("profile.joined")}</dt>
                  <dd>{new Date(data.joinedAt).toLocaleDateString()}</dd>
                </>
              )}
            </dl>
            {data.legends.length > 0 && (
              <>
                <h3>{t("ranking.legends")}</h3>
                <ul className="rank-perks">
                  {data.legends.map((l) => (
                    <li key={l}>{t(`legend.${l}` as I18nKey)}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Nombre de un Emperador que abre su perfil. */
export function ProfileLink({ id, name }: { id: string; name: string }) {
  const t = useT();
  return (
    <button type="button" className="link-btn profile-link" title={t("profile.open")} onClick={() => profileStore.getState().open(id)}>
      {name}
    </button>
  );
}
