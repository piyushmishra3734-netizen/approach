import * as THREE from "three";
import { Timer } from "three";
import { DRACOLoader, DRACO_GLTF_CONFIG } from "three/addons/loaders/DRACOLoader.js";
import { TilesRenderer } from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import {
  GLTFExtensionsPlugin,
  ReorientationPlugin,
  TilesFadePlugin,
  UpdateOnChangePlugin,
} from "3d-tiles-renderer/three/plugins";
import { CITIES, CITY_ORDER, ION_GOOGLE_TILES, ION_TOKEN, type City, type CityId } from "./cities";
import { createCraft } from "./craft";
import { createInput, type InputHandle } from "./input";

const MAX_ROLL = 1.05;
const MAX_PITCH = 0.72;
const ROLL_RATE = 1.55;
const PITCH_RATE = 0.85;
const YAW_RATE = 0.45;
const MIN_SPEED = 10;
const MAX_SPEED = 118;
/**
 * Absolute floor, at the tileset origin — sea level for both cities. The real
 * floor is the ground probe below; this only catches the craft out over water
 * and wherever tiles have not streamed in yet, and every street in SF and NYC
 * sits above it.
 */
const MIN_HEIGHT = 0;
const MAX_HEIGHT = 2800;
/** Wheels-on-the-road gap the craft is held at when it reaches the surface. */
const GEAR_CLEARANCE = 1.6;
/** Ground probe starts this far above the craft, so a dip under a roof still resolves. */
const GROUND_PROBE_UP = 300;
/** How far below the craft the probe still finds ground — past this, no clamp. */
const GROUND_PROBE_DOWN = 60;
const CHASE_OFFSET = new THREE.Vector3(0, 6.0, -30);
const CHASE_LOOK = new THREE.Vector3(0, 0.45, 20);
const COCKPIT_OFFSET = new THREE.Vector3(0, 1.05, 2.4);
const COCKPIT_LOOK = new THREE.Vector3(0, 0.35, 40);
/** Chase cam takes a sliver of bank so the plane, not the world, does the rolling. */
const CHASE_BANK = 0.12;

export type CameraMode = "chase" | "cockpit";

export type HudSnapshot = {
  ready: boolean;
  progress: number;
  speedKt: number;
  altitudeFt: number;
  heading: number;
  throttle: number;
  cityId: CityId;
  cityName: string;
  lat: number;
  lon: number;
  flying: boolean;
  cameraMode: CameraMode;
  error: string | null;
};

export type SimHandle = {
  dispose: () => void;
  start: () => void;
  setCity: (id: CityId) => void;
  setFlying: (v: boolean) => void;
  setTouch: (partial: Partial<{ pitch: number; roll: number; yaw: number; throttle: number }>) => void;
};

