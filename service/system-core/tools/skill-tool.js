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
import { safeJoin } from "../utils/fs-safe.js";
import { toToolJsonResult } from "./tool-json-result.js";
import { tTool } from "./tool-i18n.js";

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
      action: z.enum(["start", "completed"]).describe(tTool(runtime, "tools.skill.fieldAction")),
      skillName: z.string().optional().describe(tTool(runtime, "tools.skill.fieldSkillName")),
      taskName: z.string().optional().describe(tTool(runtime, "tools.skill.fieldTaskName")),
      taskId: z.string().optional().describe(tTool(runtime, "tools.skill.fieldTaskId")),
      result: z.string().optional().describe(tTool(runtime, "tools.skill.fieldResult")),
    }),
    func: async ({ action, skillName, taskName, taskId, result }) => {
      if (action === "start") {
        if (!String(skillName || "").trim()) {
          return toToolJsonResult(
            "set_skill_task",
            { ok: false, message: tTool(runtime, "tools.skill.skillNameRequiredOnStart") },
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
            taskStatus: "start",
            startedAt: new Date().toISOString(),
            endedAt: "",
          });
          currentTurnMessages.updateLast({
            taskId: createdTaskId,
            taskStatus: "start",
          });
        }
        return toToolJsonResult(
          "set_skill_task",
          {
            ok: true,
            action,
            task: {
              taskId: createdTaskId,
              skillName: skillName || "",
              taskName: taskName || "",
              taskStatus: "start",
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
            taskStatus: "completed",
            endedAt: new Date().toISOString(),
            result: result || "",
          });
          if (
            currentTurnMessages &&
            typeof currentTurnMessages.updateLast === "function"
          ) {
            currentTurnMessages.updateLast({
              taskId: resolvedTaskId,
              taskStatus: "completed",
            });
          }
        }
      }
      return toToolJsonResult(
        "set_skill_task",
        {
          ok: true,
          action,
          task: {
            taskId: resolvedTaskId,
            taskStatus: "completed",
            result: result || "",
          },
        },
        true,
      );
    },
  });

  return [listSkillTool, manageSkillTaskTool];
}
