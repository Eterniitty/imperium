/**
 * Sonidos generativos del motor cuántico (Web Audio, sin archivos): un zumbido
 * grave que sube de tono mientras carga y un estallido con eco al saltar. Pasan
 * por la mezcla de la música (su volumen, eco y reverberación).
 */
import { music } from "./music";

let charging: { stop(): void } | null = null;

/** Zumbido de carga que sube durante `seconds` segundos. */
export function playQuantumCharge(seconds: number): void {
  stopQuantumCharge();
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + seconds * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.2, t + seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(200, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + seconds);
    filter.connect(gain).connect(out);
    const oscs: OscillatorNode[] = [];
    for (const [type, detune, mult] of [
      ["sawtooth", -8, 1],
      ["sawtooth", 9, 1.5],
      ["sine", 0, 0.5],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(55 * mult, t);
      osc.frequency.exponentialRampToValueAtTime(220 * mult, t + seconds);
      osc.connect(filter);
      osc.start(t);
      oscs.push(osc);
    }
    // Trémolo que se acelera: el motor "late" cada vez más deprisa.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(3, t);
    lfo.frequency.exponentialRampToValueAtTime(18, t + seconds);
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start(t);
    oscs.push(lfo);
    charging = {
      stop() {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        for (const o of oscs) o.stop(now + 0.3);
      },
    };
  });
}

export function stopQuantumCharge(): void {
  charging?.stop();
  charging = null;
}

/** Estallido al entrar en el túnel: golpe grave y ráfaga de ruido que se apaga. */
export function playQuantumJump(): void {
  stopQuantumCharge();
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "sine";
    boom.frequency.setValueAtTime(120, t);
    boom.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    boomGain.gain.setValueAtTime(0.35, t);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    boom.connect(boomGain).connect(out);
    boom.start(t);
    boom.stop(t + 1.6);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + 2);
  });
}

/**
 * Desgarro del espacio (al saltar y, más suave, al llegar): ruido que se rasga
 * con chasquidos irregulares, un barrido que cae y un tintineo de cristal roto.
 * `strength` de 0 a 1.
 */
export function playQuantumTear(strength: number): void {
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    const len = 1.6;
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const data = noise.getChannelData(0);
    // Ruido con chasquidos: tramos de silencio y golpes, como tela o cristal que se rompe.
    let burst = 0;
    for (let i = 0; i < data.length; i++) {
      if (Math.random() < 0.0015) burst = 0.4 + Math.random() * 0.6;
      burst *= 0.9993;
      data[i] = (Math.random() * 2 - 1) * (0.25 + burst);
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 2.5;
    band.frequency.setValueAtTime(5200, t);
    band.frequency.exponentialRampToValueAtTime(260, t + len * 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * strength, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(band).connect(g).connect(out);
    src.start(t);
    src.stop(t + len);
    // Tintineo de cristal: unas notas agudas cortas al azar.
    for (let i = 0; i < 7; i++) {
      const at = t + 0.02 + Math.random() * 0.5;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 2400 + Math.random() * 3600;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, at);
      og.gain.exponentialRampToValueAtTime(0.05 * strength, at + 0.005);
      og.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      osc.connect(og).connect(out);
      osc.start(at);
      osc.stop(at + 0.3);
    }
  });
}
