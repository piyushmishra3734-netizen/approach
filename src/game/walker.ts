import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

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

export type Gait = "idle" | "walk" | "run" | "jump";

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
  /**
   * Drive this rig's LEFT arm from the clip's RIGHT arm and vice versa.
   *
   * Her export names the arm bones against the visual mesh — the bone called
   * `L-UpperArm` hangs off the character's right shoulder — so a name-to-name
   * retarget swings each hand across the body and reads as the arms trading
   * places every stride.
   *
   * The swap happens on the finished tracks rather than in the bone map: the
   * map drives the source lookup, and this rig has already shown it cannot be
   * trusted to resolve those names the obvious way (swapping there left the
   * arms stranded in T-pose). Exchanging the baked values cannot miss — every
   * track here was found by the same pass that animated the legs.
   */
  swapArms?: boolean;
};

/**
 * Exchange the quaternion values of every left/right arm pair in a finished
 * clip. All tracks were baked over one shared sample grid, so any left track
 * and its right twin carry identical timing and length — the arrays trade
 * whole. Clavicles through hands; the spine and legs are untouched.
 */
function swapArmTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
  const isArmTrack = (name: string) =>
    /\.bones\[/.test(name) && /(Clavicle|UpperArm|Forearm|Hand)/i.test(name);
  const canonical = (name: string) => name.replace(/-(?:L|R)-/, "-SIDE-");
  for (const left of clip.tracks) {
    if (!/-L-/.test(left.name) || !isArmTrack(left.name)) continue;
    const right = clip.tracks.find(
      (t) => /-R-/.test(t.name) && isArmTrack(t.name) && canonical(t.name) === canonical(left.name),
    );
    if (!right) continue;
    const values = left.values;
    left.values = right.values;
    right.values = values;
  }
  return clip;
}

/**
 * 3ds Max Biped against Mixamo, the two rigs this game has met.
 *
 * Keys are prefixes: a Sketchfab export appends `_06`, `_0198` and so on to
 * every node, and those numbers change every time the file is re-exported, so
 * matching on the stem is the only stable way to find a bone.
 *
 * The values have no colon in them. Mixamo names its bones `mixamorig:Hips`,
 * but a colon is a reserved character in an animation track path, so every
 * three.js loader strips it on the way in — look for the name Mixamo wrote and
 * you match nothing at all, silently.
 */
