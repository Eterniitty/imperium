import { useEffect, useState } from "react";
import { HEIR_DOCTRINES, HEIRS, STOCK_IDS } from "@imperium/content";
import type { Colony, HeirDoctrineId, HeirView, I18nKey, LineageStatus } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { gameStore, useGame, useT } from "../state/store";
import { fmtInt } from "./colonies";
import { killerLabel, naturalCause } from "./deathCause";
import { formatDuration, useServerNow } from "./useNow";

type Run = (op: Promise<I18nKey | null>) => void;

/** Ejecuta órdenes del panel una a una y guarda el último error. */
function useRunner(): { busy: boolean; error: I18nKey | null; run: Run } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const run: Run = (op) => {
    setBusy(true);
    void op.then((e) => {
      setError(e);
      setBusy(false);
    });
  };
  return { busy, error, run };
}

const colonyName = (c: Colony) => c.name ?? c.planetName;

/**
 * Linaje (Fase 10): racha de muertes y gestación, Cunas de linaje (dónde
 * renacer), Herederos (gestar, doctrina, gobernar otra colonia, encarnarse) e
 * historial de muertes. Todo viene del servidor (tema `me`); las órdenes van
 * por el WebSocket.
 */
export function LineagePanel() {
  const t = useT();
  const open = useGame((s) => s.lineageOpen);
  const lineage = useWorld((s) => s.lineage);
  const close = () => gameStore.getState().setLineageOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="settings economy lineage panel" role="dialog" aria-labelledby="lineage-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2 id="lineage-title">{t("lineage.title")}</h2>
          <button className="icon-btn" aria-label={t("settings.close")} onClick={close}>
            ×
          </button>
        </div>
        {lineage ? <LineageBody lineage={lineage} /> : <p className="muted">{t("lineage.offline")}</p>}
      </div>
    </div>
  );
}

