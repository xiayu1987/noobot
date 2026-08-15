/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path, PATH_CAPABILITIES } from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import {
  projectToolPathRef,
  resolveAuthorizedUserWorkspaceFilePath,
} from "../core/check-tool-input.js";
import { registerResource } from "../core/resource-broker.js";
import { createWorkspaceIoExecutor } from "../core/workspace-io-executor.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME } from "../constants/index.js";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";

function getBasePath(agentContext) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  return runtime?.basePath || "";
}

function skillRelativePath(parentSkill = "") {
  const parent = String(parentSkill || "").trim();
  return parent ? `skills/${parent}` : "skills";
}

async function resolveSkillPath({ filePath, skillRoot, agentContext }) {
  return resolveAuthorizedUserWorkspaceFilePath({
    filePath,
    agentContext,
    fieldName: "parentSkill",
    mustExist: true,
    capability: PATH_CAPABILITIES.FILE_SEARCH,
    requiredExecutionRoot: skillRoot,
  });
}

function isMissingFileError(error) {
  return error?.code === "RECOVERABLE_FILE_NOT_FOUND";
}

export function createSkillTool({ agentContext }) {
  const basePath = getBasePath(agentContext);
  const runtime = getRuntimeFromAgentContext(agentContext);
  if (!basePath) return [];
  const skillRoot = path.join(basePath, "skills");
  const workspaceIo = createWorkspaceIoExecutor({
    executionPolicy: resolveToolExecutionPolicy({
      toolName: TOOL_NAME.LIST_SKILLS,
      globalConfig: runtime?.globalConfig || {},
    }),
  });

  const listSkillTool = new DynamicStructuredTool({
    name: TOOL_NAME.LIST_SKILLS,
    description: tTool(runtime, "tools.skill.listDescription"),
    schema: z.object({
      parentSkill: z.string().optional().describe(tTool(runtime, "tools.skill.fieldParentSkill")),
    }),
    func: async ({ parentSkill }) => {
      let root;
      try {
        root = await resolveSkillPath({
          filePath: skillRelativePath(parentSkill),
          skillRoot,
          agentContext,
        });
      } catch (error) {
        if (isMissingFileError(error)) {
          return toToolJsonResult(TOOL_NAME.LIST_SKILLS, { ok: true, items: [], resources: [] }, true);
        }
        throw error;
      }
      if (!(await workspaceIo.stat(root.executionPath)).isDirectory()) {
        return toToolJsonResult(TOOL_NAME.LIST_SKILLS, { ok: true, items: [], resources: [] }, true);
      }

      const items = [];
      const resources = [];
      const addEntry = async (entryPath, entryName) => {
        const resolved = await resolveSkillPath({
          filePath: entryPath,
          skillRoot,
          agentContext,
        });
        const resource = await registerResource({
          agentContext,
          executionPath: resolved.executionPath,
          logicalPathRef: resolved.pathRef,
          capabilities: { read: true, write: false, scriptInput: true },
        });
        const entryStat = await workspaceIo.stat(resolved.executionPath);
        items.push({
          name: entryName,
          type: entryStat.isDirectory() ? "dir" : "file",
          path: projectToolPathRef(resolved.pathRef),
          resourceId: resource.resourceId,
        });
        resources.push(resource);
        return entryStat.isDirectory() ? resolved : null;
      };

      for (const entry of await workspaceIo.readDirectory(root.executionPath)) {
        const level1Path = `${skillRelativePath(parentSkill)}/${entry.name}`;
        const level1 = await addEntry(level1Path, entry.name);
        if (!level1) continue;
        for (const child of await workspaceIo.readDirectory(level1.executionPath)) {
          await addEntry(`${level1Path}/${child.name}`, child.name);
        }
      }

      return toToolJsonResult(TOOL_NAME.LIST_SKILLS, { ok: true, items, resources }, true);
    },
  });

  return [listSkillTool];
}
