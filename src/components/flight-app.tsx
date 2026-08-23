import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { CITIES, CITY_ORDER, type CityId } from "@/game/cities";
import type { HudSnapshot, SimHandle } from "@/game/sim";

const EMPTY_HUD: HudSnapshot = {
  ready: false,
  progress: 0,
  speedKt: 0,
  altitudeFt: 0,
  heading: 0,
  throttle: 0,
  cityId: "sf",
  cityName: CITIES.sf.name,
  lat: 0,
  lon: 0,
  flying: false,
  cameraMode: "chase",
  error: null,
};

const STICK_RADIUS = 56;
const STICK_DEADZONE = 0.14;
const CITY_KEY = "approach.city";

function padHeading(deg: number) {
  return Math.round(deg).toString().padStart(3, "0");
}

function formatAlt(ft: number) {
  return Math.round(ft).toLocaleString("en-US");
}

function clampStick(dx: number, dy: number) {
  const mag = Math.hypot(dx, dy);
  if (mag > STICK_RADIUS && mag > 0) {
    const s = STICK_RADIUS / mag;
    return { x: dx * s, y: dy * s };
  }
  return { x: dx, y: dy };
}

function readStoredCity(): CityId {
  try {
    const v = localStorage.getItem(CITY_KEY);
    if (v === "sf" || v === "nyc") return v;
  } catch {
    /* private mode */
  }
  return "sf";
}

function loadLabel(simReady: boolean, hud: HudSnapshot, progress: number, bootError: boolean) {
  if (bootError) return "Unavailable";
  if (!simReady) return "Loading engine";
  if (hud.error && !hud.ready) return "Tiles unavailable";
  if (!hud.ready) return "Streaming city";
  if (progress < 100) return `${progress}%`;
  return "Ready";
}

