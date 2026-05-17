/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { normalizeSkillAction, SKILL_ACTION } from "../../config/core/enums.js";
import { recoverableToolError } from "../../error/index.js";
import { safeJoin } from "../../utils/fs-safe.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { ERROR_CODE } from "../../error/constants.js";

function getBasePath(agentContext) {
  return (
    agentContext?.environment?.workspace?.basePath ||
    agentContext?.runtime?.basePath ||
    ""
  );
}

function getRuntime(agentContext) {
  return agentContext?.runtime || {};
}

export function createSkillTool({ agentContext }) {
  const basePath = getBasePath(agentContext);
  const runtime = getRuntime(agentContext);
  const currentTurnMessages = runtime?.currentTurnMessages || null;
  const currentTurnTasks = runtime?.currentTurnTasks || null;
  if (!basePath) return [];
  const skillRoot = path.join(basePath, "skills");

  const listSkillTool = new DynamicStructuredTool({
    name: "list_skills",
    description: tTool(runtime, "tools.skill.listDescription"),
    schema: z.object({
      parentSkill: z.string().optional().describe(tTool(runtime, "tools.skill.fieldParentSkill")),
    }),
    func: async ({ parentSkill }) => {
      try {
        await access(skillRoot);
      } catch {
        return toToolJsonResult("list_skills", { ok: true, items: [] }, true);
      }

      const rootDir = parentSkill
        ? safeJoin(skillRoot, parentSkill)
        : skillRoot;
      try {
        await access(rootDir);
      } catch {
        return toToolJsonResult("list_skills", { ok: true, items: [] }, true);
      }

      const items = [];
      const level1 = await readdir(rootDir, { withFileTypes: true });

      for (const entry of level1) {
        const level1Path = entry.name;
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? "dir" : "file",
          path: path.join(rootDir, level1Path),
        });

        if (!entry.isDirectory()) continue;
        const level2Dir = path.join(rootDir, entry.name);
        const level2 = await readdir(level2Dir, { withFileTypes: true });
        for (const child of level2) {
          items.push({
            name: child.name,
            type: child.isDirectory() ? "dir" : "file",
            path: path.join(level2Dir, child.name),
          });
        }
      }

      return toToolJsonResult("list_skills", { ok: true, items }, true);
    },
  });

  const manageSkillTaskTool = new DynamicStructuredTool({
    name: "set_skill_task",
    description: tTool(runtime, "tools.skill.setDescription"),
    schema: z.object({
      action: z.string().describe(tTool(runtime, "tools.skill.fieldAction")),
      skillName: z.string().optional().describe(tTool(runtime, "tools.skill.fieldSkillName")),
      taskName: z.string().optional().describe(tTool(runtime, "tools.skill.fieldTaskName")),
      taskId: z.string().optional().describe(tTool(runtime, "tools.skill.fieldTaskId")),
      result: z.string().optional().describe(tTool(runtime, "tools.skill.fieldResult")),
    }),
    func: async ({ action, skillName, taskName, taskId, result }) => {
      const normalizedAction = normalizeSkillAction(action);
      if (!normalizedAction) {
        throw recoverableToolError(
          tTool(runtime, "tools.skill.invalidAction", { action }),
          { code: ERROR_CODE.RECOVERABLE_INVALID_TOOL_INPUT },
        );
      }

      if (normalizedAction === SKILL_ACTION.START) {
        if (!String(skillName || "").trim()) {
          throw recoverableToolError(
            tTool(runtime, "tools.skill.skillNameRequiredOnStart"),
            { code: ERROR_CODE.RECOVERABLE_INPUT_MISSING },
          );
        }
        const createdTaskId = uuidv4();
        if (
          currentTurnTasks &&
          typeof currentTurnTasks.push === "function" &&
          currentTurnMessages &&
          typeof currentTurnMessages.updateLast === "function"
        ) {
          currentTurnTasks.push({
            taskId: createdTaskId,
            skillName: String(skillName || "").trim(),
            taskName: String(taskName || "").trim(),
            taskStatus: SKILL_ACTION.START,
            startedAt: new Date().toISOString(),
            endedAt: "",
          });
          currentTurnMessages.updateLast({
            taskId: createdTaskId,
            taskStatus: SKILL_ACTION.START,
          });
        }
        return toToolJsonResult(
          "set_skill_task",
          {
            ok: true,
            action: normalizedAction,
            task: {
              taskId: createdTaskId,
              skillName: skillName || "",
              taskName: taskName || "",
              taskStatus: SKILL_ACTION.START,
            },
          },
          true,
        );
      }
      let resolvedTaskId = String(taskId || "").trim();
      if (
        currentTurnTasks &&
        typeof currentTurnTasks.last === "function" &&
        typeof currentTurnTasks.updateLast === "function"
      ) {
        const lastTask = currentTurnTasks.last();
        resolvedTaskId = resolvedTaskId || String(lastTask?.taskId || "").trim();
        if (resolvedTaskId) {
          currentTurnTasks.updateLast({
            taskId: resolvedTaskId,
            taskStatus: SKILL_ACTION.COMPLETED,
            endedAt: new Date().toISOString(),
            result: result || "",
          });
          if (
            currentTurnMessages &&
            typeof currentTurnMessages.updateLast === "function"
          ) {
            currentTurnMessages.updateLast({
              taskId: resolvedTaskId,
              taskStatus: SKILL_ACTION.COMPLETED,
            });
          }
        }
      }
      return toToolJsonResult(
        "set_skill_task",
        {
          ok: true,
          action: normalizedAction,
          task: {
            taskId: resolvedTaskId,
            taskStatus: SKILL_ACTION.COMPLETED,
            result: result || "",
          },
        },
        true,
      );
    },
  });

  return [listSkillTool, manageSkillTaskTool];
}
