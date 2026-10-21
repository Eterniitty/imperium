import { useEffect, useRef } from "react";
import { telemetry } from "../engine/telemetry";
import { gameStore, useGame, useT } from "../state/store";
import { formatDistance, speedParts } from "./FlightHud";

const DEG = Math.PI / 180;
/** Campo de visión vertical de la cámara de la vista de sistema (grados): escala de la escalera de cabeceo. */
const FOV = 50;

/**
 * Instrumentos de vuelo dibujados en un lienzo encima de la escena (sin pasar
 * por React a cada fotograma): cinta de rumbo arriba (0° = hacia la estrella),
 * velocidad a la izquierda y altitud (distancia a la superficie más cercana) a
 * la derecha; en cabina, además, el horizonte artificial con la escalera de
 * cabeceo respecto al plano orbital del sistema.
 */
export function FlightInstruments() {
  const t = useT();
  const camera = useGame((s) => s.cameraView);
  const ref = useRef<HTMLCanvasElement>(null);
  const labels = useRef({ speed: "", altitude: "", heading: "", star: "" });
  labels.current = { speed: t("flight.speed"), altitude: t("hud.altitude"), heading: t("hud.heading"), star: "★" };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const first = gameStore.getState().cameraView === "first";
      const cx = w / 2;
      const cy = h / 2;
      const color = telemetry.pulse ? "rgba(143,233,255,0.85)" : "rgba(232,182,76,0.85)";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      ctx.font = "11px ui-monospace, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (first) drawHorizon(ctx, cx, cy, h);
      drawHeading(ctx, cx, Math.max(84, h * 0.11), Math.min(420, w * 0.4), labels.current.star);

      // Velocidad (izquierda) y altitud (derecha) junto a la mira.
      const off = Math.min(260, w * 0.22);
      const [num, unit] = speedParts(telemetry.speed);
      box(ctx, cx - off, cy, labels.current.speed, `${num} ${unit === "pilot.unitKm" ? "km/s" : "m/s"}`, "right");
      const alt = telemetry.nearest ? formatDistance(telemetry.nearest.distance) : "—";
      box(ctx, cx + off, cy, labels.current.altitude, alt, "left", telemetry.nearest?.name);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={ref} className={camera === "first" ? "instruments cockpit" : "instruments"} aria-hidden />;
}

/** Recuadro con un valor junto a la mira (velocidad o altitud). */
function box(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string, side: "left" | "right", sub?: string): void {
  const bw = 110;
  const bh = 34;
  const left = side === "right" ? x - bw : x;
  ctx.save();
  ctx.fillStyle = "rgba(4,8,18,0.45)";
  ctx.fillRect(left, y - bh / 2, bw, bh);
  ctx.restore();
  ctx.strokeRect(left, y - bh / 2, bw, bh);
  ctx.save();
  ctx.textAlign = side === "right" ? "right" : "left";
  const tx = side === "right" ? x - 8 : x + 8;
  ctx.globalAlpha = 0.7;
  ctx.font = "9px ui-monospace, Consolas, monospace";
  ctx.fillText(label.toUpperCase(), tx, y - 9);
  ctx.globalAlpha = 1;
  ctx.font = "bold 13px ui-monospace, Consolas, monospace";
  ctx.fillText(value, tx, y + 7);
  if (sub) {
    ctx.globalAlpha = 0.65;
    ctx.font = "9px ui-monospace, Consolas, monospace";
    ctx.fillText(sub, tx, y + bh / 2 + 9);
  }
  ctx.restore();
}

/** Horizonte artificial: escalera de cabeceo (cada 10°) girada con el alabeo, recortada en un círculo. */
function drawHorizon(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number): void {
  const pxPerDeg = h / FOV;
  const r = Math.min(h * 0.3, 240);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-telemetry.roll);
  const pitchDeg = telemetry.pitch / DEG;
  for (let d = -90; d <= 90; d += 10) {
    const y = (pitchDeg - d) * pxPerDeg;
    if (Math.abs(y) > r + 10) continue;
    const half = d === 0 ? r * 0.95 : 46;
    ctx.globalAlpha = d === 0 ? 0.9 : 0.6;
    ctx.setLineDash(d < 0 ? [6, 5] : []);
    ctx.beginPath();
    ctx.moveTo(-half, y);
    ctx.lineTo(-16, y);
    ctx.moveTo(16, y);
    ctx.lineTo(half, y);
    // Pequeñas patas hacia el horizonte, como en los aviones.
    if (d !== 0) {
      const tick = d > 0 ? 6 : -6;
      ctx.moveTo(-half, y);
      ctx.lineTo(-half, y + tick);
      ctx.moveTo(half, y);
      ctx.lineTo(half, y + tick);
    }
    ctx.stroke();
    if (d !== 0) {
      ctx.fillText(String(Math.abs(d)), -half - 14, y);
      ctx.fillText(String(Math.abs(d)), half + 14, y);
    }
  }
  ctx.restore();
  ctx.setLineDash([]);
  // Marca fija de la nave (alas) en el centro.
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy);
  ctx.lineTo(cx - 12, cy);
  ctx.lineTo(cx - 6, cy + 6);
  ctx.moveTo(cx + 34, cy);
  ctx.lineTo(cx + 12, cy);
  ctx.lineTo(cx + 6, cy + 6);
  ctx.stroke();
  // Indicador de alabeo: arco y flecha.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, -Math.PI / 2 - 0.8, -Math.PI / 2 + 0.8);
  ctx.stroke();
  ctx.restore();
  const a = -Math.PI / 2 - telemetry.roll;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2));
  ctx.lineTo(cx + Math.cos(a - 0.03) * (r + 14), cy + Math.sin(a - 0.03) * (r + 14));
  ctx.lineTo(cx + Math.cos(a + 0.03) * (r + 14), cy + Math.sin(a + 0.03) * (r + 14));
  ctx.closePath();
  ctx.fill();
}

/** Cinta de rumbo: 0° es la dirección de la estrella en el plano orbital. */
function drawHeading(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number, star: string): void {
  const deg = ((telemetry.heading / DEG) % 360 + 360) % 360;
  const pxPerDeg = width / 90;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - width / 2, y - 16, width, 34);
  ctx.clip();
  for (let d = Math.floor(deg - 50); d <= deg + 50; d++) {
    if (d % 5 !== 0) continue;
    const x = cx + (d - deg) * pxPerDeg;
    const v = ((d % 360) + 360) % 360;
    const big = v % 30 === 0;
    ctx.globalAlpha = big ? 0.85 : 0.45;
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y + (big ? -2 : 3));
    ctx.stroke();
    if (big) ctx.fillText(v === 0 ? star : String(v).padStart(3, "0"), x, y - 9);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(cx, y + 10);
  ctx.lineTo(cx - 5, y + 17);
  ctx.lineTo(cx + 5, y + 17);
  ctx.closePath();
  ctx.fill();
  ctx.font = "bold 11px ui-monospace, Consolas, monospace";
  ctx.fillText(`${String(Math.round(deg) % 360).padStart(3, "0")}°`, cx, y + 27);
}
