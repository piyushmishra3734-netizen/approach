import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { retargetClip } from "three/addons/utils/SkeletonUtils.js";

/*
 * The character you walk the city as.
 *
 * Two kinds of character are supported, because most rigs you can actually get
 * hold of do not come with a walk cycle:
 *
 *   - one whose own file carries the gaits (the CC0 robot), and
 *   - one that carries only a pose, with the gaits retargeted onto it from
 *     Mixamo clips at load time.
 *
 * Provenance and licence are in `public/models/CREDITS.md`.
 */

/** Human height in metres, so the model reads at the right scale against the city. */
const TARGET_HEIGHT = 1.78;

/**
 * Ground speeds the clips were authored around, m/s.
 *
 * The stride is stretched by `speed / reference` so the feet keep up with the
 * ground rather than skating over it. Both were read off the models by eye —
 * there is nothing in a glTF that states the speed a walk cycle assumes.
 */
const WALK_REFERENCE = 1.35;
const RUN_REFERENCE = 4.4;
/** How fast a clip may be stretched before it stops looking like walking. */
const STRIDE_RANGE = { min: 0.55, max: 1.9 };
/** Seconds to cross from one clip to another. */
const BLEND = 0.18;

export type Gait = "idle" | "walk" | "run";

export type CharacterSpec = {
  /** GLB holding the character. */
  model: string;
  /** Gaits already inside that file, by clip name or a substring of one. */
  own?: Partial<Record<Gait, string>>;
  /** Gaits to bring in from elsewhere (Mixamo .fbx) and retarget onto the rig. */
  borrow?: Partial<Record<Gait, string>>;
  /**
   * Target-rig bone prefixes against the source rig's bone names, for the
   * retarget. Only mapped bones are driven — hair, skirts, fingers and props
   * keep their bind pose, which is what you want from a borrowed clip.
   */
  boneMap?: Record<string, string>;
};

/**
 * 3ds Max Biped against Mixamo, the two rigs this game has met.
 *
 * Keys are prefixes: a Sketchfab export appends `_06`, `_0198` and so on to
 * every node, and those numbers change every time the file is re-exported, so
 * matching on the stem is the only stable way to find a bone.
 */
const BIPED_FROM_MIXAMO: Record<string, string> = {
  "Bip001-Pelvis": "mixamorig:Hips",
  "Bip001-Spine2": "mixamorig:Spine2",
  "Bip001-Spine1": "mixamorig:Spine1",
  "Bip001-Spine": "mixamorig:Spine",
  "Bip001-Neck": "mixamorig:Neck",
  "Bip001-Head": "mixamorig:Head",
  "Bip001-L-Clavicle": "mixamorig:LeftShoulder",
  "Bip001-L-UpperArm": "mixamorig:LeftArm",
  "Bip001-L-Forearm": "mixamorig:LeftForeArm",
  "Bip001-L-Hand": "mixamorig:LeftHand",
  "Bip001-R-Clavicle": "mixamorig:RightShoulder",
  "Bip001-R-UpperArm": "mixamorig:RightArm",
  "Bip001-R-Forearm": "mixamorig:RightForeArm",
  "Bip001-R-Hand": "mixamorig:RightHand",
  "Bip001-L-Thigh": "mixamorig:LeftUpLeg",
  "Bip001-L-Calf": "mixamorig:LeftLeg",
  "Bip001-L-Toe0": "mixamorig:LeftToeBase",
  "Bip001-L-Foot": "mixamorig:LeftFoot",
  "Bip001-R-Thigh": "mixamorig:RightUpLeg",
  "Bip001-R-Calf": "mixamorig:RightLeg",
  "Bip001-R-Toe0": "mixamorig:RightToeBase",
  "Bip001-R-Foot": "mixamorig:RightFoot",
};

/** The character shipped with the game: half a megabyte, gaits included. */
export const ROBOT: CharacterSpec = {
  model: "models/robot.glb",
  own: { idle: "Idle", walk: "Walking", run: "Running" },
};

/**
 * The stand-in the game actually wants to wear. Her own file holds a single
 * standing pose, so walking and running are borrowed from Mixamo and retargeted
 * onto her Biped rig.
 */
export const LACRIMOSA: CharacterSpec = {
  model: "models/lacrimosa.glb",
  own: { idle: "stand" },
  borrow: { walk: "models/anim-walk.fbx", run: "models/anim-run.fbx" },
  boneMap: BIPED_FROM_MIXAMO,
};