const BIPED_FROM_MIXAMO: Record<string, string> = {
  "Bip001-Pelvis": "mixamorigHips",
  "Bip001-Spine2": "mixamorigSpine2",
  "Bip001-Spine1": "mixamorigSpine1",
  "Bip001-Spine": "mixamorigSpine",
  "Bip001-Neck": "mixamorigNeck",
  "Bip001-Head": "mixamorigHead",
  "Bip001-L-Clavicle": "mixamorigLeftShoulder",
  "Bip001-L-UpperArm": "mixamorigLeftArm",
  "Bip001-L-Forearm": "mixamorigLeftForeArm",
  "Bip001-L-Hand": "mixamorigLeftHand",
  "Bip001-R-Clavicle": "mixamorigRightShoulder",
  "Bip001-R-UpperArm": "mixamorigRightArm",
  "Bip001-R-Forearm": "mixamorigRightForeArm",
  "Bip001-R-Hand": "mixamorigRightHand",
  "Bip001-L-Thigh": "mixamorigLeftUpLeg",
  "Bip001-L-Calf": "mixamorigLeftLeg",
  "Bip001-L-Toe0": "mixamorigLeftToeBase",
  "Bip001-L-Foot": "mixamorigLeftFoot",
  "Bip001-R-Thigh": "mixamorigRightUpLeg",
  "Bip001-R-Calf": "mixamorigRightLeg",
  "Bip001-R-Toe0": "mixamorigRightToeBase",
  "Bip001-R-Foot": "mixamorigRightFoot",
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
  borrow: {
    walk: "models/anim-walk.fbx",
    run: "models/anim-run.fbx",
    jump: "models/anim-jump.fbx",
  },
  boneMap: BIPED_FROM_MIXAMO,
  // Her export names the arms against the mesh, so name-to-name retargeting
  // swung each hand across the body. See `swapArms`.
  swapArms: true,
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
  update: (dt: number, speed: number, airborne?: boolean) => void;
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
  // The source names carry no colon: `mixamorig:Hips` is a reserved character
  // away from a track path, so every loader strips it on the way in.
  const pairs: Array<{ bone: THREE.Bone; from: THREE.Bone }> = [];
  for (const bone of target.skeleton.bones) {
    for (const [stem, sourceName] of Object.entries(boneMap)) {
      if (bone.name !== stem && !bone.name.startsWith(`${stem}_`)) continue;
      const from = source.skeleton.getBoneByName(sourceName);
      if (from) pairs.push({ bone, from });
      break;
    }
  }
  if (pairs.length === 0) {
    console.warn(
      `[walker] ${name}: no bone of this rig matched the source`,
      source.skeleton.bones.slice(0, 3).map((b) => b.name),
    );
    return null;
  }
  // Parents before children: a bone's local rotation is read against a parent
  // that must already hold this frame's pose.
  const depth = (o: THREE.Object3D) => {
    let n = 0;
    for (let p = o.parent; p; p = p.parent) n++;
    return n;
  };
  pairs.sort((a, b) => depth(a.bone) - depth(b.bone));

  /*
   * Retarget against both rigs' rest poses, not by copying orientations across.
   *
   * three's own `retargetClip` gives the target bone the source bone's world
   * orientation outright. That only holds where the two rigs agree on which way
   * a bone's local axes point, and Mixamo and 3ds Max Biped do not: copied
   * straight over, the knees bend forwards.
   *
   * So take what the source bone has *moved* from its own rest pose, in world
   * space, and apply that same movement to the target's rest pose. Rest-pose
   * relative, which is rig-agnostic.
   */
  const rest = target.skeleton.bones.map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
  source.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const restWorld = new Map<THREE.Bone, { from: THREE.Quaternion; to: THREE.Quaternion }>();
  for (const { bone, from } of pairs) {
    restWorld.set(bone, {
      from: from.getWorldQuaternion(new THREE.Quaternion()),
      to: bone.getWorldQuaternion(new THREE.Quaternion()),
    });
  }

  const fps = 30;
  const frames = Math.max(2, Math.round(clip.duration * fps));
  const step = clip.duration / (frames - 1);
  const times = new Float32Array(frames);
  const values = new Map<THREE.Bone, Float32Array>();
  for (const { bone } of pairs) values.set(bone, new Float32Array(frames * 4));

  const mixer = new THREE.AnimationMixer(source);
  mixer.clipAction(clip).play();
  const delta = new THREE.Quaternion();
  const want = new THREE.Quaternion();
  const parent = new THREE.Quaternion();
  const live = new THREE.Quaternion();

  for (let frame = 0; frame < frames; frame++) {
    mixer.update(frame === 0 ? 0 : step);
    source.updateMatrixWorld(true);
    times[frame] = frame * step;

    for (const { bone, from } of pairs) {
      const at = restWorld.get(bone)!;
      // How far this bone has turned from its own rest pose, in world space.
      delta.copy(from.getWorldQuaternion(live)).multiply(at.from.clone().invert());
      // The same turn, applied to where this rig rests.
      want.copy(delta).multiply(at.to);
      // Back into the parent's frame, which already holds this frame's pose.
      if (bone.parent) {
        (bone.parent as THREE.Bone).getWorldQuaternion(parent);
        want.premultiply(parent.invert());
      }
      bone.quaternion.copy(want);
      bone.updateMatrixWorld(true);
      want.toArray(values.get(bone)!, frame * 4);
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(source);

  // The skeleton was the scratch pad; hand it back as it was found.
  for (const held of rest) {
    held.bone.position.copy(held.position);
    held.bone.quaternion.copy(held.quaternion);
    held.bone.scale.copy(held.scale);
  }
  target.updateMatrixWorld(true);

  const tracks = pairs.map(
    ({ bone }) =>
      new THREE.QuaternionKeyframeTrack(`.bones[${bone.name}].quaternion`, times, values.get(bone)!),
  );
  return new THREE.AnimationClip(name, clip.duration, tracks);
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
  for (const gait of ["idle", "walk", "run", "jump"] as Gait[]) {
    const own = findClip(gltf.animations, spec.own?.[gait]);
    if (own) clips[gait] = own;
  }
  if (skinned && spec.borrow && spec.boneMap) {
    for (const gait of ["idle", "walk", "run", "jump"] as Gait[]) {
      const url = spec.borrow[gait];
      if (!url) continue;
      let borrowed = await borrowClip(base + url, skinned, spec.boneMap, gait);
      if (borrowed && spec.swapArms) borrowed = swapArmTracks(borrowed);
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
  const jump = action(clips.jump);
  if (jump) {
    // A jump happens once and holds its last frame until the feet are back.
    jump.setLoop(THREE.LoopOnce, 1);
    jump.clampWhenFinished = true;
  }
  if (idle) idle.setEffectiveWeight(1);

  /** Current blend weights, eased toward the target so gait changes glide. */
  const weight = { idle: 1, walk: 0, run: 0, jump: 0 };
  let wasAirborne = false;
  /**
   * Hysteresis on the moving/still decision. The sim's ground speed wobbles a
   * few centimetres a second while standing on raw photogrammetry, and a bare
   * `pace > 0.15` test sits right inside that noise — the blend flicked
   * between idle and walk every frame and the character shivered in place.
   * Leaving idle takes a real step; coming back needs the body at rest.
   */
  let moving = false;

  function update(dt: number, speed: number, airborne = false) {
    // Restart the clip on the way up, not on every frame off the ground.
    if (airborne && !wasAirborne && jump) jump.reset().play();
    wasAirborne = airborne;
    const pace = Math.abs(speed);
    if (!moving && pace > 0.25) moving = true;
    else if (moving && pace < 0.08) moving = false;
    // Targets: still, walking, running, with a band where the two gaits share.
    let wantWalk = 0;
    let wantRun = 0;
    if (moving) {
      wantRun = clamp((pace - WALK_REFERENCE * 1.4) / (RUN_REFERENCE - WALK_REFERENCE), 0, 1);
      wantWalk = 1 - wantRun;
    }
    const wantIdle = moving ? 0 : 1;

    const ease = 1 - Math.exp(-dt / BLEND);
    weight.idle += (wantIdle - weight.idle) * ease;
    weight.walk += (wantWalk - weight.walk) * ease;
    weight.run += (wantRun - weight.run) * ease;

    // In the air the jump takes over from whatever the legs were doing.
    weight.jump += ((airborne ? 1 : 0) - weight.jump) * (1 - Math.exp(-dt / (BLEND * 0.6)));
    const grounded = 1 - weight.jump;
    idle?.setEffectiveWeight(weight.idle * grounded);
    walk?.setEffectiveWeight(weight.walk * grounded);
    run?.setEffectiveWeight(weight.run * grounded);
    jump?.setEffectiveWeight(weight.jump);

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
