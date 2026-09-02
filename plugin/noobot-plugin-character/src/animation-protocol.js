/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";
import { CameraPlanSchema } from "../camera-presets/schema.js";
import { createAnimationArtifactValidator } from "./animation-artifact-validator.js";
import { createAnimationInputCompiler } from "./animation-input-compiler.js";
import { compileCameraPlan } from "./camera-preset-compiler.js";
import {
  analyzeAnimationSpatial,
  characterPositionAt,
  characterTransformAt,
  hasSpatiallyReachableEvents,
} from "./spatial-analysis.js";
import { compileCharacterRootMotion } from "./root-motion.js";
import { createSemanticActionCompiler } from "./semantic-action-compiler.js";

export {
  analyzeAnimationSpatial,
  characterPositionAt,
  characterTransformAt,
  hasSpatiallyReachableEvents,
};

const number = z.number().finite();
const vec3 = z.array(number).length(3);
const quat = z
  .array(number)
  .length(4)
  .refine((value) => value.some((item) => item !== 0), "quaternion must be non-zero");
const protocolId = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,159}$/);
const assetId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/);
const assetResource = z
  .object({
    version: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: z.literal("model/gltf-binary"),
    size: z.number().int().positive(),
    url: z.string().regex(/^\/api\/internal\/character\/assets\/[A-Za-z0-9._~-]+\/[a-f0-9]{64}$/),
  })
  .strict();
const animationAsset = z
  .object({
    assetId,
    name: z.string().trim().min(1).max(240),
    format: z.literal("glb"),
    size: z.number().int().positive(),
    animations: z.array(
      z
        .object({
          name: z.string().trim().min(1).max(160),
          duration: number.nonnegative(),
          tracks: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    nodes: z.array(z.string().trim().min(1).max(160)).max(500),
    bounds: z.object({ min: vec3, max: vec3, height: number.positive() }).strict(),
    sourceUnit: z.literal("meter"),
    metersPerUnit: number.positive().optional(),
    heightMeters: number.positive().optional(),
    canonicalUnit: z.literal("normalized_world"),
    anchor: z.literal("foot_center"),
    axes: z
      .object({ handedness: z.literal("right"), up: z.literal("Y"), forward: z.literal("-Z") })
      .strict(),
    // Optional correction for source files whose visual forward axis is not
    // the canonical -Z axis. This rotates only the asset-local model node.
    canonicalRotation: quat.optional(),
    normalization: z
      .object({
        targetHeight: number.positive(),
        scale: number.positive(),
        floorOffset: number,
        anchorOffset: vec3.default([0, 0, 0]),
      })
      .strict(),
    importedAt: z.iso.datetime(),
    resource: assetResource,
  })
  .strict()
  .refine((value) => value.size === value.resource.size, {
    message: "asset and resource sizes must match",
  });
const animationId = protocolId.max(80);
const keyframe = z
  .object({
    time: number.min(0),
    position: vec3.optional(),
    rotation: quat.optional(),
    scale: vec3.optional(),
  })
  .strict();
const track = z
  .object({
    // A named animation channel is model-authored metadata. The executable
    // representation remains the same v4 track (node + property + keyframes).
    // Keeping the channel on the authoritative track lets the model compose
    // precise channels without introducing a second runtime protocol.
    channelId: protocolId.optional(),
    node: z.string().trim().min(1).max(160),
    property: z.enum(["position", "rotation", "scale"]),
    keyframes: z.array(keyframe).min(1).max(2000),
  })
  .strict();
const rootMotionKeyframe = z
  .object({
    time: number.min(0),
    position: vec3,
    rotation: quat,
    scale: vec3.refine((value) => value.every((item) => item > 0), "root scale must be positive"),
  })
  .strict();
const rootMotion = z
  .object({
    space: z.literal("normalized_world"),
    keyframes: z.array(rootMotionKeyframe).min(2).max(200),
  })
  .strict();
const localRootMotion = z
  .object({
    space: z.literal("character_local"),
    keyframes: z.array(rootMotionKeyframe).min(2).max(200),
  })
  .strict();
const segment = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("native_clip"),
      start: number.min(0),
      duration: number.positive().max(3600),
      clip: z.string().trim().min(1).max(160),
      rootMotion,
    })
    .strict(),
  z
    .object({
      type: z.literal("keyframes"),
      start: number.min(0),
      duration: number.positive().max(3600),
      tracks: z.array(track).min(1).max(500),
      rootMotion,
    })
    .strict(),
]);
const segmentInput = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("native_clip"),
      start: number.min(0),
      duration: number.positive().max(3600),
      clip: z.string().trim().min(1).max(160),
      rootMotion: localRootMotion.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("keyframes"),
      start: number.min(0),
      duration: number.positive().max(3600),
      tracks: z.array(track).min(1).max(500),
      rootMotion: localRootMotion.optional(),
    })
    .strict(),
]);
const rootTransform = z
  .object({
    position: vec3,
    rotation: quat,
    scale: vec3.refine((value) => value.every((item) => item > 0), "root scale must be positive"),
  })
  .strict();
