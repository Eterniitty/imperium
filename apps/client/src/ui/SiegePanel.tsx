import { useState } from "react";
import type { Fleet, I18nKey, PlanetClaim, Siege } from "@imperium/shared";
import { INSTALLATIONS, SIEGE } from "@imperium/content";
import { siegePower } from "@imperium/sim";
import { connection, useWorld } from "../net/world";
import { useAuth } from "../state/auth";
import { useGame, useT } from "../state/store";
import { factionName } from "./aliens";
import { fmtInt, liveHumans } from "./colonies";
import { Meter } from "./common";
import { formatDuration, useServerNow } from "./useNow";

const HOUR_MS = 3_600_000;

/** Progreso proyectado a ahora (el servidor lo resuelve en cada `siege.tick`). */
export function liveProgress(s: Siege, now: number): number {
  if (s.outcome !== "ongoing" || s.state !== "advancing") return s.progress;
  return Math.min(1, s.progress + (s.ratePerHour * Math.max(0, now - s.at)) / HOUR_MS);
}

/** ¿Está parada (llegada) la flota en ese sistema? */
function parkedAt(f: Fleet, systemId: string, now: number): boolean {
  if (f.travel && f.travel.arriveAt > now) return false;
  return (f.travel ? f.travel.to.systemId : f.location.systemId) === systemId;
}

/** Tropas que lleva una flota: pasajeros y colonos. */
function troopsOf(f: Fleet): number {
  return Math.floor(f.cargo.humans + f.ships.reduce((n, s) => n + s.humans, 0));
}

/**
 * Un asedio (Fase 9b) visto por el atacante o el defensor: progreso, estado,
 * fuerzas, último desembarco y, para el atacante, desembarcar tropas (de una
 * flota del sistema o de su nave) y levantar el asedio.
 */
export function SiegeCard({ siege }: { siege: Siege }) {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const fleets = useWorld((s) => s.fleets);
  const humans = useWorld((s) => s.humans);
  const emperor = useAuth((s) => s.emperor);
  const now = useServerNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const [source, setSource] = useState<string>("");
  // Bombardeo orbital: qué instalación destruir (no se ven las del enemigo: si no la tiene, el servidor lo dice).
  const [razeTarget, setRazeTarget] = useState<string>("lineage_cradle");

  const planet = siege.colonyName ?? siege.planetName;
  const enemy = siege.role === "attacker"
    ? siege.defenderFactionId
      ? factionName(locale, siege.defenderFactionId)
      : (siege.defenderName ?? t("colony.independent"))
    : siege.attackerFactionId
      ? factionName(locale, siege.attackerFactionId)
      : siege.attackerName;
  const progress = liveProgress(siege, now);
  const ongoing = siege.outcome === "ongoing";
  const etaMs = siege.state === "advancing" && siege.ratePerHour > 0 ? ((1 - progress) / siege.ratePerHour) * HOUR_MS : null;

  // Fuentes de tropas del atacante: flotas paradas en el sistema con humanos y su nave, si está allí.
  const troopFleets = (Object.values(fleets) as Fleet[]).filter((f) => parkedAt(f, siege.systemId, now) && !f.battleId && troopsOf(f) >= 1).sort((a, b) => a.number - b.number);
  const travel = emperor?.travel && emperor.travel.arriveAt > now ? emperor.travel : null;
  const emperorAt = emperor ? (emperor.travel && !travel ? emperor.travel.to.systemId : emperor.location.systemId) : null;
  const aboard = Math.floor(liveHumans(humans, now));
  const flagshipHere = !travel && emperorAt === siege.systemId && aboard >= 1;
  const options: Array<{ id: string; label: string }> = [
    ...troopFleets.map((f) => ({ id: f.id, label: t("siege.fleetTroops", { fleet: t("fleet.name", { n: f.number }), n: fmtInt(troopsOf(f)) }) })),
    ...(flagshipHere ? [{ id: "flagship", label: t("siege.flagship", { n: fmtInt(aboard) }) }] : []),
  ];
  const chosen = options.find((o) => o.id === source)?.id ?? options[0]?.id;

  const run = async (op: Promise<I18nKey | null>) => {
    setBusy(true);
    setError(await op);
    setBusy(false);
  };
  const assault = () => {
    if (!chosen) return;
    void run(connection.command("siege.assault", chosen === "flagship" ? { siegeId: siege.id } : { siegeId: siege.id, fleetId: chosen }));
  };

  const a = siege.lastAssault;
  return (
    <li className={`battle siege siege-${ongoing ? siege.state : siege.outcome}`}>
      <strong>{siege.role === "attacker" ? t("siege.vs.attacker", { planet, enemy, system: siege.systemName }) : t("siege.vs.defender", { planet, enemy, system: siege.systemName })}</strong>
      <span className="small">
        {ongoing ? t(`siege.state.${siege.state}`) : t(`siege.outcome.${siege.outcome as Exclude<Siege["outcome"], "ongoing">}`)}
      </span>
      {ongoing && (
        <>
          <span className="small">
            <Meter value={progress} color={siege.role === "attacker" ? "#ffc857" : "#ff6b6b"} /> <span className="mono">{t("siege.progress", { pct: Math.floor(progress * 100) })}</span>
            {etaMs !== null && <> · {t("siege.eta", { time: formatDuration(etaMs) })}</>}
          </span>
          <span className="muted small">{t("siege.forces", { attack: fmtInt(siege.attack), defense: fmtInt(siege.defense) })}</span>
          <span className="muted small">{t("siege.defenders", { n: fmtInt(siege.defenders) })}</span>
        </>
      )}
      {a && (
        <span className="muted small">
          {a.captured
            ? t("siege.lastAssault.won", { troops: fmtInt(a.troops), defenders: fmtInt(a.defenders), lost: fmtInt(a.attackerLosses) })
            : t("siege.lastAssault.lost", { troops: fmtInt(a.troops), defenders: fmtInt(a.defenders), lost: fmtInt(a.populationLosses) })}
        </span>
      )}
      {ongoing && siege.role === "attacker" && (
        <span className="small siege-actions">
          {siege.state === "ready" &&
            (options.length > 0 ? (
              <>
                <select aria-label={t("siege.assaultWith")} value={chosen} onChange={(e) => setSource(e.target.value)}>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>{" "}
                <button className="btn btn-primary" disabled={busy} onClick={assault}>
                  {t("siege.assault")}
                </button>
              </>
            ) : (
              <span className="muted">{t("siege.noTroops")}</span>
            ))}{" "}
          {siege.state === "ready" && (
            <>
              <select aria-label={t("siege.razeTarget")} value={razeTarget} onChange={(e) => setRazeTarget(e.target.value)}>
                {INSTALLATIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {t(d.nameKey as I18nKey)}
                  </option>
                ))}
              </select>{" "}
              <button className="btn" disabled={busy} title={t("siege.razeHint", { pct: Math.round(SIEGE.razeProgressAfter * 100) })} onClick={() => void run(connection.command("siege.raze", { siegeId: siege.id, installationId: razeTarget }))}>
                {t("siege.raze")}
              </button>{" "}
            </>
          )}
          <button className="link-btn" disabled={busy} onClick={() => void run(connection.command("siege.lift", { siegeId: siege.id }))}>
            {t("siege.lift")}
          </button>
        </span>
      )}
      {ongoing && siege.role === "defender" && <span className="muted small">{t("siege.defendHint")}</span>}
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
    </li>
  );
}

