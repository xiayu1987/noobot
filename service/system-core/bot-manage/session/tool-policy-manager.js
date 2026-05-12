/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { DEFAULT_TOOL_POLICY } from "../constants.js";

/**
 * Build tool policies for session execution.
 */
export class ToolPolicyManager {
  /**
   * Build tool policy from scenario configuration.
   * @param {Object} scenario - Resolved scenario configuration
   * @returns {Object} Tool policy object
   */
  build(scenario) {
    const policy = { ...DEFAULT_TOOL_POLICY };

    if (scenario?.tools) {
      policy.tools = this._buildToolPolicyForScenario(scenario.tools);
    }

    return policy;
  }

  /**
   * Build tool policy for specific scenario.
   * @param {Array|Object} tools - Tools configuration
   * @returns {Object} Normalized tool policy
   */
  _buildToolPolicyForScenario(tools) {
    if (Array.isArray(tools)) {
      return {
        allowed: tools,
        denied: [],
        mode: "whitelist",
      };
    }

    if (typeof tools === "object") {
      return {
        allowed: tools.allowed || [],
        denied: tools.denied || [],
        mode: tools.mode || "whitelist",
      };
    }

    return {
      allowed: [],
      denied: [],
      mode: "none",
    };
  }
}
