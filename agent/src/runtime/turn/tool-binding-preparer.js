/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { adaptToolsForBinding, appendToolCompatibilityLog } from "../../models/index.js";
import { runBestEffort } from "@noobot/shared/best-effort";
import { emitEvent } from "../../events/index.js";

export function prepareToolBinding({ tools, modelState, runtime, eventListener, turn }) {
  const adaptedBinding = adaptToolsForBinding(tools, modelState);
  const configuredToolChoice = String(adaptedBinding?.bindOptions?.tool_choice || "").trim();
  if (configuredToolChoice === "required") {
    emitEvent(eventListener, "tool_choice_required_forced_non_thinking_model", {
      turn,
    });
  }

  const boundTools = Array.isArray(adaptedBinding?.tools) ? adaptedBinding.tools : [];
  const toolMap = new Map(boundTools.map((tool) => [tool.name, tool]));

  if (Array.isArray(adaptedBinding?.droppedToolNames) && adaptedBinding.droppedToolNames.length) {
    emitEvent(eventListener, "tool_binding_adapter_dropped_tools", {
      turn,
      droppedTools: adaptedBinding.droppedToolNames,
    });
    void runBestEffort(
      () =>
        appendToolCompatibilityLog({
          modelState,
          runtime,
          event: "tool_binding_adapter_dropped_tools",
          tools: adaptedBinding.droppedToolNames,
        }),
      { operationName: "toolBinding.appendCompatibilityLog" },
    );
  }

  if (
    Array.isArray(adaptedBinding?.strictDowngradedTools) &&
    adaptedBinding.strictDowngradedTools.length
  ) {
    emitEvent(eventListener, "tool_binding_adapter_strict_downgraded", {
      turn,
      incompatibleTools: adaptedBinding.strictDowngradedTools,
    });
  }

  emitEvent(eventListener, "tool_binding_ready", {
    turn,
    toolCount: boundTools.length,
    toolNames: boundTools.map((tool) => String(tool?.name || "").trim()).filter(Boolean),
    bindOptions: adaptedBinding?.bindOptions || {},
  });

  return {
    adaptedBinding,
    configuredToolChoice,
    boundTools,
    toolMap,
  };
}
