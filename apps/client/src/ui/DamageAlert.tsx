import { useEffect, useState } from "react";
import { telemetry } from "../engine/telemetry";
import { serverNow } from "../net/world";
import { useSettings } from "../state/settings";
import { useGame, useT } from "../state/store";

/** Segundos que dura el aviso de un golpe. */
const HIT_SHOW_SEC = 1.6;

/**
 * Avisos de ataque al pilotar: borde de pantalla en rojo por el lado del golpe
 * (más intenso en cabina), «ESCUDOS AL X %» o «CASCO DAÑADO» en grande, y
 * «MISIL ENTRANTE» mientras uno viene hacia la nave. Lo decide la telemetría
 * (golpes que dice el servidor); aquí solo se dibuja.
 */
export function DamageAlert() {
  const t = useT();
  const view = useGame((s) => s.view);
  const flight = useGame((s) => s.flight);
  const cockpit = useGame((s) => s.cameraView === "first");
  const reduce = useSettings((s) => s.prefs.reduceEffects);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, []);
  if (view !== "system" || !flight) return null;
  const hit = telemetry.hit;
  const age = hit ? (performance.now() - hit.at) / 1000 : Infinity;
  const showHit = hit && age < HIT_SHOW_SEC;
  const missile = telemetry.missileIncoming !== null && telemetry.missileIncoming > serverNow();
  if (!showHit && !missile) return null;
  const k = showHit ? 1 - age / HIT_SHOW_SEC : 0;
  // Borde rojo hacia el atacante: el centro del degradado, fuera de la pantalla en esa dirección.
  const x = 50 + Math.cos(hit?.angle ?? 0) * 70;
  const y = 50 - Math.sin(hit?.angle ?? 0) * 70;
  const strength = (hit?.hull ? 0.55 : 0.32) * (cockpit ? 1.5 : 1) * (reduce ? 0.5 : 1) * k;
  return (
    <div className="damage-alert" aria-live="assertive">
      {showHit && (
        <div
          className="damage-vignette"
          style={{ background: `radial-gradient(circle at ${x}% ${y}%, rgba(255, 40, 30, ${Math.min(0.85, strength)}) 0%, rgba(255, 40, 30, ${Math.min(0.5, strength * 0.5)}) 35%, transparent 70%)` }}
        />
      )}
      {showHit && (
        <div className={hit!.hull ? "damage-banner hull" : "damage-banner"} style={{ opacity: Math.min(1, k * 1.6) }}>
          {hit!.hull ? t("alert.hullDamaged") : t("alert.shields", { pct: Math.round(hit!.shield * 100) })}
        </div>
      )}
      {missile && <div className="damage-banner missile">{t("alert.missileIncoming")}</div>}
    </div>
  );
}