export function FlightApp() {
  const mountRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<SimHandle | null>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const originRef = useRef({ x: 0, y: 0, id: -1 });
  const offsetRef = useRef({ x: 0, y: 0 });
  const cityRef = useRef<CityId>("sf");
  const pendingStart = useRef(false);
  const resumeBtnRef = useRef<HTMLButtonElement>(null);
  const flyBtnRef = useRef<HTMLButtonElement>(null);
  const [hud, setHud] = useState<HudSnapshot>(EMPTY_HUD);
  const [menu, setMenu] = useState(true);
  const [paused, setPaused] = useState(false);
  const [cityId, setCityId] = useState<CityId>("sf");
  const [hintVisible, setHintVisible] = useState(true);
  const [touchUi, setTouchUi] = useState(false);
  const [simReady, setSimReady] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [stickHeld, setStickHeld] = useState(false);
  const [thrustHeld, setThrustHeld] = useState<"thrust" | "brake" | null>(null);
  cityRef.current = cityId;

  useEffect(() => {
    const stored = readStoredCity();
    if (stored !== cityRef.current) setCityId(stored);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CITY_KEY, cityId);
    } catch {
      /* private mode */
    }
  }, [cityId]);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const narrow = window.matchMedia("(max-width: 640px)");
    const apply = () => setTouchUi(coarse.matches || narrow.matches);
    apply();
    coarse.addEventListener("change", apply);
    narrow.addEventListener("change", apply);
    return () => {
      coarse.removeEventListener("change", apply);
      narrow.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let cancelled = false;
    let handle: SimHandle | null = null;

    void import("@/game/sim")
      .then(({ createSim }) => {
        if (cancelled || !mountRef.current) return;
        try {
          handle = createSim(mountRef.current, setHud, cityRef.current);
        } catch {
          setBootError(true);
          return;
        }
        simRef.current = handle;
        setSimReady(true);
        if (pendingStart.current) {
          handle.setCity(cityRef.current);
          handle.start();
          pendingStart.current = false;
          setMenu(false);
          setPaused(false);
          setHintVisible(true);
        }
      })
      .catch(() => {
        if (!cancelled) setBootError(true);
      });

    return () => {
      cancelled = true;
      handle?.dispose();
      simRef.current = null;
    };
  }, []);

  useEffect(() => {
    simRef.current?.setCity(cityId);
  }, [cityId]);

  useEffect(() => {
    if (!hud.flying || !hintVisible) return;
    const t = window.setTimeout(() => setHintVisible(false), 7000);
    return () => window.clearTimeout(t);
  }, [hud.flying, hintVisible]);

  useEffect(() => {
    if (paused) resumeBtnRef.current?.focus();
  }, [paused]);

  const resetTouch = useCallback(() => {
    setStickHeld(false);
    setThrustHeld(null);
    offsetRef.current = { x: 0, y: 0 };
    if (knobRef.current) knobRef.current.style.translate = "";
    simRef.current?.setTouch({ roll: 0, pitch: 0, throttle: 0 });
  }, []);

  const begin = useCallback(() => {
    if (bootError) return;
    if (!simRef.current) {
      pendingStart.current = true;
      return;
    }
    simRef.current.setCity(cityRef.current);
    simRef.current.start();
    setMenu(false);
    setPaused(false);
    setHintVisible(true);
    mountRef.current?.focus();
  }, [bootError]);

  const resume = useCallback(() => {
    setPaused(false);
    simRef.current?.setFlying(true);
    mountRef.current?.focus();
  }, []);

  const pause = useCallback(() => {
    setPaused(true);
    simRef.current?.setFlying(false);
    resetTouch();
  }, [resetTouch]);

  const toMenu = useCallback(() => {
    setPaused(false);
    setMenu(true);
    resetTouch();
    simRef.current?.setFlying(false);
    simRef.current?.setCity(cityRef.current);
    requestAnimationFrame(() => flyBtnRef.current?.focus());
  }, [resetTouch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        if (menu) return;
        setPaused((p) => {
          const next = !p;
          simRef.current?.setFlying(!next);
          if (next) resetTouch();
          return next;
        });
      }
      if (menu && (e.code === "Enter" || e.code === "Space")) {
        e.preventDefault();
        begin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, begin, resetTouch]);

  const applyStick = useCallback((dx: number, dy: number) => {
    const sim = simRef.current;
    const clamped = clampStick(dx, dy);
    offsetRef.current = clamped;
    const knob = knobRef.current;
    if (knob) {
      // Must be `translate`, not `transform`: Tailwind v4's -translate-x-1/2 on
      // the knob compiles to the `translate` property, and the two stack — a
      // `transform` here re-applies the -50% centering and parks the knob half
      // its width up and left of the base, permanently after the first touch.
      knob.style.translate = `calc(-50% + ${clamped.x}px) calc(-50% + ${clamped.y}px)`;
    }
    if (!sim) return;
    const nx = clamped.x / STICK_RADIUS;
    const ny = clamped.y / STICK_RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag < STICK_DEADZONE) {
      sim.setTouch({ roll: 0, pitch: 0 });
      return;
    }
    const s = ((mag - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / mag;
    sim.setTouch({ roll: nx * s, pitch: -ny * s });
  }, []);

  useLayoutEffect(() => {
    if (!stickHeld || !knobRef.current) return;
    const { x, y } = offsetRef.current;
    knobRef.current.style.translate = `calc(-50% + ${x}px) calc(-50% + ${y}px)`;
  }, [stickHeld]);

  const onStickDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* some synthetic events cannot capture */
      }
      const rect = e.currentTarget.getBoundingClientRect();
      originRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        id: e.pointerId,
      };
      setStickHeld(true);
      applyStick(e.clientX - originRef.current.x, e.clientY - originRef.current.y);
    },
    [applyStick],
  );

  const onStickMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (originRef.current.id !== e.pointerId) return;
      applyStick(e.clientX - originRef.current.x, e.clientY - originRef.current.y);
    },
    [applyStick],
  );

  const onStickUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (originRef.current.id !== e.pointerId) return;
    originRef.current.id = -1;
    setStickHeld(false);
    offsetRef.current = { x: 0, y: 0 };
    if (knobRef.current) knobRef.current.style.translate = "";
    simRef.current?.setTouch({ roll: 0, pitch: 0 });
  }, []);

  const holdThrust = useCallback((dir: "thrust" | "brake", on: boolean) => {
    setThrustHeld(on ? dir : null);
    simRef.current?.setTouch({ throttle: on ? (dir === "thrust" ? 1 : -1) : 0 });
  }, []);

  const city = CITIES[cityId];
  const rawProgress = hud.progress;
  const progressPct = Math.round(rawProgress > 1 ? rawProgress : rawProgress * 100);
  const progress = Math.min(100, Math.max(0, progressPct));
  const flying = hud.flying && !paused && !menu;
  const streaming = !bootError && (!simReady || !hud.ready || progress < 100);
  const waitRail = streaming && progress <= 2 && !hud.ready;
  const status = loadLabel(simReady, hud, progress, bootError);
  const showStreamChip = flying && !hud.ready && !hud.error;
  const showErrorChip = Boolean((hud.error && !hud.ready) || bootError);

  return (
    <main
      className="relative h-dvh w-full overflow-hidden bg-bg font-sans text-fg select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={mountRef}
        tabIndex={0}
        className="absolute inset-0 touch-none outline-none"
        aria-label="Flight viewport"
      />

      <div
        className={`load-rail ${streaming ? "is-on" : ""} ${waitRail ? "is-wait" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={waitRail ? undefined : progress}
        aria-label="City tile load"
        aria-hidden={!streaming}
      >
        <div
          className="load-rail-fill"
          style={waitRail ? undefined : { transform: `scaleX(${progress / 100})` }}
        />
      </div>

      <div
        className={`overlay-menu absolute inset-0 z-30 flex flex-col justify-between bg-linear-to-t from-bg via-bg/50 to-transparent px-6 pt-safe-t pb-safe-b sm:px-10 ${menu ? "is-open" : ""}`}
        aria-hidden={!menu}
        inert={!menu}
      >
        <div className="flex items-start justify-between gap-4 pt-8 sm:pt-10">
          <p className="rise rise-1 font-mono text-xs tracking-label text-muted uppercase">
            Photorealistic tiles
          </p>
          <p
            className={`rise rise-1 font-mono text-xs tracking-label uppercase ${
              !simReady || !hud.ready ? "shimmer-text" : "text-dim"
            }`}
            aria-live="polite"
          >
            {status}
          </p>
        </div>

        <div className="flex max-w-xl flex-col gap-8 py-8">
          <div className="flex flex-col gap-3">
            <h1 className="rise rise-2 text-3xl font-semibold tracking-label uppercase sm:text-6xl sm:tracking-display">
              Approach
            </h1>
            <p
              key={cityId}
              className="city-hint rise rise-3 max-w-sm text-base leading-snug text-muted sm:text-lg"
            >
              {bootError
                ? "The 3D view couldn't start on this device."
                : hud.error && !hud.ready
                  ? `${city.hint}. City tiles didn't load — you can still fly the empty sky.`
                  : `${city.hint}. Photogrammetry of the city, streamed as you fly.`}
            </p>
          </div>

          <div className="flex flex-col gap-5">
            <button
              ref={flyBtnRef}
              type="button"
              onClick={begin}
              disabled={!simReady || bootError}
              className="btn-press rise rise-4 h-12 w-full max-w-xs rounded-md bg-accent px-6 text-sm font-medium tracking-label text-bg uppercase hover:opacity-90 disabled:opacity-40 sm:w-auto"
            >
              {bootError ? "Unavailable" : simReady ? "Fly" : "Preparing"}
            </button>
            <div className="rise rise-5 flex flex-wrap gap-x-6 gap-y-2" role="group" aria-label="City">
              {CITY_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCityId(id)}
                  aria-pressed={id === cityId}
                  className={`city-btn h-11 font-mono text-sm tracking-hud ${
                    id === cityId ? "is-on" : "text-dim hover:text-muted"
                  }`}
                >
                  {CITIES[id].name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="rise rise-6 max-w-md pb-14 font-mono text-xs leading-relaxed tracking-hud text-dim sm:pb-16">
          {touchUi
            ? "Left stick to bank and pitch · Throttle and brake on the right"
            : "W/S pitch · A/D roll · Q/E yaw · Shift throttle · V view · Esc pause"}
        </p>
      </div>

      <div className={`hud-layer absolute inset-0 z-20 ${!menu && !paused ? "is-on" : ""}`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pt-safe-t sm:px-8">
          <div className="flex items-center gap-2 pt-3 sm:gap-3 sm:pt-5">
            <button
              type="button"
              onClick={pause}
              aria-label="Pause menu"
              className="btn-press pointer-events-auto flex size-11 items-center justify-center rounded-md text-fg/80 hover:text-fg"
            >
              <Menu className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
            <p className="font-mono text-xs tracking-label text-fg/80 uppercase">{hud.cityName}</p>
          </div>
          <div className="flex items-center gap-4 pt-3 sm:pt-5">
            <p className="font-mono text-xs tracking-hud text-fg/70 tabular-nums">{padHeading(hud.heading)}°</p>
          </div>
        </div>

        <div
          className={`pointer-events-none absolute inset-x-0 flex items-end justify-between px-4 sm:px-8 ${
            touchUi ? "top-24 px-5" : "bottom-0 pb-safe-b"
          }`}
        >
          <div className={`flex flex-col gap-1 ${touchUi ? "" : "pb-12"}`}>
            <span className="font-mono text-xs tracking-label text-muted uppercase">IAS</span>
            <span className="font-mono text-2xl tabular-nums tracking-hud">
              {Math.round(hud.speedKt)}
              <span className="ml-2 text-xs text-muted">kt</span>
            </span>
          </div>
          <div className={`flex flex-col items-end gap-1 ${touchUi ? "" : "pb-12"}`}>
            <span className="font-mono text-xs tracking-label text-muted uppercase">Alt</span>
            <span className="font-mono text-2xl tabular-nums tracking-hud">
              {formatAlt(hud.altitudeFt)}
              <span className="ml-2 text-xs text-muted">ft</span>
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute top-1/2 right-5 hidden h-28 w-px -translate-y-1/2 bg-line sm:right-8 sm:block">
          <div
            className="absolute left-1/2 h-1 w-2 -translate-x-1/2 bg-accent transition-[bottom] duration-150 ease-out"
            style={{ bottom: `${Math.round(hud.throttle * 100)}%` }}
          />
        </div>

        <p
          className={`fly-hint pointer-events-none absolute left-1/2 z-20 px-4 text-center font-mono text-xs tracking-hud text-muted ${
            touchUi ? "bottom-40" : "bottom-28"
          } ${hintVisible ? "" : "is-gone"}`}
        >
          {touchUi ? "Stick to fly · Throttle and brake on the right" : "W/S pitch · A/D roll · Shift throttle"}
        </p>
      </div>

      <div
        className={`status-chip absolute z-[25] rounded-md border border-line bg-bg/55 px-4 py-2 font-mono text-xs tracking-hud text-fg ${
          showStreamChip || showErrorChip ? "is-on" : ""
        }`}
        aria-live="polite"
        aria-hidden={!(showStreamChip || showErrorChip)}
      >
        {showErrorChip
          ? bootError
            ? "3D view unavailable"
            : "City tiles unavailable"
          : "Streaming city"}
      </div>

      <div
        className={`overlay-pause absolute inset-0 z-40 flex flex-col items-start justify-end bg-veil px-6 pt-safe-t pb-safe-b sm:px-10 ${paused ? "is-open" : ""}`}
        aria-hidden={!paused}
        inert={!paused}
      >
        <div className="panel flex flex-col gap-6 pb-8 sm:pb-10">
          <div className="flex flex-col gap-2">
            <h2 className="text-3xl font-semibold tracking-label uppercase sm:tracking-display">Paused</h2>
            <p className="font-mono text-xs tracking-hud text-muted">{hud.cityName}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              ref={resumeBtnRef}
              type="button"
              onClick={resume}
              className="btn-press h-12 w-full max-w-xs rounded-md bg-accent px-6 text-sm font-medium tracking-label text-bg uppercase hover:opacity-90 sm:w-auto"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={toMenu}
              className="btn-press h-12 w-full max-w-xs rounded-md border border-line bg-bg/40 px-6 text-sm font-medium tracking-label text-fg uppercase hover:bg-bg/55 sm:w-auto"
            >
              Menu
            </button>
          </div>
          <p className="font-mono text-xs tracking-hud text-dim">
            {touchUi ? "Stick to fly · Throttle and brake on the right" : "Esc resume · V chase / cockpit"}
          </p>
        </div>
      </div>

      {flying && touchUi ? (
        <>
          <div
            className={`absolute bottom-6 left-4 z-30 ml-safe-l mb-safe-b size-[7.5rem] touch-none rounded-full border border-line bg-bg/40 ${
              stickHeld ? "border-fg/40" : ""
            }`}
            role="application"
            aria-label="Flight stick"
            onPointerDown={onStickDown}
            onPointerMove={onStickMove}
            onPointerUp={onStickUp}
            onPointerCancel={onStickUp}
          >
            <div
              ref={knobRef}
              className="pointer-events-none absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
            />
          </div>

          <div className="absolute right-4 bottom-6 z-30 mb-safe-b mr-safe-r flex flex-col gap-3">
            <button
              type="button"
              aria-pressed={thrustHeld === "thrust"}
              className={`btn-press h-12 min-w-[5.5rem] touch-none rounded-md border border-line px-4 font-mono text-xs tracking-label uppercase ${
                thrustHeld === "thrust" ? "bg-accent text-bg" : "bg-bg/40 text-fg"
              }`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* ignore */
                }
                holdThrust("thrust", true);
              }}
              onPointerUp={() => holdThrust("thrust", false)}
              onPointerCancel={() => holdThrust("thrust", false)}
            >
              Throttle
            </button>
            <button
              type="button"
              aria-pressed={thrustHeld === "brake"}
              className={`btn-press h-12 min-w-[5.5rem] touch-none rounded-md border border-line px-4 font-mono text-xs tracking-label uppercase ${
                thrustHeld === "brake" ? "bg-accent text-bg" : "bg-bg/40 text-fg"
              }`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* ignore */
                }
                holdThrust("brake", true);
              }}
              onPointerUp={() => holdThrust("brake", false)}
              onPointerCancel={() => holdThrust("brake", false)}
            >
              Brake
            </button>
          </div>
        </>
      ) : null}

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 pb-safe-b opacity-70">
        <img
          src="https://assets.ion.cesium.com/google-credit.png"
          alt="Google"
          className="h-3.5"
          crossOrigin="anonymous"
        />
        <img
          src="https://assets.ion.cesium.com/ion-credit.png"
          alt="Cesium ion"
          className="h-3.5"
          crossOrigin="anonymous"
        />
      </div>
    </main>
  );
}
