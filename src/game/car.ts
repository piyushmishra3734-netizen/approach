import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Real Aventador length, so the car reads at the right scale against the city. */
const TARGET_LENGTH = 4.78;

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
 * Load the car and normalise it into this sim's frame: metres, nose along +Z,
 * wheels resting on y = 0.
 *
 * The orientation is measured from the rig rather than assumed — front axle
 * minus rear axle is the true nose direction whatever the exporter chose, so a
 * re-exported or swapped model does not silently drive backwards.
 */
export async function loadCar(url: string): Promise<CarModel> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const source = gltf.scene;
  source.updateMatrixWorld(true);

  const wheels = {} as Record<WheelId, THREE.Object3D>;
  for (const id of WHEEL_IDS) {
    const node = findByPattern(source, WHEEL_NODES[id]);
    if (!node) throw new Error(`car model is missing its ${id} wheel node`);
    wheels[id] = node;
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
  oriented.rotation.y = -yawToPlusZ;
  oriented.add(source);
  group.add(oriented);
  group.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const scale = TARGET_LENGTH / size.z;
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