const orientationMode = z.enum(["auto", "authored", "face_motion"]).default("auto");
export const AnimationCharacterDeclarationSchema = z
  .object({
    characterId: protocolId,
    assetId,
    rootTransform,
    orientationMode,
  })
  .strict();
const characterTimeline = z
  .object({
    ...AnimationCharacterDeclarationSchema.shape,
    segments: z.array(segment).min(1).max(100),
  })
  .strict();
const characterTimelineInput = z
  .object({
    ...AnimationCharacterDeclarationSchema.shape,
    segments: z.array(segmentInput).min(1).max(100),
  })
  .strict();
const colliderShape = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("box"),
      center: vec3,
      size: vec3.refine((value) => value.every((item) => item > 0), "box size must be positive"),
    })
    .strict(),
  z.object({ type: z.literal("sphere"), center: vec3, radius: number.positive() }).strict(),
  z
    .object({
      type: z.literal("capsule"),
      center: vec3,
      radius: number.positive(),
      halfHeight: number.positive(),
    })
    .strict(),
]);
const collider = z
  .object({
    colliderId: protocolId,
    characterId: protocolId,
    node: z.string().trim().min(1).max(160).nullable(),
    role: z.enum(["solid", "hitbox", "hurtbox"]),
    shape: colliderShape,
  })
  .strict();
const cameraKeyframe = z
  .object({
    time: number.nonnegative(),
    position: vec3,
    target: vec3,
    fov: number.positive().max(179),
    transition: z.enum(["cut", "blend"]),
    easing: z.enum(["linear", "ease_in_out"]),
  })
  .strict();
const collisionSpace = z
  .object({
    units: z.literal("normalized_world"),
    origin: vec3,
    detection: z.enum(["continuous", "events_only"]),
    colliders: z.array(collider).max(256),
  })
  .strict();
const collisionSpaceInput = collisionSpace.default({
  units: "normalized_world",
  origin: [0, 0, 0],
  detection: "continuous",
  colliders: [],
});
const contactConstraint = z
  .object({
    constraintId: protocolId,
    type: z.enum(["foot", "hand", "weapon", "custom"]),
    characterId: protocolId,
    node: z.string().trim().min(1).max(160),
    chain: z.array(z.string().trim().min(1).max(160)).min(1).max(16),
    targetCharacterId: protocolId.nullable(),
    targetNode: z.string().trim().min(1).max(160).nullable(),
    targetPosition: vec3.nullable(),
    start: number.nonnegative(),
    end: number.positive(),
    positionTolerance: number.nonnegative().max(1),
    rotationTolerance: number.nonnegative().max(3.15),
    solver: z.literal("ccd_ik"),
  })
  .strict();
const cameraTrack = z
  .object({
    type: z.literal("keyframes"),
    positionInterpolation: z.enum(["linear", "cubic", "catmull_rom_centripetal"]),
    targetInterpolation: z.enum(["linear", "cubic", "catmull_rom_centripetal"]),
    fovInterpolation: z.enum(["linear", "cubic"]),
    keyframes: z.array(cameraKeyframe).min(2).max(1000),
  })
  .strict();
const sceneBase = {
  coordinateSystem: z.literal("normalized_world"),
  unitHeight: z.literal(1),
  groundY: number,
  collisionSpace,
};
const sceneInputBase = {
  coordinateSystem: z.literal("normalized_world").default("normalized_world"),
  unitHeight: z.literal(1).default(1),
  groundY: number.default(0),
  collisionSpace: collisionSpaceInput,
};
export const AnimationSceneSchema = z
  .object({
    ...sceneBase,
    cameraTrack,
    contactConstraints: z.array(contactConstraint).max(256).default([]),
  })
  .strict();
