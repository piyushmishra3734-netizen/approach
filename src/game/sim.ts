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
import { loadCar, WHEEL_IDS, type CarModel } from "./car";
import { createInput, type InputHandle } from "./input";

const WORLD_UP = new THREE.Vector3(0, 1, 0);

const MAX_ROLL = 1.05;
const MAX_PITCH = 0.72;
const ROLL_RATE = 1.55;
const PITCH_RATE = 0.85;
const YAW_RATE = 0.45;
const MIN_SPEED = 10;
const MAX_SPEED = 118;
/**
 * Absolute floor, only for where no tile has streamed in to clamp against —
 * the ground probe below is the real floor.
 *
 * It has to sit well below zero: the tileset origin is on the WGS84 ellipsoid,
 * and the geoid runs about 32 m under it in both cities, so a San Francisco
 * street measures around -30 here despite being a few metres above the sea. A
 * floor at 0 would hold the plane a storey above the waterfront.
 */
const MIN_HEIGHT = -60;
const MAX_HEIGHT = 2800;
/** Wheels-on-the-road gap the craft is held at when it reaches the surface. */
const GEAR_CLEARANCE = 1.6;
/** Ground probe starts this far above the craft, so a dip under a roof still resolves. */
const GROUND_PROBE_UP = 300;
/** How far below the craft the probe still finds ground — past this, no clamp. */
const GROUND_PROBE_DOWN = 60;
/*
 * Car.
 *
 * No physics engine here on purpose. Cannon/Ammo want collision bodies, and the
 * only ground we have is Google's photogrammetry streaming in and out every
 * second — rebuilding trimesh colliders per tile is the stutter. Their
 * `RaycastVehicle` does not collide the chassis either: it casts a ray down
 * from each wheel, which is exactly what `groundHeightAt` already does. So the
 * same model is implemented directly, against the tiles we already raycast.
 */
/**
 * Flat-out speed, m/s (~110 km/h). Held above roughly this the tiles cannot
 * stream fast enough and the car outruns the city into unrefined geometry, so
 * the cap is a streaming budget as much as a handling choice.
 */
const CAR_TOP_SPEED = 30;
const CAR_REVERSE_SPEED = 9;
const CAR_ACCEL = 9.5;
const CAR_BRAKE = 18;
/** Coasting losses: rolling resistance plus a v² drag term. */
const CAR_ROLL_DRAG = 1.6;
const CAR_AIR_DRAG = 0.0022;
const CAR_MAX_STEER = 0.55;
/** Steer authority falls off with speed, or the car is undriveable up top. */
const CAR_STEER_FALLOFF = 26;
const CAR_STEER_RATE = 4.2;
/**
 * Rise the car will climb, as a gradient over the look-ahead distance. SF's
 * steepest streets are about 0.3; a kerb or a wall is far past this, so it
 * doubles as the thing that keeps the car in the street canyons instead of
 * driving up the face of a building.
 */
const CAR_MAX_CLIMB = 0.75;
/**
 * Drop the car will follow in a single frame. Roads do not have steps in them,
 * so anything past this is the edge of a pier, a rooftop, or a hole in the
 * mesh — the car stops at it instead of falling in. With the climb limit above
 * this is what keeps the drive on drivable surfaces without any road data.
 */
const CAR_MAX_DROP = 1.2;
/**
 * The car probes from just over its own roof, not from the plane's 300 m up.
 * The probe takes the first surface it meets going down, so a high origin
 * finds the roof of whatever tower the car is standing next to and parks the
 * Lamborghini on it.
 */
const CAR_PROBE_UP = 2.4;
/** Refined tiles the area needs before the car is allowed to land on it. */
const CAR_LANDING_TILES = 8;
/**
 * While looking for the street to land on, the probe starts this far up
 * instead. A hand-placed spawn height is never exact, and a seed even slightly
 * below the road makes a probe that starts at the car miss the surface
 * entirely and hang the car in the air forever. This is the tolerance for
 * getting that number wrong.
 * ponytail: it would grab the underside of an overhang the spawn happens to
 * sit under — all four spawns are mid-boulevard, so nothing does.
 */
