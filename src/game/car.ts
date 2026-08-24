import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Real Aventador length, so the car reads at the right scale against the city. */
const TARGET_LENGTH = 4.78;

/**
 * Some rigs name their wheel nodes and some do not. A `RigSpec` describes the
 * unnamed kind: hubs are measured offline (from the mesh itself) and passed in,
 * so the loader can build its own steering pivots instead of looking for nodes
 * that do not exist.
 */
export type RigSpec = {
  /** Hub centres per wheel, in the model's own units and frame. */
  wheels: Record<WheelId, [number, number, number]>;
  /** Hub height above the model's ground plane, model units. */
  wheelRadius: number;
  /** Yaw (radians) that carries the model's nose onto +Z. */
  noseYaw: number;
  /** Real-world length in metres the model is scaled to. */
  targetLength: number;
};

/**
 * Pagani Huayra Codalunga (public/models/pagani.glb). The export names every
 * node `Object_N`, so the hubs below were measured from the mesh: the front
 * axle sits at z = +0.294, the rear at -0.285, and the nose points up +Z —
 * confirmed in-game, so no yaw correction is applied. The rim rings kiss
 * y = 0, so hub height is the rolling radius.
 */
export const PAGANI_RIG: RigSpec = {
  wheels: {
    frontLeft: [-0.19, 0.07, 0.294],
    frontRight: [0.19, 0.07, 0.294],
    rearLeft: [-0.19, 0.075, -0.285],
    rearRight: [0.19, 0.075, -0.285],
  },
  wheelRadius: 0.075,
  noseYaw: 0,
  targetLength: 4.62,
};

/*
 * The rig names these `DEF-Wheel.Ft.L_92` and so on, but GLTFLoader sanitizes
 * node names on the way in and the dots are gone by the time we see them
 * (`DEF-WheelFtL_92`). Match with the separator optional so both spellings hit.
 */
const WHEEL_NODES = {
  frontLeft: /^DEF-Wheel[._]?Ft[._]?L/,
  frontRight: /^DEF-Wheel[._]?Ft[._]?R/,
  rearLeft: /^DEF-Wheel[._]?Bk[._]?L/,
  rearRight: /^DEF-Wheel[._]?Bk[._]?R/,
} as const;

export type WheelId = keyof typeof WHEEL_NODES;
export const WHEEL_IDS = Object.keys(WHEEL_NODES) as WheelId[];

/**
 * The model is tens of megabytes, so it is fetched once, up front, on a button
 * the player presses — never silently at the start of a drive. Holding the
 * bytes here rather than trusting the HTTP cache means switching vehicles or
 * cities re-parses instead of re-downloading.
 */
let carBytes: ArrayBuffer | null = null;
let carDownload: Promise<ArrayBuffer> | null = null;

export function isCarDownloaded(): boolean {
  return carBytes !== null;
}

/**
 * Fetch the model, reporting progress in 0..1. Safe to call again: an
 * in-flight download is shared and a finished one returns immediately.
 */
