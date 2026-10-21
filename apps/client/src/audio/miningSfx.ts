/**
 * Sonido del láser de minería (Web Audio, sin archivos): un zumbido grave con
 * chisporroteo, un pulso por cada intervalo de minería (se solapan y suenan
 * continuos mientras se mantiene la tecla). Va por la salida de efectos.
 */
import { music } from "./music";

let last = 0;

/** Un pulso del láser (unos 0,6 s). `gain` (0–1) atenúa los láseres lejanos. */
export function playMiningPulse(gain = 1): void {
  const now = performance.now();
  if (gain < 0.03 || now - last < 200) return;
  last = now;
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(92, t);
    osc.frequency.linearRampToValueAtTime(88, t + 0.6);
    const buzz = ctx.createOscillator();
    buzz.type = "square";
    buzz.frequency.value = 1320;
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0.12;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * gain, t + 0.08);
    g.gain.setValueAtTime(0.05 * gain, t + 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.62);
    osc.connect(filter);
    buzz.connect(buzzGain).connect(filter);
    filter.connect(g).connect(out);
    osc.start(t);
    buzz.start(t);
    osc.stop(t + 0.65);
    buzz.stop(t + 0.65);
  });
}
