import { useCallback, useEffect, useState } from "react";
import { STOCK_IDS, type StockId } from "@imperium/content";
import type { Colony, I18nKey, MarketMineResponse, MarketResource, MarketResponse, OrderSide } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { api } from "../state/auth";
import { useGame, useT } from "../state/store";
import { fmtCredits, fmtInt, liveCredits, liveStock } from "./colonies";
import { formatDuration, useServerNow } from "./useNow";

const REFRESH_MS = 15_000;

/** Pestaña «Mercado»: precios, historial, libro de órdenes, crear y cancelar órdenes, envíos en camino. */
export function MarketTab() {
  const t = useT();
  const now = useServerNow();
  const wallet = useWorld((s) => s.wallet);
  const colonies = useWorld((s) => s.colonies);
  const own = (Object.values(colonies) as Colony[]).sort((a, b) => a.foundedAt - b.foundedAt);
  const [resource, setResource] = useState<StockId>("metal");
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [mine, setMine] = useState<MarketMineResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const [m, me] = await Promise.all([api<MarketResponse>("GET", "/api/market"), api<MarketMineResponse>("GET", "/api/market/mine")]);
    if (m.ok) setMarket(m.data);
    if (me.ok) setMine(me.data);
    setFailed(!m.ok);
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (!market) return <p className="muted small">{t(failed ? "eco.loadError" : "eco.loading")}</p>;
  const r = market.resources.find((x) => x.resource === resource)!;

  return (
    <div className="economy-body">
      <p className="muted small">{t("market.intro", { fee: `${Math.round(market.feeRate * 1000) / 10} %` })}</p>
      {wallet && <p className="small">{t("market.balance", { credits: fmtCredits(liveCredits(wallet, now)) })}</p>}
      <div className="tabs resource-tabs" role="tablist" aria-label={t("wiki.col.resource")}>
        {STOCK_IDS.map((id) => (
          <button key={id} role="tab" aria-selected={resource === id} className={resource === id ? "lang-btn active" : "lang-btn"} onClick={() => setResource(id)}>
            {t(`resource.${id}`)}
          </button>
        ))}
      </div>
      <div className="eco-stats">
        <Price label={t("market.bestBid")} value={r.bestBid} />
        <Price label={t("market.bestAsk")} value={r.bestAsk} />
        <Price label={t("market.last")} value={r.last} />
        <div className="eco-stat">
          <span className="stat-label">{t("market.volume24h")}</span>
          <span className="stat-value mono">{fmtInt(r.volume24h)}</span>
        </div>
      </div>
      <PriceChart data={r} />
      <OrderBook data={r} />
      {own.length > 0 ? <OrderForm resource={resource} own={own} market={r} onDone={refresh} /> : <p className="muted small">{t("market.needColony")}</p>}
      {mine && <Mine mine={mine} now={now} onDone={refresh} />}
    </div>
  );
}

function Price({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="eco-stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value mono">{value === null ? "—" : `₢ ${fmtCredits(value)}`}</span>
    </div>
  );
}

/**
 * Historial del precio medio por hora (una serie: el título la nombra) y,
 * aparte, el volumen (otra escala, otro gráfico). Cada hora tiene su
 * descripción emergente con la cifra exacta.
 */
