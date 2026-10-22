import { QUANTUM_RIFT } from "@imperium/content";
import { KeyHint } from "./common";
import { useTelemetry } from "../engine/telemetry";
import { engineRef } from "../engineRef";
import { useAuth } from "../state/auth";
import { useGame, useT } from "../state/store";
import { useKeyLabels } from "./keys";
import { formatDuration, useServerNow } from "./useNow";

/**
 * Indicaciones del motor cuántico: mientras se alinea y carga (al pilotar) y,
 * durante el viaje, en la vista del túnel: destino, tiempo restante y progreso.
 */
export function QuantumHud() {
  const carriedBy = useGame((st) => st.carriedBy);
  const t = useT();
  const keys = useKeyLabels();
  const view = useGame((s) => s.view);
  const target = useGame((s) => s.quantumTarget);
  const emperor = useAuth((s) => s.emperor);
  const tel = useTelemetry(100);
  const now = useServerNow(250);

  if (view === "tunnel" && emperor?.travel) {
    const { travel } = emperor;
    const total = Math.max(1, travel.arriveAt - travel.departAt);
    const k = Math.min(1, Math.max(0, (now - travel.departAt) / total));
    return (
      <div className="quantum-hud tunnel panel" role="status">
        <div className="stat-label">{t("quantum.travelling")}</div>
        <strong className="quantum-dest-name">{travel.to.systemName}</strong>
        <div className="quantum-time mono">{formatDuration(travel.arriveAt - now)}</div>
        <div className="flight-bar quantum-bar">
          <span style={{ width: `${k * 100}%` }} />
        </div>
        <div className="muted small">{t(carriedBy ? "quantum.tunnelHintCarried" : "quantum.tunnelHint", { map: keys.toggleMap })}</div>
        {/* Espacio profundo: salir del túnel aquí (se gasta solo el combustible recorrido). */}
        <button
          className="btn quantum-drop"
          type="button"
          disabled={travel.arriveAt - now < QUANTUM_RIFT.incomingSec * 1000}
          onClick={() => void engineRef.current?.dropOut()}
          title={t(travel.arriveAt - now < QUANTUM_RIFT.incomingSec * 1000 ? "error.arriving" : "quantum.dropTitle")}
        >
          {t("quantum.drop")} <KeyHint action="dropOut" />
        </button>
      </div>
    );
  }

  if (view !== "system" || !target || (tel.quantumCharge === null && tel.quantumAlign === null)) return null;
  const charging = tel.quantumCharge !== null;
  const k = charging ? tel.quantumCharge! : Math.max(0, tel.quantumAlign ?? 0);
  return (
    <div className="quantum-hud charge panel" role="status">
      <div className="stat-label">{t(charging ? "quantum.charging" : "quantum.aligning")}</div>
      <strong className="quantum-dest-name">{target.name}</strong>
      <div className="flight-bar quantum-bar">
        <span style={{ width: `${k * 100}%` }} />
      </div>
      <div className="muted small">{t("quantum.cancelHint", { key: keys.jump })}</div>
    </div>
  );
}