export function downloadCar(
  url: string,
  onProgress: (fraction: number, received: number, total: number) => void,
): Promise<ArrayBuffer> {
  if (carBytes) return Promise.resolve(carBytes);
  carDownload ??= (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`car model: HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body?.getReader();
    if (!reader) {
      // No streaming body to measure — take the whole thing and report done.
      const buf = await res.arrayBuffer();
      onProgress(1, buf.byteLength, buf.byteLength);
      carBytes = buf;
      return buf;
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(total ? Math.min(1, received / total) : 0, received, total);
    }
    const merged = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
      merged.set(chunk, at);
      at += chunk.length;
    }
    onProgress(1, received, total || received);
    carBytes = merged.buffer;
    return carBytes;
  })().catch((err) => {
    carDownload = null;
    throw err;
  });
  return carDownload;
}

export type CarModel = {
  group: THREE.Group;
  /** Wheel centres in car-local space, y at the hub. */
  wheelOffsets: Record<WheelId, THREE.Vector3>;
  wheelRadius: number;
  /** Front-to-rear axle distance, the bicycle model's turn radius input. */
  wheelbase: number;
  /** Where a driver's eyes sit, car-local. */
  eyePoint: THREE.Vector3;
  /** Steer the front wheels (radians) and roll all four by `spin` radians. */
  pose: (steer: number, spin: number) => void;
  dispose: () => void;
};

function findByPattern(root: THREE.Object3D, pattern: RegExp): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (!found && pattern.test(obj.name)) found = obj;
  });
  return found;
}

/**
 * For unnamed rigs: park an empty pivot at each measured hub, then hand every
 * small mesh that lives inside the hub's sphere to the nearest pivot. The
 * pivot becomes the wheel — steering yaws it, driving spins it — and the body
 * is left exactly where it was. `attach` keeps world transforms intact, so a
 * mesh moved under a pivot does not jump.
 */
function buildWheelPivots(source: THREE.Object3D, rig: RigSpec): Record<WheelId, THREE.Group> {
  source.updateMatrixWorld(true);
  const worldScale = source.getWorldScale(new THREE.Vector3()).x;
  const capture = rig.wheelRadius * 1.15 * worldScale;
  const toLocal = new THREE.Matrix4().copy(source.matrixWorld).invert();

  const pivots = {} as Record<WheelId, THREE.Group>;
  for (const id of WHEEL_IDS) {
    const pivot = new THREE.Group();
    pivot.position.set(...rig.wheels[id]).applyMatrix4(toLocal);
    source.add(pivot);
    pivots[id] = pivot;
  }

  const meshes: THREE.Mesh[] = [];
  source.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) meshes.push(mesh);
  });

  const centre = new THREE.Vector3();
  const size = new THREE.Vector3();
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    box.setFromObject(mesh);
    box.getCenter(centre);
    box.getSize(size);
    if (Math.max(size.x, size.y, size.z) > capture * 2) continue;
    for (const id of WHEEL_IDS) {
      if (centre.distanceTo(pivots[id].position) < capture) {
        pivots[id].attach(mesh);
        break;
      }
    }
  }
  return pivots;
}

/**
 * Load the car and normalise it into this sim's frame: metres, nose along +Z,
 * wheels resting on y = 0.
 *
 * The orientation is measured from the rig rather than assumed — front axle
 * minus rear axle is the true nose direction whatever the exporter chose, so a
 * re-exported or swapped model does not silently drive backwards. Rigs without
 * named wheel nodes pass a `RigSpec` and get measured pivots instead.
 */
export async function loadCar(url: string, rig?: RigSpec): Promise<CarModel> {
  const bytes = await downloadCar(url, () => {});
  // Parse a copy: GLTFLoader may take ownership of the buffer it is handed,
  // and these bytes are kept for the next time the sim is rebuilt.
  const gltf = await new GLTFLoader().parseAsync(bytes.slice(0), "");
  const source = gltf.scene;
  source.updateMatrixWorld(true);

  let wheels: Record<WheelId, THREE.Object3D>;
  if (rig) {
    wheels = buildWheelPivots(source, rig);
  } else {
    wheels = {} as Record<WheelId, THREE.Object3D>;
    for (const id of WHEEL_IDS) {
      const node = findByPattern(source, WHEEL_NODES[id]);
      if (!node) throw new Error(`car model is missing its ${id} wheel node`);
      wheels[id] = node;
    }
  }

  const worldOf = (obj: THREE.Object3D) => obj.getWorldPosition(new THREE.Vector3());
  const frontAxle = worldOf(wheels.frontLeft).lerp(worldOf(wheels.frontRight), 0.5);
  const rearAxle = worldOf(wheels.rearLeft).lerp(worldOf(wheels.rearRight), 0.5);
  const nose = frontAxle.clone().sub(rearAxle);
  nose.y = 0;

  // Yaw that carries the measured nose onto +Z, the forward axis sim.ts flies.
  const yawToPlusZ = Math.atan2(nose.x, nose.z);

  const group = new THREE.Group();
  const oriented = new THREE.Group();
  oriented.rotation.y = rig ? rig.noseYaw : -yawToPlusZ;
  oriented.add(source);
  group.add(oriented);
  group.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const scale = (rig?.targetLength ?? TARGET_LENGTH) / size.z;
  oriented.scale.setScalar(scale);
  group.updateMatrixWorld(true);

  // Re-measure at final scale, then sit the car on the ground and centre it on
  // its own axles rather than on the bounding box — a spoiler or mirror must
  // not shift where the wheels think they are.
  const scaled = new THREE.Box3().setFromObject(group);
  const localFront = group.worldToLocal(worldOf(wheels.frontLeft).lerp(worldOf(wheels.frontRight), 0.5));
  const localRear = group.worldToLocal(worldOf(wheels.rearLeft).lerp(worldOf(wheels.rearRight), 0.5));
  oriented.position.x -= (localFront.x + localRear.x) / 2;
  oriented.position.z -= (localFront.z + localRear.z) / 2;
  oriented.position.y -= scaled.min.y;
  group.updateMatrixWorld(true);

  const wheelOffsets = {} as Record<WheelId, THREE.Vector3>;
  for (const id of WHEEL_IDS) {
    wheelOffsets[id] = group.worldToLocal(worldOf(wheels[id]));
  }
  // Hub height above the contact patch is the tyre radius.
  const wheelRadius = wheelOffsets.frontLeft.y;
  const wheelbase = Math.abs(wheelOffsets.frontLeft.z - wheelOffsets.rearLeft.z);

  const restSteer = {
    frontLeft: wheels.frontLeft.rotation.y,
    frontRight: wheels.frontRight.rotation.y,
  };

  for (const id of WHEEL_IDS) {
    wheels[id].matrixAutoUpdate = true;
  }

  return {
    group,
    wheelOffsets,
    wheelRadius,
    wheelbase,
    // Driver's eyes: just behind the front axle, offset to the left seat.
    eyePoint: new THREE.Vector3(
      0.38,
      wheelRadius + 0.62,
      wheelOffsets.frontLeft.z - 0.55,
    ),
    pose: (steer, spin) => {
      wheels.frontLeft.rotation.y = restSteer.frontLeft + steer;
      wheels.frontRight.rotation.y = restSteer.frontRight + steer;
      for (const id of WHEEL_IDS) wheels[id].rotation.x = spin;
    },
    dispose: () => {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        for (const m of Array.isArray(mat) ? mat : [mat]) {
          const std = m as THREE.MeshStandardMaterial;
          std?.map?.dispose();
          std?.normalMap?.dispose();
          std?.roughnessMap?.dispose();
          std?.dispose?.();
        }
      });
    },
  };
}
