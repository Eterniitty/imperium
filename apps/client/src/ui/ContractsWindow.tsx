import { useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Contract, ContractOffer, I18nKey } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { useT } from "../state/store";
import { HudIcon } from "./hudIcons";
import { formatDuration, useServerNow } from "./useNow";

type Tab = "offers" | "active" | "history";

/** Abierta o no y pestaña (se recuerda en este navegador). */
function load(): { open: boolean; tab: Tab } {
  try {
    const raw = JSON.parse(localStorage.getItem("aeon.contractsWin") ?? "{}") as { open?: boolean; tab?: Tab };
    return { open: raw.open === true, tab: raw.tab === "active" || raw.tab === "history" ? raw.tab : "offers" };
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

/** Botón de la barra superior: contratos en curso y ofertas disponibles. */
export function ContractsButton() {
  const t = useT();
  const open = useStore(contractsStore, (s) => s.open);
  const view = useWorld((s) => s.contracts);
  if (!view) return null;
  const active = view.list.filter((c) => c.status === "active").length;
  return (
    <button type="button" className={open ? "btn empire-btn on" : "btn empire-btn"} title={t("contract.open")} aria-pressed={open} onClick={() => contractsStore.getState().set({ open: !open })}>
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
        </nav>
        <button type="button" className="icon-btn" aria-label={t("planetWin.close")} title={t("planetWin.close")} onClick={() => set({ open: false })}>
          ×
        </button>
      </header>
      <div className="empire-body" key={tab}>
        <p className="muted small">
          {t("contract.slots", { n: active.length, max: view.maxActive })} · {t("contract.refresh", { time: formatDuration(view.refreshAt - now) })}
        </p>
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
