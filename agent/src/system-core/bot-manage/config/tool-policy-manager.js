/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  DEFAULT_TOOL_POLICY,
  TOOL_POLICY_MODE,
  VALID_TOOL_POLICY_MODES,
} from "./constants.js";

/**
 * Build tool policies for session execution.
 */
export class ToolPolicyManager {
  build(scenario) {
    const policy = { ...DEFAULT_TOOL_POLICY };

    if (scenario?.tools) {
      policy.tools = this._buildToolPolicyForScenario(scenario.tools);
    }

    return policy;
  }

  _buildToolPolicyForScenario(tools) {
    if (Array.isArray(tools)) {
      return {
        allowed: tools,
        denied: [],
        mode: TOOL_POLICY_MODE.WHITELIST,
      };
    }

    if (typeof tools === "object") {
      const resolvedMode = VALID_TOOL_POLICY_MODES.includes(
        String(tools.mode || "").trim(),
      )
        ? String(tools.mode || "").trim()
        : TOOL_POLICY_MODE.WHITELIST;
      return {
        allowed: tools.allowed || [],
        denied: tools.denied || [],
        mode: resolvedMode,
      };
    }

    return {
      allowed: [],
      denied: [],
      mode: TOOL_POLICY_MODE.NONE,
    };
  }
}
