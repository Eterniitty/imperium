import { useStore } from "zustand";
import { spaceStore } from "../net/space";
import { useT } from "../state/store";
import { formatDuration, useServerNow } from "./useNow";

/** Marcador del reto de caza en marcha: oleada, derribos y tiempo que queda. */
export function ChallengeHud() {
  const t = useT();
  const c = useStore(spaceStore, (s) => s.challenge);
  const now = useServerNow(500);
  if (!c) return null;
  return (
    <div className="challenge-hud panel" role="status">
      <span className="contract-kind">{t("challenge.title")}</span>
      <span>{t("challenge.wave.n", { n: c.wave })}</span>
      <span className="mono">{t("challenge.kills", { n: c.kills })}</span>
      <span className="mono challenge-time">{formatDuration(Math.max(0, c.until - now))}</span>
    </div>
  );
}
