import { useEffect, useState } from "react";

/**
 * Telemetría del vuelo: la escribe la vista de sistema en cada fotograma y la
 * leen los instrumentos de la interfaz. Es un objeto mutable (no un store) para
 * no provocar renders de React a 60 Hz; la interfaz lo muestrea a su ritmo.
 */
export interface FlightTelemetry {
  /** Velocidad (m/s). */
  speed: number;
  pulse: boolean;
  /** Velocidad máxima del pulso en este punto y con este rumbo (m/s). */
  pulseLimit: number;
  /** Cuerpo más cercano: nombre y distancia a su superficie (m). */
  nearest: { name: string; distance: number } | null;
  /** Objetivo de navegación (planeta seleccionado, objetivo fijado o cuerpo de frente): distancia y tiempo estimado. */
  eta: { name: string; distance: number; seconds: number | null } | null;
  /** Actitud respecto al plano orbital del sistema (radianes): cabeceo, alabeo y rumbo respecto a la estrella. */
  pitch: number;
  roll: number;
  heading: number;
  /** Proporción de empuje (0–1) para los motores y el sonido. */
  thrust: number;
  /** Carga del motor cuántico (0–1) o null si no se está cargando. */
  quantumCharge: number | null;
  /** Alineación con el destino cuántico (coseno; 1 = perfecto) o null. */
  quantumAlign: number | null;
  /** La cámara exterior está fuera de la vista de seguimiento (orbitando la nave). */
  freeCam: boolean;
  /** Motores: apagados, arrancando, encendidos o apagándose; y potencia (0–1, la del arranque). */
  engines: "off" | "starting" | "on" | "stopping";
  enginePower: number;
  /** Gravedad que siente la nave (m/s²; 0 con el pulso), región y cuerpo dominante. */
  gravity: { g: number; region: "deep" | "approach" | "surface"; body: string | null };
}

export const telemetry: FlightTelemetry = {
  speed: 0,
  pulse: false,
  pulseLimit: 0,
  nearest: null,
  eta: null,
  pitch: 0,
  roll: 0,
  heading: 0,
  thrust: 0,
  quantumCharge: null,
  quantumAlign: null,
  freeCam: false,
  engines: "on",
  enginePower: 1,
  gravity: { g: 0, region: "deep", body: null },
};

/** Copia de la telemetría refrescada cada `intervalMs` (para los números del HUD). */
export function useTelemetry(intervalMs = 150): FlightTelemetry {
  const [snap, setSnap] = useState<FlightTelemetry>(() => ({ ...telemetry }));
  useEffect(() => {
    const id = setInterval(() => setSnap({ ...telemetry }), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return snap;
}
