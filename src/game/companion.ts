/*
 * The companion on your walk.
 *
 * She reacts to the city: a tower going up beside you, a long run, a wall in
 * the face, or nothing at all for a while. Voices come from the browser's own
 * speech synthesis — every OS ships several, they cost no download, and the
 * lines are the game's own, so there is nothing to license and nothing to
 * fetch before she can speak. The sim builds her inside the start gesture,
 * alongside the engine audio, and mutes her whenever the sound does.
 */

export type LineKind = "landmark" | "jump" | "run" | "blocked" | "idle";

/** Seconds before the same kind may fire again, and any kind at all. */
const KIND_COOLDOWN: Record<LineKind, number> = {
  landmark: 45,
  jump: 9,
  run: 28,
  blocked: 16,
  idle: 40,
};
const GLOBAL_COOLDOWN = 6;

const LINES: Record<LineKind, string[]> = {
  landmark: [
    "This is huge!",
    "Whoa, look how tall that is!",
    "Okay, that building is showing off.",
    "You could see the whole city from up there!",
    "I never get tired of this view.",
    "That one wasn't there last time... was it?",
  ],
  jump: [
    "Nice jump!",
    "Whoa! Warn me next time!",
    "We're basically superheroes.",
    "Airtime!",
  ],
  run: [
    "Okay okay, my legs are burning!",
    "Fastest I've ever gone in sandals!",
    "Are we running from something?",
    "Catch me if you can!",
  ],
  blocked: [
    "No way through here.",
    "Well. That's a wall.",
    "Maybe try another street?",
    "This city has opinions about shortcuts.",
  ],
  idle: [
    "I love it here.",
    "So many people used to live around this spot.",
    "Smell that? City air.",
    "Standing still is also a plan.",
    "Take a picture, it'll last longer.",
    "You hear that? Neither do I. Too quiet.",
  ],
};

export type Companion = {
  /** Fire a line of a kind; returns false when cooldowns or mute said no. */
  say: (kind: LineKind) => boolean;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
};

export function createCompanion(): Companion | null {
  const synth = window.speechSynthesis;
  if (!synth) return null;

  let muted = false;
  let lastAny = -Infinity;
  const lastKind: Record<LineKind, number> = {
    landmark: -Infinity,
    jump: -Infinity,
    run: -Infinity,
    blocked: -Infinity,
    idle: -Infinity,
  };
  /** Round-robin cursor per kind, so repeats space out. */
  const cursor: Record<LineKind, number> = {
    landmark: Math.floor(Math.random() * 3),
    jump: 0,
    run: 0,
    blocked: 0,
    idle: 0,
  };

  let voice: SpeechSynthesisVoice | null = null;
  const pickVoice = () => {
    const voices = synth.getVoices();
    if (voices.length === 0) return;
    // An English voice first; among them, the ones that read as feminine on
    // the platforms people actually use. Any English voice beats silence.
    const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
    voice =
      en.find((v) => /female|zira|aria|jenny|samantha|karen|serena|google uk english female/i.test(v.name)) ??
      en.find((v) => /zira|aria|jenny|female/i.test(v.name)) ??
      en[0] ??
      voices[0];
  };
  pickVoice();
  synth.addEventListener("voiceschanged", pickVoice);

  return {
    say: (kind) => {
      if (muted || !voice) return false;
      const now = performance.now() / 1000;
      if (now - lastAny < GLOBAL_COOLDOWN) return false;
      if (now - lastKind[kind] < KIND_COOLDOWN[kind]) return false;
      const bank = LINES[kind];
      const line = bank[cursor[kind] % bank.length];
      cursor[kind] = (cursor[kind] + 1 + Math.floor(Math.random() * 2)) % bank.length;
      lastAny = now;
      lastKind[kind] = now;

      // One line at a time: a new reaction interrupts a trailing one rather
      // than stacking into a queue that keeps talking after you've moved on.
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(line);
      utter.voice = voice;
      utter.rate = 1.04;
      utter.pitch = 1.25;
      utter.volume = 0.85;
      synth.speak(utter);
      return true;
    },
    setMuted: (m) => {
      muted = m;
      if (m) synth.cancel();
    },
    dispose: () => {
      synth.cancel();
      synth.removeEventListener("voiceschanged", pickVoice);
    },
  };
}
