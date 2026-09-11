/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { READ_FILE_MANUAL } from "./tool-manual/read-file.js";
import { WRITE_FILE_MANUAL } from "./tool-manual/write-file.js";
import { SEARCH_MANUAL } from "./tool-manual/search.js";
import { PATCH_FILE_MANUAL } from "./tool-manual/patch-file.js";
import { EXECUTE_SCRIPT_MANUAL } from "./tool-manual/execute-script.js";
import { EXECUTE_NATIVE_SCRIPT_MANUAL } from "./tool-manual/execute-native-script.js";
import { LIST_SKILLS_MANUAL } from "./tool-manual/list-skills.js";
import { CALL_SERVICE_MANUAL } from "./tool-manual/call-service.js";
import { CALL_MCP_TASK_MANUAL } from "./tool-manual/call-mcp-task.js";
import { SWITCH_MODEL_MANUAL } from "./tool-manual/switch-model.js";
import { USER_INTERACTION_MANUAL } from "./tool-manual/user-interaction.js";
import { ACCESS_CONNECTOR_MANUAL } from "./tool-manual/access-connector.js";
import { WEB_SEARCH_MANUAL } from "./tool-manual/web-search.js";
import { MULTIMODAL_MANUAL } from "./tool-manual/multimodal.js";
import { TASK_ORCHESTRATION_MANUAL } from "./tool-manual/task-orchestration.js";
import { HELP_MANUAL } from "./tool-manual/help.js";

export const TOOL_MANUAL_BY_TOOL = {
  ...READ_FILE_MANUAL,
  ...WRITE_FILE_MANUAL,
  ...SEARCH_MANUAL,
  ...PATCH_FILE_MANUAL,
  ...EXECUTE_SCRIPT_MANUAL,
  ...EXECUTE_NATIVE_SCRIPT_MANUAL,
  ...LIST_SKILLS_MANUAL,
  ...CALL_SERVICE_MANUAL,
  ...CALL_MCP_TASK_MANUAL,
  ...SWITCH_MODEL_MANUAL,
  ...USER_INTERACTION_MANUAL,
  ...ACCESS_CONNECTOR_MANUAL,
  ...WEB_SEARCH_MANUAL,
  ...MULTIMODAL_MANUAL,
  ...TASK_ORCHESTRATION_MANUAL,
  ...HELP_MANUAL,
};
