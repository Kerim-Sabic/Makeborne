"use client";

/**
 * Optional launch-screen sound, synthesised with the Web Audio API (no audio files at all). It is OFF by default and
 * starts only from the visitor's own click or key press. When on, it plays:
 * - a soft tick each second: a short band-passed noise burst with a quiet high sine, more like a watch than a clock;
 * - a very quiet ambient pad: detuned sines through a slowly breathing low-pass filter, seamless because the
 *   oscillators simply run;
 * - at the reveal, a short filtered-noise swell while the pad blooms and fades.
 * A compressor and a fixed master gain cap the volume. The context is suspended while the tab is hidden.
 */
const CEILING = 0.22;
let engine: Engine | null = null;

class Engine {
  context: AudioContext;
  master: GainNode;
  pad: GainNode;
  noise: AudioBuffer;
  started = false;

  constructor() {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Context();
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -18; limiter.knee.value = 12; limiter.ratio.value = 8; limiter.attack.value = 0.003; limiter.release.value = 0.2;
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter).connect(this.context.destination);
    this.pad = this.context.createGain();
    this.pad.gain.value = 0;
    this.pad.connect(this.master);
    const length = Math.floor(this.context.sampleRate * 2);
    this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
  }

  /** The pad: A2, E3 and A3, each a pair of sines a few cents apart, under a low-pass filter that breathes slowly. */
  startPad() {
    if (this.started) return;
    this.started = true;
    const now = this.context.currentTime;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = 760; filter.Q.value = 0.6;
    filter.connect(this.pad);
    const lfo = this.context.createOscillator(), depth = this.context.createGain();
    lfo.frequency.value = 0.06; depth.gain.value = 240;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start(now);
    for (const [frequency, level] of [[110, 0.5], [164.81, 0.34], [220, 0.26]] as const) {
      for (const cents of [-5, 5]) {
        const oscillator = this.context.createOscillator(), gain = this.context.createGain();
        oscillator.type = "sine"; oscillator.frequency.value = frequency; oscillator.detune.value = cents;
        gain.gain.value = level * 0.05;
        oscillator.connect(gain).connect(filter);
        oscillator.start(now);
      }
    }
    this.pad.gain.cancelScheduledValues(now);
    this.pad.gain.setValueAtTime(0, now);
    this.pad.gain.linearRampToValueAtTime(0.55, now + 3);
  }

  fadeIn() {
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(CEILING, now + 0.6);
  }

  fadeOut(seconds = 0.4) {
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + seconds);
  }

  tick(soft: boolean) {
    const now = this.context.currentTime;
    const source = this.context.createBufferSource(), band = this.context.createBiquadFilter(), gain = this.context.createGain();
    source.buffer = this.noise;
    band.type = "bandpass"; band.frequency.value = 3600; band.Q.value = 7;
    const peak = soft ? 0.35 : 0.7;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.045);
    source.connect(band).connect(gain).connect(this.master);
    source.start(now, Math.random() * 1.5, 0.06);
    const blip = this.context.createOscillator(), blipGain = this.context.createGain();
    blip.type = "sine"; blip.frequency.value = 2400;
    blipGain.gain.setValueAtTime(0, now);
    blipGain.gain.linearRampToValueAtTime(soft ? 0.03 : 0.06, now + 0.002);
    blipGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.03);
    blip.connect(blipGain).connect(this.master);
    blip.start(now); blip.stop(now + 0.05);
  }

  /** The reveal: a rising filtered-noise swell while the pad blooms, then everything fades out. */
  swell() {
    const now = this.context.currentTime;
    const source = this.context.createBufferSource(), band = this.context.createBiquadFilter(), gain = this.context.createGain();
    source.buffer = this.noise; source.loop = true;
    band.type = "bandpass"; band.Q.value = 1.1;
    band.frequency.setValueAtTime(260, now);
    band.frequency.exponentialRampToValueAtTime(3800, now + 1.5);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 1.05);
    gain.gain.linearRampToValueAtTime(0, now + 2.1);
    source.connect(band).connect(gain).connect(this.master);
    source.start(now); source.stop(now + 2.2);
    this.pad.gain.cancelScheduledValues(now);
    this.pad.gain.setValueAtTime(this.pad.gain.value, now);
    this.pad.gain.linearRampToValueAtTime(1, now + 1.1);
    this.pad.gain.linearRampToValueAtTime(0, now + 3.4);
  }
}

/** Starts (or resumes) sound. Call it from a click or key handler so the browser allows audio. */
export async function soundOn() {
  if (typeof window === "undefined" || !("AudioContext" in window || "webkitAudioContext" in window)) return false;
  engine ??= new Engine();
  try { await engine.context.resume(); } catch { return false; }
  engine.startPad();
  engine.fadeIn();
  return engine.context.state === "running";
}
export function soundOff() { engine?.fadeOut(); }
export function soundTick(soft: boolean) { if (engine?.context.state === "running") engine.tick(soft); }
export function soundSwell() { if (engine?.context.state === "running") engine.swell(); }
/** Hidden tab: suspend; visible again: resume if sound was on. */
export function soundPause(paused: boolean) {
  if (!engine) return;
  void (paused ? engine.context.suspend() : engine.context.resume()).catch(() => undefined);
}
/** After the reveal: fade out and release the audio device. */
export function soundStop() {
  if (!engine) return;
  const current = engine;
  engine = null;
  current.fadeOut(1.2);
  setTimeout(() => { void current.context.close().catch(() => undefined); }, 1500);
}
export const SOUND_KEY = "makeborne.launch-sound";
