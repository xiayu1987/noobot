/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SANDBOX_PROVIDER } from "@noobot/execution-isolation-protocol";
import { TOOL_NAME } from "../../constants/index.js";

export const EXECUTE_SCRIPT_TOOL_NAME = TOOL_NAME.EXECUTE_SCRIPT;
export const SANDBOX_PROVIDER_NAME = SANDBOX_PROVIDER;
export const SCRIPT_EXECUTION_MODE = Object.freeze({
  FOREGROUND: "foreground",
  BACKGROUND: "background",
});
export const SCRIPT_RESULT_CODE = Object.freeze({
  OUTPUT_LIMIT_EXCEEDED: 125,
});
