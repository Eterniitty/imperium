import { useEffect, useState } from "react";
import { PARTS, HULLS, TECH, TECH_TREES, techLevel, type TechLevels, type TechTree } from "@imperium/content";
import type { I18nKey, ResearchStatus } from "@imperium/shared";
import { api } from "../state/auth";
import { useT } from "../state/store";
import { fmtInt } from "./colonies";
import { formatDuration, useServerNow } from "./useNow";

/**
 * Tecnología por niveles: cinco ramas, una investigación a la vez, pagada con
 * créditos. Muestra el nivel, lo que mejora, lo que desbloquea el siguiente
 * nivel en el Astillero y el coste (`/api/research`).
 */
export function ResearchTab() {
  const t = useT();
  const now = useServerNow();
  const [status, setStatus] = useState<ResearchStatus | null>(null);
  const [error, setError] = useState<I18nKey | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    void api<ResearchStatus>("GET", "/api/research").then((r) => {
      if (r.ok) setStatus(r.data);
      else setError(r.error as I18nKey);
    });
  useEffect(load, []);
  // Al terminar la investigación en marcha, se vuelve a pedir el estado.
  const finishAt = status?.current?.finishAt ?? 0;
  useEffect(() => {
    if (!finishAt) return;
    const id = setTimeout(load, Math.max(1000, finishAt - Date.now() + 2500));
    return () => clearTimeout(id);
  }, [finishAt]);

  if (!status) return error ? <p className="auth-error small">{t(error)}</p> : <p className="muted small">{t("ranking.loading")}</p>;
  const levels = status.levels as TechLevels;
  const start = async (tree: TechTree) => {
    setBusy(true);
    const r = await api<ResearchStatus>("POST", "/api/research/start", { tree });
    setBusy(false);
    if (r.ok) {
      setStatus(r.data);
      setError(null);
    } else setError(r.error as I18nKey);
  };
  const unlocks = (tree: TechTree, level: number) =>
    [...HULLS.filter((h) => h.tech?.tree === tree && h.tech.level === level), ...PARTS.filter((p) => p.tech?.tree === tree && p.tech.level === level)].map((x) => t(x.nameKey as I18nKey));

  return (
    <div className="research">
      <p className="muted small">{t("research.intro")}</p>
      {status.current && (
        <p className="ranking-me">
          {t("research.current", {
            tree: t(`tech.${status.current.tree}` as I18nKey),
            level: status.current.level,
            time: formatDuration(status.current.finishAt - now),
          })}
        </p>
      )}
      <ul className="tech-list">
        {TECH_TREES.map((tree) => {
          const lvl = techLevel(levels, tree);
          const next = lvl + 1;
          const maxed = lvl >= TECH.maxLevel;
          const list = maxed ? [] : unlocks(tree, next);
          return (
            <li key={tree}>
              <div className="tech-head">
                <strong>{t(`tech.${tree}` as I18nKey)}</strong>
                <span className="tech-pips">
                  {Array.from({ length: TECH.maxLevel }, (_, i) => (
                    <span key={i} className={i < lvl ? "on" : ""} />
                  ))}
                </span>
              </div>
              <div className="muted small">{t(`tech.${tree}.effect` as I18nKey, { pct: Math.round(TECH.perLevel[tree] * 100), total: Math.round(TECH.perLevel[tree] * lvl * 100) })}</div>
              {list.length > 0 && <div className="small">{t("research.unlocks", { list: list.join(", ") })}</div>}
              {!maxed && (
                <button className="btn" disabled={busy || !!status.current} onClick={() => void start(tree)}>
                  {t("research.start", { level: next, credits: fmtInt(TECH.credits[next - 1]!), hours: TECH.hours[next - 1]! })}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="auth-error small">{t(error)}</p>}
    </div>
  );
}
