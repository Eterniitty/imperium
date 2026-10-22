import { useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { RANK_XP, RANKS, rankOf, rankPerks, type RankPerk } from "@imperium/content";
import type { Contract, ContractOffer, I18nKey } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { useT } from "../state/store";
import { HudIcon } from "./hudIcons";
import { formatDuration, useServerNow } from "./useNow";

type Tab = "offers" | "active" | "history" | "rank";

/** Abierta o no y pestaña (se recuerda en este navegador). */
function load(): { open: boolean; tab: Tab } {
  try {
    const raw = JSON.parse(localStorage.getItem("aeon.contractsWin") ?? "{}") as { open?: boolean; tab?: Tab };
    return { open: raw.open === true, tab: raw.tab === "active" || raw.tab === "history" || raw.tab === "rank" ? raw.tab : "offers" };
  } catch {
    return { open: false, tab: "offers" };
  }
}

/** Estado de la ventana: lo comparten la ventana y su botón de la barra superior. */
export const contractsStore = createStore<{ open: boolean; tab: Tab; set(next: Partial<{ open: boolean; tab: Tab }>): void }>((set, get) => ({
  ...load(),
  set(next) {
    set(next);
    try {
      localStorage.setItem("aeon.contractsWin", JSON.stringify({ open: get().open, tab: get().tab }));
    } catch {
      // Sin almacenamiento: solo dura esta sesión.
    }
  },
}));

/** Textos de las mejoras de un rango (acumuladas o solo las suyas). */
function perkLines(t: ReturnType<typeof useT>, p: RankPerk): string[] {
  const out: string[] = [];
  if (p.contractSlots) out.push(t("rank.perk.contractSlots", { n: p.contractSlots }));
  if (p.contractOffers) out.push(t("rank.perk.contractOffers", { n: p.contractOffers }));
  if (p.contractRewardPct) out.push(t("rank.perk.contractRewardPct", { n: p.contractRewardPct }));
  return out;
}

/** Pestaña «Rango»: título, experiencia hasta el siguiente, mejoras, tabla de rangos y cómo se gana. */
function RankTab() {
  const t = useT();
  const xp = useWorld((s) => s.rank?.xp ?? 0);
  const { index, rank, next } = rankOf(xp);
  const title = (id: string) => t(`rank.title.${id}` as I18nKey);
  const mine = perkLines(t, rankPerks(index));
  const firstPerk = RANKS.find((r) => r.perk);
  const span = next ? next.xp - rank.xp : 1;
  const pct = next ? Math.min(100, ((xp - rank.xp) / span) * 100) : 100;
  return (
    <div className="rank-tab">
      <div className="rank-head">
        <span className="contract-kind">{t("rank.of", { n: index + 1, max: RANKS.length })}</span>
        <strong className="rank-title">{title(rank.id)}</strong>
        <div className="contract-progress" aria-label={t("rank.xp", { xp })}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="muted small">
          <span className="mono">{t("rank.xp", { xp })}</span> · {next ? t("rank.toNext", { n: next.xp - xp, title: title(next.id) }) : t("rank.max")}
        </span>
      </div>
      <h3>{t("rank.perks")}</h3>
      {mine.length ? (
        <ul className="rank-perks">
          {mine.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{t("rank.noPerks", { title: title(firstPerk?.id ?? rank.id) })}</p>
      )}
      <h3>{t("rank.list")}</h3>
      <ol className="rank-list">
        {RANKS.map((r, i) => (
          <li key={r.id} className={i === index ? "current" : i < index ? "reached" : undefined}>
            <span className="rank-mark" aria-hidden>
              {i < index ? "✓" : i === index ? "★" : ""}
            </span>
            <span className="rank-name">{title(r.id)}</span>
            <span className="mono small muted">{r.xp}</span>
            <span className="small rank-perk">{r.perk ? perkLines(t, r.perk).join(" · ") : ""}</span>
          </li>
        ))}
      </ol>
      <h3>{t("rank.how")}</h3>
      <ul className="rank-perks muted small">
        <li>{t("rank.src.contract", { n: RANK_XP.contractPerTier })}</li>
        <li>{t("rank.src.pirate", { n: RANK_XP.pirateKill })}</li>
        <li>{t("rank.src.discovery", { n: RANK_XP.discovery })}</li>
        <li>{t("rank.src.mine", { n: RANK_XP.minedPerXp })}</li>
      </ul>
      <p className="muted small">{t("rank.keep")}</p>
    </div>
  );
}

/** Botón de la barra superior: contratos en curso y ofertas disponibles. */
export function ContractsButton() {
  const t = useT();
  const open = useStore(contractsStore, (s) => s.open);
  const view = useWorld((s) => s.contracts);
  if (!view) return null;
  const active = view.list.filter((c) => c.status === "active").length;
  return (
    <button type="button" className={open ? "btn empire-btn on" : "btn empire-btn"} title={t("contract.openRank")} aria-pressed={open} onClick={() => contractsStore.getState().set({ open: !open })}>
      <HudIcon name="contract" size={14} className="inline-icon" /> <span className="mono">{active}</span>
      {view.offers.length > 0 && <span className="contract-dot" aria-hidden />}
    </button>
  );
}

/** Lo que pide un contrato, en una frase de plantilla (sin texto libre). */
function Goal({ kind, n }: { kind: Contract["kind"]; n: number }) {
  const t = useT();
  return <>{t(`contract.desc.${kind}` as I18nKey, { n })}</>;
}

/**
 * Contratos (`docs/juego-solitario.md`): ofertas del día, contratos en curso
 * con su progreso y plazo, e historial. El progreso y el pago los decide el
 * servidor; aquí se aceptan, se siguen y se abandonan.
 */
export function ContractsWindow() {
  const t = useT();
  const open = useStore(contractsStore, (s) => s.open);
  const tab = useStore(contractsStore, (s) => s.tab);
  const view = useWorld((s) => s.contracts);
  const rankXp = useWorld((s) => s.rank?.xp ?? 0);
  const now = useServerNow(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  if (!open || !view) return null;
  const set = contractsStore.getState().set;
  const active = view.list.filter((c) => c.status === "active");
  const history = view.list.filter((c) => c.status !== "active");
  const run = async (op: Promise<I18nKey | null>) => {
    setBusy(true);
    setError(await op);
    setBusy(false);
  };
  const tabs: Array<{ id: Tab; n: number }> = [
    { id: "offers", n: view.offers.length },
    { id: "active", n: active.length },
    { id: "history", n: history.length },
  ];
  const rankIndex = rankOf(rankXp).index;
  const offer = (o: ContractOffer) => (
    <li key={o.id} className="contract-row">
      <div className="contract-main">
        <span className="contract-kind">{t(`contract.kind.${o.kind}` as I18nKey)}</span>
        <strong>
          <Goal kind={o.kind} n={o.target} />
        </strong>
        <span className="muted small">
          {t("contract.reward", { credits: o.credits, rep: o.reputation })} · {t("contract.hours", { h: o.hours })}
        </span>
      </div>
      <button className="btn btn-small" disabled={busy || active.length >= view.maxActive} onClick={() => void run(connection.command("contract.accept", { offerId: o.id }))}>
        {t("contract.accept")}
      </button>
    </li>
  );
  const row = (c: Contract) => (
    <li key={c.id} className={`contract-row ${c.status}`}>
      <div className="contract-main">
        <span className="contract-kind">{t(`contract.kind.${c.kind}` as I18nKey)}</span>
        <strong>
          <Goal kind={c.kind} n={c.target} />
        </strong>
        <div className="contract-progress" aria-label={`${c.progress} / ${c.target}`}>
          <span style={{ width: `${Math.min(100, (c.progress / Math.max(1, c.target)) * 100)}%` }} />
        </div>
        <span className="muted small">
          <span className="mono">
            {c.progress} / {c.target}
          </span>{" "}
          · {t("contract.reward", { credits: c.credits, rep: c.reputation })}
          {c.status === "active" ? <> · {t("contract.left", { time: formatDuration(c.expiresAt - now) })}</> : <> · {t(`contract.status.${c.status}` as I18nKey)}</>}
        </span>
      </div>
      {c.status === "active" && (
        <button className="btn btn-small" title={t("contract.abandonTitle")} disabled={busy} onClick={() => void run(connection.command("contract.abandon", { contractId: c.id }))}>
          {t("contract.abandon")}
        </button>
      )}
    </li>
  );
  return (
    <section className="empire-win contracts-win panel" aria-label={t("contract.title")}>
      <header className="empire-head">
        <nav className="planet-win-tabs empire-tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === tab} className={x.id === tab ? "planet-win-tab active" : "planet-win-tab"} onClick={() => set({ tab: x.id })}>
              {t(`contract.tab.${x.id}` as I18nKey)}
              <span className="empire-count">{x.n}</span>
            </button>
          ))}
          <button type="button" role="tab" aria-selected={tab === "rank"} className={tab === "rank" ? "planet-win-tab active" : "planet-win-tab"} onClick={() => set({ tab: "rank" })}>
            {t("rank.tab")}
            <span className="empire-count">{rankIndex + 1}</span>
          </button>
        </nav>
        <button type="button" className="icon-btn" aria-label={t("planetWin.close")} title={t("planetWin.close")} onClick={() => set({ open: false })}>
          ×
        </button>
      </header>
      <div className="empire-body" key={tab}>
        {tab === "rank" && <RankTab />}
        {tab !== "rank" && <p className="muted small">
          {t("contract.slots", { n: active.length, max: view.maxActive })} · {t("contract.refresh", { time: formatDuration(view.refreshAt - now) })}
        </p>}
        {tab === "offers" && (view.offers.length ? <ul className="contract-list">{view.offers.map(offer)}</ul> : <p className="muted">{t("contract.noOffers")}</p>)}
        {tab === "active" && (active.length ? <ul className="contract-list">{active.map(row)}</ul> : <p className="muted">{t("contract.noActive")}</p>)}
        {tab === "history" && (history.length ? <ul className="contract-list">{history.map(row)}</ul> : <p className="muted">{t("contract.noHistory")}</p>)}
        {error && (
          <p className="auth-error small" role="alert">
            {t(error)}
          </p>
        )}
      </div>
    </section>
  );
}
