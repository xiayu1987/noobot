/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendContextMessage } from "@noobot/context-protocol/mutation/context";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { createAnimationTools } from "../animation-tools.js";
import { CHARACTER_ANIMATION_TOOL_ID } from "../contract.js";

const contextHeading = "Character animation assets:";
const content = (message = {}) => String(message?.content ?? message?.lc_kwargs?.content ?? "");

export function injectAnimationContext(context = {}, config = {}) {
  const selectedIds = new Set(
    Array.isArray(config?.selectedCharacterAssetIds) ? config.selectedCharacterAssetIds : [],
  );
  const assets = Array.isArray(config?.characterAssets)
    ? config.characterAssets.filter((asset) => selectedIds.has(asset?.assetId))
    : [];
  const modelContext = context?.modelContext;
  if (!assets.length || !modelContext?.messageBlocks?.system) return false;
  if (
    modelContext.messageBlocks.system.some((message) => content(message).startsWith(contextHeading))
  )
    return false;
  const modelAssets = assets.map((asset) => ({
    assetId: asset.assetId,
    clips: asset.animations.map((animation) => animation.name),
    nodes: asset.nodes,
  }));
  appendContextMessage(
    modelContext,
    {
      role: "system",
      content: `${contextHeading} Use character_animation_generate; reuse animationId to extend, omit to create. Set each initialPosition; use only listed clips/nodes.\n${JSON.stringify(modelAssets)}`,
    },
    { block: "system" },
  );
  return true;
}

export function activate(host = {}, config = {}) {
  const registerHook = host?.hooks?.register;
  const registerTool = host?.tools?.register;
  const commitArtifact = host?.artifacts?.commit;
  if (
    typeof registerHook !== "function" ||
    typeof registerTool !== "function" ||
    typeof commitArtifact !== "function"
  )
    throw new Error(
      "character animation plugin requires hooks.register, tools.register and artifacts.commit",
    );
  const unregister = registerHook(
    HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    (context) => injectAnimationContext(context, config),
    {
      id: "character-animation-context-before-llm-call",
      priority: 30,
      timeoutMs: TIME_THRESHOLDS.agent.hookTimeoutMs,
    },
  );
  const contribution = registerTool(CHARACTER_ANIMATION_TOOL_ID, (toolContext) =>
    createAnimationTools({
      commitArtifact: (artifact) => commitArtifact(artifact, toolContext),
      pluginConfig: config,
    }).find((item) => item.name === CHARACTER_ANIMATION_TOOL_ID),
  );
  return createPluginActivationResult({
    pluginId: "character",
    surface: PLUGIN_SURFACE.AGENT,
    dispose: () => {
      unregister?.();
      contribution?.dispose?.();
    },
  });
}
