/**
 * Música generativa con Web Audio: se compone en el navegador mientras se
 * juega, sin archivos (sin derechos de autor ni tráfico del servidor).
 *
 * - Colchón: acordes lentos de una progresión modal, con osciladores
 *   ligeramente desafinados y filtro paso bajo que "respira".
 * - Campanas: notas sueltas de una escala pentatónica, a ritmo irregular.
 * - Todo pasa por un eco y una reverberación larga, para sonar a espacio.
 *
 * Los navegadores no dejan sonar audio hasta que el jugador interactúa, así
 * que `start()` se llama desde un clic (el botón "Despertar").
 */

/** Notas en semitonos sobre La 220 Hz. Progresión en Re dórico: Dm9 – Fmaj7 – Cmaj9/E – Am7. */
const CHORDS = [
  [-7, 0, 3, 7, 10],
  [-4, 3, 7, 10, 12],
  [-9, 3, 7, 10, 14],
  [-12, 0, 3, 7, 12],
];
/** Pentatónica menor de Re, en dos octavas. */
const BELL_NOTES = [5, 8, 10, 12, 15, 17, 20, 22, 24, 27];

const freq = (semitones: number) => 220 * 2 ** (semitones / 12);

const CHORD_SECONDS = 9;

export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private chordTimer: ReturnType<typeof setTimeout> | null = null;
  private bellTimer: ReturnType<typeof setTimeout> | null = null;
  private chordIndex = 0;
  private volume = 0.5;
  private sfxVolume = 0.6;
  /** Salida de los efectos: va directa al altavoz y un poco a la reverberación. */
  private sfx: GainNode | null = null;
  private sfxOut: GainNode | null = null;

  /** Arranca (o reanuda) la música. Debe llamarse desde un gesto del jugador. */
  start(): void {
    if (this.volume <= 0) return;
    if (!this.ctx) this.build();
    void this.ctx!.resume();
    if (!this.chordTimer) this.nextChord();
    if (!this.bellTimer) this.nextBell();
  }

  stop(): void {
    if (this.chordTimer) clearTimeout(this.chordTimer);
    if (this.bellTimer) clearTimeout(this.bellTimer);
    this.chordTimer = this.bellTimer = null;
    void this.ctx?.suspend();
  }

  /** Volumen 0–1; 0 la para. */
  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.3);
    if (v <= 0) this.stop();
    else if (this.ctx) this.start();
  }

  /**
   * Efecto de sonido generativo (motor cuántico, disparos, explosiones) con su
   * propio volumen, separado del de la música (comparten el contexto de audio y
   * un poco de reverberación). Con el volumen de efectos a 0 no suena.
   */
  effect(play: (ctx: AudioContext, out: AudioNode) => void): void {
    if (this.sfxVolume <= 0) return;
    if (!this.ctx) this.build();
    void this.ctx!.resume();
    play(this.ctx!, this.sfx!);
  }

  /** Volumen de los efectos, 0–1 (0 = sin efectos). */
  setSfxVolume(v: number): void {
    this.sfxVolume = v;
    if (this.sfxOut && this.ctx) this.sfxOut.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.volume * 0.6;
    master.connect(ctx.destination);
    this.master = master;

    // Reverberación: respuesta al impulso de ruido que decae en 5 s.
    const reverb = ctx.createConvolver();
    const seconds = 5;
    const ir = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    reverb.connect(wet).connect(master);

    // Eco de 0,6 s con realimentación suave.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.6;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    delay.connect(feedback).connect(delay);
    delay.connect(reverb);

    const bus = ctx.createGain();
    bus.gain.value = 0.5;
    bus.connect(master);
    bus.connect(reverb);
    bus.connect(delay);
    this.bus = bus;

    // Efectos: entrada → (seco + algo de reverberación propia) → volumen de efectos → altavoz.
    const sfxOut = ctx.createGain();
    sfxOut.gain.value = this.sfxVolume;
    sfxOut.connect(ctx.destination);
    this.sfxOut = sfxOut;
    const sfx = ctx.createGain();
    sfx.connect(sfxOut);
    const sfxReverb = ctx.createConvolver();
    sfxReverb.buffer = ir;
    const sfxWet = ctx.createGain();
    sfxWet.gain.value = 0.3;
    sfx.connect(sfxWet).connect(sfxReverb).connect(sfxOut);
    this.sfx = sfx;
  }

  private nextChord = () => {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const chord = CHORDS[this.chordIndex % CHORDS.length]!;
    this.chordIndex++;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    // El filtro se abre y se cierra a lo largo del acorde: el colchón "respira".
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.linearRampToValueAtTime(1400, t + CHORD_SECONDS * 0.5);
    filter.frequency.linearRampToValueAtTime(500, t + CHORD_SECONDS * 1.4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.09, t + 3);
    env.gain.setValueAtTime(0.09, t + CHORD_SECONDS - 1);
    env.gain.linearRampToValueAtTime(0, t + CHORD_SECONDS + 3);
    filter.connect(env).connect(this.bus!);
    for (const n of chord) {
      for (const [type, detune] of [
        ["sine", -6],
        ["triangle", 7],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq(n);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + CHORD_SECONDS + 3.2);
      }
    }
    this.chordTimer = setTimeout(this.nextChord, CHORD_SECONDS * 1000);
  };

  private nextBell = () => {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const note = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)]!;
    // Campana: fundamental más un parcial inarmónico, con caída exponencial.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    env.connect(this.bus!);
    for (const [mult, level] of [
      [1, 1],
      [2.76, 0.3],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = level;
      osc.frequency.value = freq(note) * mult;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + 4.1);
    }
    this.bellTimer = setTimeout(this.nextBell, 2500 + Math.random() * 6000);
  };
}

export const music = new Music();