const CAR_LANDING_PROBE_UP = 60;
/** How far ahead the spawn checks for a clear run, and the rise it tolerates. */
const SPAWN_LOOK = 12;
const SPAWN_CLEAR_RISE = 1.5;
/**
 * The forward probe starts this high instead, so a building in the way reports
 * its roof rather than its ground floor.
 * ponytail: a genuine overpass reads as a wall too; add a headroom check if
 * driving under one ever matters.
 */
const WALL_PROBE_UP = 120;
/** Suspension smoothing. Raw photogrammetry is lumpy at wheel scale. */
const CAR_BODY_SMOOTH = 9;
const CAR_TILT_SMOOTH = 5.5;
const CAR_CHASE_OFFSET = new THREE.Vector3(0, 2.15, -7.4);
const CAR_CHASE_LOOK = new THREE.Vector3(0, 0.9, 9);

const CHASE_OFFSET = new THREE.Vector3(0, 6.0, -30);
const CHASE_LOOK = new THREE.Vector3(0, 0.45, 20);
const COCKPIT_OFFSET = new THREE.Vector3(0, 1.05, 2.4);
const COCKPIT_LOOK = new THREE.Vector3(0, 0.35, 40);
/** Chase cam takes a sliver of bank so the plane, not the world, does the rolling. */
const CHASE_BANK = 0.12;

export type CameraMode = "chase" | "cockpit";
export type Vehicle = "plane" | "car";

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
  vehicle: Vehicle;
  /** Car only: road speed in km/h, and whether the nose is against something. */
  speedKph: number;
  blocked: boolean;
  /** Car only: false while the model or the street under it is still loading. */
  onRoad: boolean;
  error: string | null;
};

