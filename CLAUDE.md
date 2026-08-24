# Approach — flight game

Three.js flight sim over Google Photorealistic 3D Tiles (San Francisco / New
York), in a TanStack Start (React 19 + Vite + Tailwind v4) app. The app is named
**Approach** (`src/lib/og/site.json`); "dhoom machale game" is only the folder.

Game code is small and lives in a handful of files:

- `src/game/sim.ts` — flight physics + world update loop
- `src/game/craft.ts` — aircraft mesh, livery, procedural materials
- `src/game/audio.ts` — engine sound (High asset tier only; see below)
- `src/game/input.ts` — keyboard/pointer/touch mapping
- `src/game/cities.ts` — world/city placement data
- `src/components/flight-app.tsx` — canvas host, HUD, React shell
- `src/routes/index.tsx` — mounts `<FlightApp />`

## Commands (Windows, Node 24)

```
npm run dev        # http://localhost:8080  (never run `vite` directly — npm scripts inject .grok/app-env.json)
npm run typecheck
npm run lint
npm test           # node --test on scripts/**
npm run build      # vite build + db:migrate
```

## This repo came from Grok App Builder

It was scaffolded in Grok's cloud sandbox and exported. That means:

- **`AGENTS.md` is the platform's original contract and is now partly false.**
  Ignore its sandbox framing — there is no `/workspace`, no Linux container, no
  preview proxy, no `imagine_*` tools, no injected `XAI_API_KEY`, and the user
  *can* see this terminal. Its app-level rules (scaffold contracts, auth/db
  opt-in, deploy notes) are still accurate.
- `startup.sh` was the sandbox revive hook. Dead here; `npm run dev` is enough.
- `.grok/app-env.json` is **live** — `scripts/with-app-env.mjs` reads it for
  `VITE_AUTH_ENABLED`. Don't delete it.

### Don't touch (platform wiring, breaks the build or the deploy)

`server/`, `scripts/grok-pwa-*`, `public/__grok/`, `src/lib/auth/*`,
`src/lib/preview-host-bridge.ts`, `<PreviewHostBridge />` in `__root.tsx`, and
the plugin list in `vite.config.ts`. Own server routes go in `src/routes/`.

Auth and Postgres are pre-wired but **off** (`VITE_AUTH_ENABLED: false`, no
`migrations/0002_*`). Leave them off unless the app actually needs accounts.

## Asset tiers

Settings in the menu offer **Low** (default) and **High**. Low is the game as
it shipped: nothing beyond the city tiles, and silent. High downloads
`public/audio/*.mp3` (~110 KB) and turns on engine audio — sampled loops for
the car, synthesis for the plane. Anything added later that costs bandwidth
belongs in High, not in the default path.

Sample provenance and licence are in `public/audio/CREDITS.md`. The car model
(`public/models/lamborghini.glb`, ~18 MB) stays a separate explicit download
on its own button — it is not part of the tier.

## Expiring: the Cesium ion token

`ION_TOKEN` in `src/game/cities.ts` is CesiumJS's public evaluation token and
**dies 1 Oct 2026**. After that the world renders as empty sky (the app degrades
to "City tiles unavailable" rather than crashing). Replace it with a token from
a free cesium.com/ion account when it lapses.

## Skills

`.claude/skills/` — `building-games`, `controls`, `design-ui`, `threejs`,
`multiplayer-p2p`. Read `controls` before touching steering/roll/yaw; inverted
A/D is this codebase's stated top failure mode.

`.grok/skills/` holds the leftovers (`imagine`, `generate2d*`, `xai-api`,
`auth`, `neon`, `og`) — they need Grok-only tools or platform config, kept as
reference only.
