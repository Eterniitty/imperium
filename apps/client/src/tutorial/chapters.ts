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
import { spaceStore } from "../net/space";
import { empireStore } from "../ui/EmpireWindow";
import { contractsStore } from "../ui/ContractsWindow";

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
  weaponsSafe: boolean;
  targetId: string | null;
  selectedPlanet: number | null;
  empireOpen: boolean;
  docked: boolean;
  economyOpen: string | null;
  lineageOpen: boolean;
  contractsOpen: boolean;
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
    weaponsSafe: settingsStore.getState().prefs.flight.weaponsSafe,
    targetId: spaceStore.getState().targetId,
    selectedPlanet: g.selectedPlanet,
    empireOpen: empireStore.getState().open,
    docked: spaceStore.getState().docked !== null,
    economyOpen: g.economyOpen,
    lineageOpen: g.lineageOpen,
    contractsOpen: contractsStore.getState().open,
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
  {
    id: "combat",
    needsFlight: true,
    steps: [
      { id: "safety", target: "weapons", done: (c) => !c.now.weaponsSafe },
      { id: "lock", target: "targetNearest", keys: ["targetNearest", "lockTarget"], done: (c) => c.now.targetId !== null },
      { id: "fire", keys: ["fireCannon", "fireMissile"] },
      { id: "shield", target: "supplies" },
      { id: "flee", keys: ["pulse"] },
      { id: "help", target: "help" },
      { id: "safe", target: "weapons", done: (c) => c.now.weaponsSafe },
    ],
  },
  {
    id: "mining",
    needsFlight: true,
    steps: [{ id: "deep" }, { id: "laser", keys: ["mine"] }, { id: "hold", target: "hold" }, { id: "refine", target: "hold" }, { id: "unload" }],
  },
  {
    id: "colonies",
    steps: [
      { id: "map", target: "pilot", keys: ["toggleMap"], done: (c) => c.now.view === "galaxy" || (c.now.view === "system" && !c.now.flight) },
      { id: "planet", done: (c) => c.now.selectedPlanet !== null },
      { id: "claim" },
      { id: "window" },
      { id: "build" },
      { id: "people", target: "credits" },
    ],
  },
  {
    id: "fleets",
    steps: [
      { id: "open", target: "empire", done: (c) => c.now.empireOpen },
      { id: "list" },
      { id: "send" },
      { id: "fuel" },
      { id: "routes" },
      { id: "name" },
    ],
  },
  {
    id: "mothership",
    needsFlight: true,
    steps: [
      { id: "what" },
      { id: "approach", target: "cruise" },
      { id: "dock", target: "dock", keys: ["dock"], optional: true, done: (c) => c.now.docked },
      { id: "pilot" },
      { id: "travel" },
      { id: "undock", target: "dock", keys: ["dock"], done: (c) => !c.now.docked },
    ],
  },
  {
    id: "economy",
    steps: [
      { id: "credits", target: "credits" },
      { id: "market", target: "credits", done: (c) => c.now.economyOpen === "market" },
      { id: "humanity", target: "humanity", done: (c) => c.now.economyOpen === "humanity" },
      { id: "projects" },
      { id: "reputation" },
    ],
  },
  {
    id: "lineage",
    steps: [{ id: "open", target: "lineage", done: (c) => c.now.lineageOpen }, { id: "fall" }, { id: "cradles" }, { id: "heirs" }],
  },
  {
    id: "contracts",
    steps: [
      { id: "open", target: "contracts", done: (c) => c.now.contractsOpen },
      { id: "goals" },
      { id: "offers" },
      { id: "progress" },
      { id: "rank" },
    ],
  },
];

export const chapterById = (id: string) => CHAPTERS.find((c) => c.id === id) ?? null;
