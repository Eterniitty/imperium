import { useEffect, useState } from "react";
import type { SystemAliensResponse } from "@imperium/shared";
import { useWorld } from "../net/world";
import { useAliens } from "../state/aliens";
import { api } from "../state/auth";
import { useGame, useT } from "../state/store";
import { factionName, speciesColor, speciesName } from "./aliens";
import { contentText } from "./fleets";

/** Cada cuánto se vuelve a mirar el sistema seleccionado (las flotas se mueven). */
const REFRESH_MS = 60_000;

/**
 * Presencia alienígena en el sistema seleccionado (Fase 11): de quién es el
 * territorio, si hay ruinas precursoras y qué flotas alienígenas hay (solo si
 * tus sensores lo cubren ahora). Solo para sistemas descubiertos.
 */
export function AlienPresence({ systemId }: { systemId: string }) {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const discovered = useWorld((s) => s.discovered[systemId] === true);
  const standings = useAliens((s) => s.standings);
  const [data, setData] = useState<SystemAliensResponse | null>(null);

  useEffect(() => {
    setData(null);
    if (!discovered) return;
    let alive = true;
    const load = async () => {
      const res = await api<SystemAliensResponse>("GET", `/api/systems/${encodeURIComponent(systemId)}/aliens`);
      if (alive && res.ok) setData(res.data);
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [systemId, discovered]);

  if (!data || (!data.territory && !data.relic && data.fleets.length === 0)) return null;
  const standing = data.territory ? standings.find((s) => s.factionId === data.territory!.factionId) : undefined;

  return (
    <div className="alien-presence">
      <h3>{t("system.aliens")}</h3>
      {data.territory && (
        <p className="small">
          <span className="dot" style={{ background: speciesColor(data.territory.speciesId) }} />{" "}
          <strong>
            {t("system.territory", { faction: factionName(locale, data.territory.factionId), species: speciesName(locale, data.territory.speciesId) })}
          </strong>
          <br />
          <span className={standing?.hostile ? "alien-hostile" : "muted"}>{t(standing?.hostile ? "system.alienHostile" : "system.alienPeaceful")}</span>
        </p>
      )}
      {data.relic && <p className="small anomaly">{t("system.relic")}</p>}
      {data.territory &&
        (data.sensed ? (
          data.fleets.length > 0 ? (
            <>
              <span className="small">{t("system.alienFleets")}</span>
              <ul className="emperor-list">
                {data.fleets.map((f) => (
                  <li key={f.fleetId}>
                    <span className="dot" style={{ background: speciesColor(f.speciesId) }} />
                    <strong>{factionName(locale, f.factionId)}</strong>
                    <span className="muted small">
                      {Object.entries(f.ships)
                        .map(([id, n]) => t("ship.count", { count: n, name: contentText(locale, `ship.${id}.name`) }))
                        .join(" · ")}
                      {f.inBattle && <> · {t("aliens.inBattle")}</>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted small">{t("system.noAlienFleets")}</p>
          )
        ) : (
          <p className="muted small">{t("system.alienUnsensed")}</p>
        ))}
    </div>
  );
}
