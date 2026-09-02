/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  AnimationIdSchema,
  AnimationProtocolInputSchema,
  AnimationProtocolSchema,
  AnimationProtocolUpdateInputSchema,
  AnimationScriptSchema,
  compileAnimationInput,
  compileAnimationScript,
  analyzeAnimationSpatial,
  hasSpatiallyReachableEvents,
  validateAnimationArtifactData,
} from "./animation-protocol.js";
import { CameraPresetInvocationSchema } from "../camera-presets/schema.js";
import { compileCameraPlan, listCameraPresets } from "./camera-preset-compiler.js";
import {
  CHARACTER_ANIMATION_CAMERA_APPLY_TOOL_ID,
  CHARACTER_ANIMATION_ARTIFACT_TYPE,
  CHARACTER_ANIMATION_GET_TOOL_ID,
  CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
  CHARACTER_CAMERA_PRESET_LIST_TOOL_ID,
} from "./contract.js";

function validateAssetReferences(asset, character) {
  const allowedClips = new Set(
    (asset.animations || []).map((item) => String(item?.name || "").trim()),
  );
  const unknownClip = character.segments.find(
    (segment) => segment.type === "native_clip" && !allowedClips.has(segment.clip),
  )?.clip;
  if (unknownClip)
    return {
      code: "ANIMATION_CLIP_NOT_IN_ASSET",
      clip: unknownClip,
      availableClips: [...allowedClips],
    };
  const allowedNodes = new Set((asset.nodes || []).map((item) => String(item || "").trim()));
  const unknownNode = character.segments
    .filter((segment) => segment.type === "keyframes")
    .flatMap((segment) => segment.tracks)
    .find((track) => !allowedNodes.has(track.node))?.node;
  return unknownNode
    ? { code: "ANIMATION_NODE_NOT_IN_ASSET", node: unknownNode, availableNodes: [...allowedNodes] }
    : null;
}

function validateProtocolAssets(protocol, selectedAssets) {
  if (!hasSpatiallyReachableEvents(protocol)) {
    return { code: "ANIMATION_EVENT_UNREACHABLE" };
  }
  const collisionError = validateSolidCollisions(protocol);
  if (collisionError) return collisionError;
  const characters = new Map(
    protocol.characters.map((character) => [character.characterId, character]),
  );
  for (const character of protocol.characters) {
    const asset = selectedAssets.find((item) => item?.assetId === character.assetId);
    if (!asset) return { code: "ANIMATION_ASSET_NOT_SELECTED", assetId: character.assetId };
    const error = validateAssetReferences(asset, character);
    if (error) return { code: error.code, assetId: character.assetId, ...error };
  }
  for (const collider of protocol.scene.collisionSpace.colliders) {
    const character = characters.get(collider.characterId);
    const asset = selectedAssets.find((item) => item?.assetId === character?.assetId);
    if (collider.node !== null && !asset?.nodes?.includes(collider.node)) {
      return {
        code: "ANIMATION_COLLIDER_NODE_NOT_IN_ASSET",
        assetId: character?.assetId,
        node: collider.node,
      };
    }
  }
  return null;
}

function validateSolidCollisions(protocol, spatialOptions = {}) {
  const spatial = analyzeAnimationSpatial(protocol, spatialOptions);
  const solidColliders = new Set(
    protocol.scene.collisionSpace.colliders
      .filter((collider) => collider.role === "solid")
      .map((collider) => collider.colliderId),
  );
  const penetration = spatial.penetrationIntervals.find(
    (interval) =>
      solidColliders.has(interval.sourceColliderId) &&
      solidColliders.has(interval.targetColliderId),
  );
  return penetration ? { code: "ANIMATION_COLLISION", ...penetration } : null;
}

function assetsFor(protocol, selectedAssets) {
  return protocol.characters.map((character) =>
    selectedAssets.find((asset) => asset.assetId === character.assetId),
  );
}

function validateArtifact(protocol, selectedAssets) {
  const assets = assetsFor(protocol, selectedAssets);
  if (!validateAnimationArtifactData({ protocol, assets })) {
    return { code: "ANIMATION_ARTIFACT_INVALID" };
  }
  return null;
}

const AnimationScriptToolInputSchema = z
  .object({
    script: AnimationScriptSchema,
    animationId: AnimationIdSchema.optional(),
    baseRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.baseRevision != null && !value.animationId) {
      context.addIssue({
        code: "custom",
        path: ["animationId"],
        message: "animationId is required with baseRevision",
      });
    }
  });

