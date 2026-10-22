import { useState } from "react";
import { useStore } from "zustand";
import type { EscortOrder, Fleet, I18nKey } from "@imperium/shared";
import { fleetShipId, spaceStore } from "../net/space";
import { connection, useWorld } from "../net/world";
import { useT } from "../state/store";

const ORDERS: EscortOrder[] = ["follow", "attack", "hold", "recall"];

/**
 * Órdenes a las escoltas (Fase 9d): aparece al pilotar la nave del Emperador
 * con naves de sus flotas escoltándola. «Atacar» va contra el blanco fijado.
 */
export function EscortHud() {
  const t = useT();
  const ships = useStore(spaceStore, (s) => s.ships);
  const targetId = useStore(spaceStore, (s) => s.targetId);
  const remote = useStore(spaceStore, (s) => s.remote);
  const fleets = useWorld((s) => s.fleets);
  const [order, setOrder] = useState<EscortOrder>("follow");
  const [cruise, setCruise] = useState(true);
  const [error, setError] = useState<I18nKey | null>(null);
  if (remote) return null;
  const own = new Set((Object.values(fleets) as Fleet[]).flatMap((f) => f.ships.map((s) => fleetShipId(s.id))));
  const escorts = Object.keys(ships).filter((id) => own.has(id)).length;
  if (escorts === 0) return null;
  const give = async (o: EscortOrder) => {
    const err = await connection.command("escort.order", o === "attack" && targetId ? { order: o, targetId } : { order: o });
    setError(err);
    if (!err) setOrder(o);
  };
  return (
    <div className="escort-hud panel" role="group" aria-label={t("escort.title", { n: escorts })}>
      <span className="stat-label">{t("escort.title", { n: escorts })}</span>
      <div className="escort-orders">
        {ORDERS.map((o) => (
          <button key={o} className={o === order ? "lang-btn active" : "lang-btn"} disabled={o === "attack" && !targetId} title={t(`escort.${o}.hint`)} onClick={() => void give(o)}>
            {t(`escort.${o}`)}
          </button>
        ))}
        <button
          className={cruise ? "lang-btn active" : "lang-btn"}
          title={t(cruise ? "escort.cruise.onHint" : "escort.cruise.offHint")}
          onClick={async () => {
            const err = await connection.command("escort.cruise", { on: !cruise });
            setError(err);
            if (!err) setCruise(!cruise);
          }}
        >
          {t(cruise ? "escort.cruise.on" : "escort.cruise.off")}
        </button>
      </div>
      {error && <span className="auth-error small">{t(error)}</span>}
    </div>
  );
}
