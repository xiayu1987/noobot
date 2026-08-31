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
import { readSelectedCharacterAssets } from "../asset-catalog.js";
import {
  CHARACTER_ANIMATION_GET_TOOL_ID,
  CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
} from "../contract.js";

const contextHeading = "Character animation assets:";
const content = (message = {}) => String(message?.content ?? message?.lc_kwargs?.content ?? "");

export async function injectAnimationContext(context = {}, config = {}) {
  const assets = await readSelectedCharacterAssets(config);
  const modelContext = context?.modelContext;
  if (!assets.length || !modelContext?.messageBlocks?.system) return false;
  if (
    modelContext.messageBlocks.system.some((message) => content(message).startsWith(contextHeading))
  )
    return false;
  const modelAssets = assets.map((asset) => ({
    assetId: asset.assetId,
    clips: asset.animations.map((item) => item.name),
    nodes: asset.nodes,
  }));
  appendContextMessage(
    modelContext,
    {
      role: "system",
      content: `${contextHeading} Protocol v2: generate creates a new ID; get before update; update replaces the full animation at that revision (outer animationId is canonical; omit it inside update.protocol). Each character needs characterId, assetId, rootTransform(position,rotation,scale). Scene needs normalized_world, unitHeight=1, groundY, collisionSpace, cameraTrack. All timelines share one duration and each character has one gap-free ordered segment list. To move while a native clip plays, put rootMotion.keyframes (absolute normalized-world position/rotation/scale, starting at 0 and ending at the segment duration) on that same segment; do not create overlapping segments for one character. Script uses sequence/parallel/event data only; never send JavaScript. Use only listed clips/nodes.\n${JSON.stringify(modelAssets)}`,
    },
    { block: "system" },
  );
  return true;
}

export function activate(host = {}, config = {}) {
  const registerHook = host?.hooks?.register;
  const registerTool = host?.tools?.register;
  const commitArtifact = host?.artifacts?.commit;
  const getArtifact = host?.artifacts?.get;
  if (
    [registerHook, registerTool, commitArtifact, getArtifact].some(
      (item) => typeof item !== "function",
    )
  ) {
    throw new Error(
      "character animation plugin requires hooks.register, tools.register, artifacts.commit/get",
    );
  }
  const unregister = registerHook(
    HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    (context) => injectAnimationContext(context, config),
    {
      id: "character-animation-context-before-llm-call",
      priority: 30,
      timeoutMs: TIME_THRESHOLDS.agent.hookTimeoutMs,
    },
  );
  const contributions = [
    CHARACTER_ANIMATION_TOOL_ID,
    CHARACTER_ANIMATION_GET_TOOL_ID,
    CHARACTER_ANIMATION_UPDATE_TOOL_ID,
    CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
  ].map((toolId) =>
    registerTool(toolId, (toolContext) => {
      const tool = createAnimationTools({
        commitArtifact: (artifact) => commitArtifact(artifact, toolContext),
        getArtifact: (artifact) => getArtifact(artifact, toolContext),
        resolveSelectedAssets: () => readSelectedCharacterAssets(config),
      }).find((item) => item.name === toolId);
      return tool;
    }),
  );
  return createPluginActivationResult({
    pluginId: "character",
    surface: PLUGIN_SURFACE.AGENT,
    dispose: () => {
      unregister?.();
      contributions.forEach((item) => item?.dispose?.());
    },
  });
}

export const CHARACTER_ANIMATION_TOOL_IDS = [
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_GET_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
  CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
];
