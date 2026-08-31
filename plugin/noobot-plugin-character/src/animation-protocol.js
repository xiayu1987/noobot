/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";

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
    normalization: z
      .object({ targetHeight: number.positive(), scale: number.positive(), floorOffset: number })
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
const rootMotion = z.object({ keyframes: z.array(rootMotionKeyframe).min(2).max(200) }).strict();
const segment = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("native_clip"),
      start: number.min(0),
      duration: number.positive().max(3600),
      clip: z.string().trim().min(1).max(160),
      rootMotion: rootMotion.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("keyframes"),
      start: number.min(0),
      duration: number.positive().max(3600),
      tracks: z.array(track).min(1).max(500),
      rootMotion: rootMotion.optional(),
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
export const AnimationCharacterDeclarationSchema = z
  .object({
    characterId: protocolId,
    assetId,
    rootTransform,
  })
  .strict();
const characterTimeline = z
  .object({
    ...AnimationCharacterDeclarationSchema.shape,
    segments: z.array(segment).min(1).max(100),
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
  })
  .strict();
export const AnimationSceneSchema = z
  .object({
    coordinateSystem: z.literal("normalized_world"),
    unitHeight: z.literal(1),
    groundY: number,
    collisionSpace: z
      .object({
        units: z.literal("normalized_world"),
        origin: vec3,
        detection: z.enum(["continuous", "events_only"]),
        colliders: z.array(collider).max(256),
      })
      .strict(),
    cameraTrack: z
      .object({
        type: z.literal("keyframes"),
        keyframes: z.array(cameraKeyframe).min(2).max(1000),
      })
      .strict(),
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

function characterPositionAt(character, time) {
  const segment = character.segments.find(
    (item) => item.rootMotion && time >= item.start && time <= item.start + item.duration,
  );
  if (!segment) return character.rootTransform.position;
  const frames = segment.rootMotion.keyframes;
  const localTime = Math.min(segment.duration, Math.max(0, time - segment.start));
  let left = frames[0];
  let right = frames.at(-1);
  for (let index = 1; index < frames.length; index += 1) {
    if (localTime <= frames[index].time) {
      left = frames[index - 1];
      right = frames[index];
      break;
    }
  }
  const span = Math.max(0.000001, right.time - left.time);
  const amount = Math.min(1, Math.max(0, (localTime - left.time) / span));
  return left.position.map((value, index) => value + (right.position[index] - value) * amount);
}

function colliderRadius(shape) {
  if (shape.type === "sphere") return shape.radius;
  return Math.hypot(shape.size[0], shape.size[2]) / 2;
}

function colliderWorldCenter(collider, character, time) {
  const position = characterPositionAt(character, time);
  return position.map((value, index) => value + collider.shape.center[index]);
}

function collidersCanContact(source, target, characters, time) {
  const sourceCharacter = characters.get(source.characterId);
  const targetCharacter = characters.get(target.characterId);
  if (!sourceCharacter || !targetCharacter) return false;
  const sourceCenter = colliderWorldCenter(source, sourceCharacter, time);
  const targetCenter = colliderWorldCenter(target, targetCharacter, time);
  const distance = Math.hypot(sourceCenter[0] - targetCenter[0], sourceCenter[2] - targetCenter[2]);
  return distance <= colliderRadius(source.shape) + colliderRadius(target.shape) + 0.05;
}

const scriptClip = z
  .object({
    type: z.literal("clip"),
    characterId: protocolId,
    clip: z.string().trim().min(1).max(160),
    duration: number.positive().max(3600),
    rootMotion: rootMotion.optional(),
  })
  .strict();
const scriptKeyframes = z
  .object({
    type: z.literal("keyframes"),
    characterId: protocolId,
    duration: number.positive().max(3600),
    tracks: z.array(track).min(1).max(500),
    rootMotion: rootMotion.optional(),
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
    scene: AnimationSceneSchema,
    characters: z.array(AnimationCharacterDeclarationSchema).min(1).max(32),
    root: scriptNodeSchema,
  })
  .strict();

function validateTimeline(value, context) {
  const characterIds = new Set();
  const assetIds = new Set();
  for (const [characterIndex, character] of value.characters.entries()) {
    if (characterIds.has(character.characterId)) {
      context.addIssue({
        code: "custom",
        path: ["characters", characterIndex, "characterId"],
        message: "character IDs must be unique",
      });
    }
    characterIds.add(character.characterId);
    if (assetIds.has(character.assetId)) {
      context.addIssue({
        code: "custom",
        path: ["characters", characterIndex, "assetId"],
        message: "each asset may appear only once",
      });
    }
    assetIds.add(character.assetId);
    let expectedStart = 0;
    for (const [segmentIndex, segmentValue] of character.segments.entries()) {
      const segmentPath = ["characters", characterIndex, "segments", segmentIndex];
      if (Math.abs(segmentValue.start - expectedStart) > 0.0001) {
        context.addIssue({
          code: "custom",
          path: [...segmentPath, "start"],
          message: "segments must form one gap-free timeline starting at zero",
        });
      }
      if (segmentValue.type === "keyframes") {
        for (const [trackIndex, trackValue] of segmentValue.tracks.entries()) {
          let previous = -1;
          for (const [keyframeIndex, frame] of trackValue.keyframes.entries()) {
            const framePath = [...segmentPath, "tracks", trackIndex, "keyframes", keyframeIndex];
            if (frame.time <= previous || frame.time > segmentValue.duration) {
              context.addIssue({
                code: "custom",
                path: [...framePath, "time"],
                message: "keyframe times must increase and stay within segment duration",
              });
            }
            if (!frame[trackValue.property]) {
              context.addIssue({
                code: "custom",
                path: [...framePath, trackValue.property],
                message: `keyframe requires ${trackValue.property}`,
              });
            }
            previous = frame.time;
          }
          if (Math.abs(trackValue.keyframes[0]?.time) > 0.0001) {
            context.addIssue({
              code: "custom",
              path: [...segmentPath, "tracks", trackIndex, "keyframes", 0, "time"],
              message: "each keyframe track must start at zero",
            });
          }
          const finalIndex = trackValue.keyframes.length - 1;
          if (Math.abs(trackValue.keyframes[finalIndex]?.time - segmentValue.duration) > 0.0001) {
            context.addIssue({
              code: "custom",
              path: [...segmentPath, "tracks", trackIndex, "keyframes", finalIndex, "time"],
              message: "each keyframe track must end at segment duration",
            });
          }
        }
      }
      if (segmentValue.rootMotion) {
        let previousMotionTime = -1;
        for (const [keyframeIndex, frame] of segmentValue.rootMotion.keyframes.entries()) {
          if (frame.time <= previousMotionTime || frame.time > segmentValue.duration) {
            context.addIssue({
              code: "custom",
              path: [...segmentPath, "rootMotion", "keyframes", keyframeIndex, "time"],
              message: "root motion times must increase and stay within segment duration",
            });
          }
          previousMotionTime = frame.time;
        }
        const motionFrames = segmentValue.rootMotion.keyframes;
        if (Math.abs(motionFrames[0]?.time || 0) > 0.0001) {
          context.addIssue({
            code: "custom",
            path: [...segmentPath, "rootMotion", "keyframes", 0, "time"],
            message: "root motion must start at segment time zero",
          });
        }
        if (Math.abs((motionFrames.at(-1)?.time || 0) - segmentValue.duration) > 0.0001) {
          context.addIssue({
            code: "custom",
            path: [...segmentPath, "rootMotion", "keyframes"],
            message: "root motion must end at segment duration",
          });
        }
      }
      expectedStart = segmentValue.start + segmentValue.duration;
    }
    if (Math.abs(expectedStart - value.duration) > 0.0001) {
      context.addIssue({
        code: "custom",
        path: ["characters", characterIndex, "segments"],
        message: "each character timeline must equal the animation duration",
      });
    }
  }
  const colliders = new Map();
  const characters = new Map(
    value.characters.map((character) => [character.characterId, character]),
  );
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
      ) {
        context.addIssue({
          code: "custom",
          path: ["events", index],
          message: "attack must reference its characters, hitbox and hurtbox",
        });
      }
    }
    if (event.type === "contact") {
      if (
        event.sourceColliderId === event.targetColliderId ||
        !colliders.has(event.sourceColliderId) ||
        !colliders.has(event.targetColliderId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["events", index],
          message: "contact colliders must exist",
        });
      }
    }
  }
  let previousCameraTime = -1;
  for (const [index, frame] of value.scene.cameraTrack.keyframes.entries()) {
    if (frame.time <= previousCameraTime || frame.time > value.duration)
      context.addIssue({
        code: "custom",
        path: ["scene", "cameraTrack", "keyframes", index, "time"],
        message: "camera times must increase within animation duration",
      });
    previousCameraTime = frame.time;
  }
  const cameraFrames = value.scene.cameraTrack.keyframes;
  if (
    Math.abs(cameraFrames[0]?.time || 0) > 0.0001 ||
    Math.abs((cameraFrames.at(-1)?.time || 0) - value.duration) > 0.0001
  ) {
    context.addIssue({
      code: "custom",
      path: ["scene", "cameraTrack", "keyframes"],
      message: "camera track must span the full animation",
    });
  }
}

