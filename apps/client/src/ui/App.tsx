import { useEffect, useRef } from "react";
import { Engine } from "../engine/Engine";
import { engineRef } from "../engineRef";
import { connection, worldStore } from "../net/world";
import { authStore } from "../state/auth";
import { gameStore, useGame } from "../state/store";
import { FlightHud } from "./FlightHud";
import { HelpPanel } from "./HelpPanel";
import { Legend } from "./Legend";
import { PlanetPanel } from "./PlanetPanel";
import { StartScreen } from "./StartScreen";
import { SystemPanel } from "./SystemPanel";
import { TopBar } from "./TopBar";

export function App() {
  const started = useGame((s) => s.started);
  const view = useGame((s) => s.view);
  // Con un sistema seleccionado, su panel ya dice la clase de la estrella y necesita el sitio de la leyenda.
  const hasSelection = useGame((s) => s.selected !== null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!started || !containerRef.current) return;
    const engine = new Engine(containerRef.current);
    engineRef.current = engine;
    // Solo en desarrollo: acceso desde la consola del navegador para depurar.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__imperium = { engine, store: gameStore, world: worldStore };
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
      <div className="hud">
        <TopBar />
        {view === "galaxy" ? (
          <>
            <FlightHud />
            <SystemPanel />
            {!hasSelection && <Legend />}
          </>
        ) : (
          <PlanetPanel />
        )}
        <HelpPanel />
      </div>
    </div>
  );
}
