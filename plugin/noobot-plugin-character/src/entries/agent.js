/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import { createPluginActivationResult, PLUGIN_SURFACE } from "@noobot/plugin-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { createAnimationTools } from "../animation-tools.js";
import { injectAnimationContext } from "../animation-context.js";
import { readSelectedCharacterAssets } from "../asset-catalog.js";
import {
  CHARACTER_ANIMATION_CAMERA_APPLY_TOOL_ID,
  CHARACTER_ANIMATION_GET_TOOL_ID,
  CHARACTER_ANIMATION_SCRIPT_TOOL_ID,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
  CHARACTER_CAMERA_PRESET_LIST_TOOL_ID,
} from "../contract.js";

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
    CHARACTER_CAMERA_PRESET_LIST_TOOL_ID,
    CHARACTER_ANIMATION_CAMERA_APPLY_TOOL_ID,
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