function resultFor(receipt, protocol) {
  if (receipt?.committed === false) return JSON.stringify({ ok: false, ...receipt });
  return JSON.stringify({
    ok: true,
    eventId: receipt?.eventId,
    animationId: protocol.animationId,
    revision: receipt?.revision,
    characterAssetIds: protocol.characters.map((item) => item.assetId),
    diagnostics: analyzeAnimationSpatial(protocol),
  });
}

function createCameraTools({ getArtifact, commitArtifact }) {
  const cameraListTool = new DynamicStructuredTool({
    name: CHARACTER_CAMERA_PRESET_LIST_TOOL_ID,
    description: "List authoritative built-in camera preset IDs.",
    schema: z.object({}),
    func: async () => JSON.stringify({ ok: true, presets: listCameraPresets() }),
  });
  const cameraApplyTool = new DynamicStructuredTool({
    name: CHARACTER_ANIMATION_CAMERA_APPLY_TOOL_ID,
    description:
      "Replace one authoritative animation's camera track with a built-in preset at an explicit revision.",
    schema: z.object({
      animationId: AnimationIdSchema,
      baseRevision: z.number().int().positive(),
      ...CameraPresetInvocationSchema.shape,
    }),
    func: async ({ animationId, baseRevision, presetId, subjectIds }) => {
      const current = await getArtifact({
        artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
        artifactId: animationId,
      });
      if (!current?.found || !current.artifact) {
        return JSON.stringify({ ok: false, code: "ANIMATION_NOT_FOUND", animationId });
      }
      if (current.revision !== baseRevision) {
        return JSON.stringify({
          ok: false,
          code: "ARTIFACT_REVISION_CONFLICT",
          currentRevision: current.revision,
        });
      }
      const source = current.artifact.protocol;
      const assets = current.artifact.assets;
      const protocol = AnimationProtocolSchema.parse({
        ...source,
        scene: {
          ...source.scene,
          cameraTrack: compileCameraPlan({
            camera: { presetId, ...(subjectIds ? { subjectIds } : {}) },
            duration: source.duration,
            characters: source.characters,
            assets,
            groundY: source.scene.groundY,
          }),
        },
      });
      if (!validateAnimationArtifactData({ protocol, assets })) {
        return JSON.stringify({ ok: false, code: "ANIMATION_ARTIFACT_INVALID" });
      }
      const receipt = await commitArtifact({
        artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
        artifactId: animationId,
        operation: "replaced",
        baseRevision,
        data: { protocol, assets },
      });
      return resultFor(receipt, protocol);
    },
  });
  return [cameraListTool, cameraApplyTool];
}

