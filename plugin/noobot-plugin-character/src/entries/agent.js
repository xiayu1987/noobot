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
import {
  CHARACTER_ANIMATION_GET_TOOL_ID,
  CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
} from "../contract.js";

const contextHeading = "Character animation assets:";
const content = (message = {}) => String(message?.content ?? message?.lc_kwargs?.content ?? "");

export function injectAnimationContext(context = {}, config = {}) {
  const selectedIds = new Set(Array.isArray(config?.selectedCharacterAssetIds) ? config.selectedCharacterAssetIds : []);
  const assets = Array.isArray(config?.characterAssets)
    ? config.characterAssets.filter((asset) => selectedIds.has(asset?.assetId)) : [];
  const modelContext = context?.modelContext;
  if (!assets.length || !modelContext?.messageBlocks?.system) return false;
  if (modelContext.messageBlocks.system.some((message) => content(message).startsWith(contextHeading))) return false;
  const modelAssets = assets.map((asset) => ({ assetId: asset.assetId, clips: asset.animations.map((item) => item.name), nodes: asset.nodes }));
  appendContextMessage(modelContext, {
    role: "system",
    content: `${contextHeading} Use character_animation_generate only for new IDs. Use character_animation_get before character_animation_update or character_animation_script replacement. Use scene={coordinateSystem:normalized_world,targetHeight:1,groundY:0,framing:all_characters,layout:{mode:explicit,positions:[{assetId,position}]}}; provide exactly one keyed layout position per character in normalized world units. All timelines share one duration; use only listed clips/nodes.\n${JSON.stringify(modelAssets)}`,
  }, { block: "system" });
  return true;
}

export function activate(host = {}, config = {}) {
  const registerHook = host?.hooks?.register;
  const registerTool = host?.tools?.register;
  const commitArtifact = host?.artifacts?.commit;
  const getArtifact = host?.artifacts?.get;
  const replaceArtifact = host?.artifacts?.replace;
  if ([registerHook, registerTool, commitArtifact, getArtifact, replaceArtifact].some((item) => typeof item !== "function")) {
    throw new Error("character animation plugin requires hooks.register, tools.register, artifacts.commit/get/replace");
  }
  const unregister = registerHook(HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    (context) => injectAnimationContext(context, config), {
      id: "character-animation-context-before-llm-call", priority: 30,
      timeoutMs: TIME_THRESHOLDS.agent.hookTimeoutMs,
    });
  const contributions = [
    CHARACTER_ANIMATION_TOOL_ID,
    CHARACTER_ANIMATION_GET_TOOL_ID,
    CHARACTER_ANIMATION_UPDATE_TOOL_ID,
    CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
  ].map((toolId) => registerTool(toolId, (toolContext) => {
    const tool = createAnimationTools({
      commitArtifact: (artifact) => commitArtifact(artifact, toolContext),
      getArtifact: (artifact) => getArtifact(artifact, toolContext),
      replaceArtifact: (artifact) => replaceArtifact(artifact, toolContext),
      pluginConfig: config,
    }).find((item) => item.name === toolId);
    return tool;
  }));
  return createPluginActivationResult({
    pluginId: "character", surface: PLUGIN_SURFACE.AGENT,
    dispose: () => { unregister?.(); contributions.forEach((item) => item?.dispose?.()); },
  });
}

export const CHARACTER_ANIMATION_TOOL_IDS = [
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_GET_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
  CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
];
