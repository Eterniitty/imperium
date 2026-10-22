import { useStore } from "zustand";
import { getShipClass, type ShipClassId } from "@imperium/content";
import type { Fleet } from "@imperium/shared";
import { engineRef } from "../engineRef";
import type { PilotAction } from "../engine/SystemView";
import { useTelemetry } from "../engine/telemetry";
import { spaceStore } from "../net/space";
import { useWorld } from "../net/world";
import { settingsStore, useSettings } from "../state/settings";
import { gameStore, useGame, useT } from "../state/store";
import { KeyHint } from "./common";
import { HelpButton } from "./HelpCall";
import { HudIcon, type HudIconName } from "./hudIcons";

/** Botón de la barra: icono, su tecla en la esquina y el nombre al pasar el ratón; hace la acción del piloto. */
function ActionButton({ action, on, icon, label, title }: { action: PilotAction; on?: boolean; icon: HudIconName; label: string; title?: string }) {
  return (
    <button type="button" className={on ? "action-btn on" : "action-btn"} aria-pressed={on} aria-label={label} title={title ? `${label} — ${title}` : label} onClick={() => engineRef.current?.pilotAction(action)}>
      <HudIcon name={icon} />
      <KeyHint action={action} />
    </button>
  );
}

/**
 * Barra de acciones del piloto (`docs/rediseno-interfaz.md`): lo que no se usa
 * a cada segundo va aquí, con botones, en vez de con teclas por defecto. Solo
 * salen las acciones que tienen sentido en ese momento.
 */
export function ActionBar() {
  const t = useT();
  const tel = useTelemetry(250);
  const prefs = useSettings((s) => s.prefs.flight);
  const camera = useGame((s) => s.cameraView);
  const remote = useStore(spaceStore, (s) => s.remote);
  const docked = useStore(spaceStore, (s) => s.docked);
  const systemId = useStore(spaceStore, (s) => s.systemId);
  const fleets = useWorld((s) => s.fleets);
  if (tel.quantumCharge !== null || tel.quantumAlign !== null) return null;
  // Acoplar: hay una nodriza propia parada en este sistema.
  const mothership = !remote && (Object.values(fleets) as Fleet[]).some((f) => !f.travel && f.location.systemId === systemId && f.ships.some((s) => getShipClass(s.classId as ShipClassId)?.dockFlagship));
  const engines = tel.engines;
  return (
    <nav className="action-bar panel" aria-label={t("actions.title")}>
      <ActionButton action="engines" icon="engines" on={engines === "on" || engines === "starting"} label={t(engines === "off" || engines === "stopping" ? "actions.enginesStart" : "actions.enginesStop")} />
      <ActionButton action="pulse" icon="pulse" on={tel.pulse || tel.pulseCharge !== null} label={t("actions.pulse")} />
      <ActionButton action="flightAssist" icon="assist" on={prefs.assist} label={t("actions.assist")} title={t("actions.assistTitle")} />
      <ActionButton action="mouseFlight" icon="mouse" on={prefs.mouseFlight} label={t(prefs.mouseFlight ? "actions.mouseFlight" : "actions.mouseCamera")} title={t("actions.mouseTitle")} />
      <button type="button" className={camera === "first" ? "action-btn on" : "action-btn"} aria-label={t(camera === "first" ? "actions.cameraOutside" : "actions.cameraCockpit")} title={t(camera === "first" ? "actions.cameraOutside" : "actions.cameraCockpit")} onClick={() => gameStore.getState().toggleCameraView()}>
        <HudIcon name="cockpit" />
        <KeyHint action="cameraView" />
      </button>
      {tel.freeCam && <ActionButton action="cameraReset" icon="recenter" label={t("actions.cameraReset")} />}
      <i className="action-sep" />
      <ActionButton action="cruise" icon="cruise" on={tel.cruise !== null && tel.cruise.mode !== "follow"} label={t(tel.cruise ? "actions.cruiseStop" : "actions.cruise")} />
      <ActionButton action="follow" icon="follow" on={tel.cruise?.mode === "follow"} label={t("actions.follow")} />
      {(mothership || docked) && <ActionButton action="dock" icon="dock" on={!!docked} label={t(docked ? "actions.undock" : "actions.dock")} />}
      <i className="action-sep" />
      {/* Seguro de armas: con él puesto no se dispara y el clic selecciona. */}
      <button
        type="button"
        className={prefs.weaponsSafe ? "action-btn" : "action-btn on warn"}
        aria-pressed={!prefs.weaponsSafe}
        aria-label={t(prefs.weaponsSafe ? "actions.weaponsOff" : "actions.weaponsOn")}
        title={`${t(prefs.weaponsSafe ? "actions.weaponsOff" : "actions.weaponsOn")} — ${t("actions.weaponsTitle")}`}
        onClick={() => {
          const f = settingsStore.getState().prefs.flight;
          settingsStore.getState().setPrefs({ flight: { ...f, weaponsSafe: !f.weaponsSafe } });
        }}
      >
        <HudIcon name="weapons" />
      </button>
      <ActionButton action="targetNearest" icon="targetNearest" label={t("actions.targetNearest")} />
      <ActionButton action="targetNext" icon="targetNext" label={t("actions.targetNext")} />
      <ActionButton action="autoFire" icon="autoFire" on={prefs.autoFire} label={t("actions.autoFire")} />
      {/* Pedir ayuda: a los compañeros y, cerca del Núcleo, a la milicia. */}
      {!remote && <HelpButton />}
    </nav>
  );
}
