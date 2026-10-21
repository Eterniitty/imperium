import { useCallback, useEffect, useState } from "react";
import { STOCK_IDS, type StockId } from "@imperium/content";
import type { Colony, HumanityProject, HumanityResponse, I18nKey } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { api } from "../state/auth";
import { useT } from "../state/store";
import { RESOURCE_COLORS, Meter } from "./common";
import { fmtCredits, fmtInt, fmtRate, liveCredits, liveStock } from "./colonies";
import { useServerNow } from "./useNow";

const REFRESH_MS = 30_000;
const HOUR_MS = 3_600_000;

const color = (r: StockId) => (r === "alloys" ? "#ffb070" : RESOURCE_COLORS[r]);
const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;

/** Pestaña «Humanidad»: agregados de toda la humanidad, el tesoro del Núcleo, tu cartera y los proyectos comunes. */
export function HumanityTab() {
  const t = useT();
  const now = useServerNow();
  const wallet = useWorld((s) => s.wallet);
  const [data, setData] = useState<HumanityResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const res = await api<HumanityResponse>("GET", "/api/humanity");
    if (res.ok) setData(res.data);
    setFailed(!res.ok);
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (!data) return <p className="muted small">{t(failed ? "eco.loadError" : "eco.loading")}</p>;
  const treasury = data.treasury.credits + (data.treasury.incomePerHour * Math.max(0, now - data.treasury.at)) / HOUR_MS;

  return (
    <div className="economy-body">
      <p className="muted small">{t("eco.humanityIntro")}</p>
      <h3>{t("eco.aggregates")}</h3>
      <div className="eco-stats">
        <Stat label={t("eco.emperors")} value={fmtInt(data.emperors)} />
        <Stat label={t("eco.colonies")} value={fmtInt(data.colonies)} />
        <Stat label={t("eco.population")} value={fmtInt(data.population)} />
        <Stat label={t("eco.creditsTotal")} value={`₢ ${fmtCredits(data.credits)}`} />
      </div>
      <table className="eco-table">
        <thead>
          <tr>
            <th>{t("wiki.col.resource")}</th>
            <th className="num">{t("eco.stock")}</th>
            <th className="num">{t("eco.production")}</th>
          </tr>
        </thead>
        <tbody>
          {STOCK_IDS.map((r) => (
            <tr key={r}>
              <td>
                <span className="dot" style={{ background: color(r) }} /> {t(`resource.${r}`)}
              </td>
              <td className="num mono">{fmtInt(data.stock[r])}</td>
              <td className="num mono">{fmtRate(data.ratesPerHour[r])}/h</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t("eco.treasury")}</h3>
      <div className="eco-stats">
        <Stat label={t("eco.treasuryCredits")} value={`₢ ${fmtCredits(treasury)}`} />
        <Stat label={t("eco.treasuryIncome")} value={`${fmtRate(data.treasury.incomePerHour)} ₢/h`} />
        <Stat label={t("eco.taxRate")} value={pct(data.treasury.taxRate)} />
      </div>
      {wallet && (
        <p className="small">
          {t("eco.myWallet", {
            credits: fmtCredits(liveCredits(wallet, now)),
            income: fmtRate(wallet.incomePerHour),
            tax: fmtRate(wallet.taxPerHour).replace("+", ""),
          })}
        </p>
      )}

      <h3>{t("eco.projects")}</h3>
      <p className="muted small">{t("eco.projectsIntro")}</p>
      <div className="projects">
        {data.projects.map((p) => (
          <ProjectCard key={p.id} project={p} onDone={refresh} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="eco-stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value mono">{value}</span>
    </div>
  );
}

function ProjectCard({ project: p, onDone }: { project: HumanityProject; onDone: () => Promise<void> }) {
  const t = useT();
  const now = useServerNow(5000);
  const colonies = useWorld((s) => s.colonies);
  const own = (Object.values(colonies) as Colony[]).sort((a, b) => a.foundedAt - b.foundedAt);
  const [colonyId, setColonyId] = useState<string>("");
  const [amounts, setAmounts] = useState<Record<StockId | "credits", string>>({ metal: "", volatiles: "", crystal: "", alloys: "", credits: "" });
  const [error, setError] = useState<I18nKey | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = own.find((c) => c.id === colonyId) ?? own[0];
  const stock = chosen ? liveStock(chosen, now) : null;

  const send = async () => {
    const parsed: Partial<Record<StockId, number>> = {};
    for (const r of STOCK_IDS) {
      const v = Number.parseInt(amounts[r], 10);
      if (v > 0) parsed[r] = v;
    }
    const credits = Number.parseFloat(amounts.credits.replace(",", "."));
    setBusy(true);
    setDone(false);
    const err = await connection.command("humanity.contribute", {
      projectId: p.id,
      ...(Object.keys(parsed).length && chosen ? { colonyId: chosen.id, amounts: parsed } : {}),
      ...(credits > 0 ? { credits: Math.round(credits * 100) / 100 } : {}),
    });
    setBusy(false);
    setError(err);
    if (!err) {
      setDone(true);
      setAmounts({ metal: "", volatiles: "", crystal: "", alloys: "", credits: "" });
      await onDone();
    }
  };

  return (
    <section className={`project project-${p.status}`}>
      <div className="project-head">
        <strong>{t(`project.${p.id}.name` as I18nKey)}</strong>
        <span className="tag">{t("eco.level", { level: p.level, max: p.maxLevel })}</span>
      </div>
      <p className="muted small">{t(`project.${p.id}.desc` as I18nKey, { per: pct(p.effectPerLevel) })}</p>
      <p className="small">
        {t("eco.effectNow", { effect: pct(p.effect) })} · {t(`eco.status.${p.status}`)}
      </p>
      {p.cost && (
        <>
          <div className="project-bars">
            {STOCK_IDS.filter((r) => p.cost![r] > 0).map((r) => {
              const have = p.progress[r];
              const coming = p.inTransit[r];
              return (
                <div key={r} className="project-bar">
                  <span className="small">{t(`resource.${r}`)}</span>
                  <Meter value={Math.min(1, (have + coming) / p.cost![r])} color={color(r)} />
                  <span className="mono small">
                    {fmtInt(have)}
                    {coming > 0 && <span className="muted"> +{fmtInt(coming)}</span>} / {fmtInt(p.cost![r])}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="muted small">{t("eco.creditsFromTreasury", { credits: fmtCredits(p.cost.credits) })}</p>
        </>
      )}
      {p.top.length > 0 && (
        <p className="muted small">
          {t("eco.top")}: {p.top.map((c) => `${c.name ?? t("eco.anonymous")} (${fmtInt(c.total)})`).join(" · ")}
        </p>
      )}
      {p.cost && (
        <details className="contribute">
          <summary>{t("eco.contribute")}</summary>
          {own.length > 0 && (
            <label className="small">
              {t("eco.fromColony")}{" "}
              <select value={chosen?.id ?? ""} onChange={(e) => setColonyId(e.target.value)}>
                {own.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.planetName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="logistics-grid">
            {own.length > 0 &&
              STOCK_IDS.filter((r) => p.cost![r] > 0).map((r) => (
                <label key={r} className="small">
                  {t(`resource.${r}`)} {stock && <span className="muted">({fmtInt(stock[r])})</span>}
                  <input inputMode="numeric" value={amounts[r]} onChange={(e) => setAmounts({ ...amounts, [r]: e.target.value.replace(/[^0-9]/g, "") })} />
                </label>
              ))}
            <label className="small">
              {t("eco.credits")}
              <input inputMode="decimal" value={amounts.credits} onChange={(e) => setAmounts({ ...amounts, credits: e.target.value.replace(/[^0-9.,]/g, "") })} />
            </label>
          </div>
          <button className="btn" disabled={busy} onClick={() => void send()}>
            {t("eco.send")}
          </button>
          <p className="muted small">{t("eco.contributeHint")}</p>
          {error && (
            <p className="auth-error" role="alert">
              {t(error)}
            </p>
          )}
          {done && <p className="small ok-text">{t("eco.contributed")}</p>}
        </details>
      )}
    </section>
  );
}
