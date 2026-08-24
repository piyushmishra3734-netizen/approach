/*
 * Engine audio — the one thing the High asset tier buys.
 *
 * Low is the default and stays exactly as the game shipped: silent, and not a
 * byte more downloaded. Everything here is built only when the player asks for
 * High, so a phone on a metered connection never pays for it.
 *
 * The car is sampled (CC0 loops, see `public/audio/CREDITS.md`) because a real
 * engine's timbre is not something an oscillator bank gets right. The plane is
 * synthesised: a propeller is a blade-pass drone plus air, which synthesis does
 * well, and a synth tracks the throttle instead of pitch-shifting one loop past
 * where it still sounds like an aircraft.
 */

/** Files the High tier fetches, relative to the app base. */
const PACK = {
  engine: "audio/car-engine.mp3",
  accelerate: "audio/car-accelerate.mp3",
} as const;

type PackKey = keyof typeof PACK;

/**
 * Held here rather than trusting the HTTP cache: switching city or vehicle
 * rebuilds the sim, and that should re-decode, not re-download.
 */
let packBytes: Record<PackKey, ArrayBuffer> | null = null;
let packDownload: Promise<Record<PackKey, ArrayBuffer>> | null = null;

export function isPackDownloaded(): boolean {
  return packBytes !== null;
}

