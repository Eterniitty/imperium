import { useState } from "react";
import { useStore } from "zustand";
import { SPACE_EVENTS } from "@imperium/content";
import type { I18nKey } from "@imperium/shared";
import { engineRef } from "../engineRef";
import { useTelemetry } from "../engine/telemetry";
import { spaceStore } from "../net/space";
import { connection } from "../net/world";
import { useT } from "../state/store";
import { formatDistance } from "./FlightHud";
import { formatDuration, useServerNow } from "./useNow";

/**
 * Suceso en el espacio (`SPACE_EVENTS`): restos con carga o una señal de
 * socorro cerca de la nave. La señal de socorro pide decidir si se acude; luego,
 * la distancia, el tiempo que queda y un atajo al crucero hasta la señal.
 */
export function SpaceEventPanel() {
  const t = useT();
  const ev = useStore(spaceStore, (s) => s.event);
  const tel = useTelemetry(500);
  const now = useServerNow(1000);
  const [busy, setBusy] = useState(false);
  if (!ev) return null;
  const decide = async (go: boolean) => {
    setBusy(true);
    await connection.command("event.decide", { id: ev.id, go });
    setBusy(false);
  };
  const near = tel.eventDistance !== null && tel.eventDistance <= SPACE_EVENTS.reachM;
  return (
    <section className="space-event panel" role="status" aria-label={t(`event.name.${ev.kind}` as I18nKey)}>
      <span className="contract-kind">{t(`event.name.${ev.kind}` as I18nKey)}</span>
      <p className="small">{t(ev.decide ? "event.text.distressAsk" : near ? "event.text.hold" : (`event.text.${ev.kind}` as I18nKey), { s: ev.kind === "anomaly" ? SPACE_EVENTS.anomaly.scanSec : SPACE_EVENTS.holdSec })}</p>
      <div className="space-event-foot">
        <span className="mono small muted">
          {tel.eventDistance !== null && <>{formatDistance(tel.eventDistance)} · </>}
          {t("event.left", { time: formatDuration(Math.max(0, ev.expiresAt - now)) })}
        </span>
        {ev.decide ? (
          <span className="space-event-actions">
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void decide(false)}>
              {t("event.ignore")}
            </button>
            <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void decide(true)}>
              {t("event.go")}
            </button>
          </span>
        ) : (
          !near && (
            <button type="button" className="btn btn-small" onClick={() => engineRef.current?.cruiseTo("event")}>
              {t("event.cruise")}
            </button>
          )
        )}
      </div>
    </section>
  );
}
