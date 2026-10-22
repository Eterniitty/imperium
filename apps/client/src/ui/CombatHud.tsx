import { KeyHint } from "./common";
import { HudIcon, type HudIconName } from "./hudIcons";
import { useStore } from "zustand";
import { FLAGSHIP_SUPPLIES } from "@imperium/content";
import { shipName, spaceStore } from "../net/space";
import { useGame, useT } from "../state/store";
import { formatDistance } from "./FlightHud";
import { useKeyLabels } from "./keys";
import { useSettings } from "../state/settings";
import { useServerNow } from "./useNow";
import { useTelemetry } from "../engine/telemetry";
import { useWorld } from "../net/world";

/** Un valor de la nave: icono del color de su recurso y el número (sin barra). */
function Stat({ icon, value, label, kind, warn, max }: { icon: HudIconName; value: number | string; label: string; kind: string; warn?: boolean; max?: number }) {
  return (
    <div className={`hud-stat ${kind}${warn ? " warn" : ""}`} title={label}>
      <HudIcon name={icon} size={16} />
      <span className="hud-stat-value">
        {value}
        {max !== undefined && <small>/{max}</small>}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Instrumentos de la nave al pilotar: abajo a la izquierda, en una fila de
 * iconos con su número, escudo, casco, energía, combustible y las armas con su
 * munición (todo del servidor); a la derecha, el objetivo fijado con su
 * distancia (de una nave ajena no se sabe ni el casco ni el escudo).
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
  const docked = useStore(spaceStore, (s) => s.docked);
  const dockFleet = useWorld((s) => (docked ? s.fleets[docked.fleetId] : undefined));
  const dockCargo = dockFleet
    ? { empty: dockFleet.cargo.metal + dockFleet.cargo.volatiles + dockFleet.cargo.crystal + dockFleet.cargo.alloys < 1, noVolatiles: dockFleet.cargo.volatiles < 1 }
    : null;
  if (view !== "system" || !flight || !self) return null;

  const cannon = weapons.find((w) => w.kind === "cannon");
  const missile = weapons.find((w) => w.kind === "missile");
  const dist = target ? Math.hypot(target.p[0] - self.p[0], target.p[1] - self.p[1], target.p[2] - self.p[2]) : null;
  const lowFuel = supplies !== null && supplies.fuel < FLAGSHIP_SUPPLIES.emergencyFuelMax;
  const noEnergy = supplies !== null && supplies.energy < FLAGSHIP_SUPPLIES.cannonEnergy;

  return (
    <>
      <div className="combat-self panel" aria-label={t("combat.hull")}>
        <div className="hud-stats">
          <Stat icon="shield" kind="shield" label={t("combat.shield")} value={self.shield} />
          <Stat icon="hull" kind="hull" label={t("combat.hull")} value={self.hull} warn={self.hull < self.hullMax * 0.25} />
          {supplies && <Stat icon="energy" kind="energy" label={t("hud.energy")} value={Math.round(supplies.energy)} warn={noEnergy} />}
          {supplies && <Stat icon="fuel" kind="fuel" label={t("hud.fuel")} value={Math.floor(supplies.fuel)} warn={lowFuel} />}
          <i className="action-sep" />
          {cannon && (
            <div className={`hud-weapon${now >= cannon.readyAt && cannon.ammo !== 0 && !noEnergy ? " ready" : ""}${selected === "cannon" ? " selected" : ""}`} aria-current={selected === "cannon" || undefined} title={`${t("combat.cannon")} (${keys.fireCannon})`}>
              <HudIcon name="cannon" size={16} />
              <span className={cannon.ammo !== null && cannon.ammoMax !== null && cannon.ammo < cannon.ammoMax * 0.15 ? "hud-stat-value low" : "hud-stat-value"}>{cannon.ammo ?? "∞"}</span>
              <span className="sr-only">{t("combat.cannon")}</span>
            </div>
          )}
          {missile && (
            <div className={`hud-weapon${missile.ammo !== 0 && now >= missile.readyAt ? " ready" : ""}${selected === "missile" ? " selected" : ""}`} aria-current={selected === "missile" || undefined} title={`${t("combat.missiles")} (${keys.fireMissile})`}>
              <HudIcon name="missile" size={16} />
              <span className={missile.ammo === 0 ? "hud-stat-value low" : "hud-stat-value"}>{missile.ammo ?? "∞"}</span>
              <span className="sr-only">{t("combat.missiles")}</span>
            </div>
          )}
          {deep && (
            <div className={`hud-weapon${mining ? " ready" : ""}${selected === "laser" ? " selected" : ""}`} aria-current={selected === "laser" || undefined} title={`${t("combat.laser")} (${keys.weaponLaser})`}>
              <HudIcon name="laser" size={16} />
              <span className="sr-only">{t("combat.laser")}</span>
            </div>
          )}
        </div>
        {(heat.dps > 0 || (supplies && (docked || supplies.resupplying || lowFuel || noEnergy))) && (
          <div className="combat-alerts" role="status">
            {heat.dps > 0 && (
              <span className={heat.lethal ? "hud-tag warn" : "hud-tag"}>
                {t(heat.lethal ? (heat.blackHole ? "hud.heatLethalBlackHole" : "hud.heatLethal") : "hud.heat", { dps: Math.round(heat.dps) })}
              </span>
            )}
            {docked && <span className="hud-tag ok">{t("hud.docked", { n: docked.number })}</span>}
            {/* Acoplada: se repone de la bodega de su flota; si no hay de qué, se dice (si no, «combustible bajo» no se entiende). */}
            {docked && dockCargo && dockCargo.empty && <span className="hud-tag warn">{t("hud.dockHoldEmpty")}</span>}
            {docked && dockCargo && !dockCargo.empty && dockCargo.noVolatiles && lowFuel && <span className="hud-tag warn">{t("hud.dockNoVolatiles")}</span>}
            {supplies?.resupplying && <span className="hud-tag ok">{t("hud.resupplying")}</span>}
            {lowFuel && !supplies?.resupplying && <span className="hud-tag warn">{t("hud.lowFuel")}</span>}
            {noEnergy && <span className="hud-tag warn">{t("hud.noEnergy")}</span>}
          </div>
        )}
      </div>
      <div className="combat-target panel">
        {target && dist !== null ? (
          <>
            <div className="stat-label">{t("combat.target")}</div>
            <strong className={target.ally ? "ally" : "enemy"}>{shipName(target, locale)}</strong>
            <span className="mono small"> · {formatDistance(dist)}</span>
            {target.ally && <div className="combat-assist"><span className="hud-tag warn">{t("combat.ally")}</span></div>}
          </>
        ) : (
          <span className="muted small">{targetId ? "" : t("combat.noTarget", { key: keys.lockTarget })}</span>
        )}
        {autoFire && (
          <div className="combat-assist">
            <span className="hud-tag ok">
              {t("combat.autoFire")} <KeyHint action="autoFire" />
            </span>
          </div>
        )}
      </div>
    </>
  );
}
