import { useState } from "react";
import { PROBE } from "@imperium/content";
import { distance, type Colony, type I18nKey, type Probe, type StarSystemSummary } from "@imperium/shared";
import { positionAt } from "@imperium/sim";
import { connection, serverNow, useWorld } from "../net/world";
import { useAuth } from "../state/auth";
import { findSystemSummary, useT } from "../state/store";
import { formatDuration } from "./useNow";

/**
 * Lanzar una sonda de exploración a un sistema sin descubrir (`PROBE`): sale de
 * la nave o de la colonia propia más cercana; aquí se ve el coste, el tiempo de
 * vuelo y por qué no se puede, si es el caso.
 */
export function ProbeLauncher({ system }: { system: StarSystemSummary }) {
  const t = useT();
  const emperor = useAuth((s) => s.emperor);
  const colonies = useWorld((s) => s.colonies);
  const probes = useWorld((s) => s.probes);
  const wallet = useWorld((s) => s.wallet);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  if (!emperor) return null;
  const flying = (Object.values(probes) as Probe[]).find((p) => p.systemId === system.id);
  if (flying) return <p className="small">{t("probe.flying", { time: formatDuration(flying.arriveAt - serverNow()) })}</p>;

  const origins = emperor.gestating ? [] : [positionAt(emperor, serverNow())];
  for (const c of Object.values(colonies) as Colony[]) {
    const s = findSystemSummary(c.systemId);
    if (s) origins.push(s.position);
  }
  const d = origins.length ? Math.min(...origins.map((o) => distance(o, system.position))) : Infinity;
  const inRange = d <= PROBE.maxRangeLy;
  const active = Object.keys(probes).length;
  const credits = wallet?.credits ?? 0;
  const minutes = Math.max(1, Math.round((d / PROBE.speedLyPerHour) * 60));
  const launch = async () => {
    setBusy(true);
    setError(await connection.command("probe.launch", { systemId: system.id }));
    setBusy(false);
  };
  return (
    <div className="probe-launcher">
      <button
        className="btn"
        disabled={busy || !inRange || active >= PROBE.maxActive || credits < PROBE.costCredits}
        title={t("probe.hint", { range: PROBE.maxRangeLy, max: PROBE.maxActive })}
        onClick={() => void launch()}
      >
        {t("probe.launch", { cost: PROBE.costCredits })}
      </button>
      <span className="muted small">
        {inRange ? t("probe.eta", { min: minutes }) : t("probe.outOfRange", { range: PROBE.maxRangeLy })}
        {active >= PROBE.maxActive && <> · {t("probe.limit", { max: PROBE.maxActive })}</>}
      </span>
      {error && (
        <p className="auth-error small" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
