export type Axes = {
  /** +1 nose up */
  pitch: number;
  /** +1 bank left (wing down) */
  roll: number;
  /** +1 yaw left */
  yaw: number;
  /** +1 more thrust */
  throttle: number;
};

const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyR",
  "KeyV",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "KeyZ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Minus",
  "Equal",
]);

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function radialDeadzone(x: number, y: number, dz = 0.16) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

export type InputHandle = {
  sample: () => Axes;
  touch: Axes;
  setSteer: (v: number | null) => void;
  setKeys: (codes: string[] | null) => void;
  consumeViewToggle: () => boolean;
  consumeRestart: () => boolean;
  dispose: () => void;
};

export function createInput(): InputHandle {
  const keys = new Set<string>();
  const touch: Axes = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
  let injectedSteer: number | null = null;
  let injectedKeys: string[] | null = null;
  let viewEdge = false;
  let restartEdge = false;

  const onDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (GAME_CODES.has(e.code)) e.preventDefault();
    if (e.code === "KeyV") viewEdge = true;
    if (e.code === "KeyR") restartEdge = true;
  };
  const onUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
  };
  const clear = () => keys.clear();

  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clear();
  });

  function sample(): Axes {
    const set = injectedKeys ? new Set(injectedKeys) : keys;
    let pitch = touch.pitch;
    let roll = touch.roll;
    let yaw = touch.yaw;
    let throttle = touch.throttle;

    if (set.has("KeyW") || set.has("ArrowUp")) pitch += 1;
    if (set.has("KeyS") || set.has("ArrowDown")) pitch -= 1;
    if (set.has("KeyA") || set.has("ArrowLeft")) roll -= 1;
    if (set.has("KeyD") || set.has("ArrowRight")) roll += 1;
    if (injectedSteer != null) roll = injectedSteer;
    if (set.has("KeyQ")) yaw -= 1;
    if (set.has("KeyE")) yaw += 1;
    if (set.has("ShiftLeft") || set.has("ShiftRight") || set.has("Space") || set.has("Equal")) {
      throttle += 1;
    }
    if (set.has("ControlLeft") || set.has("ControlRight") || set.has("KeyZ") || set.has("Minus")) {
      throttle -= 1;
    }

    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
    if (pads) {
      for (const pad of pads) {
        if (!pad || pad.mapping !== "standard") continue;
        const left = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
        const right = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
        roll += left.x;
        pitch += -left.y;
        yaw += right.x;
        const rt = pad.buttons[7]?.value ?? 0;
        const lt = pad.buttons[6]?.value ?? 0;
        throttle += rt - lt;
        if (pad.buttons[12]?.pressed) pitch += 1;
        if (pad.buttons[13]?.pressed) pitch -= 1;
        if (pad.buttons[14]?.pressed) roll -= 1;
        if (pad.buttons[15]?.pressed) roll += 1;
      }
    }

    return {
      pitch: clamp(pitch, -1, 1),
      roll: clamp(roll, -1, 1),
      yaw: clamp(yaw, -1, 1),
      throttle: clamp(throttle, -1, 1),
    };
  }

  return {
    sample,
    touch,
    setSteer: (v) => {
      injectedSteer = v;
    },
    setKeys: (codes) => {
      injectedKeys = codes;
    },
    consumeViewToggle: () => {
      const v = viewEdge;
      viewEdge = false;
      return v;
    },
    consumeRestart: () => {
      const v = restartEdge;
      restartEdge = false;
      return v;
    },
    dispose: () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    },
  };
}
