import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/*
 * The character you walk the city as.
 *
 * Half a megabyte, so unlike the Lamborghini it needs no download button and no
 * asset tier — picking Walk fetches it, and the warm-up gate covers the wait.
 * Provenance and licence are in `public/models/CREDITS.md`.
 */

/** Human height in metres, so the model reads at the right scale against the city. */
const TARGET_HEIGHT = 1.78;

/**
 * Ground speeds the clips were authored around, m/s.
 *
 * The stride is stretched by `speed / reference` so the feet keep up with the
 * ground rather than skating over it. Both were read off the model by eye —
 * there is nothing in a glTF that states the speed a walk cycle assumes.
 */
const WALK_REFERENCE = 1.35;
const RUN_REFERENCE = 4.4;
/** How fast a clip may be stretched before it stops looking like walking. */
const STRIDE_RANGE = { min: 0.55, max: 1.9 };
/** Seconds to cross from one clip to another. */
const BLEND = 0.18;

/**
 * Kept here rather than trusting the HTTP cache: switching city or vehicle
 * rebuilds the sim, and that should re-parse, not re-download.
 */
let walkerBytes: ArrayBuffer | null = null;
let walkerDownload: Promise<ArrayBuffer> | null = null;

export function isWalkerDownloaded(): boolean {
  return walkerBytes !== null;
}

export type Walker = {
  group: THREE.Group;
  /** Where the eyes sit, character-local, for the first-person view. */
  eyePoint: THREE.Vector3;
  /** Height in metres after scaling — the walk probe uses it for headroom. */
  height: number;
  /**
   * Advance the animation. `speed` is ground speed in m/s, signed: walking
   * backwards runs the cycle backwards rather than moonwalking forwards.
   */
  update: (dt: number, speed: number) => void;
  dispose: () => void;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Load the character and normalise it into this sim's frame: metres, feet on
 * y = 0, nose along +Z like everything else here.
 */
export async function loadWalker(url: string): Promise<Walker> {
  if (!walkerBytes) {
    walkerDownload ??= (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`character: HTTP ${res.status}`);
      return res.arrayBuffer();
    })().catch((err) => {
      walkerDownload = null;
      throw err;
    });
    walkerBytes = await walkerDownload;
  }
  // Parse a copy: GLTFLoader may take ownership of the buffer it is handed,
  // and these bytes are kept for the next time the sim is rebuilt.
  const gltf = await new GLTFLoader().parseAsync(walkerBytes.slice(0), "");
  const source = gltf.scene;
  source.updateMatrixWorld(true);

  const measured = new THREE.Box3().setFromObject(source);
  const size = measured.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
  source.scale.setScalar(scale);
  source.updateMatrixWorld(true);

  // Re-measure at the final scale and drop the model so it stands on y = 0,
  // centred on its own footprint rather than wherever the rig's origin fell.
  const box = new THREE.Box3().setFromObject(source);
  const centre = box.getCenter(new THREE.Vector3());
  source.position.x -= centre.x;
  source.position.z -= centre.z;
  source.position.y -= box.min.y;

  const group = new THREE.Group();
  group.add(source);
  const height = box.max.y - box.min.y;

  source.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // The city is lit by hemisphere plus two directionals with no shadow map;
    // a character that casts none but reads as matte sits in it convincingly.
    mesh.frustumCulled = false;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && "metalness" in mat) mat.metalness = Math.min(mat.metalness, 0.2);
  });

  const mixer = new THREE.AnimationMixer(source);
  const clip = (name: string) => gltf.animations.find((a) => a.name === name);
  const idleClip = clip("Idle");
  const walkClip = clip("Walking");
  const runClip = clip("Running");

  const action = (c: THREE.AnimationClip | undefined) => {
    if (!c) return null;
    const a = mixer.clipAction(c);
    a.play();
    a.setEffectiveWeight(0);
    return a;
  };
  const idle = action(idleClip);
  const walk = action(walkClip);
  const run = action(runClip);
  if (idle) idle.setEffectiveWeight(1);

  /** Current blend weights, eased toward the target so gait changes glide. */
  const weight = { idle: 1, walk: 0, run: 0 };

  function update(dt: number, speed: number) {
    const pace = Math.abs(speed);
    // Targets: still, walking, running, with a band where the two gaits share.
    let wantWalk = 0;
    let wantRun = 0;
    if (pace > 0.15) {
      wantRun = clamp((pace - WALK_REFERENCE * 1.4) / (RUN_REFERENCE - WALK_REFERENCE), 0, 1);
      wantWalk = 1 - wantRun;
    }
    const wantIdle = pace > 0.15 ? 0 : 1;

    const ease = 1 - Math.exp(-dt / BLEND);
    weight.idle += (wantIdle - weight.idle) * ease;
    weight.walk += (wantWalk - weight.walk) * ease;
    weight.run += (wantRun - weight.run) * ease;

    idle?.setEffectiveWeight(weight.idle);
    walk?.setEffectiveWeight(weight.walk);
    run?.setEffectiveWeight(weight.run);

    // Stretch each cycle to the ground it is covering, and run it backwards
    // when the character is backing up.
    const direction = speed < -0.05 ? -1 : 1;
    if (walk) {
      walk.timeScale =
        direction * clamp(pace / WALK_REFERENCE, STRIDE_RANGE.min, STRIDE_RANGE.max);
    }
    if (run) {
      run.timeScale = direction * clamp(pace / RUN_REFERENCE, STRIDE_RANGE.min, STRIDE_RANGE.max);
    }
    mixer.update(dt);
  }

  return {
    group,
    // Eyes just under the crown; the head is the top of the bounding box.
    eyePoint: new THREE.Vector3(0, height * 0.92, 0.12),
    height,
    update,
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(source);
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    },
  };
}