export type Walker = {
  group: THREE.Group;
  /** Where the eyes sit, character-local, for the first-person view. */
  eyePoint: THREE.Vector3;
  /** Height in metres after scaling. */
  height: number;
  /** Which gaits actually resolved — the answer to "did the retarget work?". */
  gaits: Gait[];
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
 * Kept here rather than trusting the HTTP cache: switching city or vehicle
 * rebuilds the sim, and that should re-parse, not re-download.
 */
const cache = new Map<string, ArrayBuffer>();

async function bytes(url: string): Promise<ArrayBuffer> {
  const held = cache.get(url);
  if (held) return held;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`character asset: HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  cache.set(url, buf);
  return buf;
}

function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!found && mesh.isSkinnedMesh) found = mesh;
  });
  return found;
}

function findClip(clips: THREE.AnimationClip[], want: string | undefined) {
  if (!want) return undefined;
  return (
    clips.find((c) => c.name === want) ??
    clips.find((c) => c.name.toLowerCase().includes(want.toLowerCase()))
  );
}

/**
 * Borrow a clip from another rig.
 *
 * The source hip translation is deliberately dropped — `options.hip` is left at
 * its default, which matches no bone here, so no position track comes out. The
 * sim moves the character across the ground; a clip that also carried its own
 * forward motion would fight it and double the speed.
 */
async function borrowClip(
  url: string,
  target: THREE.SkinnedMesh,
  boneMap: Record<string, string>,
  name: string,
): Promise<THREE.AnimationClip | null> {
  const fbx = new FBXLoader().parse(await bytes(url), "");
  const source = firstSkinnedMesh(fbx);
  const clip = fbx.animations[0];
  if (!source || !clip) return null;

  // Map by prefix: `Bip001-L-Foot_0180` is the same bone as `Bip001-L-Foot`.
  const names: Record<string, string> = {};
  for (const bone of target.skeleton.bones) {
    for (const [stem, sourceName] of Object.entries(boneMap)) {
      if (bone.name === stem || bone.name.startsWith(`${stem}_`)) {
        names[bone.name] = sourceName;
        break;
      }
    }
  }

  /*
   *  samples by driving the target skeleton itself, and leaves it
   * standing in the source's last frame — positions and scales included, at the
   * source rig's units. The clips it returns are rotation-only, so nothing ever
   * puts those back, and a mesh skinned to centimetre-scale bones is scattered
   * far enough to look like it never loaded at all. Borrow the skeleton, then
   * give it back exactly as it was.
   */
  const rest = target.skeleton.bones.map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
  const retargeted = retargetClip(target, source, clip, { names });
  for (const held of rest) {
    held.bone.position.copy(held.position);
    held.bone.quaternion.copy(held.quaternion);
    held.bone.scale.copy(held.scale);
  }
  retargeted.name = name;
  return retargeted;
}

/**
 * Load a character and normalise it into this sim's frame: metres, feet on
 * y = 0, nose along +Z like everything else here.
 */
export async function loadWalker(spec: CharacterSpec, base: string): Promise<Walker> {
  const gltf = await new GLTFLoader().parseAsync((await bytes(base + spec.model)).slice(0), "");
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
    // A skinned mesh's bounds are its bind pose, which a walk cycle leaves —
    // culling against them pops limbs out of existence at the screen edge.
    mesh.frustumCulled = false;
  });

  const skinned = firstSkinnedMesh(source);
  /*
   * The mixer is rooted at the skinned mesh, not the scene: both the clips that
   * came with the file (`Bip001-Head_083.quaternion`) and the retargeted ones
   * (`.bones[Bip001-Head_083].quaternion`) resolve through its skeleton, so one
   * mixer can blend across both without re-pathing either.
   */
  const mixer = new THREE.AnimationMixer(skinned ?? source);

  const clips: Partial<Record<Gait, THREE.AnimationClip>> = {};
  for (const gait of ["idle", "walk", "run"] as Gait[]) {
    const own = findClip(gltf.animations, spec.own?.[gait]);
    if (own) clips[gait] = own;
  }
  if (skinned && spec.borrow && spec.boneMap) {
    for (const gait of ["idle", "walk", "run"] as Gait[]) {
      const url = spec.borrow[gait];
      if (!url) continue;
      const borrowed = await borrowClip(base + url, skinned, spec.boneMap, gait);
      if (borrowed) clips[gait] = borrowed;
    }
  }

  const action = (clip: THREE.AnimationClip | undefined) => {
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    return a;
  };
  const idle = action(clips.idle);
  const walk = action(clips.walk);
  const run = action(clips.run);
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
    gaits: (Object.keys(clips) as Gait[]).filter((g) => clips[g]),
    update,
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(skinned ?? source);
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