type Pose = {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function wrapPi(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Compass degrees, clockwise from north. `heading` is Three.js Y (CCW from +Z/north). */
function compassDeg(heading: number) {
  const d = ((-heading * 180) / Math.PI) % 360;
  return (d + 360) % 360;
}

function spawnPose(city: City): Pose {
  return {
    x: 0,
    y: city.height,
    z: 0,
    // Compass azimuth is CW from north; Three.js Y is CCW from +Z (north).
    heading: -city.az,
    pitch: city.el,
    roll: 0,
    speed: 48,
    throttle: 0.42,
  };
}

function createSky() {
  const geo = new THREE.SphereGeometry(12000, 32, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x8eb4d2,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, mat, geo };
}

function prepareTileMaterial(mat: THREE.Material) {
  const std = mat as THREE.MeshStandardMaterial;
  if ("metalness" in std) {
    std.metalness = 0;
    std.roughness = 1;
  }
  std.toneMapped = false;
}

export function createSim(
  container: HTMLElement,
  onHud: (hud: HudSnapshot) => void,
  initialCity: CityId = "sf",
): SimHandle {
  let city = CITIES[initialCity] ?? CITIES.sf;
  let pose = spawnPose(city);
  let flying = false;
  let cameraMode: CameraMode = "chase";
  let disposed = false;
  let hudClock = 0;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x8eb4d2, 1);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8eb4d2);
  scene.fog = new THREE.Fog(0x9cb6c8, 2500, 28000);

  const camera = new THREE.PerspectiveCamera(68, 1, 1, 48000);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xe8f0f6, 0x5a584e, 1.15));
  const sun = new THREE.DirectionalLight(0xfff6ea, 0.85);
  sun.position.set(-2, 3, 1);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xcfe4f4, 0.28);
  fill.position.set(2, 1.4, -1.5);
  scene.add(fill);

  const sky = createSky();
  scene.add(sky.mesh);

  const craft = createCraft();
  scene.add(craft);

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_GLTF_CONFIG);

  const tiles = new TilesRenderer();
  const reorient = new ReorientationPlugin({
    lat: city.lat,
    lon: city.lon,
    height: 0,
    recenter: true,
  });
  tiles.registerPlugin(
    new CesiumIonAuthPlugin({
      apiToken: ION_TOKEN,
      assetId: ION_GOOGLE_TILES,
      autoRefreshToken: true,
    }),
  );
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }));
  tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 0.5 }));
  tiles.registerPlugin(new UpdateOnChangePlugin());
  tiles.registerPlugin(reorient);
  tiles.setCamera(camera);
  tiles.errorTarget = 10;
  tiles.lruCache.maxBytesSize = 420 * 1024 * 1024;
  tiles.lruCache.minBytesSize = 180 * 1024 * 1024;
  scene.add(tiles.group);

  let tilesReady = false;
  let tilesError: string | null = null;
  tiles.addEventListener("load-root-tileset", () => {
    tilesReady = true;
    tilesError = null;
    reorient.transformLatLonHeightToOrigin(city.lat, city.lon, 0);
    emitHud();
  });
  tiles.addEventListener("load-model", (event) => {
    const sceneRoot = (event as { scene?: THREE.Object3D }).scene;
    sceneRoot?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(prepareTileMaterial);
      else if (mat) prepareTileMaterial(mat);
    });
  });
  tiles.addEventListener("load-error", (event) => {
    if (tilesReady) return;
    const ev = event as { error?: Error };
    tilesError = ev.error?.message || "Couldn't load city tiles";
    emitHud();
  });

  const input: InputHandle = createInput();
  const timer = new Timer();
  const raycaster = new THREE.Raycaster();
  raycaster.far = GROUND_PROBE_UP + GROUND_PROBE_DOWN;
  // TilesRenderer honours this and stops at the first tile hit. Not in three's
  // Raycaster typings — it is a convention three-mesh-bvh established.
  (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

  const tmpCam = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();
  const tmpDown = new THREE.Vector3(0, -1, 0);
  const tmpOrigin = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const lookPos = new THREE.Vector3();
  const followEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const followQuat = new THREE.Quaternion();
  let camInitialized = false;

  function applyPoseToCraft() {
    craft.position.set(pose.x, pose.y, pose.z);
    craft.rotation.order = "YXZ";
    craft.rotation.set(-pose.pitch, pose.heading, pose.roll);
    craft.updateMatrixWorld(true);
  }

  function placeCamera(dt: number) {
    if (cameraMode === "cockpit") {
      tmpCam.copy(COCKPIT_OFFSET).applyQuaternion(craft.quaternion).add(craft.position);
      tmpLook.copy(COCKPIT_LOOK).applyQuaternion(craft.quaternion).add(craft.position);
    } else {
      // Follow heading + pitch, almost no roll — camera stays behind the nose.
      followEuler.set(-pose.pitch * 0.45, pose.heading, pose.roll * CHASE_BANK);
      followQuat.setFromEuler(followEuler);
      tmpCam.copy(CHASE_OFFSET).applyQuaternion(followQuat).add(craft.position);
      tmpLook.copy(CHASE_LOOK).applyQuaternion(followQuat).add(craft.position);
    }
    const follow = cameraMode === "cockpit" ? 20 : 10;
    const alpha = camInitialized ? 1 - Math.exp(-follow * dt) : 1;
    camPos.lerp(tmpCam, alpha);
    lookPos.lerp(tmpLook, alpha);
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(lookPos);
    camera.updateMatrixWorld();
    camInitialized = true;
    sky.mesh.position.copy(camera.position);
  }

  function resetTo(next: City) {
    city = next;
    pose = spawnPose(city);
    reorient.transformLatLonHeightToOrigin(city.lat, city.lon, 0);
    camInitialized = false;
    applyPoseToCraft();
    placeCamera(1);
  }

  /**
   * Height of the tile surface under `(x, z)`, or null where nothing is loaded
   * within reach. Probing from above the craft rather than from it means a
   * craft that has slipped under a roof still gets pushed back out, and it is
   * the same query a ground vehicle needs.
   */
  function groundHeightAt(x: number, y: number, z: number): number | null {
    tmpOrigin.set(x, y + GROUND_PROBE_UP, z);
    raycaster.set(tmpOrigin, tmpDown);
    const hit = raycaster.intersectObject(tiles.group, true)[0];
    return hit ? tmpOrigin.y - hit.distance : null;
  }

  function integrate(dt: number) {
    if (!flying) return;
    const axes = input.sample();

    const thrRate = axes.throttle < 0 ? 0.9 : 0.38;
    pose.throttle = clamp(pose.throttle + axes.throttle * thrRate * dt, 0, 1);
    const target = MIN_SPEED + pose.throttle * (MAX_SPEED - MIN_SPEED);
    pose.speed += (target - pose.speed) * Math.min(1, (axes.throttle < 0 ? 2.4 : 1.7) * dt);

    pose.roll += axes.roll * ROLL_RATE * dt;
    if (Math.abs(axes.roll) < 0.04) pose.roll *= Math.exp(-1.65 * dt);
    pose.roll = clamp(pose.roll, -MAX_ROLL, MAX_ROLL);

    pose.pitch += axes.pitch * PITCH_RATE * dt;
    if (Math.abs(axes.pitch) < 0.04) pose.pitch += (0 - pose.pitch) * (1 - Math.exp(-0.35 * dt));
    pose.pitch = clamp(pose.pitch, -MAX_PITCH, MAX_PITCH);

    pose.heading -= axes.yaw * YAW_RATE * dt;
    // Left bank (positive roll, left wing down) turns left = heading decreases
    // (nose toward -X / east when flying north).
    pose.heading -= Math.sin(pose.roll) * 0.62 * (pose.speed / 55) * dt;
    pose.heading = wrapPi(pose.heading);

    // Mesh local +Z after YXZ(heading) is (sin(h), 0, cos(h)). Same vector for flight.
    const horiz = pose.speed * Math.cos(pose.pitch);
    pose.x += Math.sin(pose.heading) * horiz * dt;
    pose.z += Math.cos(pose.heading) * horiz * dt;
    pose.y += pose.speed * Math.sin(pose.pitch) * dt;
    pose.y = clamp(pose.y, MIN_HEIGHT, MAX_HEIGHT);

    const ground = groundHeightAt(pose.x, pose.y, pose.z);
    if (ground !== null && pose.y < ground + GEAR_CLEARANCE) {
      pose.y = ground + GEAR_CLEARANCE;
      // Sitting on the surface: stop the nose from burrowing into it.
      if (pose.pitch < 0) pose.pitch = 0;
    }
  }

  function emitHud() {
    onHud({
      ready: tilesReady,
      progress: tiles.loadProgress ?? 0,
      speedKt: pose.speed * 1.94384,
      altitudeFt: pose.y * 3.28084,
      heading: compassDeg(pose.heading),
      throttle: pose.throttle,
      cityId: city.id,
      cityName: city.name,
      lat: (city.lat * 180) / Math.PI,
      lon: (city.lon * 180) / Math.PI,
      flying,
      cameraMode,
      error: tilesError,
    });
  }

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    tiles.setResolutionFromRenderer(camera, renderer);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  applyPoseToCraft();
  placeCamera(1);
  emitHud();

  const probe = {
    getYaw: () => pose.heading,
    getSpeed: () => pose.speed,
    getRoll: () => pose.roll,
    setSteer: (v: number) => input.setSteer(v),
    setKeys: (codes: string[]) => input.setKeys(codes),
  };
  window.__controlsTest = probe;
  window.__flightDebug = () => {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(craft.quaternion);
    return {
      cam: camera.position.toArray(),
      craft: craft.position.toArray(),
      heading: pose.heading,
      compass: compassDeg(pose.heading),
      ground: groundHeightAt(pose.x, pose.y, pose.z),
      roll: pose.roll,
      fwd: fwd.toArray(),
      vel: [Math.sin(pose.heading), Math.sin(pose.pitch), Math.cos(pose.heading)],
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      visible: tiles.visibleTiles.size,
      ready: tilesReady,
    };
  };

  function frame() {
    if (disposed) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.08);

    if (input.consumeViewToggle() && flying) {
      cameraMode = cameraMode === "chase" ? "cockpit" : "chase";
      camInitialized = false;
    }
    if (input.consumeRestart()) {
      resetTo(city);
    }

    integrate(dt);
    applyPoseToCraft();
    placeCamera(dt);
    craft.visible = cameraMode !== "cockpit";
    if (typeof craft.userData.update === "function") {
      craft.userData.update(dt, flying, pose.speed);
    }

    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.update();
    renderer.render(scene, camera);

    hudClock += dt;
    const streaming = !tilesReady || (tiles.loadProgress ?? 0) < 0.95;
    if (hudClock > (streaming ? 0.05 : 0.12)) {
      hudClock = 0;
      emitHud();
    }
  }

  renderer.setAnimationLoop(frame);

  return {
    dispose: () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      input.dispose();
      tiles.dispose();
      dracoLoader.dispose();
      renderer.dispose();
      sky.mat.dispose();
      sky.geo.dispose();
      if (typeof craft.userData.dispose === "function") craft.userData.dispose();
      renderer.domElement.remove();
      if (window.__controlsTest === probe) delete window.__controlsTest;
    },
    start: () => {
      flying = true;
      pose.throttle = Math.max(pose.throttle, 0.4);
      emitHud();
    },
    setCity: (id) => {
      const next = CITIES[id] ?? CITIES.sf;
      if (!CITY_ORDER.includes(next.id)) return;
      resetTo(next);
      emitHud();
    },
    setFlying: (v) => {
      flying = v;
      emitHud();
    },
    setTouch: (partial) => {
      if (partial.pitch != null) input.touch.pitch = partial.pitch;
      if (partial.roll != null) input.touch.roll = partial.roll;
      if (partial.yaw != null) input.touch.yaw = partial.yaw;
      if (partial.throttle != null) input.touch.throttle = partial.throttle;
    },
  };
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getRoll: () => number;
      setSteer?: (v: number) => void;
      setKeys?: (codes: string[]) => void;
    };
    __flightDebug?: () => Record<string, unknown>;
  }
}
