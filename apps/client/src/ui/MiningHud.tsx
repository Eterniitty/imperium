import { useState } from "react";
import { useStore } from "zustand";
import { ASTEROID_KINDS, FLAGSHIP_HOLD, HOLD_STOCK_IDS, MINING } from "@imperium/content";
import type { I18nKey } from "@imperium/shared";
import { spaceStore } from "../net/space";
import { connection, useWorld } from "../net/world";
import { useGame, useT } from "../state/store";
import { fmtInt } from "./colonies";
import { STOCK_COLORS } from "./common";
import { formatDistance } from "./FlightHud";
import { useKeyLabels } from "./keys";

/**
 * Espacio profundo y bodega: al pilotar, la región donde se está, el asteroide
 * al que apunta el morro (qué da, cuánto le queda, si está a tiro), la bodega
 * (lo minado y su capacidad) y la refinería de a bordo. Fuera del espacio
 * profundo solo aparece si la bodega lleva algo (para refinar).
 */
export function MiningHud() {
  const t = useT();
  const keys = useKeyLabels();
  const view = useGame((s) => s.view);
  const flight = useGame((s) => s.flight);
  const field = useStore(spaceStore, (s) => s.field);
  const live = useStore(spaceStore, (s) => s.hold);
  const aim = useStore(spaceStore, (s) => s.aim);
  const mining = useStore(spaceStore, (s) => s.mining);
  const fail = useStore(spaceStore, (s) => s.mineFail);
  const flagship = useWorld((s) => s.flagship);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  if (view !== "system" || !flight) return null;

  const hold = live?.hold ?? flagship?.hold ?? {};
  const capacity = live?.capacity ?? flagship?.holdCapacity ?? FLAGSHIP_HOLD.capacity;
  const used = HOLD_STOCK_IDS.reduce((n, r) => n + (hold[r] ?? 0), 0);
  const refining = live?.refining ?? false;
  if (!field && used < 0.1) return null;

  const asteroid = field && aim ? field.asteroids[aim.index] : undefined;
  const left = asteroid ? (field!.left[asteroid.i] ?? asteroid.amount) : 0;
  const inRange = aim !== null && aim.distance <= MINING.rangeM;
  const recentFail = fail && Date.now() - fail.at < 2500 ? fail.reason : null;

  const jettison = async (r: (typeof HOLD_STOCK_IDS)[number]) => {
    if (!window.confirm(t("hold.jettisonConfirm", { res: t(`resource.${r}`) }))) return;
    setBusy(true);
    setError(await connection.command("flagship.jettison", { resource: r }));
    setBusy(false);
  };

  const toggleRefine = async () => {
    setBusy(true);
    setError(await connection.command("flagship.refine", { on: !refining }));
    setBusy(false);
  };

  return (
    <div className="mining-hud panel" aria-label={t("hold.label")}>
      {field && (
        <>
          <div className="stat-label">{t("deep.title")}</div>
          <strong className="mining-region">{t(`deep.kind.${field.kind}`)}</strong>
          {asteroid ? (
            <div className={inRange ? "mining-aim in-range" : "mining-aim"}>
              <span>
                {t(`asteroid.${asteroid.kind}`)} · <span className="mono">{formatDistance(aim!.distance)}</span>
              </span>
              <span className="muted small">
                {Object.keys(ASTEROID_KINDS[asteroid.kind].yields)
                  .map((r) => t(`resource.${r}` as I18nKey))
                  .join(", ")}
              </span>
              <div className="combat-bar fuel">
                <span style={{ width: `${Math.max(0, Math.min(100, (left / asteroid.amount) * 100))}%` }} />
              </div>
              <span className="muted small">
                {left < 0.5 ? t("mining.depleted") : t("mining.left", { n: fmtInt(left) })}
                {" · "}
                {inRange ? t(mining ? "mining.active" : "mining.hint", { key: keys.mine }) : t("mining.approach", { range: formatDistance(MINING.rangeM) })}
              </span>
            </div>
          ) : (
            <p className="muted small">{t(field.asteroids.length ? "mining.aimHint" : "deep.empty")}</p>
          )}
          {recentFail && <span className="hud-tag warn">{t(`mining.fail.${recentFail}`)}</span>}
        </>
      )}
      <div className="combat-row">
        <span className="stat-label">{t("hold.label")}</span>
        <div className="combat-bar energy">
          <span style={{ width: `${Math.min(100, (used / capacity) * 100)}%` }} />
        </div>
        <span className="mono small">{fmtInt(used)}</span>
      </div>
      <div className="mining-hold small">
        {used < 0.1
          ? t("hold.empty", { n: capacity })
          : HOLD_STOCK_IDS.filter((r) => (hold[r] ?? 0) >= 0.1).map((r) => (
              <span key={r}>
                <span style={{ color: STOCK_COLORS[r] }}>{t(`resource.${r}`)}</span> <span className="mono">{fmtInt(hold[r] ?? 0)}</span>{" "}
                <button className="icon-btn" type="button" disabled={busy} onClick={() => void jettison(r)} title={t("hold.jettison")} aria-label={`${t("hold.jettison")}: ${t(`resource.${r}`)}`}>
                  ✕
                </button>
              </span>
            ))}
      </div>
      <button className={refining ? "btn btn-primary btn-small" : "btn btn-small"} type="button" disabled={busy || (!refining && (hold.volatiles ?? 0) < 0.1)} onClick={() => void toggleRefine()} title={t("hold.refineTitle", { k: FLAGSHIP_HOLD.refineVolatilesPerFuel })}>
        {t(refining ? "hold.refining" : "hold.refine")}
      </button>
      {!refining && used >= 0.1 && (hold.volatiles ?? 0) < 0.1 && <span className="muted small">{t("hold.noVolatiles")}</span>}
      {error && <span className="hud-tag warn">{t(error)}</span>}
    </div>
  );
}
