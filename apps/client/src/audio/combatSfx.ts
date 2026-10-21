/**
 * Sonidos generativos del combate (Web Audio, sin archivos): disparo de cañón,
 * lanzamiento de misil, impacto y explosión. Van por la salida de efectos (su
 * propio volumen en los ajustes). `gain` (0–1) atenúa los lejanos.
 */
import { music } from "./music";

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** Un mismo sonido no se repite más de una vez cada tantos ms (ráfagas de varias naves). */
const lastPlayed = new Map<string, number>();
function throttle(key: string, ms: number): boolean {
  const now = performance.now();
  if (now - (lastPlayed.get(key) ?? 0) < ms) return false;
  lastPlayed.set(key, now);
  return true;
}

/** Ráfaga del cañón: un "zap" corto que baja de tono. */
export function playCannon(gain = 1, own = true): void {
  if (gain < 0.03 || !throttle(own ? "cannon-own" : "cannon", own ? 60 : 90)) return;
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(own ? 880 : 620, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(filter).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

/** Lanzamiento de misil: soplido de ruido que sube y se aleja. */
export function playMissile(gain = 1): void {
  if (gain < 0.03 || !throttle("missile", 150)) return;
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(2200, t + 0.5);
    filter.frequency.exponentialRampToValueAtTime(600, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * gain, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + 1.25);
  });
}

/** Impacto en una nave: chasquido metálico breve. */
export function playHit(gain = 1): void {
  if (gain < 0.03 || !throttle("hit", 80)) return;
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.13);
  });
}

/** Explosión de una nave: golpe grave y estruendo de ruido que se apaga. */
export function playExplosion(gain = 1): void {
  if (gain < 0.03 || !throttle("explosion", 200)) return;
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(90, t);
    boom.frequency.exponentialRampToValueAtTime(25, t + 1.4);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.4 * gain, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    boom.connect(bg).connect(out);
    boom.start(t);
    boom.stop(t + 1.7);
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.exponentialRampToValueAtTime(150, t + 2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3 * gain, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    src.connect(filter).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 2.3);
  });
}

/** Atenuación por distancia (m): plena hasta 300 m, inaudible a unos 8 km. */
export function distanceGain(meters: number): number {
  return Math.max(0, Math.min(1, 1 - Math.log10(Math.max(meters, 300) / 300) / 1.45));
}
