# Approach

A browser flight sim over Google's Photorealistic 3D Tiles — take off above San
Francisco or New York and fly the real skyline down to street level.

**Play: https://piyushmishra3734-netizen.github.io/approach/**

Three.js + `3d-tiles-renderer` for the world, TanStack Start (React 19, Vite,
Tailwind v4) for the shell. No install, no account, nothing to save.

## Controls

| | |
|---|---|
| `W` / `S` | pitch |
| `A` / `D` | roll |
| `Q` / `E` | yaw |
| `Shift` / `Ctrl` | throttle / brake |
| `V` | chase ↔ cockpit |
| `R` | restart |
| `Esc` | pause |

Gamepads work (standard mapping). On phones and tablets a stick appears bottom
left with throttle and brake on the right.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:8080
```

```bash
npm run typecheck
npm run lint
npm test
npm run build      # Vercel/Nitro output
npm run build:pages  # static output for GitHub Pages (needs PAGES_BASE)
```

## Where things live

| Path | |
|---|---|
| `src/game/sim.ts` | flight model, camera, tile streaming, ground clamp |
| `src/game/craft.ts` | the aircraft mesh and its procedural livery |
| `src/game/input.ts` | keyboard, gamepad and touch axes |
| `src/game/cities.ts` | the two cities and the Cesium ion asset |
| `src/components/flight-app.tsx` | HUD, menus, touch stick |

## The Cesium ion token

`ION_TOKEN` in `src/game/cities.ts` is CesiumJS's public evaluation token, which
Cesium deletes on **1 October 2026**. After that the sky renders empty and the
HUD says the tiles are unavailable. Swap in a token from a free
[Cesium ion](https://cesium.com/ion/) account to keep flying.

Imagery © Google. Tiles served through Cesium ion.
