# Audio credits

Shipped only in the **High** asset tier (Settings → Assets). The Low tier
downloads none of this and runs silent.

## Car engine

- `car-engine.mp3`, `car-accelerate.mp3`
- Source: [pmndrs/racing-game](https://github.com/pmndrs/racing-game),
  `public/sounds/engine.mp3` and `public/sounds/accelerate.mp3`,
  commit `7816a5d954b75e6ad853ae4e4f0cbbd628072643`.
- The project's code is MIT and its README states the project is "100% open
  source and community built, CC0 assets only". These two files are used here
  on that basis, unmodified.

## Plane engine

Synthesised in the browser (`src/game/audio.ts`) — no file, no download. A
propeller sample under a compatible licence could not be sourced, and a
synthesised prop tracks throttle properly instead of pitch-shifting one loop.

To swap in a real recording later, drop `plane-engine.mp3` in this folder and
add it to `PACK` in `src/game/audio.ts`; the loader already handles the rest.

## Road and wind noise

Synthesised (filtered noise, gain from road speed). No file.
