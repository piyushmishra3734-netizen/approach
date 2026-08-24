import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Menu, Minimize, RotateCw, Settings } from "lucide-react";
import { CITIES, CITY_ORDER, type CityId } from "@/game/cities";
import type { HudSnapshot, SimHandle, Vehicle } from "@/game/sim";

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
  vehicle: "plane",
  speedKph: 0,
  blocked: false,
  onRoad: true,
  worldReady: false,
  warmup: 0,
  error: null,
};

/** Rounded size of the car model, for the label before the fetch reports one. */
const CAR_DOWNLOAD_MB = 18;

const STICK_RADIUS = 56;
const STICK_DEADZONE = 0.14;
const CITY_KEY = "approach.city";
const VEHICLE_KEY = "approach.vehicle";
const ASSETS_KEY = "approach.assets";

/**
 * How much the game is allowed to download beyond the city tiles.
 *
 * Low is the default and is the game as it shipped: nothing extra, and silent.
 * High buys engine audio — the sampled car loops plus the synthesised plane —
 * and anything else added later belongs here rather than in the default path.
 */
type AssetTier = "low" | "high";

/** Rounded size of the sound pack, for the label before the fetch reports one. */
const AUDIO_PACK_KB = 110;

function mb(bytes: number) {
  return (bytes / 1048576).toFixed(1);
}

function kb(bytes: number) {
  return Math.round(bytes / 1024);
}

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
    // Validate against the live list so adding a city does not need a second
    // edit here, and a stale id from an older build falls back cleanly.
    if (v && (CITY_ORDER as string[]).includes(v)) return v as CityId;
  } catch {
    /* private mode */
  }
  return "sf";
}

function readStoredAssets(): AssetTier {
  try {
    if (localStorage.getItem(ASSETS_KEY) === "high") return "high";
  } catch {
    /* private mode */
  }
  return "low";
}

function readStoredVehicle(): Vehicle {
  try {
    const v = localStorage.getItem(VEHICLE_KEY);
    if (v === "plane" || v === "car") return v;
  } catch {
    /* private mode */
  }
  return "plane";
}

