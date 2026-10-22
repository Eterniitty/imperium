/**
 * Sonido continuo del vuelo (Web Audio, sin archivos), por la salida de
 * efectos (su volumen en Ajustes; a 0, no suena):
 * - zumbido grave de los motores, que sube de tono y se abre con el empuje;
 * - rumor de fondo de la nave en marcha;
 * - el pulso: un soplido que crece con la velocidad y un tono que sube
 *   mientras se carga.
 * Lo mueve la vista del sistema en cada fotograma con `flightSound.update`.
 * El navegador solo deja sonar tras un gesto del jugador: hasta entonces el
 * contexto de audio está suspendido y no se oye nada (ni falla).
 */
import { music } from "./music";
import { settingsStore } from "../state/settings";

export interface FlightSoundState {
  /** Potencia de los motores (0 apagados – 1 en marcha; sube durante el arranque). */
  power: number;
  /** Empuje pedido (0–1). */
  thrust: number;
  /** Velocidad (m/s). */
  speed: number;
  /** Pulso encendido. */
  pulse: boolean;
  /** Carga del pulso (0–1) o null si no se carga. */
  charge: number | null;
  /** Velocidad máxima del pulso (para escalar el soplido). */
  pulseMax: number;
}

interface Nodes {
  ctx: AudioContext;
  hum: GainNode;
  humFilter: BiquadFilterNode;
  oscs: OscillatorNode[];
  rumble: GainNode;
  wind: GainNode;
  windFilter: BiquadFilterNode;
  chargeOsc: OscillatorNode;
  chargeGain: GainNode;
  sources: AudioScheduledSourceNode[];
}

function noise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Ruido algo «marrón» (más grave que el blanco): rumor y viento, no siseo.
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}

class FlightSound {
  private n: Nodes | null = null;

  private build(): void {
    music.effect((ctx, out) => {
      const sources: AudioScheduledSourceNode[] = [];
      // Motores: dos dientes de sierra desafinados y una octava, por un filtro que se abre con el empuje.
      const humFilter = ctx.createBiquadFilter();
      humFilter.type = "lowpass";
      humFilter.Q.value = 3;
      humFilter.frequency.value = 160;
      const hum = ctx.createGain();
      hum.gain.value = 0;
      humFilter.connect(hum).connect(out);
      const oscs = ([[42, -6], [42.4, 7], [84, 0]] as const).map(([f, detune]) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(humFilter);
        o.start();
        sources.push(o);
        return o;
      });
      // Rumor de la nave en marcha y viento del pulso: el mismo ruido con dos filtros.
      const buf = noise(ctx);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = "lowpass";
      rumbleFilter.frequency.value = 140;
      const rumble = ctx.createGain();
      rumble.gain.value = 0;
      src.connect(rumbleFilter).connect(rumble).connect(out);
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.Q.value = 0.8;
      windFilter.frequency.value = 400;
      const wind = ctx.createGain();
      wind.gain.value = 0;
      src.connect(windFilter).connect(wind).connect(out);
      src.start();
      sources.push(src);
      // Carga del pulso: un tono que sube.
      const chargeOsc = ctx.createOscillator();
      chargeOsc.type = "triangle";
      chargeOsc.frequency.value = 110;
      const chargeGain = ctx.createGain();
      chargeGain.gain.value = 0;
      chargeOsc.connect(chargeGain).connect(out);
      chargeOsc.start();
      sources.push(chargeOsc);
      this.n = { ctx, hum, humFilter, oscs, rumble, wind, windFilter, chargeOsc, chargeGain, sources };
    });
  }

  /** Ajusta el sonido al estado del vuelo (cada fotograma; los cambios se suavizan). */
  update(s: FlightSoundState): void {
    if (!this.n) {
      if (s.power <= 0.01) return;
      this.build();
      if (!this.n) return;
    }
    const { ctx, hum, humFilter, oscs, rumble, wind, windFilter, chargeOsc, chargeGain } = this.n;
    const t = ctx.currentTime;
    // Volumen propio de los motores (Ajustes → Sonido), dentro del de efectos.
    const vol = settingsStore.getState().prefs.engineVolume;
    const ease = 0.12;
    const thrust = Math.max(0, Math.min(1, s.thrust));
    const p = Math.max(0, Math.min(1, s.power));
    // Motores: más alto, más agudo y más abierto con el empuje; con el pulso, un poco más tenso.
    hum.gain.setTargetAtTime(vol * p * (0.035 + 0.075 * thrust), t, ease);
    humFilter.frequency.setTargetAtTime(140 + 900 * thrust * p + (s.pulse ? 300 : 0), t, ease);
    const pitch = 0.85 + 0.35 * thrust + (s.pulse ? 0.25 : 0);
    oscs.forEach((o, i) => o.frequency.setTargetAtTime([42, 42.4, 84][i]! * pitch * (0.6 + 0.4 * p), t, 0.25));
    rumble.gain.setTargetAtTime(vol * p * 0.06, t, 0.3);
    // Pulso: viento que crece y sube con la velocidad (escala logarítmica, como el velocímetro).
    const v = s.pulse ? Math.log(1 + s.speed) / Math.log(1 + s.pulseMax) : 0;
    wind.gain.setTargetAtTime(s.pulse ? vol * (0.05 + 0.12 * v) : 0, t, s.pulse ? 0.4 : 0.25);
    windFilter.frequency.setTargetAtTime(300 + 1600 * v, t, 0.3);
    // Carga: tono de 110 a 660 Hz, algo más fuerte al final.
    if (s.charge !== null) {
      chargeOsc.frequency.setTargetAtTime(110 * 6 ** s.charge, t, 0.05);
      chargeGain.gain.setTargetAtTime(vol * (0.02 + 0.05 * s.charge), t, 0.05);
    } else chargeGain.gain.setTargetAtTime(0, t, 0.08);
  }

  /** Se deja de pilotar: silencio y se liberan los nodos. */
  stop(): void {
    const n = this.n;
    if (!n) return;
    this.n = null;
    const t = n.ctx.currentTime;
    for (const g of [n.hum, n.rumble, n.wind, n.chargeGain]) g.gain.setTargetAtTime(0, t, 0.15);
    for (const s of n.sources) s.stop(t + 1);
  }
}

export const flightSound = new FlightSound();

/** Aviso del piloto automático al llegar o entrar en órbita: dos notas suaves. */
export function playCruiseArrive(): void {
  music.effect((ctx, out) => {
    const t = ctx.currentTime;
    for (const [i, f] of [523.25, 783.99].entries()) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      const at = t + i * 0.16;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.07, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + 0.65);
    }
  });
}
