import type { ReactNode } from "react";
import { useStore } from "zustand";
import { getShipClass, type ShipClassId } from "@imperium/content";
import type { Fleet } from "@imperium/shared";
import { engineRef } from "../engineRef";
import type { PilotAction } from "../engine/SystemView";
import { useTelemetry } from "../engine/telemetry";
import { spaceStore } from "../net/space";
import { useWorld } from "../net/world";
import { useSettings } from "../state/settings";
import { gameStore, useGame, useT } from "../state/store";
import { KeyHint } from "./common";
import { HelpButton } from "./HelpCall";

/** Botón de la barra: hace la acción del piloto, muestra si está activa y su tecla si la tiene. */
function ActionButton({ action, on, children, title }: { action: PilotAction; on?: boolean; children: ReactNode; title?: string }) {
  return (
    <button type="button" className={on ? "action-btn on" : "action-btn"} aria-pressed={on} title={title} onClick={() => engineRef.current?.pilotAction(action)}>
      <span>{children}</span>
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
      <div className="action-group">
        <ActionButton action="engines" on={engines === "on" || engines === "starting"}>
          {t(engines === "off" || engines === "stopping" ? "actions.enginesStart" : "actions.enginesStop")}
        </ActionButton>
        <ActionButton action="pulse" on={tel.pulse || tel.pulseCharge !== null}>
          {t("actions.pulse")}
        </ActionButton>
        <ActionButton action="flightAssist" on={prefs.assist} title={t("actions.assistTitle")}>
          {t("actions.assist")}
        </ActionButton>
        <ActionButton action="mouseFlight" on={prefs.mouseFlight} title={t("actions.mouseTitle")}>
          {t(prefs.mouseFlight ? "actions.mouseFlight" : "actions.mouseCamera")}
        </ActionButton>
        <button type="button" className="action-btn" onClick={() => gameStore.getState().toggleCameraView()}>
          <span>{t(camera === "first" ? "actions.cameraOutside" : "actions.cameraCockpit")}</span>
          <KeyHint action="cameraView" />
        </button>
        {tel.freeCam && <ActionButton action="cameraReset">{t("actions.cameraReset")}</ActionButton>}
      </div>
      <div className="action-group">
        <ActionButton action="cruise" on={tel.cruise !== null && tel.cruise.mode !== "follow"}>
          {t(tel.cruise ? "actions.cruiseStop" : "actions.cruise")}
        </ActionButton>
        <ActionButton action="follow" on={tel.cruise?.mode === "follow"}>
          {t("actions.follow")}
        </ActionButton>
        {(mothership || docked) && <ActionButton action="dock" on={!!docked}>{t(docked ? "actions.undock" : "actions.dock")}</ActionButton>}
      </div>
      <div className="action-group">
        <ActionButton action="targetNearest">{t("actions.targetNearest")}</ActionButton>
        <ActionButton action="targetNext">{t("actions.targetNext")}</ActionButton>
        <ActionButton action="autoFire" on={prefs.autoFire}>
          {t("actions.autoFire")}
        </ActionButton>
        {/* Pedir ayuda: a los compañeros y, cerca del Núcleo, a la milicia. */}
        {!remote && <HelpButton />}
      </div>
    </nav>
  );
}