function PriceChart({ data }: { data: MarketResource }) {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const h = data.history;
  if (h.length === 0) return <p className="muted small chart-empty">{t("market.noHistory")}</p>;
  const W = 320;
  const H = 90;
  const VH = 28;
  const pad = 4;
  const min = Math.min(...h.map((p) => p.avg));
  const max = Math.max(...h.map((p) => p.avg));
  // Con un solo precio, la línea queda en medio.
  const lo = max === min ? min - Math.max(0.01, min * 0.1) : min;
  const hi = max === min ? max + Math.max(0.01, max * 0.1) : max;
  const t0 = h[0]!.t;
  const t1 = Math.max(h.at(-1)!.t, t0 + 3_600_000);
  const x = (tt: number) => pad + ((tt - t0) / (t1 - t0)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const vmax = Math.max(...h.map((p) => p.volume));
  const bw = Math.max(2, (W - 2 * pad) / Math.max(12, h.length) - 2);
  const hour = (tt: number) => new Date(tt).toLocaleString(locale === "es" ? "es-ES" : "en-GB", { day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <figure className="price-chart">
      <figcaption className="small">
        {t("market.chartTitle", { resource: t(`resource.${data.resource}`) })}{" "}
        <span className="muted mono">
          ₢ {fmtCredits(min)} – {fmtCredits(max)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("market.chartTitle", { resource: t(`resource.${data.resource}`) })}>
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="chart-axis" />
        <polyline className="chart-line" points={h.map((p) => `${x(p.t)},${y(p.avg)}`).join(" ")} />
        {h.map((p) => (
          <g key={p.t}>
            <circle cx={x(p.t)} cy={y(p.avg)} r={h.length > 24 ? 2 : 4} className="chart-dot" />
            {/* Zona sensible más grande que el punto, con la cifra exacta. */}
            <rect x={x(p.t) - 6} y={0} width={12} height={H} className="chart-hit">
              <title>{`${hour(p.t)} · ₢ ${fmtCredits(p.avg)} · ${fmtInt(p.volume)}`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <svg viewBox={`0 0 ${W} ${VH}`} className="volume-chart" role="img" aria-label={t("market.volume")}>
        {h.map((p) => {
          const bh = Math.max(1, (p.volume / vmax) * (VH - 2));
          return (
            <rect key={p.t} x={x(p.t) - bw / 2} y={VH - bh} width={bw} height={bh} rx={1} className="chart-bar">
              <title>{`${hour(p.t)} · ${fmtInt(p.volume)}`}</title>
            </rect>
          );
        })}
      </svg>
      <span className="muted small">{t("market.volume")}</span>
    </figure>
  );
}

function OrderBook({ data }: { data: MarketResource }) {
  const t = useT();
  const side = (rows: Array<{ price: number; quantity: number }>, cls: string) =>
    rows.length === 0 ? (
      <p className="muted small">{t("market.empty")}</p>
    ) : (
      <table className="eco-table">
        <thead>
          <tr>
            <th className="num">{t("market.price")}</th>
            <th className="num">{t("market.quantity")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.price} className={cls}>
              <td className="num mono">{fmtCredits(l.price)}</td>
              <td className="num mono">{fmtInt(l.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  return (
    <div className="order-book">
      <div>
        <h4>{t("market.bids")}</h4>
        {side(data.bids, "bid")}
      </div>
      <div>
        <h4>{t("market.asks")}</h4>
        {side(data.asks, "ask")}
      </div>
    </div>
  );
}

function OrderForm({ resource, own, market, onDone }: { resource: StockId; own: Colony[]; market: MarketResource; onDone: () => Promise<void> }) {
  const t = useT();
  const now = useServerNow(5000);
  const [side, setSide] = useState<OrderSide>("buy");
  const [colonyId, setColonyId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<I18nKey | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = own.find((c) => c.id === colonyId) ?? own[0]!;
  const q = Number.parseInt(quantity, 10);
  const p = Number.parseFloat(price.replace(",", "."));
  const total = q > 0 && p > 0 ? Math.round(q * p * 100) / 100 : null;
  const suggested = side === "buy" ? market.bestAsk : market.bestBid;

  const submit = async () => {
    if (!(q > 0 && p > 0)) return setError("market.invalid");
    setBusy(true);
    setDone(false);
    const err = await connection.command("market.order", { resource, side, price: Math.round(p * 100) / 100, quantity: q, colonyId: chosen.id });
    setBusy(false);
    setError(err);
    if (!err) {
      setDone(true);
      setQuantity("");
      await onDone();
    }
  };

  return (
    <section className="order-form">
      <h4>{t("market.newOrder")}</h4>
      <div className="mode" role="group">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} className={side === s ? "lang-btn active" : "lang-btn"} aria-pressed={side === s} onClick={() => setSide(s)}>
            {t(`market.side.${s}`)}
          </button>
        ))}
      </div>
      <div className="logistics-grid">
        <label className="small">
          {t(side === "buy" ? "market.deliverTo" : "market.sellFrom")}
          <select value={chosen.id} onChange={(e) => setColonyId(e.target.value)}>
            {own.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.planetName}
              </option>
            ))}
          </select>
        </label>
        <label className="small">
          {t("market.quantity")} {side === "sell" && <span className="muted">({fmtInt(liveStock(chosen, now)[resource])})</span>}
          <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ""))} />
        </label>
        <label className="small">
          {t("market.pricePerUnit")}
          <input inputMode="decimal" value={price} placeholder={suggested !== null ? String(suggested) : ""} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.,]/g, ""))} />
        </label>
      </div>
      <p className="small">
        {total !== null ? t(side === "buy" ? "market.totalBuy" : "market.totalSell", { total: fmtCredits(total) }) : <span className="muted">{t("market.hint")}</span>}
      </p>
      <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
        {t(side === "buy" ? "market.placeBuy" : "market.placeSell")}
      </button>
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
      {done && <p className="small ok-text">{t("market.placed")}</p>}
    </section>
  );
}

