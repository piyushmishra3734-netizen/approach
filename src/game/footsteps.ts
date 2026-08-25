/*
 * Footsteps, jump and landing sounds, synthesised rather than sampled.
 *
 * The car got real engine loops because an engine's timbre is not something
 * synthesis fakes well. A footfall is the opposite case: a short filtered
 * noise burst with the right envelope reads as a shoe on concrete from across
 * a city block, and synthesising it keeps the on-foot tier at zero bytes —
 * no pack to fetch before the first step makes a sound.
 */

export type Footsteps = {
  /** One ground contact. Alternates a slight stereo lean, left foot / right. */
  step: (running: boolean) => void;
  /** Take-off: a short air sweep. */
  whoosh: () => void;
  /** Feet back on the ground: a body-weight thud. */
  thud: () => void;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
};

function makeContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  return new Ctor();
}

/** A fraction of a second of raw noise, reused by every sound here. */
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** The caller must be inside a user gesture; see `ensureAudio` in the sim. */
export function createFootsteps(): Footsteps | null {
  const ctx = makeContext();
  if (!ctx) return null;
  void ctx.resume();

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  let muted = false;
  let side = 1;

  const burst = (
    when: number,
    peak: number,
    freq: number,
    q: number,
    decay: number,
    pan: number,
    type: BiquadFilterType = "bandpass",
  ) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, decay + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const vol = ctx.createGain();
    vol.gain.setValueAtTime(peak, when);
    vol.gain.exponentialRampToValueAtTime(0.001, when + decay);
    let tail: AudioNode = vol;
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      vol.connect(panner);
      tail = panner;
    }
    src.connect(filter);
    filter.connect(vol);
    tail.connect(master);
    src.start(when);
    src.stop(when + decay + 0.05);
  };

  return {
    step: (running) => {
      if (muted) return;
      const t = ctx.currentTime;
      // Heel: a mid knock. Sole: a softer slap just behind it.
      const lean = side * 0.14;
      side = -side;
      const strength = running ? 1 : 0.62;
      burst(t, 0.5 * strength * (0.85 + Math.random() * 0.3), 340 + Math.random() * 180, 1.1, 0.075, lean);
      burst(t + 0.018, 0.3 * strength, 900 + Math.random() * 300, 0.8, 0.05, lean);
    },
    whoosh: () => {
      if (muted) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, 0.45);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(260, t);
      filter.frequency.exponentialRampToValueAtTime(1500, t + 0.16);
      filter.frequency.exponentialRampToValueAtTime(420, t + 0.4);
      const vol = ctx.createGain();
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      src.connect(filter);
      filter.connect(vol);
      vol.connect(master);
      src.start(t);
      src.stop(t + 0.45);
    },
    thud: () => {
      if (muted) return;
      const t = ctx.currentTime;
      // Body weight through the knees: a low knock plus its gravel.
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.16);
      const vol = ctx.createGain();
      vol.gain.setValueAtTime(0.42, t);
      vol.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(vol);
      vol.connect(master);
      osc.start(t);
      osc.stop(t + 0.2);
      burst(t, 0.22, 240, 0.9, 0.09, 0, "lowpass");
    },
    setMuted: (m) => {
      muted = m;
    },
    dispose: () => {
      void ctx.close();
    },
  };
}
