import { useEffect, useState } from "react";
import { ERA_GOALS, PRESTIGE, type MetaStat } from "@imperium/content";
import type { I18nKey, RankingResponse } from "@imperium/shared";
import { api } from "../state/auth";
import { useT } from "../state/store";
import { fmtInt } from "./colonies";

/**
 * Metas (fase 5): tu prestigio y tu puesto, los objetivos de la era con su
 * progreso y la clasificación de los Emperadores (`GET /api/ranking`).
 */
export function RankingTab() {
  const t = useT();
  const [data, setData] = useState<RankingResponse | null>(null);
  const [error, setError] = useState<I18nKey | null>(null);

  useEffect(() => {
    let alive = true;
    void api<RankingResponse>("GET", "/api/ranking").then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else setError(r.error as I18nKey);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="auth-error small">{t(error)}</p>;
  if (!data) return <p className="muted small">{t("ranking.loading")}</p>;
  const me = data.me;
  return (
    <div className="ranking">
      {me && (
        <>
          <p className="ranking-me">
            {t("ranking.you", { rank: me.rank, total: data.total, prestige: fmtInt(me.prestige) })}
          </p>
          <h3>{t("ranking.goals")}</h3>
          <ul className="goals">
            {ERA_GOALS.map((g) => {
              const have = me.stats[g.stat];
              const done = have >= g.target;
              return (
                <li key={g.id} className={done ? "done" : ""}>
                  <span>{t(`goal.${g.id}` as I18nKey)}</span>
                  <span className="goal-bar">
                    <span style={{ width: `${Math.min(100, (have / g.target) * 100)}%` }} />
                  </span>
                  <span className="mono small">
                    {done ? "✓" : `${fmtInt(have)} / ${fmtInt(g.target)}`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            {t("ranking.how", {
              list: (Object.keys(PRESTIGE) as MetaStat[]).map((k) => t(`ranking.stat.${k}` as I18nKey, { n: PRESTIGE[k] })).join(" · "),
            })}
          </p>
        </>
      )}
      <h3>{t("ranking.title")}</h3>
      <table className="keys-table ranking-table">
        <tbody>
          {data.top.map((r) => (
            <tr key={r.rank} className={me && r.rank === me.rank ? "me" : ""}>
              <td className="mono">{r.rank}</td>
              <th scope="row">
                {r.name ?? <span className="muted">{t("ranking.hidden")}</span>}
                {r.ai && <span className="tag">{t("ranking.ai")}</span>}
                {r.core && <span className="tag capital">◉ {t("ranking.core")}</span>}
              </th>
              <td className="mono">{fmtInt(r.prestige)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