function Mine({ mine, now, onDone }: { mine: MarketMineResponse; now: number; onDone: () => Promise<void> }) {
  const t = useT();
  const [error, setError] = useState<I18nKey | null>(null);
  const cancel = async (orderId: string) => {
    setError(await connection.command("market.cancel", { orderId }));
    await onDone();
  };
  return (
    <section>
      <h4>{t("market.myOrders", { n: mine.orders.length, max: mine.maxOpenOrders })}</h4>
      {mine.orders.length === 0 ? (
        <p className="muted small">{t("market.noOrders")}</p>
      ) : (
        <ul className="fleet-list">
          {mine.orders.map((o) => (
            <li key={o.id} className="my-order">
              <span className="small">
                <strong className={o.side === "buy" ? "bid" : "ask"}>{t(`market.side.${o.side}`)}</strong> {fmtInt(o.remaining)}/{fmtInt(o.quantity)} {t(`resource.${o.resource}`).toLowerCase()} ·
                ₢ {fmtCredits(o.price)} · {o.colonyName}
              </span>
              <button className="link-btn" onClick={() => void cancel(o.id)}>
                {t("market.cancel")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
      {mine.shipments.length > 0 && (
        <>
          <h4>{t("market.shipments")}</h4>
          <ul className="fleet-list">
            {mine.shipments.map((s) => (
              <li key={s.id} className="small">
                {STOCK_IDS.filter((r) => s.amounts[r] > 0)
                  .map((r) => `${fmtInt(s.amounts[r])} ${t(`resource.${r}`).toLowerCase()}`)
                  .join(" · ")}{" "}
                → {s.kind === "trade" ? s.to : t(`project.${s.to}.name` as I18nKey)} ·{" "}
                <span className="mono">{s.arriveAt > now ? formatDuration(s.arriveAt - now) : t("market.arriving")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {mine.trades.length > 0 && (
        <>
          <h4>{t("market.recentTrades")}</h4>
          <ul className="fleet-list">
            {mine.trades.map((tr, i) => (
              <li key={i} className="small">
                <strong className={tr.side === "buy" ? "bid" : "ask"}>{t(tr.side === "buy" ? "market.bought" : "market.sold")}</strong> {fmtInt(tr.quantity)}{" "}
                {t(`resource.${tr.resource}`).toLowerCase()} · ₢ {fmtCredits(tr.price)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