export type SimHandle = {
  dispose: () => void;
  start: () => void;
  setCity: (id: CityId) => void;
  /** Put the vehicle back at the spawn — the R key, for the touch UI. */
  restart: () => void;
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

function spawnPose(city: City, vehicle: Vehicle = "plane"): Pose {
  const base = {
    x: 0,
    z: 0,
    // Compass azimuth is CW from north; Three.js Y is CCW from +Z (north).
    heading: -city.az,
    roll: 0,
  };
  // The car gets its own spawn on a real street, seeded at roughly the right
  // elevation; the wheel probes settle it onto the actual surface once the
  // tiles there refine. It never falls — a raycast vehicle is glued to the
  // surface, so there is no gravity to fall with.
  if (vehicle === "car") {
    return {
      ...base,
      heading: -city.drive.az,
      y: city.drive.height,
      pitch: 0,
      speed: 0,
      throttle: 0,
    };
  }
  return { ...base, y: city.height, pitch: city.el, speed: 48, throttle: 0.42 };
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
  vehicle: Vehicle = "plane",
): SimHandle {
  let city = CITIES[initialCity] ?? CITIES.sf;
  let pose = spawnPose(city, vehicle);
  let flying = false;
  let cameraMode: CameraMode = "chase";
  let disposed = false;
  let hudClock = 0;
  /** Front wheels, radians, + is left. Smoothed toward the stick. */
  let steerAngle = 0;
  /** Accumulated wheel rotation, so the tyres roll with the road.  */
  let wheelSpin = 0;
  let blocked = false;
  let car: CarModel | null = null;

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
  craft.visible = vehicle === "plane";
  scene.add(craft);

  // The Lamborghini is ~18 MB, so it is only fetched when someone picks the car
  // — a flight never pays for it.
  if (vehicle === "car") {
    void loadCar(`${import.meta.env.BASE_URL}models/lamborghini.glb`)
      .then((loaded) => {
        if (disposed) {
          loaded.dispose();
          return;
        }
        car = loaded;
        scene.add(loaded.group);
        applyPoseToCraft();
        emitHud();
      })
      .catch((err) => {
        console.error("[sim] car model failed to load:", err);
        tilesError = "Couldn't load the car";
        emitHud();
      });
  }

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_GLTF_CONFIG);

  const tiles = new TilesRenderer();
  const spawn0 = vehicle === "car" ? city.drive : city;
  const reorient = new ReorientationPlugin({
    lat: spawn0.lat,
    lon: spawn0.lon,
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
    reorient.transformLatLonHeightToOrigin(spawnLatLon().lat, spawnLatLon().lon, 0);
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

  /** The object the camera follows: the car once it is loaded, else the plane. */
  /** The lat/lon the tileset is centred on, which differs per vehicle. */
  function spawnLatLon() {
    return vehicle === "car" ? city.drive : city;
  }

  function body(): THREE.Object3D {
    return car?.group ?? craft;
  }

  function applyPoseToCraft() {
    const obj = body();
    obj.position.set(pose.x, pose.y, pose.z);
    obj.rotation.order = "YXZ";
    obj.rotation.set(-pose.pitch, pose.heading, pose.roll);
    obj.updateMatrixWorld(true);
    car?.pose(steerAngle, wheelSpin);
  }

  function placeCamera(dt: number) {
    const obj = body();
    if (vehicle === "car") {
      if (cameraMode === "cockpit") {
        // FPP sits in the driver's seat and looks out over the bonnet.
        tmpCam.copy(car?.eyePoint ?? COCKPIT_OFFSET).applyQuaternion(obj.quaternion).add(obj.position);
        tmpLook.set(0, (car?.eyePoint.y ?? 1) - 0.1, 40).applyQuaternion(obj.quaternion).add(obj.position);
      } else {
        // TPP hangs off heading only. Letting it inherit the body's pitch and
        // roll makes every kerb throw the whole city around the screen.
        followEuler.set(0, pose.heading, 0);
        followQuat.setFromEuler(followEuler);
        tmpCam.copy(CAR_CHASE_OFFSET).applyQuaternion(followQuat).add(obj.position);
        tmpLook.copy(CAR_CHASE_LOOK).applyQuaternion(followQuat).add(obj.position);
      }
    } else if (cameraMode === "cockpit") {
      tmpCam.copy(COCKPIT_OFFSET).applyQuaternion(obj.quaternion).add(obj.position);
      tmpLook.copy(COCKPIT_LOOK).applyQuaternion(obj.quaternion).add(obj.position);
    } else {
      // Follow heading + pitch, almost no roll — camera stays behind the nose.
      followEuler.set(-pose.pitch * 0.45, pose.heading, pose.roll * CHASE_BANK);
      followQuat.setFromEuler(followEuler);
      tmpCam.copy(CHASE_OFFSET).applyQuaternion(followQuat).add(obj.position);
      tmpLook.copy(CHASE_LOOK).applyQuaternion(followQuat).add(obj.position);
    }
    const follow = cameraMode === "cockpit" ? 20 : vehicle === "car" ? 7.5 : 10;
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
    pose = spawnPose(city, vehicle);
    carGrounded = false;
    arrivalHeight = Number.NaN;
    lastRestY = Number.NaN;
    steerAngle = 0;
    blocked = false;
    reorient.transformLatLonHeightToOrigin(spawnLatLon().lat, spawnLatLon().lon, 0);
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
  function groundHeightAt(
    x: number,
    y: number,
    z: number,
    down = GROUND_PROBE_DOWN,
    up = GROUND_PROBE_UP,
  ): number | null {
    tmpOrigin.set(x, y + up, z);
    raycaster.set(tmpOrigin, tmpDown);
    raycaster.far = up + down;
    const hit = raycaster.intersectObject(tiles.group, true)[0];
    return hit ? tmpOrigin.y - hit.distance : null;
  }

  /** True once the tiles under the spawn have resolved and the car has landed. */
  let carGrounded = false;
  /** Last candidate street height, used to require two agreeing samples. */
  let arrivalHeight = Number.NaN;
  /** Surface height under the wheels last frame, for the cliff-edge test. */
  let lastRestY = Number.NaN;
  const wheelWorld = new THREE.Vector3();
  const wheelHeight = { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 };

  /**
   * Surface height under a car-local point, in world space.
   * Returns null while the tile under that wheel has not streamed in.
   */
  function groundUnderOffset(offset: THREE.Vector3): number | null {
    wheelWorld.copy(offset).applyAxisAngle(WORLD_UP, pose.heading);
    // Before the first landing the car is still parked at the flight spawn
    // height, so the probe has to reach the whole way down to the street; after
    // that it is sitting on the road and the short reach is enough.
    const down = carGrounded ? GROUND_PROBE_DOWN : MAX_HEIGHT;
    const up = carGrounded ? CAR_PROBE_UP : CAR_LANDING_PROBE_UP;
    return groundHeightAt(pose.x + wheelWorld.x, pose.y, pose.z + wheelWorld.z, down, up);
  }

  /** Where the body rests on the four sampled contacts, and how it is tilted. */
  function wheelContact(model: CarModel) {
    const front = (wheelHeight.frontLeft + wheelHeight.frontRight) / 2;
    const rear = (wheelHeight.rearLeft + wheelHeight.rearRight) / 2;
    const left = (wheelHeight.frontLeft + wheelHeight.rearLeft) / 2;
    const right = (wheelHeight.frontRight + wheelHeight.rearRight) / 2;
    const track = Math.abs(model.wheelOffsets.frontLeft.x - model.wheelOffsets.frontRight.x);
    return {
      restY: (front + rear) / 2 + model.wheelRadius,
      targetPitch: Math.atan2(front - rear, model.wheelbase),
      // Left wheels higher tilts the left side up, which is +roll here (the
      // plane's A/D bank uses the same sign).
      targetRoll: Math.atan2(left - right, track),
    };
  }

  /**
   * Read all four wheel contacts. Returns false while any of them is over a
   * tile that has not streamed in — a three-wheeled average pitches the body.
   */
  function sampleWheels(): boolean {
    if (!car) return false;
    for (const id of WHEEL_IDS) {
      const g = groundUnderOffset(car.wheelOffsets[id]);
      if (g === null) return false;
      wheelHeight[id] = g;
    }
    return true;
  }

  /** How far the surface climbs `SPAWN_LOOK` metres along `heading`. */
  function riseAhead(heading: number, ground: number): number {
    const h = groundHeightAt(
      pose.x + Math.sin(heading) * SPAWN_LOOK,
      pose.y,
      pose.z + Math.cos(heading) * SPAWN_LOOK,
      GROUND_PROBE_DOWN,
      WALL_PROBE_UP,
    );
    return h === null ? Infinity : h - ground;
  }

  /**
   * The authored heading, or the nearest one to it with clear road ahead.
   *
   * A hand-placed spawn cannot know which way the street runs, and in
   * photogrammetry a parked bus or a street tree is part of the terrain — face
   * one and the car is walled in before it moves. Rather than hand-tuning a
   * compass bearing per city until it happens to work, look around and take the
   * clearest way out, preferring the direction the spawn asked for.
   */
  function clearestHeading(preferred: number, ground: number): number {
    let best = preferred;
    let bestRise = riseAhead(preferred, ground);
    if (bestRise <= SPAWN_CLEAR_RISE) return preferred;
    for (let i = 1; i <= 8; i++) {
      const offset = (i * Math.PI) / 4;
      for (const candidate of [preferred + offset, preferred - offset]) {
        const rise = riseAhead(candidate, ground);
        if (rise <= SPAWN_CLEAR_RISE) return wrapPi(candidate);
        if (rise < bestRise) {
          bestRise = rise;
          best = candidate;
        }
      }
    }
    return wrapPi(best);
  }

  function integrateCar(dt: number) {
    if (!car) return;

    // Held at the spawn height until the street below has streamed in, then
    // placed on it once — no long fall, and no driving around in mid-air.
    if (!carGrounded) {
      // The root tileset is a coarse shell that can sit a hundred metres off
      // the real street, and it is stable while it is the only thing loaded —
      // so agreeing samples alone are not enough to trust it. Wait until the
      // area has actually refined before committing the car to a surface.
      if (tiles.visibleTiles.size < CAR_LANDING_TILES) return;
      if (!sampleWheels()) return;
      const { restY, targetPitch, targetRoll } = wheelContact(car);
      // Coarse tiles read tens of metres off and refine as they stream, so wait
      // for two agreeing samples. Landing on the first one drops the car
      // through the city and the renderer never refines from down there.
      if (Math.abs(restY - arrivalHeight) > 2) {
        arrivalHeight = restY;
        return;
      }
      carGrounded = true;
      lastRestY = restY;
      pose.y = restY;
      pose.pitch = targetPitch;
      pose.roll = targetRoll;
      pose.heading = clearestHeading(pose.heading, restY);
      camInitialized = false;
      return;
    }

    const axes = input.sample();
    // A/D arrive on the roll axis (A = -1). Left must increase heading: in this
    // sim forward is (sin h, 0, cos h), so d(forward)/dh at h=0 is +X, and +X is
    // left of +Z. Hence the negation here — and it is the ONLY sign flip in the
    // steering path. Proved by the control self-test, do not "fix" it blind.
    const steerInput = -axes.roll;
    const throttleInput = axes.pitch;

    // Speed. Brake first, then reverse; drag always pulls back toward zero.
    const speedFactor = 1 / (1 + Math.abs(pose.speed) / CAR_STEER_FALLOFF);
    if (throttleInput > 0.02) {
      pose.speed += throttleInput * CAR_ACCEL * dt;
    } else if (throttleInput < -0.02) {
      pose.speed +=
        pose.speed > 0.4 ? throttleInput * CAR_BRAKE * dt : throttleInput * CAR_ACCEL * 0.55 * dt;
    }
    const drag = CAR_ROLL_DRAG + CAR_AIR_DRAG * pose.speed * pose.speed;
    pose.speed -= Math.sign(pose.speed) * Math.min(Math.abs(pose.speed), drag * dt);
    pose.speed = clamp(pose.speed, -CAR_REVERSE_SPEED, CAR_TOP_SPEED);
    pose.throttle = Math.abs(pose.speed) / CAR_TOP_SPEED;

    // Steering: a bicycle model off the front axle, so the turn circle tightens
    // as the car slows the way a real one does.
    const steerTarget = steerInput * CAR_MAX_STEER * speedFactor;
    steerAngle += (steerTarget - steerAngle) * (1 - Math.exp(-CAR_STEER_RATE * dt));
    pose.heading += (pose.speed / car.wheelbase) * Math.tan(steerAngle) * dt;
    pose.heading = wrapPi(pose.heading);

    // Look ahead before committing the move: anything rising faster than a
    // steep street is a kerb or a building, and the car stops against it.
    //
    // The two probes deliberately start at different heights. Under the car we
    // want the road, so that one starts just over the roof. Ahead of the car we
    // want to know whether a building is standing there, and a low probe would
    // start *inside* its ground floor and report the floor as open road — so
    // that one starts above the facade and reports the roof.
    const reach = 2.6 + Math.abs(pose.speed) * 0.35;
    const dir = Math.sign(pose.speed) || 1;
    const aheadX = pose.x + Math.sin(pose.heading) * reach * dir;
    const aheadZ = pose.z + Math.cos(pose.heading) * reach * dir;
    const here = groundHeightAt(pose.x, pose.y, pose.z, GROUND_PROBE_DOWN, CAR_PROBE_UP);
    const ahead = groundHeightAt(aheadX, pose.y, aheadZ, GROUND_PROBE_DOWN, WALL_PROBE_UP);
    blocked =
      here !== null && ahead !== null && ahead - here > reach * CAR_MAX_CLIMB;
    if (blocked) {
      // Bleed the speed off rather than stopping dead — a hard stop at 40 m/s
      // reads as a bug, a hard shove backwards reads as a crash.
      pose.speed *= Math.exp(-9 * dt);
      if (Math.abs(pose.speed) < 0.6) pose.speed = 0;
    }

    const prevX = pose.x;
    const prevZ = pose.z;
    pose.x += Math.sin(pose.heading) * pose.speed * dt;
    pose.z += Math.cos(pose.heading) * pose.speed * dt;
    wheelSpin -= (pose.speed / car.wheelRadius) * dt;

    // Suspension: sample all four wheels, then let the body chase the contact
    // plane instead of snapping to it. Raw photogrammetry is lumpy at wheel
    // scale and an unfiltered body shakes itself apart.
    if (!sampleWheels()) return;
    const { restY, targetPitch, targetRoll } = wheelContact(car);

    // A sheer drop under the wheels is a kerb edge, a pier, or a gap in the
    // mesh — never a road. Refuse to follow it down and stop against it, the
    // same way the climb limit stops the car against a wall.
    // Compare against the surface we were on last frame, not against the body.
    // Measuring the body's own height instead deadlocks the car: settle a
    // fraction too high and every frame reads as a cliff, so it never comes
    // down and never moves again.
    const step = restY - lastRestY;
    lastRestY = restY;
    if (step < -CAR_MAX_DROP) {
      // Take the step back too, so the car settles at the lip rather than
      // creeping further out over it every frame.
      pose.x = prevX;
      pose.z = prevZ;
      blocked = true;
      pose.speed *= Math.exp(-12 * dt);
      if (Math.abs(pose.speed) < 0.6) pose.speed = 0;
      return;
    }

    pose.y += (restY - pose.y) * (1 - Math.exp(-CAR_BODY_SMOOTH * dt));
    pose.pitch += (targetPitch - pose.pitch) * (1 - Math.exp(-CAR_TILT_SMOOTH * dt));
    pose.roll += (targetRoll - pose.roll) * (1 - Math.exp(-CAR_TILT_SMOOTH * dt));
  }

  function integrate(dt: number) {
    if (!flying) return;
    if (vehicle === "car") {
      integrateCar(dt);
      return;
    }
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
      vehicle,
      speedKph: pose.speed * 3.6,
      blocked,
      onRoad: vehicle !== "car" || carGrounded,
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
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(body().quaternion);
    return {
      cam: camera.position.toArray(),
      craft: body().position.toArray(),
      vehicle,
      steer: steerAngle,
      wheelRadius: car?.wheelRadius ?? null,
      speed: pose.speed,
      blocked,
      grounded: carGrounded,
      heading: pose.heading,
      compass: compassDeg(pose.heading),
      // Report the surface the way the active vehicle actually probes it.
      ground:
        vehicle === "car"
          ? groundHeightAt(pose.x, pose.y, pose.z, MAX_HEIGHT, CAR_PROBE_UP)
          : groundHeightAt(pose.x, pose.y, pose.z, MAX_HEIGHT),
      wallAhead: groundHeightAt(
        pose.x + Math.sin(pose.heading) * 4,
        pose.y,
        pose.z + Math.cos(pose.heading) * 4,
        GROUND_PROBE_DOWN,
        WALL_PROBE_UP,
      ),
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
    if (vehicle === "car") {
      // The interior is modelled, so the car stays drawn in FPP — hiding it
      // would leave the driver looking through a missing dashboard.
      if (car) car.group.visible = true;
    } else {
      craft.visible = cameraMode !== "cockpit";
      if (typeof craft.userData.update === "function") {
        craft.userData.update(dt, flying, pose.speed);
      }
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
      car?.dispose();
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
    restart: () => {
      resetTo(city);
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