/** Fetch one file, reporting bytes as they land. */
async function fetchTracked(url: string, onBytes: (delta: number, total: number) => void) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`audio pack: HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    onBytes(buf.byteLength, buf.byteLength);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onBytes(value.length, total);
  }
  const merged = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.length;
  }
  return merged.buffer;
}

/**
 * Fetch the sound pack, reporting bytes received and expected. Safe to call
 * again: an in-flight download is shared and a finished one returns at once.
 */
export function downloadAudioPack(
  base: string,
  onProgress: (received: number, total: number) => void,
): Promise<Record<PackKey, ArrayBuffer>> {
  if (packBytes) {
    const done = Object.values(packBytes).reduce((n, b) => n + b.byteLength, 0);
    onProgress(done, done);
    return Promise.resolve(packBytes);
  }
  packDownload ??= (async () => {
    // Totals only exist once each response's headers are in, so the reported
    // total grows for the first few chunks. Over ~110 KB nobody sees it.
    let received = 0;
    const totals = new Map<string, number>();
    const keys = Object.keys(PACK) as PackKey[];
    const buffers = await Promise.all(
      keys.map((key) =>
        fetchTracked(`${base}${PACK[key]}`, (delta, total) => {
          received += delta;
          totals.set(key, total);
          let sum = 0;
          for (const t of totals.values()) sum += t;
          onProgress(received, Math.max(sum, received));
        }),
      ),
    );
    const pack = {} as Record<PackKey, ArrayBuffer>;
    keys.forEach((key, i) => (pack[key] = buffers[i]));
    packBytes = pack;
    return pack;
  })().catch((err) => {
    packDownload = null;
    throw err;
  });
  return packDownload;
}

export type EngineState = {
  /** Road/air speed, m/s. */
  speed: number;
  /** What counts as flat out for this vehicle, m/s. */
  topSpeed: number;
  /** Throttle demand, 0..1. */
  throttle: number;
};

export type EngineAudio = {
  update: (state: EngineState) => void;
  /** Silence without tearing the graph down — pause, or the mute toggle. */
  setMuted: (muted: boolean) => void;
  dispose: () => void;
};

/**
 * Speeds the fake gearbox shifts at, as fractions of top speed.
 *
 * There is no gearbox in the physics — the car is a raycast model with a flat
 * speed cap. But an engine note that rises smoothly from crawl to flat out
 * reads as a milk float, so the sound gets ratios the handling does not: revs
 * climb inside a gear and drop on the shift, which is most of what makes an
 * engine sound like one.
 */
const CAR_GEARS = [0.16, 0.32, 0.52, 0.76, 1];

/** Revs as 0..1 within the current gear, from speed as a fraction of top. */
function gearRpm(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  let low = 0;
  for (const top of CAR_GEARS) {
    if (f <= top) {
      const span = Math.max(top - low, 1e-3);
      return 0.28 + 0.72 * ((f - low) / span);
    }
    low = top;
  }
  return 1;
}

function makeContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  return new Ctor();
}

/** Two seconds of softened noise, looped for road and wind. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // One-pole lowpass over white noise: tyres and airflow are rumble, and
    // raw white noise reads as radio static.
    last = last * 0.86 + (Math.random() * 2 - 1) * 0.14;
    data[i] = last * 3.2;
  }
  return buf;
}

function loopSource(ctx: AudioContext, buffer: AudioBuffer, gain: number) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const vol = ctx.createGain();
  vol.gain.value = gain;
  src.connect(vol);
  return { src, vol };
}

/**
 * Build the audio for a vehicle. The caller must be inside a user gesture —
 * every browser refuses to start an AudioContext otherwise — which is why the
 * sim only ever calls this from the start press or the settings toggle.
 */
export async function createEngineAudio(
  kind: "car" | "plane",
  base: string,
): Promise<EngineAudio | null> {
  const ctx = makeContext();
  if (!ctx) return null;

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  void ctx.resume();

  /** Smoothing for every parameter, seconds. Steps in these click audibly. */
  const GLIDE = 0.08;
  const set = (param: AudioParam, value: number, glide = GLIDE) =>
    param.setTargetAtTime(value, ctx.currentTime, glide);

  let muted = false;
  let volume = 0;
  const applyMaster = () => set(master.gain, muted ? 0 : volume, 0.05);

  const stops: Array<() => void> = [];

  if (kind === "car") {
    const bytes = await downloadAudioPack(base, () => {});
    // decodeAudioData takes ownership of the buffer it is handed, and these
    // bytes are kept for the next sim.
    const [engine, accelerate] = await Promise.all([
      ctx.decodeAudioData(bytes.engine.slice(0)),
      ctx.decodeAudioData(bytes.accelerate.slice(0)),
    ]);

    const idle = loopSource(ctx, engine, 0.34);
    const pull = loopSource(ctx, accelerate, 0);
    const road = loopSource(ctx, noiseBuffer(ctx), 0);
    const roadFilter = ctx.createBiquadFilter();
    roadFilter.type = "lowpass";
    roadFilter.frequency.value = 320;

    idle.vol.connect(master);
    pull.vol.connect(master);
    road.vol.connect(roadFilter);
    roadFilter.connect(master);
    idle.src.start();
    pull.src.start();
    road.src.start();
    stops.push(() => {
      idle.src.stop();
      pull.src.stop();
      road.src.stop();
    });

    volume = 0.9;
    applyMaster();

    return {
      update: ({ speed, topSpeed, throttle }) => {
        const fraction = Math.min(1, Math.abs(speed) / Math.max(topSpeed, 1));
        const rpm = gearRpm(fraction);
        // Both loops ride the same revs; the crossfade between them is what
        // makes lifting off the throttle sound like lifting off.
        set(idle.src.playbackRate, 0.78 + rpm * 1.25);
        set(pull.src.playbackRate, 0.72 + rpm * 1.3);
        set(idle.vol.gain, 0.34 * (1 - 0.55 * throttle));
        set(pull.vol.gain, 0.46 * throttle * (0.3 + 0.7 * rpm));
        set(road.vol.gain, 0.3 * fraction);
        set(roadFilter.frequency, 320 + 1100 * fraction, 0.12);
      },
      setMuted: (m) => {
        muted = m;
        applyMaster();
      },
      dispose: () => {
        stops.forEach((stop) => stop());
        void ctx.close();
      },
    };
  }

  // Plane: blade-pass drone plus airflow.
  const bank = [
    { type: "sawtooth" as OscillatorType, mul: 1, gain: 0.5, detune: 0 },
    { type: "square" as OscillatorType, mul: 2, gain: 0.16, detune: 6 },
    { type: "sawtooth" as OscillatorType, mul: 3, gain: 0.09, detune: -9 },
  ];
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 700;
  tone.Q.value = 0.6;
  tone.connect(master);

  const oscs = bank.map(({ type, mul, gain, detune }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = 46 * mul;
    osc.detune.value = detune;
    const vol = ctx.createGain();
    vol.gain.value = gain;
    osc.connect(vol);
    vol.connect(tone);
    osc.start();
    return { osc, mul };
  });
  stops.push(() => oscs.forEach(({ osc }) => osc.stop()));

  /*
   * A propeller never holds a dead-steady note — two blades and an airframe
   * beat against each other. A slow wobble on the fundamental is the whole
   * difference between an aircraft and a test tone.
   */
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 4.7;
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = 0.9;
  wobble.connect(wobbleDepth);
  oscs.forEach(({ osc, mul }) => {
    const perHarmonic = ctx.createGain();
    perHarmonic.gain.value = mul;
    wobbleDepth.connect(perHarmonic);
    perHarmonic.connect(osc.frequency);
  });
  wobble.start();
  stops.push(() => wobble.stop());

  const air = loopSource(ctx, noiseBuffer(ctx), 0);
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = "bandpass";
  airFilter.frequency.value = 900;
  airFilter.Q.value = 0.7;
  air.vol.connect(airFilter);
  airFilter.connect(master);
  air.src.start();
  stops.push(() => air.src.stop());

  volume = 0.75;
  applyMaster();

  return {
    update: ({ speed, topSpeed, throttle }) => {
      const fraction = Math.min(1, Math.abs(speed) / Math.max(topSpeed, 1));
      // Revs follow the throttle, with a little from the airspeed so a dive
      // picks up and a climb falls away.
      const rev = Math.min(1, throttle * 0.8 + fraction * 0.35);
      const f0 = 44 + 54 * rev;
      oscs.forEach(({ osc, mul }) => set(osc.frequency, f0 * mul, 0.12));
      set(tone.frequency, 620 + 900 * rev, 0.12);
      set(air.vol.gain, 0.1 + 0.34 * fraction);
      set(airFilter.frequency, 800 + 900 * fraction, 0.15);
    },
    setMuted: (m) => {
      muted = m;
      applyMaster();
    },
    dispose: () => {
      stops.forEach((stop) => stop());
      void ctx.close();
    },
  };
}