export function hasSpatiallyReachableEvents(value) {
  const characters = new Map(
    value.characters.map((character) => [character.characterId, character]),
  );
  const colliders = new Map(
    value.scene.collisionSpace.colliders.map((collider) => [collider.colliderId, collider]),
  );
  return value.events.every((event) => {
    if (event.type === "attack") {
      return collidersCanContact(
        colliders.get(event.hitboxId),
        colliders.get(event.hurtboxId),
        characters,
        event.time,
      );
    }
    if (event.type === "contact") {
      return collidersCanContact(
        colliders.get(event.sourceColliderId),
        colliders.get(event.targetColliderId),
        characters,
        event.time,
      );
    }
    return true;
  });
}

const fields = {
  format: z.literal("noobot.animation.protocol"),
  version: z.literal(2),
  duration: number.positive().max(3600),
  loop: z.boolean().default(false),
  scene: AnimationSceneSchema,
  characters: z.array(characterTimeline).min(1).max(32),
  events: z.array(AnimationEventSchema).max(1000),
};

const animationProtocolInputFields = z
  .object({ ...fields, animationId: animationId.optional() })
  .strict();
const animationProtocolUpdateFields = z.object({ ...fields }).strict();
export const AnimationProtocolInputSchema =
  animationProtocolInputFields.superRefine(validateTimeline);
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

