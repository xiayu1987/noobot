/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AnimationProtocolInputSchema } from "./animation-protocol.js";
import {
  CHARACTER_ANIMATION_ARTIFACT_TYPE,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_PLUGIN_ID,
} from "./contract.js";

function selectedAnimationAssets(pluginConfig = {}) {
  const selectedIds = new Set(
    Array.isArray(pluginConfig?.selectedCharacterAssetIds)
      ? pluginConfig.selectedCharacterAssetIds.map((item) => String(item || "").trim())
      : [],
  );
  return Array.isArray(pluginConfig?.characterAssets)
    ? pluginConfig.characterAssets.filter((asset) => selectedIds.has(asset?.assetId))
    : [];
}

function validateAssetReferences(asset, character) {
  const allowedClips = new Set(
    Array.isArray(asset.animations)
      ? asset.animations.map((item) => String(item?.name || "").trim())
      : [],
  );
  const unknownClip = character.segments.find(
    (segment) => segment.type === "native_clip" && !allowedClips.has(segment.clip),
  )?.clip;
  if (unknownClip) return { code: "ANIMATION_CLIP_NOT_IN_ASSET", clip: unknownClip };

  const allowedNodes = new Set(
    Array.isArray(asset.nodes) ? asset.nodes.map((item) => String(item || "").trim()) : [],
  );
  const unknownNode = character.segments
    .filter((segment) => segment.type === "keyframes")
    .flatMap((segment) => segment.tracks)
    .find((track) => !allowedNodes.has(track.node))?.node;
  return unknownNode ? { code: "ANIMATION_NODE_NOT_IN_ASSET", node: unknownNode } : null;
}

async function commitAnimation(commitArtifact, protocol, assets) {
  if (typeof commitArtifact !== "function") throw new Error("artifacts.commit is required");
  return commitArtifact({
    artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
    artifactId: protocol.animationId,
    data: { protocol, assets },
  });
}

export function createAnimationTools({ commitArtifact, pluginConfig = {} } = {}) {
  const selectedAssets = selectedAnimationAssets(pluginConfig);
  return [
    new DynamicStructuredTool({
      name: CHARACTER_ANIMATION_TOOL_ID,
      description:
        "Create or extend a character animation. Reuse animationId to extend; omit it to create. Include selected characters, initialPosition, and a continuous timeline. Use listed clips or nodes only.",
      schema: z.object({ protocol: AnimationProtocolInputSchema }),
      func: async ({ protocol: input }) => {
        const protocol = {
          ...input,
          animationId:
            input.animationId || `animation.${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
        };
        for (const character of protocol.characters) {
          const asset = selectedAssets.find((item) => item?.assetId === character.assetId);
          if (!asset) {
            return JSON.stringify({
              ok: false,
              code: "ANIMATION_ASSET_NOT_SELECTED",
              assetId: character.assetId,
            });
          }
          const referenceError = validateAssetReferences(asset, character);
          if (referenceError) {
            return JSON.stringify({ ok: false, assetId: character.assetId, ...referenceError });
          }
        }
        const assets = protocol.characters.map((character) =>
          selectedAssets.find((item) => item?.assetId === character.assetId),
        );
        const envelope = await commitAnimation(commitArtifact, protocol, assets);
        return JSON.stringify({
          ok: true,
          eventId: envelope.identity.eventId,
          animationId: protocol.animationId,
          characterAssetIds: protocol.characters.map((character) => character.assetId),
        });
      },
    }),
  ];
}
