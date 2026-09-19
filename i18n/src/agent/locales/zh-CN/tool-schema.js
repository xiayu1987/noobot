/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { buildToolSchemaFlat } from "../../../shared/tool-schema-flat.js";
import { CONNECTOR_TOOL_SCHEMA } from "./tool-schema/connectors.js";
import { FILE_TOOL_SCHEMA } from "./tool-schema/files.js";
import { TASK_ORCHESTRATION_TOOL_SCHEMA } from "./tool-schema/task-orchestration.js";
import { INVOCATION_TOOL_SCHEMA } from "./tool-schema/invocation.js";
import { ASSISTANCE_TOOL_SCHEMA } from "./tool-schema/assistance.js";

export const TOOL_SCHEMA_BY_TOOL = {
  ...CONNECTOR_TOOL_SCHEMA,
  ...FILE_TOOL_SCHEMA,
  ...TASK_ORCHESTRATION_TOOL_SCHEMA,
  ...INVOCATION_TOOL_SCHEMA,
  ...ASSISTANCE_TOOL_SCHEMA,
};

export const TOOL_SCHEMA_FLAT_GENERATED = buildToolSchemaFlat(TOOL_SCHEMA_BY_TOOL);