/** Asedios propios y a colonias propias (panel «Batallas»). */
export function SiegeList() {
  const t = useT();
  const sieges = useWorld((s) => s.sieges);
  const list = (Object.values(sieges) as Siege[]).sort((a, b) => Number(b.outcome === "ongoing") - Number(a.outcome === "ongoing") || b.startedAt - a.startedAt);
  if (list.length === 0) return null;
  return (
    <div className="war-contacts sieges">
      <span className="small">{t("siege.title")}</span>
      <ul className="fleet-list">
        {list.map((s) => (
          <SiegeCard key={s.id} siege={s} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Asedio en el panel de un planeta con colonia: el asedio en curso (propio o
 * contra tu colonia) o, si es ajena, la orden de asediarla con las flotas
 * armadas paradas en el sistema.
 */
export function PlanetSiege({ systemId, colonyId, claim, own }: { systemId: string; colonyId: string; claim: PlanetClaim | undefined; own: boolean }) {
  const t = useT();
  const sieges = useWorld((s) => s.sieges);
  const fleets = useWorld((s) => s.fleets);
  const now = useServerNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const active = (Object.values(sieges) as Siege[]).find((s) => s.colonyId === colonyId && s.outcome === "ongoing");
  if (active) {
    return (
      <ul className="fleet-list planet-siege">
        <SiegeCard siege={active} />
      </ul>
    );
  }
  if (own) return claim?.besieged ? <p className="auth-warning">{t("siege.besieged")}</p> : null;
  const armed = (Object.values(fleets) as Fleet[]).some((f) => parkedAt(f, systemId, now) && !f.battleId && siegePower(f.ships.map((s) => s.classId)) > 0);
  return (
    <div className="colony-claim planet-siege">
      {claim?.besieged && <p className="auth-warning">{t("siege.besieged")}</p>}
      {armed ? (
        <button
          className="btn"
          disabled={busy || claim?.besieged}
          onClick={async () => {
            setBusy(true);
            setError(await connection.command("siege.start", { colonyId }));
            setBusy(false);
          }}
        >
          {t("siege.start")}
        </button>
      ) : (
        <p className="muted small">{t("siege.startHint")}</p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
