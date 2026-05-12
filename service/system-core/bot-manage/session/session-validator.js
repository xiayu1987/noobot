/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isValidSessionId } from "../utils/session-utils.js";

/**
 * Validate session execution input and options.
 */
export class SessionValidator {
  /**
   * Validate input and options for session execution.
   * @param {Object} input - User input object
   * @param {Object} options - Execution options
   */
  validateInput(input, options) {
    if (!input || typeof input !== "object") {
      throw new Error("Input must be a valid object");
    }
    if (!input.content && !input.contentText) {
      throw new Error("Input must contain 'content' or 'contentText'");
    }
    if (options && options.sessionId && !isValidSessionId(options.sessionId)) {
      throw new Error("Invalid sessionId format");
    }
  }

  /**
   * Validate scenario configuration.
   * @param {Object} scenarioConfig - Scenario configuration object
   */
  validateScenarioConfig(scenarioConfig) {
    if (!scenarioConfig || typeof scenarioConfig !== "object") {
      throw new Error("Scenario config must be a valid object");
    }
    if (scenarioConfig.tools && !Array.isArray(scenarioConfig.tools)) {
      throw new Error("Scenario config 'tools' must be an array");
    }
    if (
      scenarioConfig.context &&
      typeof scenarioConfig.context !== "object"
    ) {
      throw new Error("Scenario config 'context' must be an object");
    }
  }
}
