import { useStore } from "zustand";
import { spaceStore } from "../net/space";
import { useGame, useT } from "../state/store";
import { useKeyLabels } from "./keys";
import { useServerNow } from "./useNow";

function Bar({ value, max, kind }: { value: number; max: number; kind: "hull" | "shield" }) {
  return (
    <div className={`combat-bar ${kind}`}>
      <span style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%` }} />
    </div>
  );
}

/** Estado de combate al pilotar: casco, escudo y armas propias, y el objetivo fijado. */
export function CombatHud() {
  const t = useT();
  const keys = useKeyLabels();
  const view = useGame((s) => s.view);
  const flight = useGame((s) => s.flight);
  const self = useStore(spaceStore, (s) => s.self);
  const weapons = useStore(spaceStore, (s) => s.weapons);
  const targetId = useStore(spaceStore, (s) => s.targetId);
  const target = useStore(spaceStore, (s) => (s.targetId ? s.ships[s.targetId]?.state : undefined));
  const now = useServerNow(250);
  if (view !== "system" || !flight || !self) return null;

  const cannon = weapons.find((w) => w.kind === "cannon");
  const missile = weapons.find((w) => w.kind === "missile");
  const dist = target ? Math.hypot(target.p[0] - self.p[0], target.p[1] - self.p[1], target.p[2] - self.p[2]) : null;

  return (
    <>
      <div className="combat-self panel" aria-label={t("combat.hull")}>
        <div className="combat-row">
          <span className="stat-label">{t("combat.shield")}</span>
          <Bar value={self.shield} max={self.shieldMax} kind="shield" />
          <span className="mono small">{self.shield}</span>
        </div>
        <div className="combat-row">
          <span className="stat-label">{t("combat.hull")}</span>
          <Bar value={self.hull} max={self.hullMax} kind="hull" />
          <span className="mono small">{self.hull}</span>
        </div>
        <div className="combat-row weapons">
          {cannon && (
            <span className={now >= cannon.readyAt ? "weapon ready" : "weapon"}>
              {t("combat.cannon")} <kbd>{keys.fireCannon}</kbd>
            </span>
          )}
          {missile && (
            <span className={missile.ammo && now >= missile.readyAt ? "weapon ready" : "weapon"}>
              {t("combat.missiles")} {missile.ammo}/{missile.ammoMax} <kbd>{keys.fireMissile}</kbd>
            </span>
          )}
        </div>
      </div>
      <div className="combat-target panel">
        {target && dist !== null ? (
          <>
            <div className="stat-label">{t("combat.target")}</div>
            <strong className={target.ally ? "ally" : "enemy"}>{target.name}</strong>
            <span className="mono small"> · {dist.toFixed(0)} u</span>
            <Bar value={target.shield} max={target.shieldMax} kind="shield" />
            <Bar value={target.hull} max={target.hullMax} kind="hull" />
          </>
        ) : (
          <span className="muted small">{targetId ? "" : t("combat.noTarget", { key: keys.lockTarget })}</span>
        )}
      </div>
    </>
  );
}
