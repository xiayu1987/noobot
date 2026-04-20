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

function getBasePath(agentContext) {
  return agentContext?.basePath || agentContext?.runtime?.basePath || "";
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
    description:
      "列出技能目录结构。\
参数说明：\
- parentSkill（可选）：技能路径；不传时默认从 skills 根目录开始。\
行为说明：\
- 返回指定目录下的第一层和第二层目录/文件。\
返回字段：\
- name：名称\
- type：类型（dir 或 file）\
- path：完整路径\
用途：用于浏览和定位技能文件结构。",
    schema: z.object({
      parentSkill: z.string().optional().describe("要浏览的技能子路径（相对 skills 根目录）"),
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
    description:
      "设置 skill 任务状态。action=start 表示开始任务（仅匹配到技能后调用）；action=completed 表示结束任务（仅正确返回完整结果后调用，报错/需要确认/需要询问时禁止调用）。",
    schema: z.object({
      action: z.enum(["start", "completed"]).describe("任务动作：start 或 completed"),
      skillName: z.string().optional().describe("技能名称，action=start 时必填"),
      taskName: z.string().optional().describe("任务名称，action=start 时可填"),
      taskId: z.string().optional().describe("任务ID，action=completed 时可填"),
      result: z.string().optional().describe("任务结果说明，action=completed 时可填"),
    }),
    func: async ({ action, skillName, taskName, taskId, result }) => {
      if (action === "start") {
        if (!String(skillName || "").trim()) {
          return toToolJsonResult(
            "set_skill_task",
            { ok: false, message: "skillName is required when action=start" },
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
