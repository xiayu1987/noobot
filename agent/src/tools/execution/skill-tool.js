/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readdir } from "node:fs/promises";
import { filePath as path, resolvePathRef } from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { safeJoin } from "../../shared/utils/fs-safe.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME } from "../constants/index.js";

function getBasePath(agentContext) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  return agentContext?.context?.environment?.workspace?.basePath || runtime?.basePath || "";
}

function toSkillDisplayPath({ targetPath = "", runtime = {}, agentContext = null } = {}) {
  const normalizedPath = String(targetPath || "").trim();
  if (!normalizedPath) return "";
  void agentContext;
  return resolvePathRef({ input: normalizedPath, workspaceRoot: runtime?.basePath || "" }).path;
}

export function createSkillTool({ agentContext }) {
  const basePath = getBasePath(agentContext);
  const runtime = getRuntimeFromAgentContext(agentContext);
  if (!basePath) return [];
  const skillRoot = path.join(basePath, "skills");

  const listSkillTool = new DynamicStructuredTool({
    name: TOOL_NAME.LIST_SKILLS,
    description: tTool(runtime, "tools.skill.listDescription"),
    schema: z.object({
      parentSkill: z.string().optional().describe(tTool(runtime, "tools.skill.fieldParentSkill")),
    }),
    func: async ({ parentSkill }) => {
      try {
        await access(skillRoot);
      } catch {
        return toToolJsonResult(TOOL_NAME.LIST_SKILLS, { ok: true, items: [] }, true);
      }

      const rootDir = parentSkill ? safeJoin(skillRoot, parentSkill) : skillRoot;
      try {
        await access(rootDir);
      } catch {
        return toToolJsonResult(TOOL_NAME.LIST_SKILLS, { ok: true, items: [] }, true);
      }

      const items = [];
      const level1 = await readdir(rootDir, { withFileTypes: true });

      for (const entry of level1) {
        const level1Path = entry.name;
        const level1FullPath = path.join(rootDir, level1Path);
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? "dir" : "file",
          path: toSkillDisplayPath({ targetPath: level1FullPath, runtime, agentContext }),
        });

        if (!entry.isDirectory()) continue;
        const level2Dir = level1FullPath;
        const level2 = await readdir(level2Dir, { withFileTypes: true });
        for (const child of level2) {
          const childFullPath = path.join(level2Dir, child.name);
          items.push({
            name: child.name,
            type: child.isDirectory() ? "dir" : "file",
            path: toSkillDisplayPath({ targetPath: childFullPath, runtime, agentContext }),
          });
        }
      }

      return toToolJsonResult(TOOL_NAME.LIST_SKILLS, { ok: true, items }, true);
    },
  });

  return [listSkillTool];
}
