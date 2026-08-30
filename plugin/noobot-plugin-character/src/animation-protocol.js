/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";

const number = z.number().finite();
const vec3 = z.array(number).length(3);
const quat = z.array(number).length(4);
const assetId = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/);
const assetResource = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.literal("model/gltf-binary"),
  size: z.number().int().positive(),
  url: z.string().regex(/^\/api\/internal\/character\/assets\/[A-Za-z0-9._~-]+\/[a-f0-9]{64}$/),
}).strict();
const animationAsset = z.object({
  assetId,
  name: z.string().trim().min(1).max(240),
  format: z.literal("glb"),
  size: z.number().int().positive(),
  animations: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    duration: number.nonnegative(),
    tracks: z.number().int().nonnegative(),
  }).strict()),
  nodes: z.array(z.string().trim().min(1).max(160)).max(500),
  importedAt: z.iso.datetime(),
  resource: assetResource,
}).strict().refine((value) => value.size === value.resource.size, {
  message: "asset and resource sizes must match",
});
const animationId = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/);
const keyframe = z.object({
  time: number.min(0),
  position: vec3.optional(),
  rotation: quat.optional(),
  scale: vec3.optional(),
}).strict();
const track = z.object({
  node: z.string().trim().min(1).max(160),
  property: z.enum(["position", "rotation", "scale"]),
  keyframes: z.array(keyframe).min(1).max(2000),
}).strict();
const segment = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("native_clip"),
    start: number.min(0),
    duration: number.positive().max(3600),
    clip: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    type: z.literal("keyframes"),
    start: number.min(0),
    duration: number.positive().max(3600),
    tracks: z.array(track).min(1).max(500),
  }).strict(),
]);
const characterTimeline = z.object({
  assetId,
  initialPosition: vec3,
  segments: z.array(segment).min(1).max(100),
}).strict();

function validateTimeline(value, context) {
  const assetIds = new Set();
  for (const [characterIndex, character] of value.characters.entries()) {
    if (assetIds.has(character.assetId)) {
      context.addIssue({ code: "custom", path: ["characters", characterIndex, "assetId"], message: "each character asset may appear only once" });
    }
    assetIds.add(character.assetId);
    let expectedStart = 0;
    for (const [segmentIndex, segmentValue] of character.segments.entries()) {
      const segmentPath = ["characters", characterIndex, "segments", segmentIndex];
      if (Math.abs(segmentValue.start - expectedStart) > 0.0001) {
        context.addIssue({ code: "custom", path: [...segmentPath, "start"], message: "segments must form one gap-free timeline starting at zero" });
      }
      if (segmentValue.type === "keyframes") {
        for (const [trackIndex, trackValue] of segmentValue.tracks.entries()) {
          let previous = -1;
          for (const [keyframeIndex, frame] of trackValue.keyframes.entries()) {
            const framePath = [...segmentPath, "tracks", trackIndex, "keyframes", keyframeIndex];
            if (frame.time <= previous || frame.time > segmentValue.duration) {
              context.addIssue({ code: "custom", path: [...framePath, "time"], message: "keyframe times must increase and stay within segment duration" });
            }
            if (!frame[trackValue.property]) {
              context.addIssue({ code: "custom", path: [...framePath, trackValue.property], message: `keyframe requires ${trackValue.property}` });
            }
            previous = frame.time;
          }
          if (Math.abs(trackValue.keyframes[0]?.time) > 0.0001) {
            context.addIssue({ code: "custom", path: [...segmentPath, "tracks", trackIndex, "keyframes", 0, "time"], message: "each keyframe track must start at zero" });
          }
          const finalIndex = trackValue.keyframes.length - 1;
          if (Math.abs(trackValue.keyframes[finalIndex]?.time - segmentValue.duration) > 0.0001) {
            context.addIssue({ code: "custom", path: [...segmentPath, "tracks", trackIndex, "keyframes", finalIndex, "time"], message: "each keyframe track must end at segment duration" });
          }
        }
      }
      expectedStart = segmentValue.start + segmentValue.duration;
    }
    if (Math.abs(expectedStart - value.duration) > 0.0001) {
      context.addIssue({ code: "custom", path: ["characters", characterIndex, "segments"], message: "each character timeline must equal the animation duration" });
    }
  }
}

const fields = {
  format: z.literal("noobot.animation.protocol"),
  version: z.literal(1),
  duration: number.positive().max(3600),
  loop: z.boolean().default(false),
  characters: z.array(characterTimeline).min(1).max(32),
};

export const AnimationProtocolInputSchema = z.object({ ...fields, animationId: animationId.optional() }).strict().superRefine(validateTimeline);
export const AnimationProtocolSchema = z.object({ ...fields, animationId }).strict().superRefine(validateTimeline);
export const AnimationAssetSchema = animationAsset;
export const AnimationAssetListSchema = z.array(animationAsset).min(1).max(32);
export const parseAnimationProtocol = (value) => AnimationProtocolSchema.parse(value);
export const safeParseAnimationProtocol = (value) => AnimationProtocolSchema.safeParse(value);
export const safeParseAnimationAssets = (value) => AnimationAssetListSchema.safeParse(value);

export function validateAnimationArtifactData(data = {}) {
  const protocol = safeParseAnimationProtocol(data?.protocol);
  const assets = safeParseAnimationAssets(data?.assets);
  if (!protocol.success || !assets.success) return false;
  const referenced = new Set(protocol.data.characters.map((character) => character.assetId));
  const described = new Set(assets.data.map((asset) => asset.assetId));
  return referenced.size === described.size && [...referenced].every((id) => described.has(id));
}
