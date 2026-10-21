import { useStore } from "zustand";
import { LINEAGE } from "@imperium/content";
import { engineRef } from "../engineRef";
import { spaceStore } from "../net/space";
import { connection, useWorld } from "../net/world";
import { gameStore, useGame, useT } from "../state/store";
import { Meter } from "./common";
import { formatDuration, useServerNow } from "./useNow";

/**
 * Fase 10: el Emperador ha caído. Muestra la gestación del cuerpo nuevo (tiempo
 * restante, dónde renacerá), qué se perdió, la racha de muertes y los
 * Herederos en los que puede encarnarse en vez de esperar. Al renacer
 * desaparece sola y el motor vuelve a los mandos de la nave.
 */
export function DeathScreen() {
  const t = useT();
  const lineage = useWorld((s) => s.lineage);
  const destroyed = useStore(spaceStore, (s) => s.destroyed);
  const view = useGame((s) => s.view);
  const now = useServerNow(500);
  const dead = lineage?.dead;
  if (!lineage || !dead) return null;
  const total = Math.max(1, dead.rebornAt - dead.diedAt);
  const left = Math.max(0, dead.rebornAt - now);
  const last = lineage.deaths[0];
  const by = destroyed?.by ?? last?.by ?? null;
  const place =
    dead.place.kind === "cradle"
      ? t("lineage.dead.atCradle", { colony: dead.place.colonyName ?? "", system: dead.place.systemName })
      : t("lineage.dead.atCore", { system: dead.place.systemName });
  const ready = lineage.heirs.filter((h) => h.state === "active");
  const cooldown = lineage.incarnateReadyAt - now;

  return (
    <div className="death-screen" role="alertdialog" aria-labelledby="death-title">
      <div className="death-card panel">
        <h2 id="death-title">{t("lineage.dead.title")}</h2>
        <p className="death-law">{t("lineage.dead.law")}</p>
        {by !== null && <p>{t("lineage.dead.by", { by: by || t("npc.pirate") })}</p>}
        <p>{place}</p>
        <div className="death-timer">
          <span className="stat-label">{t("lineage.dead.gestation")}</span>
          <span className="mono death-time">{left > 0 ? formatDuration(left) : t("lineage.dead.soon")}</span>
          <Meter value={1 - left / total} color="#e8b64c" />
        </div>
        <p className="muted small">{t("lineage.dead.streak", { n: last?.streak ?? lineage.streak })}</p>
        <p className="muted small">{t("lineage.dead.lost", { humans: LINEAGE.rebirthHumans })}</p>
        {ready.length > 0 && (
          <div className="death-heirs">
            <h4>{t("lineage.dead.heirs")}</h4>
            {ready.map((h) => (
              <button
                key={h.id}
                className="btn"
                disabled={cooldown > 0}
                onClick={async () => {
                  const error = await connection.command("heir.incarnate", { heirId: h.id });
                  if (error) gameStore.getState().notify(error);
                }}
              >
                {t("lineage.dead.incarnate", { name: h.name, colony: h.colonyName })}
              </button>
            ))}
            {cooldown > 0 && <p className="muted small">{t("lineage.incarnateIn", { time: formatDuration(cooldown) })}</p>}
          </div>
        )}
        <div className="death-actions">
          <button className="link-btn" onClick={() => gameStore.getState().setLineageOpen(true)}>
            {t("lineage.open")}
          </button>
          {view === "system" && (
            <button className="link-btn" onClick={() => engineRef.current?.toggleMap()}>
              {t("pilot.map")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