export const AnimationSceneInputSchema = z
  .object({
    ...sceneInputBase,
    camera: CameraPlanSchema.default({ presetId: "camera.static.wide" }),
    contactConstraints: z.array(contactConstraint).max(256).default([]),
  })
  .strict();
const markerEvent = z
  .object({
    eventId: protocolId,
    type: z.literal("marker"),
    time: number.nonnegative(),
    name: protocolId,
  })
  .strict();
const attackEvent = z
  .object({
    eventId: protocolId,
    type: z.literal("attack"),
    time: number.nonnegative(),
    attackerId: protocolId,
    targetId: protocolId,
    hitboxId: protocolId,
    hurtboxId: protocolId,
  })
  .strict();
const contactEvent = z
  .object({
    eventId: protocolId,
    type: z.literal("contact"),
    time: number.nonnegative(),
    sourceColliderId: protocolId,
    targetColliderId: protocolId,
  })
  .strict();
export const AnimationEventSchema = z.discriminatedUnion("type", [
  markerEvent,
  attackEvent,
  contactEvent,
]);
const animationScriptEvent = z.discriminatedUnion("type", [
  markerEvent.omit({ time: true }),
  attackEvent.omit({ time: true }),
  contactEvent.omit({ time: true }),
]);

const scriptClip = z
  .object({
    type: z.literal("clip"),
    characterId: protocolId,
    clip: z.string().trim().min(1).max(160),
    duration: number.positive().max(3600),
    rootMotion: localRootMotion.optional(),
  })
  .strict();
const scriptKeyframes = z
  .object({
    type: z.literal("keyframes"),
    characterId: protocolId,
    duration: number.positive().max(3600),
    tracks: z.array(track).min(1).max(500),
    rootMotion: localRootMotion.optional(),
  })
  .strict();
const scriptChannel = z
  .object({
    type: z.literal("channel"),
    characterId: protocolId,
    channelId: protocolId,
    duration: number.positive().max(3600),
    tracks: z.array(track).min(1).max(500),
    rootMotion: localRootMotion.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.tracks.some(
        (trackValue) => trackValue.channelId && trackValue.channelId !== value.channelId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["tracks"],
        message: "channel track channelId must match the enclosing channel",
      });
    }
  });
export const AnimationMoveModeSchema = z.enum([
  "walk",
  "run",
  "crawl",
  "jump",
  "hop",
  "drop",
  "detour",
  "step_over",
  "jump_over",
  "vault",
  "climb_over",
]);
export const AnimationOrientationModeSchema = z.enum(["turn", "face"]);
export const AnimationPostureModeSchema = z.enum([
  "idle",
  "stop",
  "crouch",
  "kneel",
  "sit",
  "lie",
  "stand_up",
]);
const scriptMove = z
  .object({
    type: z.literal("move"),
    characterId: protocolId,
    mode: AnimationMoveModeSchema,
    clip: z.string().trim().min(1).max(160),
    target: vec3,
    duration: number.positive().max(3600).optional(),
    obstacleId: protocolId.optional(),
    clearance: number.positive().max(10).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const obstacleAction = ["detour", "step_over", "jump_over", "vault", "climb_over"].includes(
      value.mode,
    );
    if (obstacleAction && !value.obstacleId) {
      context.addIssue({ code: "custom", path: ["obstacleId"], message: "obstacleId is required" });
    }
    if (!obstacleAction && value.obstacleId) {
      context.addIssue({
        code: "custom",
        path: ["obstacleId"],
        message: "obstacleId is only valid for obstacle actions",
      });
    }
  });
const scriptOrient = z.discriminatedUnion("mode", [
  z
    .object({
      type: z.literal("orient"),
      characterId: protocolId,
      mode: z.literal("face"),
      clip: z.string().trim().min(1).max(160),
      target: vec3,
      duration: number.positive().max(3600).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("orient"),
      characterId: protocolId,
      mode: z.literal("turn"),
      clip: z.string().trim().min(1).max(160),
      angle: number.min(-Math.PI).max(Math.PI),
      duration: number.positive().max(3600).optional(),
    })
    .strict(),
]);
const scriptPosture = z
  .object({
    type: z.literal("posture"),
    characterId: protocolId,
    mode: AnimationPostureModeSchema,
    clip: z.string().trim().min(1).max(160),
    duration: number.positive().max(3600),
  })
  .strict();
