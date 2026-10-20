import { useEffect, useState } from "react";
import type { HealthResponse } from "@imperium/shared";
import { useT } from "../state/store";

/** Cada cuánto se comprueba el estado del servidor. */
const POLL_MS = 30_000;

/**
 * Indicador de conexión con el servidor. De momento solo consulta
 * `/api/health`; en la Fase 4 lo sustituirá el estado del WebSocket.
 */
export function ServerStatus() {
  const t = useT();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
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
  }, []);

  const online = health !== null;
  return (
    <span className="server-status" title={online ? `${t("server.title")} · v${health.version}` : t("server.title")}>
      <span className={online ? "server-dot online" : "server-dot"} aria-hidden="true" />
      <span className="hide-sm">{t("server.label")}:</span> {online ? t("server.online") : t("server.offline")}
    </span>
  );
}
