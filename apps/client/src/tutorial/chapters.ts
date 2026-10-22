/**
 * Capítulos del tutorial (`docs/tutorial.md`) como datos: cada paso tiene su
 * texto (`tut.<capítulo>.<paso>` en i18n), el elemento que se resalta
 * (atributo `data-tutorial` de la interfaz), las teclas que muestra y, si se
 * puede comprobar, cuándo se da por hecho. Los pasos sin comprobación se pasan
 * con «Siguiente». Todo ocurre en la partida real y no da recompensas.
 */
import type { Action } from "../state/settings";
import { settingsStore } from "../state/settings";
import { gameStore } from "../state/store";
import { telemetry, type FlightTelemetry } from "../engine/telemetry";

/** Lo que mira una comprobación: el estado al empezar el paso y el de ahora. */
export interface StepContext {
  start: Snapshot;
  now: Snapshot;
}

/** Foto del estado del juego que usan las comprobaciones. */
export interface Snapshot {
  tel: FlightTelemetry;
  view: "galaxy" | "system" | "tunnel";
  flight: boolean;
  settingsOpen: boolean;
  cruisePanel: boolean;
  quantumPanel: boolean;
  cameraView: "first" | "third";
  speedMode: string;
}

export function snapshot(): Snapshot {
  const g = gameStore.getState();
  return {
    tel: { ...telemetry, gravity: { ...telemetry.gravity } },
    view: g.view,
    flight: g.flight,
    settingsOpen: g.settingsOpen,
    cruisePanel: g.cruisePanel,
    quantumPanel: g.quantumPanel,
    cameraView: g.cameraView,
    speedMode: settingsStore.getState().prefs.flight.speedMode,
  };
}

export interface TutorialStep {
  id: string;
  /** Elemento resaltado: `[data-tutorial="<target>"]`. */
  target?: string;
  /** Teclas que se muestran junto al texto. */
  keys?: Action[];
  /** Cuándo se da por hecho (sin ella, se pasa con «Siguiente»). */
  done?: (c: StepContext) => boolean;
  /** Paso opcional (cuesta algo de verdad, como un salto): se avisa de que se puede saltar. */
  optional?: boolean;
}

export interface TutorialChapter {
  id: string;
  /** Hace falta estar pilotando la nave (si no, el primer paso lo pide). */
  needsFlight?: boolean;
  steps: TutorialStep[];
}

/** Cuánto ha girado la nave (grados) desde el principio del paso: rumbo o cabeceo, por el lado corto. */
const turned = (a: FlightTelemetry, b: FlightTelemetry) => {
  const d = Math.abs(a.heading - b.heading) % (2 * Math.PI);
  return (Math.max(Math.min(d, 2 * Math.PI - d), Math.abs(a.pitch - b.pitch)) * 180) / Math.PI;
};

const piloting = (c: StepContext) => c.now.view === "system" && c.now.flight;

export const CHAPTERS: TutorialChapter[] = [
  {
    id: "basics",
    steps: [
      { id: "welcome" },
      { id: "emperor", target: "emperor" },
      { id: "credits", target: "credits" },
      { id: "contracts", target: "contracts" },
      { id: "empire", target: "empire" },
      { id: "wiki", target: "wiki" },
      { id: "settings", target: "settings", done: (c) => c.now.settingsOpen },
      { id: "settingsClose", done: (c) => !c.now.settingsOpen },
      { id: "pilot", target: "pilot", keys: ["toggleMap"], done: piloting },
    ],
  },
  {
    id: "flying",
    needsFlight: true,
    steps: [
      { id: "engines", target: "engines", keys: ["engines"], done: (c) => c.now.tel.engines === "on" },
      { id: "forward", keys: ["forward"], done: (c) => c.now.tel.speed > 40 },
      { id: "brake", keys: ["back"], done: (c) => c.now.tel.speed < 8 },
      { id: "turn", keys: ["turnLeft", "turnRight", "pitchUp", "pitchDown"], done: (c) => turned(c.now.tel, c.start.tel) > 25 },
      { id: "mouse", target: "mouseFlight", keys: ["mouseFlight"] },
      { id: "camera", target: "cameraView", keys: ["cameraView"], done: (c) => c.now.cameraView !== c.start.cameraView },
      { id: "gear", target: "speedMode", keys: ["speedMode"], done: (c) => c.now.speedMode !== c.start.speedMode },
      { id: "boost", keys: ["boost"] },
    ],
  },
  {
    id: "cruise",
    needsFlight: true,
    steps: [
      { id: "open", target: "cruise", keys: ["cruise"], done: (c) => c.now.cruisePanel || c.now.tel.cruise !== null },
      { id: "dial", target: "speed-dial" },
      { id: "go", target: "cruise-list", done: (c) => c.now.tel.cruise?.mode === "goto" },
      { id: "hud", target: "cruise-hud" },
      { id: "orbit", target: "cruise", done: (c) => c.now.tel.cruise?.mode === "orbit" },
      { id: "cancel", target: "cruise", done: (c) => c.now.tel.cruise === null },
    ],
  },
  {
    id: "pulse",
    needsFlight: true,
    steps: [
      { id: "on", target: "pulse", keys: ["pulse"], done: (c) => c.now.tel.pulse },
      { id: "off", target: "pulse", keys: ["pulse"], done: (c) => !c.now.tel.pulse && c.now.tel.pulseCharge === null },
      { id: "fuel", target: "supplies" },
      { id: "jumpOpen", keys: ["jump"], done: (c) => c.now.quantumPanel || c.now.view === "tunnel" },
      { id: "jumpGo", target: "quantum-list", optional: true, done: (c) => c.now.view === "tunnel" || c.now.tel.quantumAlign !== null || c.now.tel.quantumCharge !== null },
      { id: "tunnel" },
    ],
  },
];

export const chapterById = (id: string) => CHAPTERS.find((c) => c.id === id) ?? null;
