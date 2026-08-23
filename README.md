# Approach

Fly or drive through real cities, on Google's Photorealistic 3D Tiles. Take a
plane over the skyline, or put a Lamborghini on the actual street surface in San
Francisco, New York, London or Tokyo.

**Play: https://piyushmishra3734-netizen.github.io/approach/**

The car model is 18 MB, so it is never fetched behind your back: the start
screen offers it as a download with a progress bar, and Drive only unlocks once
it is in.

Three.js + `3d-tiles-renderer` for the world, TanStack Start (React 19, Vite,
Tailwind v4) for the shell. No install, no account, nothing to save.

## Controls

| | Plane | Car |
|---|---|---|
| `W` / `S` | pitch | throttle / brake |
| `A` / `D` | roll | steer |
| `Q` / `E` | yaw | — |
| `Shift` / `Ctrl` | throttle / brake | — |
| `V` | chase ↔ cockpit | chase ↔ driver's seat |
| `R` | restart | restart |
| `Esc` | pause | pause |

Gamepads work (standard mapping). On phones and tablets a stick appears bottom
left with throttle and brake on the right, and the top bar carries reload and
full-screen buttons.

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
| `src/game/sim.ts` | flight and car models, cameras, tile streaming, ground probes |
| `src/game/car.ts` | loads the Lamborghini and normalises it into the sim frame |
| `src/game/craft.ts` | the aircraft mesh and its procedural livery |
| `src/game/input.ts` | keyboard, gamepad and touch axes |
| `src/game/cities.ts` | the four cities, their flight and drive spawns, the ion asset |
| `src/components/flight-app.tsx` | HUD, menus, touch stick |

## The Cesium ion token

`ION_TOKEN` in `src/game/cities.ts` is CesiumJS's public evaluation token, which
Cesium deletes on **1 October 2026**. After that the sky renders empty and the
HUD says the tiles are unavailable. Swap in a token from a free
[Cesium ion](https://cesium.com/ion/) account to keep flying.

## How the car stays on the road

There is no road data and no physics engine. Four rays are cast down from the
wheel positions onto the Google tile mesh every frame, and the body is fitted to
those four contacts with suspension smoothing — the same model Cannon's
`RaycastVehicle` uses, minus the collision bodies a streaming tileset cannot
provide. Two limits keep it on drivable surfaces without knowing where roads
are: it will not climb a gradient steeper than a very steep street, and it will
not follow a sheer drop. Measured wheel-to-surface error is 0.02 m or better in
all four cities.

Imagery © Google. Tiles served through Cesium ion.
