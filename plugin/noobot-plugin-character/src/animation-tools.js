/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import vm from "node:vm";
import { AnimationProtocolInputSchema, AnimationProtocolSchema } from "./animation-protocol.js";
import {
  CHARACTER_ANIMATION_ARTIFACT_TYPE,
  CHARACTER_ANIMATION_GET_TOOL_ID,
  CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
} from "./contract.js";

function selectedAnimationAssets(pluginConfig = {}) {
  const selectedIds = new Set(Array.isArray(pluginConfig?.selectedCharacterAssetIds)
    ? pluginConfig.selectedCharacterAssetIds.map((item) => String(item || "").trim()) : []);
  return Array.isArray(pluginConfig?.characterAssets)
    ? pluginConfig.characterAssets.filter((asset) => selectedIds.has(asset?.assetId)) : [];
}

function validateAssetReferences(asset, character) {
  const allowedClips = new Set((asset.animations || []).map((item) => String(item?.name || "").trim()));
  const unknownClip = character.segments.find((segment) =>
    segment.type === "native_clip" && !allowedClips.has(segment.clip))?.clip;
  if (unknownClip) return { code: "ANIMATION_CLIP_NOT_IN_ASSET", clip: unknownClip };
  const allowedNodes = new Set((asset.nodes || []).map((item) => String(item || "").trim()));
  const unknownNode = character.segments.filter((segment) => segment.type === "keyframes")
    .flatMap((segment) => segment.tracks).find((track) => !allowedNodes.has(track.node))?.node;
  return unknownNode ? { code: "ANIMATION_NODE_NOT_IN_ASSET", node: unknownNode } : null;
}

function validateProtocolAssets(protocol, selectedAssets) {
  for (const character of protocol.characters) {
    const asset = selectedAssets.find((item) => item?.assetId === character.assetId);
    if (!asset) return { code: "ANIMATION_ASSET_NOT_SELECTED", assetId: character.assetId };
    const error = validateAssetReferences(asset, character);
    if (error) return { code: error.code, assetId: character.assetId, ...error };
  }
  return null;
}

function assetsFor(protocol, selectedAssets) {
  return protocol.characters.map((character) => selectedAssets.find((asset) => asset.assetId === character.assetId));
}

function resultFor(envelope, protocol, revision = undefined) {
  return JSON.stringify({ ok: true, eventId: envelope?.identity?.eventId, animationId: protocol.animationId,
    ...(revision == null ? {} : { revision }), characterAssetIds: protocol.characters.map((item) => item.assetId) });
}

function createScriptProtocol(source) {
  const text = String(source || "").trim();
  if (!text || text.length > 100000) throw new Error("animation script is empty or too large");
  if (/(?:process|require|import|export|globalThis|constructor|__proto__|prototype|eval|Function|fetch|XMLHttpRequest|WebSocket|document|window)/.test(text)) {
    throw new Error("animation script contains a forbidden capability");
  }
  const context = vm.createContext(Object.freeze({ Math, JSON }));
  const value = new vm.Script(`(function () { "use strict"; return (${text}); })()`, {
    filename: "character-animation.script",
  }).runInContext(context, { timeout: 1000 });
  return AnimationProtocolInputSchema.parse(value);
}

export function createAnimationTools({ commitArtifact, getArtifact, replaceArtifact, pluginConfig = {} } = {}) {
  const selectedAssets = selectedAnimationAssets(pluginConfig);
  const commit = async (protocol) => {
    const assets = assetsFor(protocol, selectedAssets);
    return commitArtifact({ artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE, artifactId: protocol.animationId,
      operation: "created", data: { protocol, assets } });
  };
  const update = async (protocol, baseRevision) => {
    const assets = assetsFor(protocol, selectedAssets);
    return replaceArtifact({ artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE, artifactId: protocol.animationId,
      baseRevision, data: { protocol, assets } });
  };
  return [
    new DynamicStructuredTool({
      name: CHARACTER_ANIMATION_TOOL_ID,
      description: "Create a new character animation. Omit animationId to generate one; never append to an existing ID.",
      schema: z.object({ protocol: AnimationProtocolInputSchema }),
      func: async ({ protocol: input }) => {
        const protocol = { ...input, animationId: input.animationId || `animation.${crypto.randomUUID().replaceAll("-", "")}` };
        const error = validateProtocolAssets(protocol, selectedAssets);
        if (error) return JSON.stringify({ ok: false, ...error });
        return resultFor(await commit(protocol), protocol, 1);
      },
    }),
    new DynamicStructuredTool({
      name: CHARACTER_ANIMATION_GET_TOOL_ID,
      description: "Read the authoritative current animation by animationId before modifying it.",
      schema: z.object({ animationId: z.string().trim().min(1) }),
      func: async ({ animationId }) => JSON.stringify(await getArtifact({ artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE, artifactId: animationId })),
    }),
    new DynamicStructuredTool({
      name: CHARACTER_ANIMATION_UPDATE_TOOL_ID,
      description: "Replace the current animation for an existing animationId. Call character_animation_get first and provide its revision.",
      schema: z.object({ animationId: z.string().trim().min(1), baseRevision: z.number().int().positive(), protocol: AnimationProtocolInputSchema }),
      func: async ({ animationId, baseRevision, protocol: input }) => {
        const protocol = { ...input, animationId };
        const error = validateProtocolAssets(protocol, selectedAssets);
        if (error) return JSON.stringify({ ok: false, ...error });
        const committed = await update(protocol, baseRevision);
        return committed?.committed === false ? JSON.stringify(committed) : resultFor(committed, protocol, baseRevision + 1);
      },
    }),
    new DynamicStructuredTool({
      name: CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
      description: "Create or replace an animation from a restricted JavaScript expression returning one animation protocol. No host APIs are available.",
      schema: z.object({ script: z.string().min(1).max(100000), animationId: z.string().trim().min(1).optional(), baseRevision: z.number().int().positive().optional() }),
      func: async ({ script, animationId, baseRevision }) => {
        const input = createScriptProtocol(script);
        const protocol = { ...input, ...(animationId ? { animationId } : {}), animationId: animationId || input.animationId || `animation.${crypto.randomUUID().replaceAll("-", "")}` };
        const error = validateProtocolAssets(protocol, selectedAssets);
        if (error) return JSON.stringify({ ok: false, ...error });
        if (animationId) {
          if (baseRevision == null) return JSON.stringify({ ok: false, code: "ANIMATION_BASE_REVISION_REQUIRED" });
          const committed = await update(protocol, baseRevision);
          return committed?.committed === false ? JSON.stringify(committed) : resultFor(committed, protocol, baseRevision + 1);
        }
        return resultFor(await commit(protocol), protocol, 1);
      },
    }),
  ];
}