export function createAnimationTools({ commitArtifact, getArtifact, resolveSelectedAssets } = {}) {
  if (typeof resolveSelectedAssets !== "function") {
    throw new TypeError("character animation tools require an asset catalog resolver");
  }
  const commit = async (protocol, selectedAssets) => {
    const assets = assetsFor(protocol, selectedAssets);
    return commitArtifact({
      artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
      artifactId: protocol.animationId,
      operation: "created",
      data: { protocol, assets },
    });
  };
  const update = async (protocol, baseRevision, selectedAssets) => {
    const assets = assetsFor(protocol, selectedAssets);
    return commitArtifact({
      artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
      artifactId: protocol.animationId,
      operation: "replaced",
      baseRevision,
      data: { protocol, assets },
    });
  };
  const createTool = new DynamicStructuredTool({
    name: CHARACTER_ANIMATION_TOOL_ID,
    description:
      "Create a new v4 character animation. Root motion input is character_local and is compiled to absolute normalized_world tracks. Use orientationMode face_motion for walking/running, authored for backing/side-steps, and explicit opposite yaw rotations when characters face each other: left facing +X [0,-0.7071068,0,0.7071068], right facing -X [0,0.7071068,0,0.7071068]. Omit animationId to generate one; never append to an existing ID.",
    schema: z.object({ protocol: AnimationProtocolInputSchema }),
    func: async ({ protocol: input }) => {
      const selectedAssets = await resolveSelectedAssets();
      const protocol = compileAnimationInput(
        {
          ...input,
          animationId: input.animationId || `animation.${crypto.randomUUID().replaceAll("-", "")}`,
        },
        { assets: selectedAssets },
      );
      const error = validateProtocolAssets(protocol, selectedAssets);
      if (error) return JSON.stringify({ ok: false, ...error });
      const artifactError = validateArtifact(protocol, selectedAssets);
      if (artifactError) return JSON.stringify({ ok: false, ...artifactError });
      return resultFor(await commit(protocol, selectedAssets), protocol);
    },
  });
  const getTool = new DynamicStructuredTool({
    name: CHARACTER_ANIMATION_GET_TOOL_ID,
    description: "Read the authoritative current animation by animationId before modifying it.",
    schema: z.object({ animationId: AnimationIdSchema }),
    func: async ({ animationId }) =>
      JSON.stringify(
        await getArtifact({
          artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
          artifactId: animationId,
        }),
      ),
  });
  const updateTool = new DynamicStructuredTool({
    name: CHARACTER_ANIMATION_UPDATE_TOOL_ID,
    description:
      "Replace the current animation for an existing animationId. Call character_animation_get first and provide its revision.",
    schema: z.object({
      animationId: AnimationIdSchema,
      baseRevision: z.number().int().positive(),
      protocol: AnimationProtocolUpdateInputSchema,
    }),
    func: async ({ animationId, baseRevision, protocol: input }) => {
      const selectedAssets = await resolveSelectedAssets();
      const protocol = AnimationProtocolSchema.parse({ ...input, animationId });
      const error = validateProtocolAssets(protocol, selectedAssets);
      if (error) return JSON.stringify({ ok: false, ...error });
      const artifactError = validateArtifact(protocol, selectedAssets);
      if (artifactError) return JSON.stringify({ ok: false, ...artifactError });
      const committed = await update(protocol, baseRevision, selectedAssets);
      return resultFor(committed, protocol);
    },
  });
  const scriptTool = new DynamicStructuredTool({
    name: CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
    description:
      'Create or replace one v4 character animation from declarative sequence/parallel/event data. Prefer semantic nodes: move {type:"move", characterId, mode:"walk"|"run"|"crawl"|"jump"|"hop"|"drop"|"detour"|"step_over"|"jump_over"|"vault"|"climb_over", clip, target:[x,y,z], duration?, obstacleId?, clearance?}; orient face {type:"orient", characterId, mode:"face", clip, target:[x,y,z], duration?}; orient turn {type:"orient", characterId, mode:"turn", clip, angle, duration?}; posture {type:"posture", characterId, mode:"idle"|"stop"|"crouch"|"kneel"|"sit"|"lie"|"stand_up", clip, duration}; program an exact animation channel with {type:"channel", characterId, channelId, duration, tracks:[{node, property:"position"|"rotation"|"scale", keyframes:[{time,...}]}], rootMotion?}. Channel keyframes are authoritative and are compiled into the same v4 timeline; no code is executed. target is world-space; start comes from rootTransform or the previous node endpoint. Obstacle modes require a solid box collider ID. Arguments are {script, animationId?, baseRevision?}; for existing animations call character_animation_get first. The compiler expands semantic nodes into authoritative v4 rootMotion.',
    schema: AnimationScriptToolInputSchema,
    func: async ({ script, animationId, baseRevision }) => {
      const selectedAssets = await resolveSelectedAssets();
      let input;
      try {
        input = compileAnimationScript(script);
      } catch (error) {
        return JSON.stringify({
          ok: false,
          code: "ANIMATION_SCRIPT_INVALID",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const resolvedId = animationId || `animation.${crypto.randomUUID().replaceAll("-", "")}`;
      if (animationId && baseRevision == null) {
        return JSON.stringify({
          ok: false,
          code: "ARTIFACT_BASE_REVISION_REQUIRED",
          message:
            "For a new animation omit animationId; for an existing animation call character_animation_get first and provide its positive revision.",
        });
      }
      let protocol;
      try {
        protocol = compileAnimationInput(
          { ...input, animationId: resolvedId },
          { assets: selectedAssets },
        );
      } catch (error) {
        return JSON.stringify({
          ok: false,
          code: "ANIMATION_SCRIPT_INVALID",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const error = validateProtocolAssets(protocol, selectedAssets);
      if (error) return JSON.stringify({ ok: false, ...error });
      const artifactError = validateArtifact(protocol, selectedAssets);
      if (artifactError) return JSON.stringify({ ok: false, ...artifactError });
      const receipt = animationId
        ? await update(protocol, baseRevision, selectedAssets)
        : await commit(protocol, selectedAssets);
      return resultFor(receipt, protocol);
    },
  });
  return [
    createTool,
    getTool,
    updateTool,
    scriptTool,
    ...createCameraTools({ getArtifact, commitArtifact }),
  ];
}
