/**
 * Sonidos generativos del arranque y el apagado de los motores de la nave
 * (Web Audio, sin archivos): chasquidos de relés, bombas que zumban, una
 * turbina que sube de tono, el golpe del encendido y un rumor que se asienta.
 * Pasan por la mezcla de la música, como el resto de efectos.
 */
import { music } from "./music";

let running: { stop(): void } | null = null;

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Secuencia de arranque de `seconds` segundos. */
export function playEngineStart(seconds: number): void {
  stopEngineSound();
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const nodes: AudioScheduledSourceNode[] = [];
    // Relés: chasquidos secos al principio (reactor, buses, bombas).
    for (const at of [0.05, 0.22, 0.31, 0.6, seconds * 0.35]) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.03);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t + at);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.03);
      src.connect(hp).connect(g).connect(out);
      src.start(t + at);
      nodes.push(src);
    }
    // Turbina: dos dientes de sierra desafinados que suben de tono, filtrados.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(1800, t + seconds * 0.9);
    lp.frequency.exponentialRampToValueAtTime(700, t + seconds + 1.5);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.08, t + seconds * 0.4);
    tg.gain.exponentialRampToValueAtTime(0.14, t + seconds * 0.95);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 2.5);
    lp.connect(tg).connect(out);
    for (const [detune, mult] of [
      [-7, 1],
      [8, 2.01],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(30 * mult, t);
      osc.frequency.exponentialRampToValueAtTime(110 * mult, t + seconds * 0.9);
      osc.frequency.exponentialRampToValueAtTime(90 * mult, t + seconds + 1);
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + seconds + 2.6);
      nodes.push(osc);
    }
    // Encendido: golpe grave y bocanada de ruido al 75 %.
    const ign = t + seconds * 0.75;
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(90, ign);
    boom.frequency.exponentialRampToValueAtTime(35, ign + 0.8);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.setValueAtTime(0.0001, ign);
    bg.gain.exponentialRampToValueAtTime(0.3, ign + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0001, ign + 1);
    boom.connect(bg).connect(out);
    boom.start(t);
    boom.stop(ign + 1.1);
    nodes.push(boom);
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = noiseBuffer(ctx, 1.4);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, ign);
    bp.frequency.exponentialRampToValueAtTime(1600, ign + 0.4);
    bp.frequency.exponentialRampToValueAtTime(400, ign + 1.3);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, ign);
    wg.gain.exponentialRampToValueAtTime(0.16, ign + 0.08);
    wg.gain.exponentialRampToValueAtTime(0.0001, ign + 1.3);
    whoosh.connect(bp).connect(wg).connect(out);
    whoosh.start(ign);
    nodes.push(whoosh);
    running = {
      stop() {
        const now = ctx.currentTime;
        for (const g of [tg, bg, wg]) {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        }
        for (const n of nodes) {
          try {
            n.stop(now + 0.25);
          } catch {
            // Ya parado.
          }
        }
      },
    };
  });
}

/** Apagado: la turbina baja de tono y se apaga en `seconds` segundos. */
export function playEngineStop(seconds: number): void {
  stopEngineSound();
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + seconds * 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds * 1.5);
    lp.connect(g).connect(out);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + seconds * 1.4);
    osc.connect(lp);
    osc.start(t);
    osc.stop(t + seconds * 1.6);
  });
}

export function stopEngineSound(): void {
  running?.stop();
  running = null;
}