const scriptEvent = z
  .object({
    type: z.literal("event"),
    event: animationScriptEvent,
  })
  .strict();
const scriptNodeSchema = z.lazy(() =>
  z.discriminatedUnion("type", [
    scriptClip,
    scriptKeyframes,
    scriptChannel,
    scriptMove,
    scriptOrient,
    scriptPosture,
    scriptEvent,
    scriptSequence,
    scriptParallel,
  ]),
);
const scriptSequence = z
  .object({
    type: z.literal("sequence"),
    steps: z.array(scriptNodeSchema).min(1).max(200),
  })
  .strict();
const scriptParallel = z
  .object({
    type: z.literal("parallel"),
    steps: z.array(scriptNodeSchema).min(1).max(200),
  })
  .strict();
export const AnimationScriptSchema = z
  .object({
    format: z.literal("noobot.animation.script"),
    version: z.literal(1),
    loop: z.boolean().default(false),
    scene: AnimationSceneInputSchema,
    characters: z.array(AnimationCharacterDeclarationSchema).min(1).max(32),
    root: scriptNodeSchema,
  })
  .strict();

function validateCharacterTimeline(
  value,
  character,
  characterIndex,
  context,
  characterIds,
  assetIds,
) {
  if (characterIds.has(character.characterId))
    context.addIssue({
      code: "custom",
      path: ["characters", characterIndex, "characterId"],
      message: "character IDs must be unique",
    });
  characterIds.add(character.characterId);
  if (assetIds.has(character.assetId))
    context.addIssue({
      code: "custom",
      path: ["characters", characterIndex, "assetId"],
      message: "each asset may appear only once",
    });
  assetIds.add(character.assetId);
  let expectedStart = 0;
  for (const [segmentIndex, segmentValue] of character.segments.entries()) {
    const segmentPath = ["characters", characterIndex, "segments", segmentIndex];
    if (Math.abs(segmentValue.start - expectedStart) > 0.0001)
      context.addIssue({
        code: "custom",
        path: [...segmentPath, "start"],
        message: "segments must form one gap-free timeline starting at zero",
      });
    validateSegment(segmentValue, segmentPath, context);
    expectedStart = segmentValue.start + segmentValue.duration;
  }
  if (Math.abs(expectedStart - value.duration) > 0.0001)
    context.addIssue({
      code: "custom",
      path: ["characters", characterIndex, "segments"],
      message: "each character timeline must equal the animation duration",
    });
}

function validateSegment(segmentValue, segmentPath, context) {
  if (segmentValue.type === "keyframes") {
    for (const [trackIndex, trackValue] of segmentValue.tracks.entries()) {
      let previous = -1;
      for (const [keyframeIndex, frame] of trackValue.keyframes.entries()) {
        const framePath = [...segmentPath, "tracks", trackIndex, "keyframes", keyframeIndex];
        if (frame.time <= previous || frame.time > segmentValue.duration)
          context.addIssue({
            code: "custom",
            path: [...framePath, "time"],
            message: "keyframe times must increase and stay within segment duration",
          });
        if (!frame[trackValue.property])
          context.addIssue({
            code: "custom",
            path: [...framePath, trackValue.property],
            message: `keyframe requires ${trackValue.property}`,
          });
        previous = frame.time;
      }
      validateTrackBounds(trackValue, segmentValue.duration, segmentPath, trackIndex, context);
    }
  }
  if (segmentValue.rootMotion) validateRootMotion(segmentValue, segmentPath, context);
}

function validateTrackBounds(trackValue, duration, segmentPath, trackIndex, context) {
  const first = trackValue.keyframes[0]?.time;
  const last = trackValue.keyframes.at(-1)?.time;
  if (Math.abs(first) > 0.0001)
    context.addIssue({
      code: "custom",
      path: [...segmentPath, "tracks", trackIndex, "keyframes", 0, "time"],
      message: "each keyframe track must start at zero",
    });
  if (Math.abs(last - duration) > 0.0001)
    context.addIssue({
      code: "custom",
      path: [
        ...segmentPath,
        "tracks",
        trackIndex,
        "keyframes",
        trackValue.keyframes.length - 1,
        "time",
      ],
      message: "each keyframe track must end at segment duration",
    });
}