export function validateAnimationArtifactData(data = {}) {
  const protocol = safeParseAnimationProtocol(data?.protocol);
  const assets = safeParseAnimationAssets(data?.assets);
  if (!protocol.success || !assets.success) return false;
  const referenced = new Set(protocol.data.characters.map((character) => character.assetId));
  const described = new Set();
  for (const asset of assets.data) {
    if (described.has(asset.assetId)) return false;
    described.add(asset.assetId);
  }
  if (referenced.size !== described.size || ![...referenced].every((id) => described.has(id)))
    return false;
  const assetNodes = new Map(assets.data.map((asset) => [asset.assetId, new Set(asset.nodes)]));
  return protocol.data.scene.collisionSpace.colliders.every(
    (collider) =>
      collider.node === null ||
      assetNodes
        .get(
          protocol.data.characters.find(
            (character) => character.characterId === collider.characterId,
          )?.assetId,
        )
        ?.has(collider.node),
  );
}

function mergeCharacterSegment(map, characterId, segment) {
  const entry = map.get(characterId);
  if (!entry) throw new TypeError(`animation script references unknown character: ${characterId}`);
  entry.push(segment);
}

function compileScriptNode(node, start, segmentMap, events) {
  if (node.type === "clip") {
    mergeCharacterSegment(segmentMap, node.characterId, {
      type: "native_clip",
      start,
      duration: node.duration,
      clip: node.clip,
      ...(node.rootMotion ? { rootMotion: node.rootMotion } : {}),
    });
    return node.duration;
  }
  if (node.type === "keyframes") {
    mergeCharacterSegment(segmentMap, node.characterId, {
      type: "keyframes",
      start,
      duration: node.duration,
      tracks: node.tracks,
      ...(node.rootMotion ? { rootMotion: node.rootMotion } : {}),
    });
    return node.duration;
  }
  if (node.type === "event") {
    events.push({ ...node.event, time: start });
    return 0;
  }
  if (node.type === "parallel") {
    return Math.max(
      ...node.steps.map((step) => compileScriptNode(step, start, segmentMap, events)),
    );
  }
  let duration = 0;
  for (const step of node.steps)
    duration += compileScriptNode(step, start + duration, segmentMap, events);
  return duration;
}

export function compileAnimationScript(value) {
  const script = AnimationScriptSchema.parse(value);
  const segmentMap = new Map(script.characters.map((item) => [item.characterId, []]));
  const events = [];
  const duration = compileScriptNode(script.root, 0, segmentMap, events);
  if (!(duration > 0)) throw new TypeError("animation script duration must be positive");
  for (const character of script.characters) {
    const segments = segmentMap.get(character.characterId);
    if (
      !segments.length ||
      Math.abs(segments.at(-1).start + segments.at(-1).duration - duration) > 0.0001
    ) {
      throw new TypeError(
        `animation script does not span full duration for character: ${character.characterId}`,
      );
    }
  }
  return AnimationProtocolInputSchema.parse({
    format: "noobot.animation.protocol",
    version: 2,
    duration,
    loop: script.loop,
    scene: script.scene,
    characters: script.characters.map((item) => ({
      ...item,
      segments: segmentMap.get(item.characterId),
    })),
    events,
  });
}