function LineageBody({ lineage }: { lineage: LineageStatus }) {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const now = useServerNow();
  const colonies = useWorld((s) => s.colonies);
  const { busy, error, run } = useRunner();
  const atCore = lineage.cradles.length === 0;

  return (
    <div className="economy-body">
      <div className="eco-stats">
        <div className="eco-stat">
          <span className="stat-label">{t("lineage.generation")}</span>
          <span className="stat-value mono">{lineage.generation}</span>
        </div>
        <div className="eco-stat">
          <span className="stat-label">{t("lineage.streak")}</span>
          <span className="stat-value mono">{lineage.streak}</span>
        </div>
        <div className="eco-stat" title={t("lineage.nextGestationTitle")}>
          <span className="stat-label">{t("lineage.nextGestation")}</span>
          <span className="stat-value mono">{formatDuration(lineage.nextGestationMs)}</span>
          <span className="muted small">{t(atCore ? "lineage.atCore" : "lineage.atCradle")}</span>
        </div>
      </div>
      <p className="muted small">{t("lineage.rules")}</p>

      <h3>{t("lineage.cradles")}</h3>
      {lineage.cradles.length === 0 ? (
        <p className="muted">{t("lineage.noCradles")}</p>
      ) : (
        <ul className="list lineage-list">
          <li>
            <label>
              <input type="radio" name="cradle" checked={lineage.preferredCradleId === null} disabled={busy} onChange={() => run(connection.command("lineage.prefer", { colonyId: null }))} />{" "}
              {t("lineage.nearest")}
            </label>
          </li>
          {lineage.cradles.map((c) => (
            <li key={c.colonyId}>
              <label>
                <input
                  type="radio"
                  name="cradle"
                  checked={lineage.preferredCradleId === c.colonyId}
                  disabled={busy}
                  onChange={() => run(connection.command("lineage.prefer", { colonyId: c.colonyId }))}
                />{" "}
                <strong>{c.colonyName}</strong> <span className="muted">· {c.systemName}</span>
              </label>
              {c.heirId && <span className="tag">{t("lineage.cradleBusy")}</span>}
            </li>
          ))}
        </ul>
      )}

      <h3>
        {t("lineage.heirs")} <span className="muted small">({lineage.heirs.length} / {HEIRS.maxPerEmperor})</span>
      </h3>
      <p className="muted small">{t("lineage.heirsHint")}</p>
      {lineage.heirs.length > 0 && (
        <ul className="list lineage-list">
          {lineage.heirs.map((h) => (
            <HeirRow key={h.id} heir={h} lineage={lineage} colonies={colonies} now={now} busy={busy} run={run} />
          ))}
        </ul>
      )}
      <GestateForm lineage={lineage} colonies={colonies} busy={busy} run={run} />
      {error && <p className="error small">{t(error)}</p>}

      <h3>{t("lineage.deaths")}</h3>
      {lineage.deaths.length === 0 ? (
        <p className="muted">{t("lineage.noDeaths")}</p>
      ) : (
        <table className="eco-table">
          <thead>
            <tr>
              <th>{t("lineage.col.when")}</th>
              <th>{t("lineage.col.where")}</th>
              <th>{t("lineage.col.by")}</th>
              <th>{t("lineage.col.streak")}</th>
              <th>{t("lineage.col.reborn")}</th>
            </tr>
          </thead>
          <tbody>
            {lineage.deaths.map((d) => (
              <tr key={d.id}>
                <td className="mono">{new Date(d.diedAt).toLocaleString()}</td>
                <td>
                  {d.systemName} <span className="muted small">({t(d.cause === "battle" ? "lineage.cause.battle" : "lineage.cause.combat")})</span>
                </td>
                <td>{d.by === null ? "—" : naturalCause(d.by) ? t(naturalCause(d.by)!.short) : killerLabel(d.by, locale)}</td>
                <td className="mono">{d.streak}</td>
                <td>{d.rebirthKind ? t(`lineage.kind.${d.rebirthKind}`) : t("lineage.kind.pending")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HeirRow({ heir, lineage, colonies, now, busy, run }: { heir: HeirView; lineage: LineageStatus; colonies: Record<string, Colony>; now: number; busy: boolean; run: Run }) {
  const t = useT();
  const governed = new Set(lineage.heirs.map((h) => h.colonyId));
  const free = (Object.values(colonies) as Colony[]).filter((c) => !governed.has(c.id));
  const [target, setTarget] = useState("");
  const chosen = free.find((c) => c.id === target)?.id ?? free[0]?.id;
  const cooldown = lineage.incarnateReadyAt - now;
  const active = heir.state === "active";
  return (
    <li className="lineage-heir">
      <div>
        <strong>{heir.name}</strong> <span className="muted">· {heir.colonyName} ({heir.systemName})</span>{" "}
        {active ? <span className="tag">{t("lineage.governing")}</span> : <span className="tag">{t("lineage.gestating", { time: formatDuration((heir.readyAt ?? now) - now) })}</span>}
      </div>
      <div className="lineage-actions">
        <label>
          {t("lineage.doctrine")}{" "}
          <select value={heir.doctrine} disabled={busy} onChange={(e) => run(connection.command("heir.doctrine", { heirId: heir.id, doctrine: e.target.value as HeirDoctrineId, builds: heir.builds }))}>
            {HEIR_DOCTRINES.map((d) => (
              <option key={d.id} value={d.id}>
                {t(`doctrine.${d.id}`)}
              </option>
            ))}
          </select>
        </label>
        <label title={t("lineage.buildsTitle")}>
          <input type="checkbox" checked={heir.builds} disabled={busy} onChange={(e) => run(connection.command("heir.doctrine", { heirId: heir.id, doctrine: heir.doctrine, builds: e.target.checked }))} />{" "}
          {t("lineage.builds")}
        </label>
      </div>
      <p className="muted small">{t(`doctrine.${heir.doctrine}.desc`)}</p>
      {active && (
        <div className="lineage-actions">
          {free.length > 0 && (
            <>
              <select value={chosen} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
                {free.map((c) => (
                  <option key={c.id} value={c.id}>
                    {colonyName(c)} · {c.systemName}
                  </option>
                ))}
              </select>
              <button className="link-btn" disabled={busy || !chosen} onClick={() => chosen && run(connection.command("heir.assign", { heirId: heir.id, colonyId: chosen }))}>
                {t("lineage.assign")}
              </button>
            </>
          )}
          <button
            className="btn"
            disabled={busy || cooldown > 0}
            title={t("lineage.incarnateTitle")}
            onClick={() => window.confirm(t("lineage.incarnateConfirm", { name: heir.name })) && run(connection.command("heir.incarnate", { heirId: heir.id }))}
          >
            {cooldown > 0 ? t("lineage.incarnateIn", { time: formatDuration(cooldown) }) : t("lineage.incarnate")}
          </button>
        </div>
      )}
    </li>
  );
}

function GestateForm({ lineage, colonies, busy, run }: { lineage: LineageStatus; colonies: Record<string, Colony>; busy: boolean; run: Run }) {
  const t = useT();
  const free = lineage.cradles.filter((c) => !c.heirId);
  const [cradle, setCradle] = useState("");
  const [doctrine, setDoctrine] = useState<HeirDoctrineId>("prosperity");
  const chosen = free.find((c) => c.colonyId === cradle)?.colonyId ?? free[0]?.colonyId;
  if (lineage.cradles.length === 0) return null;
  if (lineage.heirs.length >= HEIRS.maxPerEmperor) return <p className="muted small">{t("lineage.heirLimit")}</p>;
  if (free.length === 0) return <p className="muted small">{t("lineage.noFreeCradle")}</p>;
  const col = chosen ? colonies[chosen] : undefined;
  const cost = STOCK_IDS.filter((r) => HEIRS.cost[r] > 0)
    .map((r) => `${fmtInt(HEIRS.cost[r])} ${t(`resource.${r}`).toLowerCase()}`)
    .join(" · ");
  return (
    <div className="lineage-gestate">
      <h4>{t("lineage.gestateTitle")}</h4>
      <div className="lineage-actions">
        <select value={chosen} onChange={(e) => setCradle(e.target.value)} disabled={busy}>
          {free.map((c) => (
            <option key={c.colonyId} value={c.colonyId}>
              {c.colonyName} · {c.systemName}
            </option>
          ))}
        </select>
        <select value={doctrine} onChange={(e) => setDoctrine(e.target.value as HeirDoctrineId)} disabled={busy}>
          {HEIR_DOCTRINES.map((d) => (
            <option key={d.id} value={d.id}>
              {t(`doctrine.${d.id}`)}
            </option>
          ))}
        </select>
        <button className="btn" disabled={busy || !chosen} onClick={() => chosen && run(connection.command("heir.gestate", { colonyId: chosen, doctrine }))}>
          {t("lineage.gestate")}
        </button>
      </div>
      <p className="muted small">
        {t("lineage.gestateCost", { cost, people: HEIRS.population, hours: HEIRS.gestationHours })}
        {col ? ` · ${t("lineage.population", { n: fmtInt(col.population) })}` : ""}
      </p>
      <p className="muted small">{t(`doctrine.${doctrine}.desc`)}</p>
    </div>
  );
}