function validateRootMotion(segmentValue, segmentPath, context) {
  let previous = -1;
  for (const [keyframeIndex, frame] of segmentValue.rootMotion.keyframes.entries()) {
    if (frame.time <= previous || frame.time > segmentValue.duration)
      context.addIssue({
        code: "custom",
        path: [...segmentPath, "rootMotion", "keyframes", keyframeIndex, "time"],
        message: "root motion times must increase and stay within segment duration",
      });
    previous = frame.time;
  }
  const frames = segmentValue.rootMotion.keyframes;
  if (Math.abs(frames[0]?.time || 0) > 0.0001)
    context.addIssue({
      code: "custom",
      path: [...segmentPath, "rootMotion", "keyframes", 0, "time"],
      message: "root motion must start at segment time zero",
    });
  if (Math.abs((frames.at(-1)?.time || 0) - segmentValue.duration) > 0.0001)
    context.addIssue({
      code: "custom",
      path: [...segmentPath, "rootMotion", "keyframes"],
      message: "root motion must end at segment duration",
    });
}

function validateColliders(value, characterIds, context) {
  const colliders = new Map();
  for (const [index, item] of value.scene.collisionSpace.colliders.entries()) {
    if (colliders.has(item.colliderId))
      context.addIssue({
        code: "custom",
        path: ["scene", "collisionSpace", "colliders", index, "colliderId"],
        message: "collider IDs must be unique",
      });
    if (!characterIds.has(item.characterId))
      context.addIssue({
        code: "custom",
        path: ["scene", "collisionSpace", "colliders", index, "characterId"],
        message: "collider character must exist",
      });
    colliders.set(item.colliderId, item);
  }
  return colliders;
}

function validateEvents(value, characterIds, colliders, context) {
  const eventIds = new Set();
  for (const [index, event] of value.events.entries()) {
    if (eventIds.has(event.eventId))
      context.addIssue({
        code: "custom",
        path: ["events", index, "eventId"],
        message: "event IDs must be unique",
      });
    if (event.time > value.duration)
      context.addIssue({
        code: "custom",
        path: ["events", index, "time"],
        message: "event must occur within animation duration",
      });
    eventIds.add(event.eventId);
    validateEvent(event, index, characterIds, colliders, context);
  }
}

function validateEvent(event, index, characterIds, colliders, context) {
  if (event.type === "attack") {
    const hitbox = colliders.get(event.hitboxId);
    const hurtbox = colliders.get(event.hurtboxId);
    if (
      event.attackerId === event.targetId ||
      !characterIds.has(event.attackerId) ||
      !characterIds.has(event.targetId) ||
      hitbox?.role !== "hitbox" ||
      hitbox?.characterId !== event.attackerId ||
      hurtbox?.role !== "hurtbox" ||
      hurtbox?.characterId !== event.targetId
    )
      context.addIssue({
        code: "custom",
        path: ["events", index],
        message: "attack must reference its characters, hitbox and hurtbox",
      });
  }
  if (
    event.type === "contact" &&
    (event.sourceColliderId === event.targetColliderId ||
      !colliders.has(event.sourceColliderId) ||
      !colliders.has(event.targetColliderId))
  )
    context.addIssue({
      code: "custom",
      path: ["events", index],
      message: "contact colliders must exist",
    });
}

function validateConstraints(value, characterIds, context) {
  const ids = new Set();
  for (const [index, constraint] of value.scene.contactConstraints.entries()) {
    if (ids.has(constraint.constraintId))
      context.addIssue({
        code: "custom",
        path: ["scene", "contactConstraints", index, "constraintId"],
        message: "constraint IDs must be unique",
      });
    ids.add(constraint.constraintId);
    if (
      !characterIds.has(constraint.characterId) ||
      constraint.end > value.duration ||
      constraint.end <= constraint.start
    )
      context.addIssue({
        code: "custom",
        path: ["scene", "contactConstraints", index],
        message: "contact constraint must reference a character and fit the animation duration",
      });
    if (constraint.targetCharacterId != null && !characterIds.has(constraint.targetCharacterId))
      context.addIssue({
        code: "custom",
        path: ["scene", "contactConstraints", index, "targetCharacterId"],
        message: "contact target character must exist",
      });
  }
}

