import { useEffect, useRef, useState } from "react";
import { Engine } from "../engine/Engine";
import { music } from "../audio/music";
import { engineRef } from "../engineRef";
import { settingsStore, uiScaleFor, useSettings } from "../state/settings";
import { spaceStore } from "../net/space";
import { connection, worldStore } from "../net/world";
import { authStore } from "../state/auth";
import { gameStore, useGame } from "../state/store";
import { FlightHud } from "./FlightHud";
import { CombatHud } from "./CombatHud";
import { ColoniesPanel } from "./ColoniesPanel";
import { FleetsPanel } from "./FleetsPanel";
import { Notice } from "./Notice";
import { SettingsPanel } from "./SettingsPanel";
import { Legend } from "./Legend";
import { PlanetPanel } from "./PlanetPanel";
import { StartScreen } from "./StartScreen";
import { SystemPanel } from "./SystemPanel";
import { TopBar } from "./TopBar";

/** Escala de la interfaz según los ajustes y el tamaño de la ventana (se recalcula al cambiarla). */
function useUiScale(): number {
  const pref = useSettings((s) => s.prefs.uiScale);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return uiScaleFor(pref, size.w, size.h);
}

export function App() {
  const started = useGame((s) => s.started);
  const view = useGame((s) => s.view);
  // Con un sistema seleccionado, su panel ya dice la clase de la estrella y necesita el sitio de la leyenda.
  const hasSelection = useGame((s) => s.selected !== null);
  const containerRef = useRef<HTMLDivElement>(null);
  const uiScale = useUiScale();

  // La música sigue al volumen de los ajustes.
  useEffect(
    () =>
      settingsStore.subscribe((s, prev) => {
        if (s.prefs.musicVolume !== prev.prefs.musicVolume) music.setVolume(s.prefs.musicVolume);
      }),
    [],
  );

  useEffect(() => {
    if (!started || !containerRef.current) return;
    const engine = new Engine(containerRef.current);
    engineRef.current = engine;
    // Solo en desarrollo: acceso desde la consola del navegador para depurar.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__imperium = { engine, store: gameStore, world: worldStore, space: spaceStore, connection };
    }
    // Con Emperador, se conecta al mundo compartido; sin servidor, el universo sigue siendo local.
    if (authStore.getState().emperor) connection.start();
    return () => {
      connection.stop();
      engine.dispose();
      engineRef.current = null;
    };
  }, [started]);

  if (!started) return <StartScreen />;

  return (
    <div className="game">
      <div className="viewport" ref={containerRef} />
      <div className="hud" style={{ zoom: uiScale }}>
        <TopBar />
        {view === "galaxy" ? (
          <>
            <FlightHud />
            <div className="left-col">
              <FleetsPanel />
              <ColoniesPanel />
            </div>
            <SystemPanel />
            {!hasSelection && <Legend />}
          </>
        ) : (
          <>
            <FlightHud />
            <CombatHud />
            <PlanetPanel />
          </>
        )}
        <Notice />
        <SettingsPanel />
      </div>
    </div>
  );
}