function loadLabel(simReady: boolean, hud: HudSnapshot, progress: number, bootError: boolean) {
  if (bootError) return "Unavailable";
  if (!simReady) return "Loading engine";
  if (hud.error && !hud.ready) return "Tiles unavailable";
  if (!hud.ready) return "Streaming city";
  if (!hud.worldReady) return `Building the city · ${Math.round(hud.warmup * 100)}%`;
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
  const vehicleRef = useRef<Vehicle>("plane");
  const assetsRef = useRef<AssetTier>("low");
  const pendingStart = useRef(false);
  /** Latest `hud.worldReady`, so the start gate does not re-bind the key handler. */
  const worldReadyRef = useRef(false);
  const resumeBtnRef = useRef<HTMLButtonElement>(null);
  const flyBtnRef = useRef<HTMLButtonElement>(null);
  const [hud, setHud] = useState<HudSnapshot>(EMPTY_HUD);
  const [menu, setMenu] = useState(true);
  const [paused, setPaused] = useState(false);
  const [cityId, setCityId] = useState<CityId>("sf");
  const [vehicle, setVehicle] = useState<Vehicle>("plane");
  const [hintVisible, setHintVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [touchUi, setTouchUi] = useState(false);
  const [simReady, setSimReady] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [stickHeld, setStickHeld] = useState(false);
  const [thrustHeld, setThrustHeld] = useState<"thrust" | "brake" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [carState, setCarState] = useState<"idle" | "downloading" | "ready" | "failed">("idle");
  const [carBytes, setCarBytes] = useState({ received: 0, total: 0 });
  const [assets, setAssets] = useState<AssetTier>("low");
  const [packState, setPackState] = useState<"idle" | "downloading" | "ready" | "failed">("idle");
  const [packBytes, setPackBytes] = useState({ received: 0, total: 0 });
  cityRef.current = cityId;
  vehicleRef.current = vehicle;
  assetsRef.current = assets;
  worldReadyRef.current = hud.worldReady;

  useEffect(() => {
    const storedCity = readStoredCity();
    if (storedCity !== cityRef.current) setCityId(storedCity);
    const storedVehicle = readStoredVehicle();
    if (storedVehicle !== vehicleRef.current) setVehicle(storedVehicle);
    const storedAssets = readStoredAssets();
    if (storedAssets !== assetsRef.current) setAssets(storedAssets);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CITY_KEY, cityId);
      localStorage.setItem(VEHICLE_KEY, vehicle);
      localStorage.setItem(ASSETS_KEY, assets);
    } catch {
      /* private mode */
    }
  }, [cityId, vehicle, assets]);

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
          handle = createSim(
            mountRef.current,
            setHud,
            cityRef.current,
            vehicleRef.current,
            assetsRef.current === "high",
          );
        } catch {
          setBootError(true);
          return;
        }
        simRef.current = handle;
        setSimReady(true);
        // A start that was waiting on this rebuild is not fired here: the new
        // sim has no city drawn yet. The warm-up effect below releases it.
      })
      .catch(() => {
        if (!cancelled) setBootError(true);
      });

    return () => {
      cancelled = true;
      handle?.dispose();
      simRef.current = null;
      setSimReady(false);
      // The old sim's last snapshot said the world was ready; the new one's
      // is not, and a stale `worldReady` would wave the player straight in.
      setHud(EMPTY_HUD);
    };
    // The vehicle is baked into the sim (which model, which dynamics), so
    // switching it rebuilds — only ever from the menu, never mid-drive.
  }, [vehicle]);

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

  useEffect(() => {
    // iOS Safari has no Fullscreen API on ordinary elements, so the control is
    // only offered where it will actually do something.
    setCanFullscreen(typeof document.documentElement.requestFullscreen === "function");
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    // A model kept from an earlier visit to this menu needs no second fetch.
    void import("@/game/car").then(({ isCarDownloaded }) => {
      if (isCarDownloaded()) setCarState("ready");
    });
    void import("@/game/audio").then(({ isPackDownloaded }) => {
      if (isPackDownloaded()) setPackState("ready");
    });
  }, []);

  /**
   * Switch asset tier. High fetches the sound pack and turns the engine on in
   * the running sim; the press itself is the user gesture the AudioContext
   * needs, so the sound starts here or not at all.
   */
  const chooseAssets = useCallback((next: AssetTier) => {
    setAssets(next);
    assetsRef.current = next;
    if (next === "low") {
      simRef.current?.setSound(false);
      return;
    }
    simRef.current?.setSound(true);
    setPackState((current) => (current === "ready" ? current : "downloading"));
    void import("@/game/audio")
      .then(({ isPackDownloaded, downloadAudioPack }) =>
        isPackDownloaded()
          ? null
          : downloadAudioPack(import.meta.env.BASE_URL, (received, total) =>
              setPackBytes({ received, total }),
            ),
      )
      .then(() => setPackState("ready"))
      .catch(() => setPackState("failed"));
  }, []);

  /** Fetch the car model on an explicit press, showing progress as it comes. */
  const getCar = useCallback(() => {
    setCarState("downloading");
    setCarBytes({ received: 0, total: 0 });
    void import("@/game/car")
      .then(({ downloadCar }) =>
        downloadCar(`${import.meta.env.BASE_URL}models/lamborghini.glb`, (_f, received, total) =>
          setCarBytes({ received, total }),
        ),
      )
      .then(() => setCarState("ready"))
      .catch(() => setCarState("failed"));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const done = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    // A rejected request (denied, or already changing) must not surface as an
    // unhandled rejection; the button simply does nothing.
    void done?.catch(() => {});
  }, []);

  const resetTouch = useCallback(() => {
    setStickHeld(false);
    setThrustHeld(null);
    offsetRef.current = { x: 0, y: 0 };
    if (knobRef.current) knobRef.current.style.translate = "";
    simRef.current?.setTouch({ roll: 0, pitch: 0, throttle: 0 });
  }, []);

  const begin = useCallback(() => {
    if (bootError) return;
    // The sim streams the spawn view under the menu. Starting before any of it
    // has drawn drops the player into blank sky, so an early press is held and
    // the effect below fires it the moment the city is there.
    if (!simRef.current || !worldReadyRef.current) {
      pendingStart.current = true;
      return;
    }
    pendingStart.current = false;
    simRef.current.setCity(cityRef.current);
    simRef.current.start();
    setMenu(false);
    setPaused(false);
    setHintVisible(true);
    mountRef.current?.focus();
  }, [bootError]);

  /**
   * Start in the chosen vehicle. Picking the other one rebuilds the sim, so the
   * start is deferred to the moment that rebuild finishes rather than firing at
   * the sim that is about to be thrown away.
   */
  const startWith = useCallback(
    (next: Vehicle) => {
      if (bootError) return;
      if (next !== vehicleRef.current) {
        pendingStart.current = true;
        setVehicle(next);
        return;
      }
      begin();
    },
    [bootError, begin],
  );

  /** Release a start that was pressed before the city had drawn. */
  useEffect(() => {
    if (pendingStart.current && hud.worldReady) begin();
  }, [hud.worldReady, begin]);

  const restart = useCallback(() => {
    setPaused(false);
    resetTouch();
    simRef.current?.restart();
    simRef.current?.setFlying(true);
    mountRef.current?.focus();
  }, [resetTouch]);

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
        if (menu) {
          setSettingsOpen(false);
          return;
        }
        setPaused((p) => {
          const next = !p;
          simRef.current?.setFlying(!next);
          if (next) resetTouch();
          return next;
        });
      }
      if (menu && (e.code === "Enter" || e.code === "Space")) {
        // Enter anywhere in the menu starts the game — except on a control,
        // which gets to be a control. Without this, opening Settings or picking
        // a city from the keyboard also took off.
        if (document.activeElement instanceof HTMLButtonElement) return;
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
  const isCar = vehicle === "car";
  const carPercent = carBytes.total
    ? Math.round((carBytes.received / carBytes.total) * 100)
    : 0;
  const controlHint = touchUi
    ? isCar
      ? "Stick to steer · Throttle and brake on the right · Eye button for the driver's seat"
      : "Left stick to bank and pitch · Throttle and brake on the right"
    : isCar
      ? "W/S throttle and brake · A/D steer · V chase / driver's seat · R reset · Esc pause"
      : "W/S pitch · A/D roll · Q/E yaw · Shift throttle · V view · Esc pause";
  const shortHint = touchUi
    ? isCar
      ? "Stick to steer · Throttle and brake on the right"
      : "Stick to fly · Throttle and brake on the right"
    : isCar
      ? "W/S throttle · A/D steer · V view"
      : "W/S pitch · A/D roll · Shift throttle";
  const pausedHint = isCar ? "Esc resume · V chase / driver's seat" : "Esc resume · V chase / cockpit";
  const rawProgress = hud.progress;
  const progressPct = Math.round(rawProgress > 1 ? rawProgress : rawProgress * 100);
  const progress = Math.min(100, Math.max(0, progressPct));
  // Before the start the rail tracks the warm-up — how much of the spawn view
  // has actually drawn. `loadProgress` is no use there: it reads 100% while the
  // queue is still empty, so the old rail sat full over an empty sky.
  const railPct = hud.worldReady ? progress : Math.round(hud.warmup * 100);
  const canStart = simReady && hud.worldReady && !bootError;
  const flying = hud.flying && !paused && !menu;
  const streaming = !bootError && (!simReady || !hud.worldReady || progress < 100);
  // Indeterminate shimmer while there is nothing true to report yet: no root
  // tileset, or a warm-up that has not drawn its first tile.
  const waitRail = streaming && railPct <= 2 && (!hud.ready || !hud.worldReady);
  const status = loadLabel(simReady, hud, progress, bootError);
  const findingRoad = flying && isCar && !hud.onRoad && !hud.error && !bootError;
  const showStreamChip = flying && (!hud.ready || findingRoad) && !hud.error;
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
        aria-valuenow={waitRail ? undefined : railPct}
        aria-label="City tile load"
        aria-hidden={!streaming}
      >
        <div
          className="load-rail-fill"
          style={waitRail ? undefined : { transform: `scaleX(${railPct / 100})` }}
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
                  ? isCar
                    ? `${city.hint}. City tiles didn't load — there is no road to drive on.`
                    : `${city.hint}. City tiles didn't load — you can still fly the empty sky.`
                  : `${city.hint}. Photogrammetry of the city, streamed as you ${isCar ? "drive" : "fly"}.`}
            </p>
          </div>

          <div className="flex flex-col gap-5">
            <div className="rise rise-4 flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row" role="group" aria-label="Start">
                <button
                  ref={flyBtnRef}
                  type="button"
                  onClick={() => startWith("plane")}
                  disabled={!canStart}
                  className={`btn-press h-12 w-full rounded-md px-6 text-sm font-medium tracking-label uppercase disabled:opacity-40 sm:w-44 ${
                    vehicle === "plane"
                      ? "bg-accent text-bg hover:opacity-90"
                      : "border border-line text-fg hover:border-fg/40"
                  }`}
                >
                  {bootError
                    ? "Unavailable"
                    : !simReady
                      ? "Preparing"
                      : !hud.worldReady
                        ? "Loading"
                        : "Fly"}
                </button>
                <button
                  type="button"
                  onClick={carState === "ready" ? () => startWith("car") : getCar}
                  disabled={
                    !simReady ||
                    bootError ||
                    carState === "downloading" ||
                    (carState === "ready" && !hud.worldReady)
                  }
                  className={`btn-press h-12 w-full rounded-md px-6 text-sm font-medium tracking-label uppercase disabled:opacity-40 sm:w-44 ${
                    vehicle === "car" && carState === "ready"
                      ? "bg-accent text-bg hover:opacity-90"
                      : "border border-line text-fg hover:border-fg/40"
                  }`}
                >
                  {bootError
                    ? "Unavailable"
                    : !simReady
                      ? "Preparing"
                      : carState === "ready"
                        ? hud.worldReady
                          ? "Drive"
                          : "Loading"
                        : carState === "downloading"
                          ? `${carPercent}%`
                          : carState === "failed"
                            ? "Retry car"
                            : `Get car · ${CAR_DOWNLOAD_MB} MB`}
                </button>
              </div>

              {carState === "downloading" || carState === "failed" ? (
                <div className="flex w-full max-w-sm flex-col gap-1.5">
                  <div
                    className="h-1 w-full overflow-hidden rounded-full bg-line"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={carPercent}
                    aria-label="Car model download"
                  >
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-150"
                      style={{ width: `${carPercent}%` }}
                    />
                  </div>
                  <p className="font-mono text-xs tracking-hud text-muted" aria-live="polite">
                    {carState === "failed"
                      ? "Download failed — check the connection and try again"
                      : `${mb(carBytes.received)} / ${
                          carBytes.total ? mb(carBytes.total) : CAR_DOWNLOAD_MB
                        } MB · the Lamborghini and its textures`}
                  </p>
                </div>
              ) : null}
            </div>
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

            <div className="rise rise-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
                aria-controls="menu-settings"
                className={`btn-press flex h-11 w-fit items-center gap-2 font-mono text-sm tracking-hud ${
                  settingsOpen ? "text-fg" : "text-dim hover:text-muted"
                }`}
              >
                <Settings className="size-4" strokeWidth={1.75} aria-hidden="true" />
                Settings
              </button>

              <div
                id="menu-settings"
                hidden={!settingsOpen}
                className="flex flex-col gap-2 border-l border-line pl-4"
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs tracking-label text-muted uppercase">
                    Assets
                  </span>
                  <div
                    className="flex gap-1 rounded-md border border-line p-1"
                    role="group"
                    aria-label="Asset quality"
                  >
                    {(["low", "high"] as AssetTier[]).map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => chooseAssets(tier)}
                        aria-pressed={assets === tier}
                        className={`btn-press h-8 rounded px-4 font-mono text-xs tracking-hud uppercase ${
                          assets === tier ? "bg-accent text-bg" : "text-dim hover:text-fg"
                        }`}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>
                <p
                  className="max-w-sm font-mono text-xs leading-relaxed tracking-hud text-dim"
                  aria-live="polite"
                >
                  {assets === "low"
                    ? "Low · nothing beyond the city tiles, and no sound."
                    : packState === "failed"
                      ? "Sound pack failed — press High again to retry."
                      : packState === "downloading"
                        ? `Sound pack · ${kb(packBytes.received)} / ${
                            packBytes.total ? kb(packBytes.total) : AUDIO_PACK_KB
                          } KB`
                        : `High · engine sound for the plane and the car (${AUDIO_PACK_KB} KB).`}
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="rise rise-6 max-w-md pb-14 font-mono text-xs leading-relaxed tracking-hud text-dim sm:pb-16">
          {controlHint}
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
          <div className="flex items-center gap-1 pt-3 sm:gap-2 sm:pt-5">
            <p className="mr-2 font-mono text-xs tracking-hud text-fg/70 tabular-nums">
              {padHeading(hud.heading)}°
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              aria-label="Reload the page"
              className="btn-press pointer-events-auto flex size-11 items-center justify-center rounded-md text-fg/80 hover:text-fg"
            >
              <RotateCw className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
            {canFullscreen ? (
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Leave full screen" : "Full screen"}
                aria-pressed={fullscreen}
                className="btn-press pointer-events-auto flex size-11 items-center justify-center rounded-md text-fg/80 hover:text-fg"
              >
                {fullscreen ? (
                  <Minimize className="size-5" strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Maximize className="size-5" strokeWidth={1.75} aria-hidden="true" />
                )}
              </button>
            ) : null}
          </div>
        </div>

        <div
          className={`pointer-events-none absolute inset-x-0 flex items-end justify-between px-4 sm:px-8 ${
            touchUi ? "top-24 px-5" : "bottom-0 pb-safe-b"
          }`}
        >
          <div className={`flex flex-col gap-1 ${touchUi ? "" : "pb-12"}`}>
            <span className="font-mono text-xs tracking-label text-muted uppercase">
              {isCar ? "Speed" : "IAS"}
            </span>
            <span className="font-mono text-2xl tabular-nums tracking-hud">
              {Math.round(isCar ? Math.abs(hud.speedKph) : hud.speedKt)}
              <span className="ml-2 text-xs text-muted">{isCar ? "km/h" : "kt"}</span>
            </span>
          </div>
          <div className={`flex flex-col items-end gap-1 ${touchUi ? "" : "pb-12"}`}>
            <span className="font-mono text-xs tracking-label text-muted uppercase">
              {isCar ? "Elev" : "Alt"}
            </span>
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
          {shortHint}
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
          : findingRoad
            ? "Finding the road"
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
              onClick={restart}
              className="btn-press h-12 w-full max-w-xs rounded-md border border-line bg-bg/40 px-6 text-sm font-medium tracking-label text-fg uppercase hover:bg-bg/55 sm:w-auto"
            >
              Restart
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
            {touchUi ? shortHint : pausedHint}
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
