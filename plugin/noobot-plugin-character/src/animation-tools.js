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
  compileAnimationScript,
  hasSpatiallyReachableEvents,
  validateAnimationArtifactData,
} from "./animation-protocol.js";
import {
  CHARACTER_ANIMATION_ARTIFACT_TYPE,
  CHARACTER_ANIMATION_GET_TOOL_ID,
  CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
} from "./contract.js";

function validateAssetReferences(asset, character) {
  const allowedClips = new Set(
    (asset.animations || []).map((item) => String(item?.name || "").trim()),
  );
  const unknownClip = character.segments.find(
    (segment) => segment.type === "native_clip" && !allowedClips.has(segment.clip),
  )?.clip;
  if (unknownClip) return { code: "ANIMATION_CLIP_NOT_IN_ASSET", clip: unknownClip };
  const allowedNodes = new Set((asset.nodes || []).map((item) => String(item || "").trim()));
  const unknownNode = character.segments
    .filter((segment) => segment.type === "keyframes")
    .flatMap((segment) => segment.tracks)
    .find((track) => !allowedNodes.has(track.node))?.node;
  return unknownNode ? { code: "ANIMATION_NODE_NOT_IN_ASSET", node: unknownNode } : null;
}

function validateProtocolAssets(protocol, selectedAssets) {
  if (!hasSpatiallyReachableEvents(protocol)) {
    return { code: "ANIMATION_EVENT_UNREACHABLE" };
  }
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

function resultFor(receipt, protocol) {
  if (receipt?.committed === false) return JSON.stringify({ ok: false, ...receipt });
  return JSON.stringify({
    ok: true,
    eventId: receipt?.eventId,
    animationId: protocol.animationId,
    revision: receipt?.revision,
    characterAssetIds: protocol.characters.map((item) => item.assetId),
  });
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
  return [
    new DynamicStructuredTool({
      name: CHARACTER_ANIMATION_TOOL_ID,
      description:
        "Create a new character animation. Omit animationId to generate one; never append to an existing ID.",
      schema: z.object({ protocol: AnimationProtocolInputSchema }),
      func: async ({ protocol: input }) => {
        const selectedAssets = await resolveSelectedAssets();
        const protocol = AnimationProtocolSchema.parse({
          ...input,
          animationId: input.animationId || `animation.${crypto.randomUUID().replaceAll("-", "")}`,
        });
        const error = validateProtocolAssets(protocol, selectedAssets);
        if (error) return JSON.stringify({ ok: false, ...error });
        const artifactError = validateArtifact(protocol, selectedAssets);
        if (artifactError) return JSON.stringify({ ok: false, ...artifactError });
        return resultFor(await commit(protocol, selectedAssets), protocol);
      },
    }),
    new DynamicStructuredTool({
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
    }),
    new DynamicStructuredTool({
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
    }),
    new DynamicStructuredTool({
      name: CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
      description:
        "Create or replace an animation from a declarative sequence/parallel/event script. No code is executed.",
      schema: z
        .object({
          script: AnimationScriptSchema,
          animationId: AnimationIdSchema.optional(),
          baseRevision: z.number().int().positive().optional(),
        })
        .superRefine((value, context) => {
          if (value.baseRevision != null && !value.animationId) {
            context.addIssue({
              code: "custom",
              path: ["animationId"],
              message: "animationId is required with baseRevision",
            });
          }
        }),
      func: async ({ script, animationId, baseRevision }) => {
        const selectedAssets = await resolveSelectedAssets();
        const input = compileAnimationScript(script);
        const resolvedId = animationId || `animation.${crypto.randomUUID().replaceAll("-", "")}`;
        if (animationId && baseRevision == null) {
          return JSON.stringify({ ok: false, code: "ARTIFACT_BASE_REVISION_REQUIRED" });
        }
        const protocol = AnimationProtocolSchema.parse({ ...input, animationId: resolvedId });
        const error = validateProtocolAssets(protocol, selectedAssets);
        if (error) return JSON.stringify({ ok: false, ...error });
        const artifactError = validateArtifact(protocol, selectedAssets);
        if (artifactError) return JSON.stringify({ ok: false, ...artifactError });
        const receipt = animationId
          ? await update(protocol, baseRevision, selectedAssets)
          : await commit(protocol, selectedAssets);
        return resultFor(receipt, protocol);
      },
    }),
  ];
}
