/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileTool } from "./file-tool.js";
import { createScriptTool } from "./script-tool.js";
import { createSkillTool } from "./skill-tool.js";
import { createDoc2DataTool } from "./doc2data-tool.js";
import { createServiceTool } from "./service-tool.js";
import { createAgentCollabTool } from "./agent-collab-tool.js";
import { createModelTool } from "./model-tool.js";
import { createUserInteractionTool } from "./user-interaction-tool.js";

export function buildTools(ctx) {
  return [
    ...createFileTool(ctx),
    ...createScriptTool(ctx),
    ...createSkillTool(ctx),
    ...createDoc2DataTool(ctx),
    ...createServiceTool(ctx),
    ...createAgentCollabTool(ctx),
    ...createModelTool(ctx),
    ...createUserInteractionTool(ctx),
  ];
}
