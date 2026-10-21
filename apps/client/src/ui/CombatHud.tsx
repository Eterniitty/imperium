import { useStore } from "zustand";
import { FLAGSHIP_SUPPLIES } from "@imperium/content";
import { shipName, spaceStore } from "../net/space";
import { useGame, useT } from "../state/store";
import { formatDistance } from "./FlightHud";
import { useKeyLabels } from "./keys";
import { useSettings } from "../state/settings";
import { useServerNow } from "./useNow";
import { useTelemetry } from "../engine/telemetry";

type BarKind = "hull" | "shield" | "energy" | "fuel";

function Bar({ value, max, kind, mark }: { value: number; max: number; kind: BarKind; mark?: number }) {
  return (
    <div className={`combat-bar ${kind}`}>
      <span style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%` }} />
      {mark !== undefined && max > 0 && <i className="bar-mark" style={{ left: `${(mark / max) * 100}%` }} />}
    </div>
  );
}

/**
 * Instrumentos de la nave al pilotar, al estilo de un avión de Battlefield:
 * a la izquierda, escudo, casco, energía y combustible (todo del servidor); a
 * la derecha, munición del cañón y misiles, y el objetivo fijado con su distancia.
 */
export function CombatHud() {
  const t = useT();
  const keys = useKeyLabels();
  const view = useGame((s) => s.view);
  const locale = useGame((s) => s.locale);
  const flight = useGame((s) => s.flight);
  const self = useStore(spaceStore, (s) => s.self);
  const weapons = useStore(spaceStore, (s) => s.weapons);
  const supplies = useStore(spaceStore, (s) => s.supplies);
  const targetId = useStore(spaceStore, (s) => s.targetId);
  const selected = useStore(spaceStore, (s) => s.weapon);
  const deep = useStore(spaceStore, (s) => s.field !== null);
  const mining = useStore(spaceStore, (s) => s.mining);
  const autoFire = useSettings((s) => s.prefs.flight.autoFire);
  const target = useStore(spaceStore, (s) => (s.targetId ? s.ships[s.targetId]?.state : undefined));
  const now = useServerNow(250);
  const { heat } = useTelemetry(250);
  if (view !== "system" || !flight || !self) return null;

  const cannon = weapons.find((w) => w.kind === "cannon");
  const missile = weapons.find((w) => w.kind === "missile");
  const dist = target ? Math.hypot(target.p[0] - self.p[0], target.p[1] - self.p[1], target.p[2] - self.p[2]) : null;
  const lowFuel = supplies !== null && supplies.fuel < FLAGSHIP_SUPPLIES.emergencyFuelMax;
  const noEnergy = supplies !== null && supplies.energy < FLAGSHIP_SUPPLIES.cannonEnergy;

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
        {heat.dps > 0 && (
          <div className="combat-alerts" role="status">
            <span className={heat.lethal ? "hud-tag warn" : "hud-tag"}>
              {t(heat.lethal ? (heat.blackHole ? "hud.heatLethalBlackHole" : "hud.heatLethal") : "hud.heat", { dps: Math.round(heat.dps) })}
            </span>
          </div>
        )}
        {supplies && (
          <>
            <div className={noEnergy ? "combat-row warn" : "combat-row"}>
              <span className="stat-label">{t("hud.energy")}</span>
              <Bar value={supplies.energy} max={supplies.energyMax} kind="energy" />
              <span className="mono small">{Math.round(supplies.energy)}</span>
            </div>
            <div className={lowFuel ? "combat-row warn" : "combat-row"}>
              <span className="stat-label">{t("hud.fuel")}</span>
              <Bar value={supplies.fuel} max={supplies.fuelMax} kind="fuel" mark={FLAGSHIP_SUPPLIES.emergencyFuelMax} />
              <span className="mono small">{Math.floor(supplies.fuel)}</span>
            </div>
            {(supplies.resupplying || lowFuel || noEnergy) && (
              <div className="combat-alerts">
                {supplies.resupplying && <span className="hud-tag ok">{t("hud.resupplying")}</span>}
                {lowFuel && !supplies.resupplying && <span className="hud-tag warn">{t("hud.lowFuel")}</span>}
                {noEnergy && <span className="hud-tag warn">{t("hud.noEnergy")}</span>}
              </div>
            )}
          </>
        )}
      </div>
      <div className="combat-weapons panel">
        {cannon && (
          <div className={`${now >= cannon.readyAt && cannon.ammo !== 0 && !noEnergy ? "weapon-slot ready" : "weapon-slot"}${selected === "cannon" ? " selected" : ""}`} aria-current={selected === "cannon" || undefined}>
            <span className="stat-label">
              {t("combat.cannon")} <kbd>{keys.fireCannon}</kbd>
            </span>
            <span className={cannon.ammo !== null && cannon.ammoMax !== null && cannon.ammo < cannon.ammoMax * 0.15 ? "ammo low" : "ammo"}>
              {cannon.ammo ?? "∞"}
              {cannon.ammoMax !== null && <small>/{cannon.ammoMax}</small>}
            </span>
          </div>
        )}
        {missile && (
          <div className={`${missile.ammo && now >= missile.readyAt ? "weapon-slot ready" : "weapon-slot"}${selected === "missile" ? " selected" : ""}`} aria-current={selected === "missile" || undefined}>
            <span className="stat-label">
              {t("combat.missiles")} <kbd>{keys.fireMissile}</kbd>
            </span>
            <span className={missile.ammo === 0 ? "ammo low" : "ammo"}>
              {missile.ammo}
              <small>/{missile.ammoMax}</small>
            </span>
            <span className="sr-only">
              {t("combat.missiles")} {missile.ammo}/{missile.ammoMax}
            </span>
          </div>
        )}
        {deep && (
          <div className={`weapon-slot${mining ? " ready" : ""}${selected === "laser" ? " selected" : ""}`} aria-current={selected === "laser" || undefined}>
            <span className="stat-label">
              {t("combat.laser")} <kbd>{keys.weaponLaser}</kbd>
            </span>
          </div>
        )}
      </div>
      <div className="combat-target panel">
        {target && dist !== null ? (
          <>
            <div className="stat-label">{t("combat.target")}</div>
            <strong className={target.ally ? "ally" : "enemy"}>{shipName(target, locale)}</strong>
            <span className="mono small"> · {formatDistance(dist)}</span>
            <Bar value={target.shield} max={target.shieldMax} kind="shield" />
            <Bar value={target.hull} max={target.hullMax} kind="hull" />
            {target.ally && <div className="combat-assist"><span className="hud-tag warn">{t("combat.ally")}</span></div>}
          </>
        ) : (
          <span className="muted small">{targetId ? "" : t("combat.noTarget", { key: keys.lockTarget })}</span>
        )}
        {autoFire && (
          <div className="combat-assist">
            <span className="hud-tag ok">
              {t("combat.autoFire")} <kbd>{keys.autoFire}</kbd>
            </span>
          </div>
        )}
      </div>
    </>
  );
}
