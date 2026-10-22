/**
 * Sonidos generativos del combate (Web Audio, sin archivos), graves y con eco para que pesen: disparo de cañón,
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

/** Eco corto (retardo con realimentación) para que los golpes graves suenen en una nave enorme. */
function echo(ctx: AudioContext, out: AudioNode, delaySec: number, feedback: number): AudioNode {
  const input = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = delaySec;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 900;
  input.connect(out);
  input.connect(delay);
  delay.connect(damp).connect(fb).connect(delay);
  damp.connect(out);
  // El bucle de realimentación no se libera solo: se desconecta cuando el eco ya se ha apagado.
  window.setTimeout(() => {
    for (const n of [input, delay, damp, fb]) n.disconnect();
  }, 3000);
  return input;
}

/**
 * Cañonazo: un golpe grave (el retroceso de un cañón de una nave capital), un
 * estallido de ruido apagado y el silbido del disparo, más grave que antes.
 */
export function playCannon(gain = 1, own = true): void {
  if (gain < 0.03 || !throttle(own ? "cannon-own" : "cannon", own ? 60 : 90)) return;
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const bus = echo(ctx, out, 0.11, 0.28);
    // Golpe grave.
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(own ? 130 : 105, t);
    thump.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.26 * gain, t + 0.008);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    thump.connect(tg).connect(bus);
    thump.start(t);
    thump.stop(t + 0.34);
    // Estallido apagado.
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.14 * gain, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(lp).connect(ng).connect(bus);
    src.start(t);
    src.stop(t + 0.24);
    // Silbido del proyectil.
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(own ? 520 : 400, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.16);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.045 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(filter).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
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
    // Retumbo del motor del misil al salir del lanzador.
    const rumble = ctx.createOscillator();
    rumble.type = "triangle";
    rumble.frequency.setValueAtTime(70, t);
    rumble.frequency.exponentialRampToValueAtTime(42, t + 0.9);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.2 * gain, t + 0.05);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    rumble.connect(rg).connect(out);
    rumble.start(t);
    rumble.stop(t + 1.05);
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
    const bus = echo(ctx, out, 0.23, 0.38);
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(75, t);
    boom.frequency.exponentialRampToValueAtTime(18, t + 2);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.5 * gain, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    boom.connect(bg).connect(bus);
    boom.start(t);
    boom.stop(t + 2.3);
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
    src.connect(filter).connect(ng).connect(bus);
    src.start(t);
    src.stop(t + 2.3);
  });
}

/** Atenuación por distancia (m): plena hasta 300 m, inaudible a unos 8 km. */
export function distanceGain(meters: number): number {
  return Math.max(0, Math.min(1, 1 - Math.log10(Math.max(meters, 300) / 300) / 1.45));
}

/** Alarma de daño: dos pitidos graves y ásperos (como mucho uno cada 1,2 s). */
export function playAlarm(gain = 1): void {
  if (gain < 0.03 || !throttle("alarm", 1200)) return;
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    for (const at of [0, 0.22]) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(440, t + at);
      o.frequency.linearRampToValueAtTime(330, t + at + 0.16);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.09 * gain, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.18);
      o.connect(lp).connect(g).connect(out);
      o.start(t + at);
      o.stop(t + at + 0.2);
    }
  });
}

/** Aviso de misil entrante: pitidos agudos y rápidos (como mucho una tanda cada 0,8 s). */
export function playMissileWarning(): void {
  if (!throttle("missile-warn", 800)) return;
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    for (const at of [0, 0.12, 0.24]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = 1320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.06, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.08);
      o.connect(g).connect(out);
      o.start(t + at);
      o.stop(t + at + 0.1);
    }
  });
}
