/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";
import { isValidSessionId } from "../utils/session-utils.js";
import { CALLER_ROLE, VALID_CALLER_ROLES } from "./constants.js";

/**
 * Centralized validator for bot-manage runtime input/config.
 */
export class BotManageValidator {
  normalizeRunMessage(message = "") {
    const normalizedMessage = String(message ?? "").trim();
    if (!normalizedMessage) {
      throw recoverableToolError(tSystem("common.userSessionMessageRequired"), {
        code: "RECOVERABLE_INPUT_MISSING",
      });
    }
    return normalizedMessage;
  }

  validateRunInput({
    userId,
    sessionId,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
  }) {
    if (!userId || !sessionId) {
      throw recoverableToolError(tSystem("common.userSessionRequired"), {
        code: "RECOVERABLE_INPUT_MISSING",
      });
    }
    if (!isValidSessionId(sessionId)) {
      throw recoverableToolError(tSystem("bot.invalidSessionIdFormat"), {
        code: "RECOVERABLE_INVALID_SESSION_ID",
      });
    }
    if (!VALID_CALLER_ROLES.includes(String(caller || ""))) {
      throw recoverableToolError(tSystem("bot.invalidCaller"), {
        code: "RECOVERABLE_INVALID_CALLER",
      });
    }
    if (parentSessionId && !isValidSessionId(parentSessionId)) {
      throw recoverableToolError(tSystem("bot.invalidParentSessionIdFormat"), {
        code: "RECOVERABLE_INVALID_PARENT_SESSION_ID",
      });
    }
  }

  validateScenarioConfig(scenarioConfig) {
    if (!scenarioConfig || typeof scenarioConfig !== "object") {
      throw new Error(tSystem("bot.scenarioConfigObjectRequired"));
    }
    if (scenarioConfig.tools && !Array.isArray(scenarioConfig.tools)) {
      throw new Error(tSystem("bot.scenarioConfigToolsArrayRequired"));
    }
    if (
      scenarioConfig.context &&
      typeof scenarioConfig.context !== "object"
    ) {
      throw new Error(tSystem("bot.scenarioConfigContextObjectRequired"));
    }
  }
}
