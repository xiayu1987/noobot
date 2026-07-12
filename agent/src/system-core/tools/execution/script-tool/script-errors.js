/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverableToolError } from "../../../error/index.js";
import { ERROR_CODE } from "../../../error/constants.js";
import { tScript } from "./script-i18n.js";

export function missingCommandError(mode, commandName = "", runtime = {}) {
  return recoverableToolError(
    tScript(runtime, "commandNotInstalled", { commandName }),
    {
      code: ERROR_CODE.RECOVERABLE_COMMAND_NOT_INSTALLED,
      details: {
        mode,
        commandName,
        code: 127,
      },
    },
  );
}

export function scriptRuntimeError(message = "", options = {}) {
  return recoverableToolError(String(message || "").trim(), {
    code: String(options?.code || ERROR_CODE.RECOVERABLE_SCRIPT_RUNTIME_ERROR),
    details:
      options?.details && typeof options.details === "object"
        ? options.details
        : {},
  });
}
