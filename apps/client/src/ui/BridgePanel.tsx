import type { Battle, Colony, Fleet, Siege } from "@imperium/shared";
import { useWorld } from "../net/world";
import { useT } from "../state/store";
import { fmtInt, livePopulation } from "./colonies";
import { useServerNow } from "./useNow";

/**
 * Puente de mando durante el viaje cuántico: resumen del imperio (humanos a
 * bordo, flotas, colonias) y lo que pide atención (batallas, asedios, colonias
 * desabastecidas). Debajo van los paneles de flotas, batallas y colonias, que
 * funcionan igual que en el mapa (M).
 */
export function BridgePanel() {
  const t = useT();
  const now = useServerNow(1000);
  const humans = useWorld((s) => s.humans);
  const fleets = Object.values(useWorld((s) => s.fleets)) as Fleet[];
  const colonies = Object.values(useWorld((s) => s.colonies)) as Colony[];
  const battles = (Object.values(useWorld((s) => s.battles)) as Battle[]).filter((b) => b.outcome === "ongoing");
  const sieges = (Object.values(useWorld((s) => s.sieges)) as Siege[]).filter((s) => s.outcome === "ongoing");

  const aboard = humans ? Math.min(humans.capacity, humans.count + (humans.perHour * Math.max(0, now - humans.at)) / 3_600_000) : null;
  const moving = fleets.filter((f) => f.travel && f.travel.arriveAt > now).length;
  const population = colonies.reduce((a, c) => a + livePopulation(c, now), 0);
  const builds = colonies.reduce((a, c) => a + c.builds.length, 0);
  const short = colonies.filter((c) => c.shortage).length;
  const attacked = sieges.filter((s) => s.role === "defender").length;
  const alerts: string[] = [];
  if (battles.length > 0) alerts.push(t("bridge.battles", { n: battles.length }));
  if (attacked > 0) alerts.push(t("bridge.underSiege", { n: attacked }));
  if (sieges.length - attacked > 0) alerts.push(t("bridge.sieging", { n: sieges.length - attacked }));
  if (short > 0) alerts.push(t("bridge.shortage", { n: short }));

  return (
    <div className="fleets bridge panel" aria-label={t("bridge.title")}>
      <div className="help-toggle bridge-title">{t("bridge.title")}</div>
      <ul className="bridge-stats small">
        {aboard !== null && humans && (
          <li>
            {t("bridge.aboard")}: <span className="mono">{fmtInt(aboard)}</span> / <span className="mono">{fmtInt(humans.capacity)}</span>
          </li>
        )}
        <li>
          {t("bridge.fleets")}: <span className="mono">{fleets.length}</span>
          {moving > 0 && <> · {t("bridge.moving", { n: moving })}</>}
        </li>
        <li>
          {t("bridge.colonies")}: <span className="mono">{colonies.length}</span> · {t("colony.population")}: <span className="mono">{fmtInt(population)}</span>
          {builds > 0 && <> · {t("colony.queue")}: {builds}</>}
        </li>
      </ul>
      {alerts.length > 0 ? (
        <ul className="bridge-alerts small">
          {alerts.map((a) => (
            <li key={a} className="hud-tag warn">{a}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{t("bridge.calm")}</p>
      )}
    </div>
  );
}
