import { useEffect, useState } from "react";
import type { HealthResponse } from "@imperium/shared";
import { useWorld } from "../net/world";
import { useT } from "../state/store";

/** Cada cuánto se comprueba el estado del servidor. */
const POLL_MS = 30_000;

/**
 * Indicador de conexión con el servidor. Con el mundo compartido abierto muestra
 * el estado del WebSocket y cuántos Emperadores hay en línea; si no (sin
 * servidor o sin Emperador), consulta `/api/health` de vez en cuando.
 */
export function ServerStatus() {
  const t = useT();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const status = useWorld((s) => s.status);
  // Solo jugadores reales; los Emperadores de la IA se cuentan aparte, debajo.
  const players = useWorld((s) => Object.values(s.emperors).filter((e) => e.online && !e.ai).length);
  const ais = useWorld((s) => Object.values(s.emperors).filter((e) => e.ai).length);

  useEffect(() => {
    if (status !== "idle") return;
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const body = res.ok ? ((await res.json()) as HealthResponse) : null;
        if (alive) setHealth(body?.ok ? body : null);
      } catch {
        if (alive) setHealth(null);
      }
    };
    void check();
    const id = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [status]);

  if (status !== "idle") {
    const label = status === "open" ? t("server.players", { count: players }) : status === "connecting" ? t("server.connecting") : t("server.offline");
    return (
      <span className="server-status stacked" title={t("server.title")}>
        <span className="server-line">
          <span className={status === "open" ? "server-dot online" : "server-dot"} aria-hidden="true" />
          <span className="hide-sm">{t("server.label")}:</span> {label}
        </span>
        {status === "open" && ais > 0 && <span className="server-ai">{t("server.ai", { count: ais })}</span>}
      </span>
    );
  }

  const online = health !== null;
  return (
    <span className="server-status" title={online ? `${t("server.title")} · v${health.version}` : t("server.title")}>
      <span className={online ? "server-dot online" : "server-dot"} aria-hidden="true" />
      <span className="hide-sm">{t("server.label")}:</span> {online ? t("server.online") : t("server.offline")}
    </span>
  );
}