function validateCamera(value, context) {
  let previous = -1;
  for (const [index, frame] of value.scene.cameraTrack.keyframes.entries()) {
    const sameTimeCut =
      index > 0 && frame.transition === "cut" && Math.abs(frame.time - previous) <= 0.0001;
    if (
      frame.time < previous ||
      (!sameTimeCut && frame.time <= previous) ||
      frame.time > value.duration
    )
      context.addIssue({
        code: "custom",
        path: ["scene", "cameraTrack", "keyframes", index, "time"],
        message: "camera times must increase; only a cut may share the previous time",
      });
    previous = frame.time;
  }
  const frames = value.scene.cameraTrack.keyframes;
  if (
    Math.abs(frames[0]?.time || 0) > 0.0001 ||
    Math.abs((frames.at(-1)?.time || 0) - value.duration) > 0.0001
  )
    context.addIssue({
      code: "custom",
      path: ["scene", "cameraTrack", "keyframes"],
      message: "camera track must span the full animation",
    });
}

function validateTimeline(value, context) {
  const characterIds = new Set();
  const assetIds = new Set();
  for (const [characterIndex, character] of value.characters.entries()) {
    validateCharacterTimeline(value, character, characterIndex, context, characterIds, assetIds);
  }
  const colliders = validateColliders(value, characterIds, context);
  validateEvents(value, characterIds, colliders, context);
  validateConstraints(value, characterIds, context);
  validateCamera(value, context);
}

const fields = {
  format: z.literal("noobot.animation.protocol"),
  version: z.literal(4),
  duration: number.positive().max(3600),
  loop: z.boolean().default(false),
  scene: AnimationSceneSchema,
  characters: z.array(characterTimeline).min(1).max(32),
  events: z.array(AnimationEventSchema).max(1000),
};

const inputFields = {
  format: z.literal("noobot.animation.protocol"),
  version: z.literal(4),
  duration: number.positive().max(3600),
  loop: z.boolean().default(false),
  scene: AnimationSceneInputSchema,
  characters: z.array(characterTimelineInput).min(1).max(32),
  events: z.array(AnimationEventSchema).max(1000),
};
const animationProtocolInputFields = z
  .object({ ...inputFields, animationId: animationId.optional() })
  .strict();
const animationProtocolUpdateFields = z.object({ ...fields }).strict();
export const AnimationProtocolInputSchema = animationProtocolInputFields;
export const AnimationProtocolSchema = z
  .object({ ...fields, animationId })
  .strict()
  .superRefine(validateTimeline);
export const AnimationProtocolUpdateInputSchema =
  animationProtocolUpdateFields.superRefine(validateTimeline);
export const AnimationIdSchema = animationId;
export const AnimationAssetSchema = animationAsset;
export const AnimationTrackSchema = track;
export const AnimationRootTransformSchema = rootTransform;
export const AnimationAssetListSchema = z.array(animationAsset).min(1).max(32);
export const parseAnimationProtocol = (value) => AnimationProtocolSchema.parse(value);
export const safeParseAnimationProtocol = (value) => AnimationProtocolSchema.safeParse(value);
export const safeParseAnimationAssets = (value) => AnimationAssetListSchema.safeParse(value);

export const compileAnimationInput = createAnimationInputCompiler({
  parseInput: (value) => AnimationProtocolInputSchema.parse(value),
  parseProtocol: (value) => AnimationProtocolSchema.parse(value),
  compileRootMotion: compileCharacterRootMotion,
  compileCamera: compileCameraPlan,
});

export const validateAnimationArtifactData = createAnimationArtifactValidator({
  parseProtocol: safeParseAnimationProtocol,
  parseAssets: safeParseAnimationAssets,
});

export const compileAnimationScript = createSemanticActionCompiler({
  parseScript: (value) => AnimationScriptSchema.parse(value),
  parseProtocolInput: (value) => AnimationProtocolInputSchema.parse(value),
});
